import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { ClerkProvider, Show, SignIn, SignUp, useClerk, useUser } from '@clerk/react';
import { publishableKeyFromHost } from '@clerk/react/internal';
import { shadcn } from '@clerk/themes';
import {
  useGetCapabilities, useGetCatalogSets, useSearchCatalogCards, useGetCatalogCard,
  useListDecks, useCreateDeck, useImportDeck, useGetDeck, useUpdateDeck,
  useDeleteDeck, useUpdateDeckCards, useValidateDeck, useExportDeck,
  usePreviewDeckRevision, useApplyDeckRevision, useUndoDeckRevision,
  useListDeckThreads, useCreateDeckThread, useGetDeckThread, useUpdateDeckThread,
  getListDecksQueryKey, getGetDeckQueryKey, getListDeckThreadsQueryKey,
  getGetDeckThreadQueryKey, getGetCatalogCardQueryKey, getSearchCatalogCardsQueryKey,
  getExportDeckQueryKey,
} from '@workspace/api-client-react';
import type { CatalogCard, Deck, DeckSettings } from '@workspace/api-client-react';
import { Link, Redirect, Route, Router as WouterRouter, Switch, useLocation, useRoute } from 'wouter';
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, CircleHelp,
  Clipboard, Coins, Compass, FileUp, Layers3, LockKeyhole, Menu, MessageCircle,
  Plus, RefreshCw, Save, Search, Settings2, ShieldCheck, SlidersHorizontal, Sparkles,
  Swords, Trash2, Undo2, X, Zap,
} from 'lucide-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';

const queryClient = new QueryClient();
const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');
const clerkPubKey = publishableKeyFromHost(window.location.hostname, import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);
const clerkProxyUrl = import.meta.env.VITE_CLERK_PROXY_URL;
if (!clerkPubKey) throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY in .env file');
function stripBase(path: string) { return basePath && path.startsWith(basePath) ? path.slice(basePath.length) || '/' : path; }
const palette: Record<string, string> = { W: 'Bone', U: 'Tide', B: 'Dusk', R: 'Ember', G: 'Moss' };
const blankSettings = (): DeckSettings => ({
  format: 'commander', colorCount: 2, colors: ['U', 'R'], playstyle: 'midrange',
  theme: null, budget: null, commanderName: null, includeCards: [], excludeCards: [],
  competitiveness: 'casual', infiniteCombos: false, selectedSetCodes: [], setMode: 'any',
});
const cx = (...v: Array<string | false | undefined>) => v.filter(Boolean).join(' ');
const money = (n?: number | null) => n == null ? '—' : `$${n.toFixed(2)}`;

function Brand({ inverse = false }: { inverse?: boolean }) {
  return <Link href="/" className={cx('brand', inverse && 'brand-inverse')} data-testid="link-brand"><span className="brand-mark"><Layers3 size={17}/></span><span>decksmith</span><span className="brand-period">.</span></Link>;
}
function Button({ children, onClick, variant = 'dark', className = '', disabled = false, type = 'button', testId }: { children: ReactNode; onClick?: () => void; variant?: 'dark' | 'light' | 'line' | 'quiet' | 'rust'; className?: string; disabled?: boolean; type?: 'button' | 'submit'; testId?: string }) {
  return <button type={type} onClick={onClick} disabled={disabled} data-testid={testId} className={cx('btn', `btn-${variant}`, className)}>{children}</button>;
}
function WordmarkFooter() { return <footer className="site-footer"><Brand/><span>Built for the table, not the algorithm.</span><span className="footer-rules">Decksmith • Commander workshop</span></footer>; }
function Header() {
  const [menu, setMenu] = useState(false);
  return <header className="topbar"><div className="topbar-inner"><Brand/><nav className={cx('nav-links', menu && 'nav-open')}><a href="#how-it-works">How it works</a><a href="#principles">Our approach</a><Link href="/saved-decks">My decks</Link></nav><div className="nav-actions"><Link href="/sign-in" className="nav-login" data-testid="link-sign-in">Sign in</Link><Link href="/sign-up" className="btn btn-dark nav-cta" data-testid="link-sign-up">Start building <ArrowRight size={15}/></Link></div><button className="mobile-menu" aria-label="Toggle menu" onClick={() => setMenu(!menu)} data-testid="button-mobile-menu"><Menu size={21}/></button></div></header>;
}
function Landing() {
  const { data: capabilities } = useGetCapabilities();
  return <main className="landing">
    <Header/>
    <section className="hero-section">
      <div className="hero-copy enter"><div className="eyebrow"><span className="eyebrow-rule"/> THE COMMANDER WORKSHOP <span className="edition">EST. AT YOUR TABLE</span></div><h1>Build a deck<br/>that <em>feels</em> like yours.</h1><p className="hero-sub">A thoughtful workshop for your next Commander deck. Get the rules right, understand every card, and make every choice your own.</p><div className="hero-cta-row"><Link href="/studio" className="btn btn-dark btn-large" data-testid="link-begin-workshop">Begin a workshop <ArrowRight size={17}/></Link><a href="#how-it-works" className="text-link">See how it works <ArrowDownToLine size={14}/></a></div><div className="hero-proof"><span className="proof-stamp"><ShieldCheck size={14}/> REAL CARD CATALOG</span><span>No invented cards. No rules guesswork.</span></div></div>
      <div className="hero-art enter" aria-label="Illustration of a Commander deck on a tabletop"><div className="orbit orbit-one"/><div className="orbit orbit-two"/><div className="card-back card-back-a"><div className="card-ornament"/><span>MAGIC<br/>THE GATHERING</span></div><div className="card-back card-back-b"><div className="sigil"/></div><div className="card-front"><div className="card-front-top"><span>◆</span><span>3R</span></div><div className="art-window"><div className="sun-disc"/><div className="mountain mountain-a"/><div className="mountain mountain-b"/><div className="figure"/></div><div className="card-info"><b>Atsushi, the Blazing Sky</b><small>Legendary Creature — Dragon Spirit</small><i>Flying, trample. When Atsushi dies, choose one —</i><span className="card-power">4 / 4</span></div></div><div className="art-caption"><span>FIELD NOTES 001</span><span>THE FIRST COMMANDER</span></div><div className="sparkle s1"/><div className="sparkle s2"/></div>
      <div className="hero-index"><span>01</span><span className="index-line"/><span>MAKE IT YOURS</span></div>
    </section>
    <section className="ticker" aria-label="Decksmith promises"><div>REAL CARDS <i>•</i> CLEAR RULES <i>•</i> YOUR KIND OF GAME <i>•</i> REAL CARDS <i>•</i> CLEAR RULES <i>•</i> YOUR KIND OF GAME</div></section>
    <section className="principles section-wrap" id="principles"><div className="section-intro"><div className="eyebrow"><span className="eyebrow-rule"/> THE TABLE IS THE POINT</div><h2>Good decks come from<br/><em>good decisions.</em></h2><p>Commander is a hundred small choices that add up to a game worth remembering. We help you make them with confidence.</p></div><div className="principle-list"><article><span className="principle-no">01</span><div><h3>Rules, in plain English.</h3><p>Card text and Commander legality come from the catalog, not a guess. Understand the why behind each choice.</p></div><BookOpen size={22}/></article><article><span className="principle-no">02</span><div><h3>Control stays with you.</h3><p>Pick the colors, set your budget, add cards you love, and tune the list by hand. The deck is yours.</p></div><SlidersHorizontal size={22}/></article><article><span className="principle-no">03</span><div><h3>Make every slot count.</h3><p>See the card count, mana curve, price, and legality as your list takes shape. No black boxes.</p></div><Coins size={22}/></article></div></section>
    <section className="workshop-section" id="how-it-works"><div className="workshop-visual"><div className="workshop-number">01 <span>/ 03</span></div><div className="mini-table"><div className="mini-glow"/><div className="mini-card mini-card1"/><div className="mini-card mini-card2"/><div className="mini-card mini-card3"/></div><div className="table-note">A little structure.<br/>A lot of room to play.</div></div><div className="workshop-copy"><div className="eyebrow"><span className="eyebrow-rule"/> THE WORKSHOP</div><h2>Start with a spark.<br/><em>Build from there.</em></h2><p>Choose a commander, theme, or the way you like to play. Then shape the supporting cast, one real card at a time.</p><ol><li><span>01</span><div><b>Set your direction</b><small>Colors, playstyle, table power, and budget.</small></div></li><li><span>02</span><div><b>Browse real cards</b><small>Search, inspect, add, and refine from the catalog.</small></div></li><li><span>03</span><div><b>Check the whole list</b><small>Catch legality and price details before you sit down.</small></div></li></ol><Link href="/studio" className="btn btn-light">Open the workshop <ArrowRight size={16}/></Link></div></section>
    <section className="plainspoken section-wrap"><div className="quote-mark">“</div><blockquote>Magic is at its best when<br/>everyone gets to play.</blockquote><div className="quote-byline">A DECKSMITH PRINCIPLE <span>—</span> SINCE ALWAYS</div><div className="quote-side">We believe the best tool<br/>is the one that helps you<br/>understand the game.</div></section>
    <section className="availability-band"><div className="availability-seal"><Sparkles size={17}/></div><div><span className="eyebrow">A NOTE ON GUIDANCE</span><h3>Build with the tools. Keep the choices yours.</h3><p>Deck catalog, editing, legality checks, and saving are ready. AI guide and chat are currently unavailable.</p></div><span className="availability-status"><i/> {capabilities?.catalogName || 'CARD CATALOG'}</span></section>
    <section className="closing-cta"><div className="eyebrow"><span className="eyebrow-rule"/> YOUR NEXT GAME STARTS HERE</div><h2>Make room for<br/><em>your kind of magic.</em></h2><Link href="/studio" className="btn btn-dark btn-large">Build your first deck <ArrowRight size={17}/></Link><p>Free to explore. Made for the table.</p></section>
    <WordmarkFooter/>
  </main>;
}

function AppShell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const [mobileNav, setMobileNav] = useState(false);
  return <div className="app-shell"><aside className={cx('sidebar', mobileNav && 'mobile-open')}><button className="mobile-close" onClick={() => setMobileNav(false)} aria-label="Close navigation" data-testid="button-close-sidebar"><X size={18}/></button><Brand inverse/><div className="sidebar-caption">YOUR WORKSHOP</div><Link href="/studio" onClick={() => setMobileNav(false)} className={cx('side-link', location === '/studio' && 'active')} data-testid="link-studio"><Compass size={17}/> Build a deck <span className="side-arrow">↗</span></Link><Link href="/saved-decks" onClick={() => setMobileNav(false)} className={cx('side-link', location === '/saved-decks' && 'active')} data-testid="link-saved-decks"><Layers3 size={17}/> Saved decks</Link><div className="sidebar-bottom"><div className="sidebar-note"><div className="note-icon"><BookOpen size={16}/></div><b>Real cards. Real rules.</b><span>Made for better games around the table.</span></div><AccountMenu/></div></aside><div className="app-main"><header className="studio-topbar"><button className="mobile-menu dark-menu" onClick={() => setMobileNav(true)} aria-label="Open navigation" data-testid="button-sidebar-menu"><Menu size={19}/></button><div className="breadcrumb"><span>Decksmith</span><span>/</span><b>{location === '/studio' ? 'New workshop' : location === '/saved-decks' ? 'Saved decks' : 'Deck editor'}</b></div><div className="topbar-user"><span className="catalog-live"><i/> CARD CATALOG</span><AccountMenu compact/></div></header><div className="page-content">{children}</div></div></div>;
}
function AccountMenu({ compact = false }: { compact?: boolean }) {
  const { user } = useUser(); const { signOut } = useClerk(); const [, setLocation] = useLocation();
  if (!user) return <Link href="/sign-in" className="account-link" data-testid="link-account-sign-in"><span className="avatar">?</span>{!compact && 'Sign in'}</Link>;
  const name = user.firstName || user.username || 'Player';
  return <div className="account-menu"><span className="avatar">{name.slice(0, 1).toUpperCase()}</span>{!compact && <span className="account-name">{name}</span>}<button className="account-signout" data-testid="button-sign-out" onClick={() => signOut({ redirectUrl: basePath || '/' })}>Sign out</button></div>;
}
function AuthGate({ children }: { children: ReactNode }) {
  return <><Show when="signed-in">{children}</Show><Show when="signed-out"><Redirect to="/sign-in"/></Show></>;
}
function ShellPage({ children }: { children: ReactNode }) { return <AuthGate><AppShell>{children}</AppShell></AuthGate>; }

function InputField({ label, value, onChange, placeholder, testId, type = 'text' }: { label: string; value: string; onChange: (v: string) => void; placeholder?: string; testId: string; type?: string }) {
  return <label className="field"><span>{label}</span><input type={type} value={value} placeholder={placeholder} onChange={e => onChange(e.target.value)} data-testid={testId}/></label>;
}
function ColorPicker({ colors, onChange }: { colors: string[]; onChange: (v: string[]) => void }) {
  const colorsList = ['W','U','B','R','G'];
  const toggle = (color: string) => onChange(colors.includes(color) ? colors.filter(c => c !== color) : colors.length < 5 ? [...colors, color] : colors);
  return <div className="color-picker">{colorsList.map(color => <button key={color} onClick={() => toggle(color)} className={cx('color-choice', colors.includes(color) && 'selected')} data-testid={`button-color-${color}`}><span className={`mana-dot mana-${color}`}>{color}</span><span>{palette[color]}</span>{colors.includes(color) && <Check size={13}/>}</button>)}</div>;
}

function Studio() {
  const [, setLocation] = useLocation();
  const [settings, setSettings] = useState<DeckSettings>(blankSettings());
  const [title, setTitle] = useState('Untitled Commander deck');
  const [commander, setCommander] = useState('');
  const [theme, setTheme] = useState('');
  const [budget, setBudget] = useState('');
  const [query, setQuery] = useState('');
  const [importOpen, setImportOpen] = useState(false);
  const [importList, setImportList] = useState('');
  const [tab, setTab] = useState<'cards' | 'sets'>('cards');
  const { data: caps } = useGetCapabilities();
  const { data: sets = [], isLoading: setsLoading, isError: setsError, refetch: refetchSets } = useGetCatalogSets();
  const searchParams = useMemo(() => ({ q: query.trim(), limit: 12 }), [query]);
  const { data: results = [], isLoading: searching, isError: searchError, refetch: refetchSearch } = useSearchCatalogCards(searchParams, { query: { enabled: query.trim().length > 0, queryKey: getSearchCatalogCardsQueryKey(searchParams) } });
  const [inspectId, setInspectId] = useState('');
  const { data: inspectCard } = useGetCatalogCard(inspectId, { query: { enabled: !!inspectId, queryKey: getGetCatalogCardQueryKey(inspectId) } });
  const create = useCreateDeck(); const importer = useImportDeck();
  const [picked, setPicked] = useState<CatalogCard[]>([]);
  const update = <K extends keyof DeckSettings>(key: K, value: DeckSettings[K]) => setSettings(s => ({ ...s, [key]: value }));
  const selectedSettings = (): DeckSettings => ({ ...settings, commanderName: commander || null, theme: theme || null, budget: budget ? Number(budget) : null });
  const addCard = (card: CatalogCard) => setPicked(cards => cards.some(c => c.id === card.id) ? cards : [...cards, card]);
  const saveDraft = () => {
    const payload = { title: title.trim() || 'Untitled Commander deck', settings: selectedSettings(), cards: picked.map(card => ({ cardId: card.id, quantity: 1, locked: false })) };
    create.mutate({ data: payload }, { onSuccess: deck => { queryClient.invalidateQueries({ queryKey: getListDecksQueryKey() }); setLocation(`/decks/${deck.id}`); } });
  };
  const handleImport = () => importer.mutate({ data: { title: title.trim() || 'Imported deck', decklist: importList, settings: selectedSettings() } }, { onSuccess: result => { queryClient.invalidateQueries({ queryKey: getListDecksQueryKey() }); setLocation(`/decks/${result.deck.id}`); } });
  return <ShellPage><div className="studio-page enter">
    <div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-rule"/> COMMANDER WORKSHOP</div><h1>Build your deck.</h1><p>Start with an idea. Make the list yours, one card at a time.</p></div><div className="heading-mark"><Compass size={20}/><span>WORKSHOP<br/>NO. 01</span></div></div>
    <div className="studio-grid">
      <section className="builder-main">
        <div className="panel section-panel"><div className="panel-heading"><span className="step-index">01</span><div><h2>Set your direction</h2><p>Choose a starting point. You can change any of this later.</p></div><Settings2 size={18}/></div>
          <InputField label="Deck name" value={title} onChange={setTitle} placeholder="A name worth remembering" testId="input-deck-title"/>
          <div className="two-fields"><InputField label="Commander (optional)" value={commander} onChange={v => { setCommander(v); update('commanderName', v || null); }} placeholder="Find a legendary creature" testId="input-commander"/><label className="field"><span>Playstyle</span><select value={settings.playstyle} onChange={e => update('playstyle', e.target.value as DeckSettings['playstyle'])} data-testid="select-playstyle"><option value="help-me-choose">Help me choose</option><option value="aggro">Aggro — move fast</option><option value="control">Control — stay in charge</option><option value="combo">Combo — assemble a plan</option><option value="midrange">Midrange — adapt as you go</option></select></label></div>
          <div className="field"><div className="field-title-row"><span>Color identity</span><small>Pick up to five</small></div><ColorPicker colors={settings.colors} onChange={c => { update('colors', c as DeckSettings['colors']); update('colorCount', c.length); }}/></div>
          <div className="two-fields"><InputField label="Theme or idea" value={theme} onChange={v => { setTheme(v); update('theme', v || null); }} placeholder="Sea monsters, +1/+1 counters…" testId="input-theme"/><InputField label="Budget (USD)" value={budget} onChange={v => { setBudget(v); update('budget', v ? Number(v) : null); }} placeholder="No limit" testId="input-budget" type="number"/></div>
          <div className="two-fields"><label className="field"><span>Table power</span><select value={settings.competitiveness} onChange={e => update('competitiveness', e.target.value as DeckSettings['competitiveness'])} data-testid="select-competitiveness"><option value="casual">Relaxed · casual</option><option value="balanced">Focused · balanced</option><option value="high-power">Sharp · high power</option></select></label><label className="toggle-row"><span><b>Infinite combos</b><small>Allow repeatable game-ending lines</small></span><input type="checkbox" checked={settings.infiniteCombos} onChange={e => update('infiniteCombos', e.target.checked)} data-testid="toggle-infinite-combos"/></label></div>
           <div className="two-fields"><InputField label="Must include" value={settings.includeCards.join(', ')} onChange={v => update('includeCards', v.split(',').map(item => item.trim()).filter(Boolean))} placeholder="Sol Ring, a favorite card…" testId="input-include-cards"/><InputField label="Leave out" value={settings.excludeCards.join(', ')} onChange={v => update('excludeCards', v.split(',').map(item => item.trim()).filter(Boolean))} placeholder="Cards you don’t want" testId="input-exclude-cards"/></div>
        </div>
        <div className="panel section-panel catalog-panel"><div className="panel-heading"><span className="step-index">02</span><div><h2>Find your cards</h2><p>Browse a real Magic catalog. Inspect details before adding.</p></div><Search size={18}/></div>
          <div className="catalog-switch"><button className={cx(tab === 'cards' && 'selected')} onClick={() => setTab('cards')} data-testid="tab-catalog-cards"><Search size={14}/> Cards</button><button className={cx(tab === 'sets' && 'selected')} onClick={() => setTab('sets')} data-testid="tab-catalog-sets"><Layers3 size={14}/> Sets</button></div>
          {tab === 'cards' ? <><div className="search-box"><Search size={17}/><input value={query} onChange={e => setQuery(e.target.value)} placeholder="Search by card name or rules text…" data-testid="input-card-search"/>{query && <button onClick={() => setQuery('')} aria-label="Clear search" data-testid="button-clear-search"><X size={15}/></button>}</div>
            {!query && <div className="catalog-hint"><span className="hint-rule"/> Try a card name, creature type, or rules phrase.</div>}
            {searching && <div className="skeleton-list"><i/><i/><i/></div>}
            {searchError && <div className="inline-error">The card catalog could not be reached. <button onClick={() => refetchSearch()} data-testid="button-retry-search">Retry</button></div>}
            {query && !searching && !searchError && <div className="card-results">{results.length ? results.map(card => <div className="catalog-card-row" key={card.id} data-testid={`card-result-${card.id}`}><button className="card-result-main" onClick={() => setInspectId(card.id)}><div className="card-thumbnail">{card.imageUri ? <img src={card.imageUri} alt=""/> : <span><Layers3 size={20}/></span>}</div><span className="card-result-copy"><b>{card.name}</b><small>{card.typeLine}</small><span className="result-meta">{card.setName} · {money(card.priceUsd)}</span></span></button><div className="card-row-actions"><span className={cx('legal-chip', card.legalCommander ? 'legal' : 'not-legal')}>{card.legalCommander ? 'LEGAL' : 'CHECK'}</span><button className="add-card-btn" onClick={() => addCard(card)} aria-label={`Add ${card.name}`} data-testid={`button-add-card-${card.id}`}><Plus size={17}/></button></div></div>) : <div className="empty-search"><Search size={20}/><span>No matching cards in this search.</span></div>}</div>}
          </> : <div className="set-browser">{setsLoading ? <div className="skeleton-list"><i/><i/><i/></div> : setsError ? <div className="inline-error">Sets unavailable. <button onClick={() => refetchSets()} data-testid="button-retry-sets">Retry</button></div> : sets.map(set => <button key={set.code} className={cx('set-row', settings.selectedSetCodes.includes(set.code) && 'selected')} onClick={() => update('selectedSetCodes', settings.selectedSetCodes.includes(set.code) ? settings.selectedSetCodes.filter(code => code !== set.code) : [...settings.selectedSetCodes, set.code])} data-testid={`button-set-${set.code}`}><span className="set-icon">{set.iconUri ? <img src={set.iconUri} alt=""/> : <Layers3 size={15}/>}</span><span><b>{set.name}</b><small>{set.code.toUpperCase()} · {set.cardCount} cards</small></span>{settings.selectedSetCodes.includes(set.code) && <Check size={15}/>}</button>)}</div>}
          <div className="set-mode-row"><span>Set preference</span><select value={settings.setMode} onChange={e => update('setMode', e.target.value as DeckSettings['setMode'])} data-testid="select-set-mode"><option value="any">Any printing</option><option value="prefer">Prefer selected sets</option><option value="only">Only selected sets</option></select></div>
        </div>
        <div className="panel selected-panel"><div className="panel-heading"><span className="step-index">03</span><div><h2>Your first picks</h2><p>{picked.length} {picked.length === 1 ? 'card' : 'cards'} in the workshop</p></div><span className="count-pill">{picked.length}</span></div>
          {picked.length ? <div className="picked-list">{picked.map(c => <div className="picked-row" key={c.id}><span className="picked-name">{c.name}</span><span className="picked-mana">{c.manaCost || '—'}</span><button onClick={() => setPicked(items => items.filter(card => card.id !== c.id))} aria-label={`Remove ${c.name}`} data-testid={`button-remove-card-${c.id}`}><X size={15}/></button></div>)}</div> : <div className="empty-picks"><Plus size={16}/><span>Cards you add from the catalog will gather here.</span></div>}
        </div>
      </section>
      <aside className="builder-aside">
        <div className="sticky-card deck-summary-card"><div className="summary-overline"><Swords size={14}/> DECK IN PROGRESS <span>01</span></div><h3>{title || 'Untitled deck'}</h3><div className="summary-commander">{commander ? <><span className="mini-seal">C</span><span>{commander}</span></> : <><span className="mini-seal muted-seal">?</span><span>Choose a commander to begin</span></>}</div><div className="summary-colorline">{settings.colors.length ? settings.colors.map(c => <span key={c} className={`mana-dot mana-${c}`}>{c}</span>) : <span className="colorless-note">Colorless</span>}<span className="color-label">{settings.colors.map(c => palette[c]).join(' / ') || 'No colors selected'}</span></div><div className="summary-metrics"><div><span>CARDS</span><b>{picked.length}</b><small>of 100</small></div><div><span>BUDGET</span><b>{budget ? `$${Number(budget).toFixed(0)}` : 'Open'}</b><small>target</small></div></div><div className="summary-note"><CircleHelp size={15}/><p>Start with the feeling you want at the table. We’ll keep the rules and card details clear as you go.</p></div><Button onClick={saveDraft} disabled={create.isPending || !title.trim()} className="full-width" testId="button-save-deck">{create.isPending ? 'Saving workshop…' : <><Save size={16}/> Save this deck</>}</Button>{create.isError && <p className="error-text">Could not save your deck. Please try again.</p>}<button className="import-link" onClick={() => setImportOpen(true)} data-testid="button-open-import"><FileUp size={15}/> Import a decklist instead</button><div className="ai-unavailable"><span className="ai-status-dot"/><div><b>AI guidance unavailable</b><small>{caps?.catalogName || 'Catalog and deck tools still work normally.'}</small></div><LockKeyhole size={14}/></div></div>
      </aside>
    </div>
    {importOpen && <div className="modal-backdrop" role="presentation"><div className="modal-card" role="dialog" aria-modal="true" aria-labelledby="import-title"><button className="modal-close" onClick={() => setImportOpen(false)} aria-label="Close import" data-testid="button-close-import"><X size={19}/></button><div className="eyebrow"><span className="eyebrow-rule"/> BRING YOUR LIST</div><h2 id="import-title">Import a decklist.</h2><p>Paste a plain-text list. We’ll resolve the card names against the catalog and flag anything that needs attention.</p><label className="field"><span>Decklist</span><textarea rows={9} value={importList} onChange={e => setImportList(e.target.value)} placeholder={'1 Sol Ring\\n1 Command Tower\\n...'} data-testid="textarea-import-list"/></label><div className="modal-actions"><Button variant="line" onClick={() => setImportOpen(false)}>Cancel</Button><Button onClick={handleImport} disabled={!importList.trim() || importer.isPending} testId="button-import-deck">{importer.isPending ? 'Resolving cards…' : <><FileUp size={15}/> Import list</>}</Button></div>{importer.isError && <div className="inline-error">Import could not be completed. Check the list and try again.</div>}</div></div>}
    {inspectCard && <CardDetail card={inspectCard} onClose={() => setInspectId('')} onAdd={() => { addCard(inspectCard); setInspectId(''); }}/>}
  </div></ShellPage>;
}

function CardDetail({ card, onClose, onAdd }: { card: CatalogCard; onClose: () => void; onAdd: () => void }) {
  return <div className="modal-backdrop" role="presentation"><div className="modal-card card-detail" role="dialog" aria-modal="true"><button className="modal-close" onClick={onClose} aria-label="Close card details" data-testid="button-close-card-details"><X size={19}/></button><div className="card-detail-layout"><div className="detail-image">{card.imageLargeUri || card.imageUri ? <img src={card.imageLargeUri || card.imageUri || ''} alt={card.name}/> : <span><Layers3 size={36}/></span>}</div><div className="detail-copy"><div className="eyebrow"><span className="eyebrow-rule"/> CATALOG CARD</div><h2>{card.name}</h2><div className="detail-type">{card.manaCost} · {card.typeLine}</div><p className="oracle-text">{card.oracleText || 'No rules text.'}</p>{card.cardFaces.length > 1 && card.cardFaces.map(face => <div className="face-rules" key={face.name}><b>{face.name}</b><p>{face.typeLine}</p><small>{face.oracleText}</small></div>)}<div className="detail-facts"><span><small>PRINTING</small><b>{card.setName}</b></span><span><small>PRICE</small><b>{money(card.priceUsd)}</b></span><span><small>COMMANDER</small><b>{card.legalCommander ? 'Legal' : 'Not legal'}</b></span></div><Button onClick={onAdd} className="full-width" testId="button-add-card-detail"><Plus size={16}/> Add to workshop</Button></div></div></div></div>;
}

function SavedDecks() {
  const { data: decks = [], isLoading, isError, refetch } = useListDecks();
  const remove = useDeleteDeck();
  return <ShellPage><div className="saved-page enter"><div className="page-heading"><div><div className="eyebrow"><span className="eyebrow-rule"/> YOUR WORKSHOP</div><h1>Saved decks.</h1><p>Every idea you’ve put on the table, all in one place.</p></div><Link href="/studio" className="btn btn-dark" data-testid="link-new-deck"><Plus size={16}/> New deck</Link></div>
    {isLoading ? <div className="deck-grid-skeleton"><i/><i/><i/></div> : isError ? <div className="error-state"><ShieldCheck size={24}/><h2>Your decks didn’t load.</h2><p>There’s a connection issue. Your saved lists are still safe.</p><Button onClick={() => refetch()} testId="button-retry-decks"><RefreshCw size={15}/> Try again</Button></div> : decks.length ? <div className="saved-deck-list">{decks.map((deck, i) => <article className="saved-deck-card" key={deck.id} data-testid={`deck-summary-${deck.id}`}><div className={`deck-emblem emblem-${i % 4}`}><Layers3 size={23}/><span>{String(i + 1).padStart(2, '0')}</span></div><div className="saved-info"><div className="saved-card-meta"><span className={cx('status-dot', deck.status)}/><span>{deck.status}</span><span>·</span><span>{deck.totalCards} cards</span><span>·</span><span>Updated {new Date(deck.updatedAt).toLocaleDateString()}</span></div><Link href={`/decks/${deck.id}`} className="saved-title" data-testid={`link-deck-${deck.id}`}>{deck.title}</Link><p>{deck.commanderName || 'Commander not selected'} <span>·</span> {money(deck.estimatedTotal)} estimated</p></div><div className="saved-side"><div className="saved-count"><b>{deck.totalCards}</b><small>/ 100</small></div><Link href={`/decks/${deck.id}`} className="open-deck" data-testid={`link-open-deck-${deck.id}`}><ArrowRight size={18}/></Link><button className="delete-deck" onClick={() => { if (window.confirm(`Delete “${deck.title}”? This cannot be undone.`)) remove.mutate({ deckId: deck.id }, { onSuccess: () => queryClient.invalidateQueries({ queryKey: getListDecksQueryKey() }) }); }} aria-label={`Delete ${deck.title}`} data-testid={`button-delete-deck-${deck.id}`}><Trash2 size={15}/></button></div></article>)}</div> : <div className="empty-decks"><div className="empty-crest"><Layers3 size={27}/></div><span className="eyebrow">A CLEAN TABLE</span><h2>Your next deck starts here.</h2><p>Give an idea a name, pick a color identity, and find your first card.</p><Link href="/studio" className="btn btn-dark" data-testid="link-empty-new-deck">Start a workshop <ArrowRight size={16}/></Link></div>}
  </div></ShellPage>;
}

function DeckEditor({ deckId }: { deckId: string }) {
  const [, setLocation] = useLocation();
  const { data: deck, isLoading, isError, refetch } = useGetDeck(deckId, { query: { enabled: !!deckId, queryKey: getGetDeckQueryKey(deckId) } });
  const { data: caps } = useGetCapabilities();
  const [titleDraft, setTitleDraft] = useState('');
  const [search, setSearch] = useState('');
  const [threadTitle, setThreadTitle] = useState('');
  const [threadId, setThreadId] = useState('');
  const [revision, setRevision] = useState<Deck['cards'] | null>(null);
  const { data: cardResults = [] } = useSearchCatalogCards({ q: search.trim(), limit: 8 }, { query: { enabled: search.trim().length > 0, queryKey: getSearchCatalogCardsQueryKey({ q: search.trim(), limit: 8 }) } });
  const { data: threads = [] } = useListDeckThreads(deckId, { query: { enabled: !!deckId, queryKey: getListDeckThreadsQueryKey(deckId) } });
  const { data: threadDetail } = useGetDeckThread(deckId, threadId, { query: { enabled: !!threadId, queryKey: getGetDeckThreadQueryKey(deckId, threadId) } });
  const update = useUpdateDeck(); const cardsUpdate = useUpdateDeckCards(); const validate = useValidateDeck(); const removeDeck = useDeleteDeck();
  const exporter = useExportDeck(deckId, { query: { enabled: false, queryKey: getExportDeckQueryKey(deckId) } });
  const preview = usePreviewDeckRevision(); const apply = useApplyDeckRevision(); const undo = useUndoDeckRevision();
  const newThread = useCreateDeckThread(); const renameThread = useUpdateDeckThread();
  const refreshDeck = () => queryClient.invalidateQueries({ queryKey: getGetDeckQueryKey(deckId) });
  useEffect(() => { if (deck) setTitleDraft(deck.title); }, [deck?.id, deck?.title]);
  if (isLoading) return <ShellPage><div className="loading-editor"><i/><i/><i/></div></ShellPage>;
  if (isError || !deck) return <ShellPage><div className="error-state"><h2>This deck isn’t available.</h2><p>It may have been removed or the connection may have dropped.</p><Button onClick={() => refetch()} testId="button-retry-deck"><RefreshCw size={15}/> Try again</Button><Link href="/saved-decks" className="text-link">Back to saved decks</Link></div></ShellPage>;
  const list = revision || deck.cards;
  const updateCards = (next: typeof deck.cards) => cardsUpdate.mutate({ deckId, data: { cards: next.map(c => ({ cardId: c.card.id, quantity: c.quantity, locked: c.locked })) } }, { onSuccess: () => { setRevision(null); refreshDeck(); } });
  const add = (card: CatalogCard) => {
    const existing = deck.cards.find(item => item.card.id === card.id);
    updateCards(existing
      ? deck.cards.map(item => item.card.id === card.id ? { ...item, quantity: Math.min(100, item.quantity + 1) } : item)
      : [...deck.cards, { card, quantity: 1, locked: false, isCommander: false, roles: [] }]);
  };
  const checkRevision = () => preview.mutate({ deckId, data: { cards: list.map(c => ({ cardId: c.card.id, quantity: c.quantity, locked: c.locked })) } });
  const exportList = async () => {
    try { const result = await queryClient.fetchQuery({ queryKey: getExportDeckQueryKey(deckId), queryFn: () => exporter.refetch().then(r => r.data!) }); if (result?.decklist) { await navigator.clipboard.writeText(result.decklist); window.alert('Decklist copied to clipboard.'); } } catch { window.alert('Could not export this deck. Try again.'); }
  };
  return <ShellPage><div className="editor-page enter">
    <div className="editor-header"><Link href="/saved-decks" className="back-link" data-testid="link-back-to-decks"><ArrowLeft size={15}/> Saved decks</Link><div className="editor-heading"><div><div className="eyebrow"><span className="eyebrow-rule"/> COMMANDER DECK</div><input className="editor-title" value={titleDraft} onChange={e => setTitleDraft(e.target.value)} onBlur={() => { if (titleDraft.trim() && titleDraft !== deck.title) update.mutate({ deckId, data: { title: titleDraft.trim() } }, { onSuccess: refreshDeck }); }} aria-label="Deck title" data-testid="input-editor-title"/><div className="editor-subtitle">{deck.commanderName || 'Commander not selected'} <span>·</span> Edited {new Date(deck.updatedAt).toLocaleDateString()}</div></div><div className="editor-actions"><Button variant="line" onClick={exportList} testId="button-export-deck"><Clipboard size={15}/> Export</Button><Button onClick={() => validate.mutate({ deckId }, { onSuccess: refreshDeck })} disabled={validate.isPending} testId="button-validate-deck"><ShieldCheck size={15}/>{validate.isPending ? 'Checking…' : 'Check deck'}</Button></div></div>
    </div>
    <div className="legality-banner"><span className={cx('legality-icon', deck.legality.status)}>{deck.legality.status === 'legal' ? <Check size={17}/> : <CircleHelp size={17}/>}</span><div><b>{deck.legality.status === 'legal' ? 'Commander legal' : deck.legality.status === 'incomplete' ? 'Still taking shape' : deck.legality.status === 'illegal' ? 'Needs a closer look' : 'Draft list'}</b><small>{deck.legality.totalCards} cards · {deck.legality.issues.length ? deck.legality.issues.join(' · ') : 'No rule issues found'}</small></div><span className="legality-price">{money(deck.pricing.estimatedTotal)}<small>EST. TOTAL</small></span><button className="undo-btn" disabled={!deck.canUndo || undo.isPending} onClick={() => undo.mutate({ deckId }, { onSuccess: refreshDeck })} data-testid="button-undo-deck"><Undo2 size={15}/> Undo</button></div>
    <div className="editor-layout"><section className="editor-main">
      <div className="editor-tabs"><span className="editor-tab active"><Layers3 size={15}/> Cards <b>{deck.totalCards}</b></span><span className="editor-tab-help">{deck.cards.length} unique</span><button className="layout-toggle" onClick={() => update.mutate({ deckId, data: { viewPreference: deck.viewPreference === 'list' ? 'images' : 'list' } }, { onSuccess: refreshDeck })} data-testid="button-toggle-card-view"><Menu size={15}/>{deck.viewPreference === 'list' ? 'List view' : 'Image view'}</button></div>
      <div className="deck-card-table"><div className="table-head"><span>CARD</span><span>ROLE</span><span>QTY</span><span>PRICE</span><span/></div>{deck.cards.length ? deck.cards.map(row => <div className="deck-card-row" key={row.card.id} data-testid={`deck-card-${row.card.id}`}><div className="editor-card-name"><span className="editor-thumb">{row.card.imageUri && <img src={row.card.imageUri} alt=""/>}</span><span><b>{row.card.name}</b><small>{row.card.typeLine}</small></span>{row.isCommander && <em>COMMANDER</em>}</div><div className="role-chips">{row.roles.slice(0, 2).map(r => <span key={r}>{r}</span>)}<button className={cx('locked-toggle', row.locked && 'is-locked')} onClick={() => updateCards(deck.cards.map(c => c.card.id === row.card.id ? { ...c, locked: !c.locked } : c))} aria-label={`${row.locked ? 'Unlock' : 'Lock'} ${row.card.name}`} data-testid={`button-lock-card-${row.card.id}`}><LockKeyhole size={12}/></button></div><div className="qty-control"><button onClick={() => updateCards(deck.cards.map(c => c.card.id === row.card.id ? { ...c, quantity: Math.max(1, c.quantity - 1) } : c))} aria-label={`Decrease ${row.card.name}`} data-testid={`button-qty-minus-${row.card.id}`}>−</button><span>{row.quantity}</span><button onClick={() => updateCards(deck.cards.map(c => c.card.id === row.card.id ? { ...c, quantity: Math.min(100, c.quantity + 1) } : c))} aria-label={`Increase ${row.card.name}`} data-testid={`button-qty-plus-${row.card.id}`}>+</button></div><span className="deck-price">{money(row.card.priceUsd)}</span><button className="row-remove" onClick={() => updateCards(deck.cards.filter(c => c.card.id !== row.card.id))} aria-label={`Remove ${row.card.name}`} data-testid={`button-remove-deck-card-${row.card.id}`}><X size={15}/></button></div>) : <div className="empty-deck-editor"><Layers3 size={23}/><b>No cards in this deck yet.</b><span>Use the catalog search below to add a card.</span></div>}</div>
      <div className="deck-search-add"><div className="search-box compact-search"><Search size={16}/><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Add cards from the catalog…" data-testid="input-editor-card-search"/></div>{search && <div className="editor-search-results">{cardResults.map(card => <button key={card.id} onClick={() => add(card)} data-testid={`button-editor-add-${card.id}`}><span>{card.name}<small>{card.typeLine}</small></span><Plus size={15}/></button>)}</div>}</div>
      {deck.unresolvedNames.length > 0 && <div className="unresolved-box"><FileUp size={16}/><div><b>Some imported names need attention</b><p>{deck.unresolvedNames.join(' · ')}</p></div></div>}
      <div className="threads-panel"><div className="thread-heading"><div><span className="eyebrow"><span className="eyebrow-rule"/> DECK THREADS</span><h3>Notes from the table</h3></div><button onClick={() => { const title = window.prompt('Name this thread'); if (title?.trim()) newThread.mutate({ deckId, data: { title: title.trim() } }, { onSuccess: thread => { setThreadId(thread.id); queryClient.invalidateQueries({ queryKey: getListDeckThreadsQueryKey(deckId) }); } }); }} className="thread-add" data-testid="button-new-thread"><Plus size={15}/> New thread</button></div>
        {threads.length ? <div className="thread-list">{threads.map(thread => <button className={cx('thread-pill', thread.id === threadId && 'selected')} key={thread.id} onClick={() => setThreadId(thread.id)} data-testid={`button-thread-${thread.id}`}><MessageCircle size={14}/>{thread.title}<span>{new Date(thread.updatedAt).toLocaleDateString()}</span></button>)}</div> : <p className="thread-empty">Keep a running note about your choices. AI chat is unavailable, but threads are saved here.</p>}
        {threadId && <div className="thread-detail">{threadDetail?.messages.length ? threadDetail.messages.map(msg => <div key={msg.id} className={`thread-message ${msg.role}`} data-testid={`message-${msg.id}`}><span>{msg.role === 'assistant' ? 'GUIDE' : 'YOU'}</span><p>{msg.content}</p></div>) : <p className="thread-empty">No messages in this thread yet.</p>}<div className="ai-offline-notice"><LockKeyhole size={15}/><span>AI chat is unavailable right now. Your saved thread remains here.</span></div>{threadTitle && <div className="rename-inline"><input value={threadTitle} onChange={e => setThreadTitle(e.target.value)} aria-label="Thread title" data-testid="input-thread-title"/><Button variant="line" onClick={() => renameThread.mutate({ deckId, threadId, data: { title: threadTitle } }, { onSuccess: () => { setThreadTitle(''); queryClient.invalidateQueries({ queryKey: getListDeckThreadsQueryKey(deckId) }); } })} testId="button-rename-thread">Rename</Button></div>}<button className="rename-trigger" onClick={() => setThreadTitle(threadDetail?.thread.title || '')} data-testid="button-edit-thread-title">Rename thread</button></div>}
      </div>
    </section>
    <aside className="editor-aside"><div className="editor-side-card"><span className="side-card-kicker">DECK HEALTH</span><div className="deck-health-count"><b>{deck.totalCards}</b><span>/ 100 cards</span></div><div className="health-bar"><i style={{ width: `${Math.min(deck.totalCards, 100)}%` }}/></div><div className="health-row"><span><ShieldCheck size={14}/> Legality</span><b className={deck.legality.status === 'legal' ? 'green-text' : 'rust-text'}>{deck.legality.status}</b></div><div className="health-row"><span><Coins size={14}/> Estimated value</span><b>{money(deck.pricing.estimatedTotal)}</b></div><div className="health-row"><span><Zap size={14}/> Price verified</span><b>{deck.pricing.verified ? 'Yes' : 'Partial'}</b></div><div className="curve-section"><div className="curve-title">MANA CURVE <span>MV</span></div><div className="curve-bars">{deck.stats.manaCurve.map(item => <div key={item.manaValue} className="curve-col"><span style={{ height: `${Math.max(5, item.count * 7)}px` }}/><small>{item.manaValue}</small></div>)}</div></div><div className="roles-section"><div className="curve-title">DECK ROLES</div>{deck.stats.roleCounts.slice(0, 5).map(role => <div className="role-progress" key={role.role}><span>{role.role}</span><b>{role.count}</b></div>)}</div></div>
      <button className="review-changes-button" onClick={checkRevision} disabled={preview.isPending} data-testid="button-preview-revision"><SlidersHorizontal size={14}/>{preview.isPending ? 'Reviewing changes…' : 'Preview card changes'}</button>
      <div className="guide-card"><div className="guide-card-head"><Sparkles size={15}/><b>Deck guide</b></div><div className="guide-unavailable"><LockKeyhole size={18}/><b>AI guidance is unavailable</b><p>Your deck, card data, and rules checks are still fully editable. No generated strategy will be shown.</p><small>{caps?.catalogName || 'Card catalog active'}</small></div><details><summary>Saved guide notes <ChevronDown size={14}/></summary>{Object.entries(deck.guide).map(([key, value]) => <div className="guide-note" key={key}><b>{key.replace(/([A-Z])/g, ' $1')}</b><p>{value || 'No note yet.'}</p></div>)}</details></div>
      <div className="editor-danger"><button onClick={() => { if (window.confirm(`Delete “${deck.title}”? This cannot be undone.`)) removeDeck.mutate({ deckId }, { onSuccess: () => { queryClient.invalidateQueries({ queryKey: getListDecksQueryKey() }); setLocation('/saved-decks'); } }); }} data-testid="button-editor-delete"><Trash2 size={14}/> Delete deck</button><span>Changes save as you work.</span></div>
    </aside></div>
    {preview.data && <div className="revision-preview"><button className="modal-close" onClick={() => preview.reset()} aria-label="Close revision preview" data-testid="button-close-revision-preview"><X size={17}/></button><h3>Review your changes</h3><p>{preview.data.additions.length} additions · {preview.data.removals.length} removals</p>{preview.data.warnings.map(w => <div className="revision-warning" key={w}>{w}</div>)}<Button onClick={() => apply.mutate({ deckId, data: { cards: list.map(c => ({ cardId: c.card.id, quantity: c.quantity, locked: c.locked })) } }, { onSuccess: () => { preview.reset(); refreshDeck(); } })} testId="button-apply-revision"><Check size={15}/> Apply revision</Button></div>}
  </div></ShellPage>;
}

function SignInPage() { return <div className="auth-page"><div className="auth-brand"><Brand/><span>A better table starts here.</span></div><SignIn routing="path" path={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`}/></div>; }
function SignUpPage() { return <div className="auth-page"><div className="auth-brand"><Brand/><span>A better table starts here.</span></div><SignUp routing="path" path={`${basePath}/sign-up`} signInUrl={`${basePath}/sign-in`}/></div>; }
function ClerkCacheClearer() {
  const { addListener } = useClerk(); const client = useQueryClient(); const prev = useRef<string | null | undefined>(undefined);
  useEffect(() => { const unsubscribe = addListener(({ user }) => { const id = user?.id ?? null; if (prev.current !== undefined && prev.current !== id) client.clear(); prev.current = id; }); return unsubscribe; }, [addListener, client]);
  return null;
}
function HomeRoute() { return <><Show when="signed-in"><Redirect to="/studio"/></Show><Show when="signed-out"><Landing/></Show></>; }
function ErrorBoundaryRoute({ children }: { children: ReactNode }) { const [location] = useLocation(); return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>; }
function RoutedApp() {
  const [, setLocation] = useLocation();
  return <ClerkProvider publishableKey={clerkPubKey} proxyUrl={clerkProxyUrl} appearance={{
    theme: shadcn, cssLayerName: 'clerk', options: { logoPlacement: 'inside', logoLinkUrl: basePath || '/', logoImageUrl: `${window.location.origin}${basePath}/logo.svg` },
    variables: { colorPrimary: '#315f4d', colorForeground: '#2b3037', colorMutedForeground: '#72736f', colorDanger: '#9c453c', colorBackground: '#f7f4ec', colorInput: '#f1eee6', colorInputForeground: '#2b3037', colorNeutral: '#2b3037', fontFamily: 'DM Sans', borderRadius: '0.7rem' },
    elements: {
      rootBox: 'w-full flex justify-center', cardBox: 'bg-[#f7f4ec] rounded-2xl w-[440px] max-w-full overflow-hidden shadow-xl',
      card: '!shadow-none !border-0 !bg-transparent !rounded-none', footer: '!shadow-none !border-0 !bg-transparent !rounded-none',
      headerTitle: 'text-[#272e36] font-serif', headerSubtitle: 'text-[#666b68]', socialButtonsBlockButtonText: 'text-[#303735] font-semibold',
      formFieldLabel: 'text-[#3e4743] font-semibold', footerActionLink: 'text-[#315f4d] font-semibold', footerActionText: 'text-[#666b68]',
      dividerText: 'text-[#77766f]', identityPreviewEditButton: 'text-[#315f4d]', formFieldSuccessText: 'text-[#315f4d]',
      alertText: 'text-[#8c3f37]', logoBox: 'rounded-xl overflow-hidden', logoImage: 'object-contain',
      socialButtonsBlockButton: 'border-[#d8d2c5] bg-[#faf8f2] hover:bg-[#eeeadf]', formButtonPrimary: 'bg-[#315f4d] hover:bg-[#274c3e] text-white',
      formFieldInput: 'bg-[#f1eee6] border-[#d7d1c5] text-[#272e36] focus:border-[#315f4d]', footerAction: 'text-[#666b68]',
      dividerLine: 'bg-[#ded8cd]', alert: 'bg-[#f8e7e2] border-[#e9c7bd]', otpCodeFieldInput: 'bg-[#f1eee6] border-[#d7d1c5]',
      formFieldRow: 'mb-4', main: 'gap-5',
    },
  }} signInUrl={`${basePath}/sign-in`} signUpUrl={`${basePath}/sign-up`} localization={{
    signIn: { start: { title: 'Welcome back, planeswalker', subtitle: 'Pick up where your next deck left off.' } },
    signUp: { start: { title: 'Join the workshop', subtitle: 'Make a home for your next Commander deck.' } },
  }} routerPush={to => setLocation(stripBase(to))} routerReplace={to => setLocation(stripBase(to), { replace: true })}>
    <QueryClientProvider client={queryClient}><ClerkCacheClearer/><ErrorBoundaryRoute><Switch>
      <Route path="/" component={HomeRoute}/>
      <Route path="/studio"><AuthGate><Studio/></AuthGate></Route>
      <Route path="/saved-decks"><AuthGate><SavedDecks/></AuthGate></Route>
      <Route path="/decks/:deckId"><AuthGate><DeckEditorRoute/></AuthGate></Route>
      <Route path="/sign-in/*?" component={SignInPage}/>
      <Route path="/sign-up/*?" component={SignUpPage}/>
      <Route component={NotFound}/>
    </Switch></ErrorBoundaryRoute></QueryClientProvider>
  </ClerkProvider>;
}
function DeckEditorRoute() { const [, params] = useRoute('/decks/:deckId'); return <DeckEditor deckId={params?.deckId || ''}/>; }
function App() {
  return <TooltipProvider><WouterRouter base={basePath}><RoutedApp/></WouterRouter><Toaster/></TooltipProvider>;
}
export default App;
