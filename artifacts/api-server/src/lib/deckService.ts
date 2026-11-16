import { and, desc, eq } from "drizzle-orm";
import { GetDeckResponse, ListDecksResponse } from "@workspace/api-zod";
import type {
  Deck,
  DeckCard,
  DeckGenerateInput,
  DeckImportInput,
  DeckInput,
  DeckLegality,
  DeckPricing,
  DeckRevisionPreview,
  DeckSettings,
  DeckStats,
  DeckSummary,
} from "@workspace/api-zod";
import {
  db,
  deckMessagesTable,
  deckRevisionsTable,
  deckThreadsTable,
  decksTable,
  type DeckJson,
  type DeckRecord,
} from "@workspace/db";
import {
  getCardById,
  getCardsByIds,
  getCardsForQuery,
  searchCards,
} from "./scryfall";

const COLOR_ORDER = ["W", "U", "B", "R", "G"] as const;
const COLOR_WORDS: Record<string, (typeof COLOR_ORDER)[number]> = {
  white: "W",
  blue: "U",
  black: "B",
  red: "R",
  green: "G",
};
const COLOR_NAMES: Record<string, string> = {
  W: "Plains",
  U: "Island",
  B: "Swamp",
  R: "Mountain",
  G: "Forest",
};
const NO_AI_REPLY =
  "AI responses are unavailable right now. You can still search real cards, edit this deck, and check its legality.";
export const MAGIC_SCOPE_REPLY =
  "I can help with Magic: The Gathering and deck building. What would you like to build or change?";

type Selection = { cardId: string; quantity: number; locked?: boolean };
type WorkingDeck = {
  settings: DeckSettings;
  cards: DeckCard[];
  commanderCardId: string | null;
  commanderName: string | null;
  unresolvedNames: string[];
};

const defaultSettings: DeckSettings = {
  format: "commander",
  colorCount: 0,
  colors: [],
  playstyle: "help-me-choose",
  theme: null,
  budget: null,
  commanderName: null,
  includeCards: [],
  excludeCards: [],
  competitiveness: "balanced",
  infiniteCombos: false,
  selectedSetCodes: [],
  setMode: "any",
};

function asDeckSettings(value: DeckJson): DeckSettings {
  return value as unknown as DeckSettings;
}

function asDeckCards(value: DeckJson[]): DeckCard[] {
  return value as unknown as DeckCard[];
}

function countCards(cards: DeckCard[]): number {
  return cards.reduce((sum, item) => sum + item.quantity, 0);
}

function normalizedName(name: string): string {
  return name.trim().toLocaleLowerCase();
}

function identityIsWithin(
  identity: string[],
  colors: string[],
): boolean {
  return identity.every((color) => colors.includes(color));
}

function exactIdentityMatches(identity: string[], colors: string[]): boolean {
  const actual = [...identity].sort().join("");
  const desired = [...colors].sort().join("");
  return actual === desired;
}

function isBasic(card: DeckCard["card"]): boolean {
  return /\bBasic Land\b/i.test(card.typeLine);
}

function isCommanderCandidate(card: DeckCard["card"]): boolean {
  const text = `${card.typeLine} ${card.oracleText ?? ""}`;
  return (
    (/\bLegendary\b/i.test(card.typeLine) && /\bCreature\b/i.test(card.typeLine)) ||
    (/\bPlaneswalker\b/i.test(card.typeLine) &&
      /\bcan be your commander\b/i.test(text)) ||
    /\bcan be your commander\b/i.test(text)
  );
}

function isUnlimited(card: DeckCard["card"]): boolean {
  return (
    isBasic(card) ||
    /a deck can have any number of cards named/i.test(card.oracleText ?? "")
  );
}

function roleTags(card: DeckCard["card"], theme: string | null): string[] {
  const text = `${card.typeLine} ${card.oracleText ?? ""}`.toLowerCase();
  const roles = new Set<string>();
  if (/\bland\b/.test(card.typeLine.toLowerCase())) roles.add("land");
  if (/\bcreature\b/.test(card.typeLine.toLowerCase())) roles.add("creature");
  if (
    /add \{[wubrgc]\}|search your library for a (basic )?land|treasure token/.test(
      text,
    )
  ) {
    roles.add("ramp");
  }
  if (/draw (?:a|two|three|x|\d+) cards?|put .* into your hand|investigate/.test(text)) {
    roles.add("draw");
  }
  if (
    /destroy target|exile target|counter target spell|deals? .* damage to target|return target .* to its owner's hand/.test(
      text,
    )
  ) {
    roles.add("removal");
  }
  if (/\bplaneswalker\b/.test(text)) roles.add("planeswalker");
  if (/\benchantment\b/.test(card.typeLine.toLowerCase())) roles.add("enchantment");
  if (/\bartifact\b/.test(card.typeLine.toLowerCase())) roles.add("artifact");
  if (theme) {
    const terms = theme
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((term) => term.length >= 3);
    if (terms.some((term) => text.includes(term))) roles.add("theme");
  }
  if (roles.size === 0) roles.add("other");
  return [...roles];
}

function withRoles(
  card: DeckCard["card"],
  quantity: number,
  commanderCardId: string | null,
  theme: string | null,
  locked = false,
): DeckCard {
  return {
    card,
    quantity,
    locked,
    isCommander: card.id === commanderCardId,
    roles: roleTags(card, theme),
  };
}

function summarizeLegality(
  settings: DeckSettings,
  cards: DeckCard[],
  commanderCardId: string | null,
): DeckLegality {
  const issues: string[] = [];
  const totalCards = countCards(cards);
  const commanders = cards.filter((item) => item.isCommander);
  const commander = commanders[0]?.card;

  if (settings.colorCount !== settings.colors.length) {
    issues.push(
      `Selected color count (${settings.colorCount}) does not match the ${settings.colors.length} chosen colors.`,
    );
  }
  if (totalCards !== 100) {
    issues.push(
      totalCards < 100
        ? `This deck has ${totalCards} cards; Commander decks need 100 including the commander.`
        : `This deck has ${totalCards} cards; Commander decks allow exactly 100 including the commander.`,
    );
  }
  if (!commanderCardId || !commander || commanders.length !== 1) {
    issues.push("Choose exactly one eligible commander.");
  } else {
    if (!isCommanderCandidate(commander)) {
      issues.push(`${commander.name} is not eligible to be a commander.`);
    }
    if (!commander.legalCommander) {
      issues.push(`${commander.name} is not legal in Commander.`);
    }
    if (!exactIdentityMatches(commander.colorIdentity, settings.colors)) {
      issues.push(
        `${commander.name}'s color identity does not match the selected colors.`,
      );
    }
  }

  const names = new Map<string, { quantity: number; card: DeckCard["card"] }>();
  for (const item of cards) {
    const key = item.card.oracleId ?? normalizedName(item.card.name);
    const existing = names.get(key);
    if (existing) {
      existing.quantity += item.quantity;
    } else {
      names.set(key, { quantity: item.quantity, card: item.card });
    }
    if (!item.card.legalCommander) {
      issues.push(`${item.card.name} is banned or not legal in Commander.`);
    }
    if (
      commander &&
      !identityIsWithin(item.card.colorIdentity, commander.colorIdentity)
    ) {
      issues.push(
        `${item.card.name} has a color identity outside ${commander.name}'s identity.`,
      );
    }
    if (
      settings.setMode === "only" &&
      !settings.selectedSetCodes.some(
        (code) => code.toLowerCase() === item.card.setCode.toLowerCase(),
      )
    ) {
      issues.push(
        `${item.card.name} is printed in ${item.card.setCode.toUpperCase()}, outside the selected sets.`,
      );
    }
    if (
      settings.excludeCards.some(
        (excluded) => normalizedName(excluded) === normalizedName(item.card.name),
      )
    ) {
      issues.push(`${item.card.name} is on the exclusion list.`);
    }
  }
  for (const [key, item] of names) {
    if (item.quantity > 1 && !isUnlimited(item.card)) {
      issues.push(
        `${item.card.name} appears ${item.quantity} times; Commander permits one copy.`,
      );
    }
    if (key === commander?.oracleId && item.quantity !== 1) {
      issues.push("The commander must appear exactly once.");
    }
  }

  const uniqueIssues = [...new Set(issues)];
  let status: DeckLegality["status"];
  if (totalCards === 0) status = "draft";
  else if (uniqueIssues.length === 0 && totalCards === 100) status = "legal";
  else if (totalCards < 100) status = "incomplete";
  else status = "illegal";
  return { status, totalCards, issues: uniqueIssues };
}

function summarizePricing(
  cards: DeckCard[],
  budget: number | null,
): DeckPricing {
  let knownSubtotal = 0;
  let missingPriceCount = 0;
  for (const item of cards) {
    if (item.card.priceUsd == null) {
      missingPriceCount += item.quantity;
    } else {
      knownSubtotal += item.card.priceUsd * item.quantity;
    }
  }
  knownSubtotal = Math.round(knownSubtotal * 100) / 100;
  const estimatedTotal = missingPriceCount === 0 ? knownSubtotal : null;
  return {
    knownSubtotal,
    estimatedTotal,
    missingPriceCount,
    budget,
    overBudgetBy:
      budget != null && estimatedTotal != null && estimatedTotal > budget
        ? Math.round((estimatedTotal - budget) * 100) / 100
        : null,
    verified: missingPriceCount === 0,
  };
}

function summarizeStats(cards: DeckCard[]): DeckStats {
  const curve = new Map<number, number>();
  const sources = new Map<string, number>();
  const roles = new Map<string, { count: number; cardIds: Set<string> }>();

  for (const item of cards) {
    const card = item.card;
    if (!/\bland\b/i.test(card.typeLine)) {
      const manaValue = Math.min(7, Math.floor(card.cmc));
      curve.set(manaValue, (curve.get(manaValue) ?? 0) + item.quantity);
    } else {
      for (const color of card.colorIdentity) {
        sources.set(color, (sources.get(color) ?? 0) + item.quantity);
      }
      const basicColor = COLOR_ORDER.find((color) =>
        card.typeLine.toLowerCase().includes(COLOR_NAMES[color].toLowerCase()),
      );
      if (basicColor) {
        sources.set(basicColor, (sources.get(basicColor) ?? 0) + item.quantity);
      }
    }
    for (const role of item.roles) {
      const group = roles.get(role) ?? { count: 0, cardIds: new Set<string>() };
      group.count += item.quantity;
      group.cardIds.add(card.id);
      roles.set(role, group);
    }
  }

  return {
    manaCurve: [...curve.entries()]
      .sort(([a], [b]) => a - b)
      .map(([manaValue, count]) => ({ manaValue, count })),
    manaSourcesByColor: COLOR_ORDER.map((color) => ({
      color,
      count: sources.get(color) ?? 0,
    })).filter((row) => row.count > 0),
    roleCounts: [...roles.entries()].map(([role, group]) => ({
      role,
      count: group.count,
      cardIds: [...group.cardIds],
    })),
  };
}

function buildGuide(settings: DeckSettings, cards: DeckCard[]) {
  const theme = settings.theme?.trim();
  const themeCards = cards.filter((item) => item.roles.includes("theme"));
  const ramp = cards.filter((item) => item.roles.includes("ramp")).length;
  const draw = cards.filter((item) => item.roles.includes("draw")).length;
  const removal = cards.filter((item) => item.roles.includes("removal")).length;
  const plan = theme
    ? `Build around ${theme} synergies, then use your commander and supporting cards to turn those interactions into a win.`
    : `Develop mana, keep cards flowing, and use your commander as the deck's central source of value.`;
  return {
    winPlan: plan,
    openingHand: `Look for 2–4 lands, a low-cost play, and at least one source of early development. Mulligan hands that cannot cast their spells.`,
    earlyGame: `Develop mana and establish the first pieces of your plan. The current list contains about ${ramp} ramp and ${draw} draw cards.`,
    lateGame: `Use your commander and strongest synergies to close the game. Save removal for threats that stop your plan.`,
    synergies: themeCards.length
      ? `${themeCards.slice(0, 5).map((item) => item.card.name).join(", ")} are tagged for the ${theme} theme.`
      : `Use the role counts to identify card combinations; this guide is rule-based, not AI-generated.`,
    recovery: `Keep a draw source and a removal spell available. The current list has about ${removal} removal cards; rebuild with the cards that generate the most value.`,
  };
}

function derive(
  settings: DeckSettings,
  cards: DeckCard[],
  commanderCardId: string | null,
): Pick<
  Deck,
  | "totalCards"
  | "legality"
  | "pricing"
  | "stats"
  | "guide"
  | "commanderName"
> {
  const commander = cards.find((item) => item.card.id === commanderCardId)?.card;
  return {
    totalCards: countCards(cards),
    legality: summarizeLegality(settings, cards, commanderCardId),
    pricing: summarizePricing(cards, settings.budget),
    stats: summarizeStats(cards),
    guide: buildGuide(settings, cards),
    commanderName: commander?.name ?? null,
  };
}

function snapshotFrom(deck: DeckRecord): DeckJson {
  return {
    title: deck.title,
    settings: deck.settings,
    cards: deck.cards,
    commanderCardId: deck.commanderCardId,
    commanderName: deck.commanderName,
    viewPreference: deck.viewPreference,
    legality: deck.legality,
    pricing: deck.pricing,
    stats: deck.stats,
    guide: deck.guide,
    unresolvedNames: deck.unresolvedNames,
  };
}

async function canUndo(userId: string, deckId: string): Promise<boolean> {
  const rows = await db
    .select({ id: deckRevisionsTable.id })
    .from(deckRevisionsTable)
    .where(
      and(
        eq(deckRevisionsTable.userId, userId),
        eq(deckRevisionsTable.deckId, deckId),
        eq(deckRevisionsTable.undone, false),
      ),
    )
    .limit(1);
  return rows.length > 0;
}

export async function toApiDeck(
  record: DeckRecord,
  userId: string,
): Promise<Deck> {
  const settings = asDeckSettings(record.settings);
  const cards = asDeckCards(record.cards);
  const derived = derive(settings, cards, record.commanderCardId);
  return GetDeckResponse.parse({
    id: record.id,
    title: record.title,
    format: record.format,
    settings,
    cards,
    commanderCardId: record.commanderCardId,
    commanderName: derived.commanderName,
    totalCards: derived.totalCards,
    viewPreference: record.viewPreference,
    legality: derived.legality,
    pricing: derived.pricing,
    stats: derived.stats,
    guide: derived.guide,
    unresolvedNames: record.unresolvedNames,
    canUndo: await canUndo(userId, record.id),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  });
}

export async function getOwnedDeck(
  userId: string,
  id: string,
): Promise<DeckRecord | null> {
  if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(id)) {
    return null;
  }
  const rows = await db
    .select()
    .from(decksTable)
    .where(and(eq(decksTable.id, id), eq(decksTable.userId, userId)))
    .limit(1);
  return rows[0] ?? null;
}

export async function listDeckSummaries(userId: string): Promise<DeckSummary[]> {
  const rows = await db
    .select()
    .from(decksTable)
    .where(eq(decksTable.userId, userId))
    .orderBy(desc(decksTable.updatedAt));
  return ListDecksResponse.parse(
    rows.map((record) => {
      const settings = asDeckSettings(record.settings);
      const cards = asDeckCards(record.cards);
      const derived = derive(settings, cards, record.commanderCardId);
      return {
        id: record.id,
        title: record.title,
        format: record.format,
        commanderName: derived.commanderName,
        totalCards: derived.totalCards,
        status: derived.legality.status,
        estimatedTotal: derived.pricing.estimatedTotal,
        missingPriceCount: derived.pricing.missingPriceCount,
        viewPreference: record.viewPreference,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      };
    }),
  );
}

function toDeckCards(
  cards: Array<{ card: DeckCard["card"]; quantity: number; locked?: boolean }>,
  commanderCardId: string | null,
  theme: string | null,
): DeckCard[] {
  return cards.map((item) =>
    withRoles(
      item.card,
      item.quantity,
      commanderCardId,
      theme,
      item.locked ?? false,
    ),
  );
}

async function saveNewDeck(
  userId: string,
  title: string,
  working: WorkingDeck,
  viewPreference: Deck["viewPreference"] = "list",
): Promise<Deck> {
  const cards = toDeckCards(
    working.cards.map((item) => ({
      card: item.card,
      quantity: item.quantity,
      locked: item.locked,
    })),
    working.commanderCardId,
    working.settings.theme,
  );
  const derived = derive(working.settings, cards, working.commanderCardId);
  const [record] = await db
    .insert(decksTable)
    .values({
      userId,
      title,
      format: "commander",
      settings: working.settings as unknown as DeckJson,
      cards: cards as unknown as DeckJson[],
      commanderCardId: working.commanderCardId,
      commanderName: derived.commanderName,
      viewPreference,
      legality: derived.legality as unknown as DeckJson,
      pricing: derived.pricing as unknown as DeckJson,
      stats: derived.stats as unknown as DeckJson,
      guide: derived.guide as unknown as DeckJson,
      unresolvedNames: working.unresolvedNames,
    })
    .returning();
  return toApiDeck(record, userId);
}

export async function createDraft(
  userId: string,
  input: DeckInput,
): Promise<Deck> {
  const settings = input.settings;
  const resolved = await resolveSelections(input.cards);
  const commander = resolved.find((item) => item.card.name === settings.commanderName);
  const commanderCardId = commander?.card.id ?? null;
  const cards = toDeckCards(resolved, commanderCardId, settings.theme);
  return saveNewDeck(
    userId,
    input.title,
    {
      settings,
      cards,
      commanderCardId,
      commanderName: commander?.card.name ?? null,
      unresolvedNames: [],
    },
  );
}

async function resolveSelections(
  selections: Selection[],
): Promise<Array<{ card: DeckCard["card"]; quantity: number; locked?: boolean }>> {
  for (const selection of selections) {
    if (!Number.isInteger(selection.quantity) || selection.quantity < 1) {
      throw new Error("Card quantities must be positive whole numbers.");
    }
  }
  const cards = await getCardsByIds(selections.map((selection) => selection.cardId));
  const cardsById = new Map(cards.map((card) => [card.id, card]));
  return selections.map((selection) => {
    const card = cardsById.get(selection.cardId);
    if (!card) {
      throw new Error(`Card ID ${selection.cardId} was not found in the catalog.`);
    }
    return {
      card,
      quantity: selection.quantity,
      locked: selection.locked ?? false,
    };
  });
}

function scopeMatches(text: string): boolean {
  const value = text.toLowerCase();
  if (!value.trim()) return true;
  return /\b(magic|mtg|commander|deck|decklist|this deck|card|cards|mana|scryfall|mtg arena|gathering|color identity|colour identity|land|lands|creature|creatures|zombie|zombies|vampire|vampires|dragon|dragons|elf|elves|goblin|goblins|spell|spells|ramp|removal|draw|sideboard|standard|modern|pioneer|pauper|pilot|opening hand|mulligan|synergy|budget swap|upgrade|upgrade|win plan)\b/.test(
    value,
  );
}

function parseSettingsFromRequest(
  request: string | null | undefined,
  original: DeckSettings,
): DeckSettings {
  if (!request) return original;
  const next = { ...original };
  const lower = request.toLowerCase();
  if (/\bcolorless\b|\bno colors?\b|\bzero[- ]color\b/.test(lower)) {
    next.colors = [];
    next.colorCount = 0;
  } else {
    const colors = COLOR_ORDER.filter((color) =>
      Object.entries(COLOR_WORDS).some(
        ([name, code]) => code === color && new RegExp(`\\b${name}\\b`, "i").test(lower),
      ),
    );
    if (colors.length > 0) {
      next.colors = [...colors];
      next.colorCount = colors.length;
    }
  }
  const budget = request.match(/\$\s?(\d+(?:\.\d{1,2})?)/);
  if (budget && next.budget == null) next.budget = Number(budget[1]);
  if (!next.theme) {
    const themes = [
      "zombies",
      "zombie",
      "vampire",
      "vampires",
      "elves",
      "elf",
      "goblins",
      "goblin",
      "dragons",
      "dragon",
      "artifacts",
      "artifact",
      "graveyard",
      "tokens",
      "token",
      "counters",
      "spellslinger",
    ];
    const found = themes.find((theme) => lower.includes(theme));
    if (found) next.theme = found;
  }
  const style = ["aggro", "control", "combo", "midrange"].find((candidate) =>
    lower.includes(candidate),
  );
  if (style) next.playstyle = style as DeckSettings["playstyle"];
  return next;
}

function scryfallIdentityQuery(colors: string[]): string {
  return colors.length
    ? `id<=${colors.map((color) => color.toLowerCase()).join("")}`
    : "id:c";
}

function selectedSetQuery(settings: DeckSettings): string[] {
  return settings.selectedSetCodes
    .map((code) => code.trim().toLowerCase())
    .filter((code) => /^[a-z0-9]{1,8}$/.test(code));
}

function allowedPrinting(card: DeckCard["card"], settings: DeckSettings): boolean {
  if (!card.legalCommander) return false;
  if (!identityIsWithin(card.colorIdentity, settings.colors)) return false;
  if (settings.setMode !== "only") return true;
  return settings.selectedSetCodes.some(
    (code) => code.toLowerCase() === card.setCode.toLowerCase(),
  );
}

function excluded(card: DeckCard["card"], settings: DeckSettings): boolean {
  return settings.excludeCards.some(
    (name) => normalizedName(name) === normalizedName(card.name),
  );
}

function uniqueOracleCards(cards: DeckCard["card"][]): DeckCard["card"][] {
  const seen = new Set<string>();
  return cards.filter((card) => {
    const key = card.oracleId ?? normalizedName(card.name);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function sortedForBudget(
  cards: DeckCard["card"][],
  budget: number | null,
): DeckCard["card"][] {
  if (budget == null) return cards;
  return [...cards].sort((a, b) => {
    const aPrice = a.priceUsd ?? Number.POSITIVE_INFINITY;
    const bPrice = b.priceUsd ?? Number.POSITIVE_INFINITY;
    return aPrice - bPrice;
  });
}

function pushUnique(
  list: DeckCard[],
  card: DeckCard["card"],
  commanderCardId: string | null,
  settings: DeckSettings,
): boolean {
  const key = card.oracleId ?? normalizedName(card.name);
  if (
    list.some(
      (item) => (item.card.oracleId ?? normalizedName(item.card.name)) === key,
    ) ||
    excluded(card, settings) ||
    !allowedPrinting(card, settings)
  ) {
    return false;
  }
  list.push(withRoles(card, 1, commanderCardId, settings.theme));
  return true;
}

async function candidatesForSettings(
  settings: DeckSettings,
): Promise<DeckCard["card"][]> {
  const identity = scryfallIdentityQuery(settings.colors);
  const setCodes = selectedSetQuery(settings);
  const queries =
    settings.setMode === "only"
      ? setCodes.map((code) => `f:commander ${identity} set:${code}`)
      : [`f:commander ${identity}`];

  if (settings.setMode === "only" && setCodes.length === 0) return [];
  const candidates: DeckCard["card"][] = [];
  for (const query of queries) {
    candidates.push(...(await getCardsForQuery(query, 3)));
  }

  const basicQueries =
    settings.setMode === "only"
      ? setCodes.map((code) => `f:commander t:basic ${identity} set:${code}`)
      : [`f:commander t:basic ${identity}`];
  for (const query of basicQueries) {
    candidates.push(...(await getCardsForQuery(query, 1)));
  }

  if (settings.setMode === "prefer" && setCodes.length > 0) {
    candidates.sort((a, b) => {
      const aPreferred = setCodes.includes(a.setCode.toLowerCase()) ? 1 : 0;
      const bPreferred = setCodes.includes(b.setCode.toLowerCase()) ? 1 : 0;
      return bPreferred - aPreferred;
    });
  }
  return uniqueOracleCards(candidates).filter((card) =>
    allowedPrinting(card, settings),
  );
}

function chooseCommander(
  candidates: DeckCard["card"][],
  requestedName: string | null,
  settings: DeckSettings,
): DeckCard["card"] | null {
  const possible = candidates.filter(
    (card) =>
      isCommanderCandidate(card) &&
      exactIdentityMatches(card.colorIdentity, settings.colors),
  );
  if (!requestedName) return possible[0] ?? null;
  return (
    possible.find(
      (card) => normalizedName(card.name) === normalizedName(requestedName),
    ) ?? null
  );
}

function settingProblems(settings: DeckSettings): string[] {
  const problems: string[] = [];
  if (settings.format !== "commander") {
    problems.push("Only Commander is supported in this build.");
  }
  if (settings.colors.length !== settings.colorCount) {
    problems.push("The selected color count and colors do not match.");
  }
  if (new Set(settings.colors).size !== settings.colors.length) {
    problems.push("Each color can only be selected once.");
  }
  if (settings.setMode === "only" && settings.selectedSetCodes.length === 0) {
    problems.push("Choose at least one set for the strict set mode.");
  }
  if (settings.selectedSetCodes.length !== selectedSetQuery(settings).length) {
    problems.push("One or more selected set codes are invalid.");
  }
  return problems;
}

export async function generateCommanderDeck(
  userId: string,
  input: DeckGenerateInput,
): Promise<Deck> {
  if (input.request && !scopeMatches(input.request)) {
    throw new Error(MAGIC_SCOPE_REPLY);
  }
  const settings = parseSettingsFromRequest(input.request, input.settings);
  const problems = settingProblems(settings);
  if (problems.length > 0) {
    throw new Error(problems.join(" "));
  }

  let candidates = await candidatesForSettings(settings);
  if (settings.budget != null) {
    candidates = sortedForBudget(candidates, settings.budget);
  }
  if (settings.setMode === "prefer") {
    const preferred = selectedSetQuery(settings);
    candidates.sort((a, b) => {
      const aPreferred = preferred.includes(a.setCode.toLowerCase()) ? 1 : 0;
      const bPreferred = preferred.includes(b.setCode.toLowerCase()) ? 1 : 0;
      return bPreferred - aPreferred;
    });
  }

  const commander = chooseCommander(
    candidates,
    settings.commanderName,
    settings,
  );
  if (!commander) {
    throw new Error(
      settings.setMode === "only"
        ? "The selected sets do not contain an eligible commander with the requested color identity."
        : settings.commanderName
          ? `${settings.commanderName} was not found as a legal commander with the selected color identity.`
          : "No eligible commander was found for the selected colors.",
    );
  }

  const selected: DeckCard[] = [
    withRoles(commander, 1, commander.id, settings.theme),
  ];
  const includedCards: DeckCard["card"][] = [];
  for (const name of settings.includeCards) {
    const exact = await searchCards(`!"${name.replaceAll('"', '\\"')}"`, 10);
    const card = exact.find((item) => allowedPrinting(item, settings));
    if (!card) {
      throw new Error(
        `${name} is not available as a legal card under the current color and set constraints.`,
      );
    }
    includedCards.push(card);
  }
  for (const card of includedCards) {
    if (card.id !== commander.id) {
      pushUnique(selected, card, commander.id, settings);
    }
  }

  const basicCandidates = candidates
    .filter((card) => isBasic(withRoles(card, 1, null, null).card))
    .filter((card) => allowedPrinting(card, settings));
  const lands = candidates.filter((card) => /\bland\b/i.test(card.typeLine));
  let landCount = selected
    .filter((item) => /\bland\b/i.test(item.card.typeLine))
    .reduce((sum, item) => sum + item.quantity, 0);
  for (const land of lands) {
    if (landCount >= 8) break;
    if (pushUnique(selected, land, commander.id, settings)) landCount += 1;
  }

  const basicByColor = new Map<string, DeckCard["card"]>();
  for (const color of settings.colors) {
    const basic = basicCandidates.find((card) =>
      card.typeLine.toLowerCase().includes(COLOR_NAMES[color].toLowerCase()),
    );
    if (basic) basicByColor.set(color, basic);
  }
  if (settings.colors.length === 0) {
    const wastes = basicCandidates.find((card) =>
      /\bWastes\b/i.test(card.typeLine),
    );
    if (wastes) basicByColor.set("C", wastes);
  }
  const colorSlots = [...basicByColor.entries()];
  if (colorSlots.length > 0) {
    const remainingLandSlots = Math.max(0, 36 - landCount);
    for (let index = 0; index < remainingLandSlots; index += 1) {
      const [color, basic] = colorSlots[index % colorSlots.length];
      const existing = selected.find((item) => item.card.id === basic.id);
      if (existing) {
        existing.quantity += 1;
      } else {
        selected.push(withRoles(basic, 1, commander.id, settings.theme));
      }
      if (color === "C") continue;
    }
    landCount += remainingLandSlots;
  }
  if (landCount < 36) {
    for (const land of lands) {
      if (landCount >= 36) break;
      if (pushUnique(selected, land, commander.id, settings)) landCount += 1;
    }
  }

  let total = countCards(selected);
  const nonlands = candidates.filter(
    (card) => !/\bland\b/i.test(card.typeLine) && card.id !== commander.id,
  );
  const available = () =>
    nonlands.filter(
      (card) =>
        !selected.some(
          (item) =>
            (item.card.oracleId ?? normalizedName(item.card.name)) ===
            (card.oracleId ?? normalizedName(card.name)),
        ),
    );
  const addByRole = (role: string, target: number) => {
    let current = selected
      .filter((item) => item.roles.includes(role))
      .reduce((sum, item) => sum + item.quantity, 0);
    for (const card of available()) {
      if (current >= target || total >= 100) break;
      const tagged = roleTags(card, settings.theme);
      if (!tagged.includes(role)) continue;
      if (pushUnique(selected, card, commander.id, settings)) {
        current += 1;
        total += 1;
      }
    }
  };

  total = countCards(selected);
  addByRole("ramp", 10);
  addByRole("draw", 10);
  addByRole("removal", 8);
  if (settings.theme) addByRole("theme", 16);
  addByRole("creature", 30);

  for (const card of available()) {
    if (total >= 100) break;
    if (pushUnique(selected, card, commander.id, settings)) total += 1;
  }
  if (total !== 100) {
    throw new Error(
      settings.setMode === "only"
        ? `The selected sets yielded only ${total} legal cards. Change the strict set selection to build a complete 100-card deck.`
        : `The catalog returned only ${total} eligible cards for these constraints. Broaden the color, theme, or exclusion settings.`,
    );
  }

  const workingCards = toDeckCards(
    selected.map((item) => ({
      card: item.card,
      quantity: item.quantity,
      locked: item.locked,
    })),
    commander.id,
    settings.theme,
  );
  const draft = await saveNewDeck(
    userId,
    settings.theme
      ? `${settings.theme[0].toUpperCase()}${settings.theme.slice(1)} Commander`
      : `${commander.name} Commander`,
    {
      settings,
      cards: workingCards,
      commanderCardId: commander.id,
      commanderName: commander.name,
      unresolvedNames: [],
    },
  );
  await db.insert(deckThreadsTable).values([
    {
      deckId: draft.id,
      userId,
      title: "How to pilot it",
    },
    {
      deckId: draft.id,
      userId,
      title: "Budget swaps",
    },
  ]);
  return draft;
}

export async function updateDeckSettings(
  userId: string,
  deck: DeckRecord,
  changes: {
    title?: string;
    settings?: DeckSettings;
    viewPreference?: Deck["viewPreference"];
  },
): Promise<Deck> {
  const settings = changes.settings ?? asDeckSettings(deck.settings);
  const cards = toDeckCards(
    asDeckCards(deck.cards).map((item) => ({
      card: item.card,
      quantity: item.quantity,
      locked: item.locked,
    })),
    deck.commanderCardId,
    settings.theme,
  );
  const derived = derive(settings, cards, deck.commanderCardId);
  const [updated] = await db
    .update(decksTable)
    .set({
      title: changes.title ?? deck.title,
      settings: settings as unknown as DeckJson,
      cards: cards as unknown as DeckJson[],
      commanderName: derived.commanderName,
      viewPreference: changes.viewPreference ?? deck.viewPreference,
      legality: derived.legality as unknown as DeckJson,
      pricing: derived.pricing as unknown as DeckJson,
      stats: derived.stats as unknown as DeckJson,
      guide: derived.guide as unknown as DeckJson,
      updatedAt: new Date(),
    })
    .where(
      and(eq(decksTable.id, deck.id), eq(decksTable.userId, userId)),
    )
    .returning();
  return toApiDeck(updated, userId);
}

async function saveRevision(
  userId: string,
  deck: DeckRecord,
  newCards: DeckCard[],
  unresolvedNames = deck.unresolvedNames,
): Promise<Deck> {
  const settings = asDeckSettings(deck.settings);
  const cards = toDeckCards(
    newCards.map((item) => ({
      card: item.card,
      quantity: item.quantity,
      locked: item.locked,
    })),
    deck.commanderCardId,
    settings.theme,
  );
  const derived = derive(settings, cards, deck.commanderCardId);
  const [updated] = await db.transaction(async (tx) => {
    await tx.insert(deckRevisionsTable).values({
      deckId: deck.id,
      userId,
      snapshot: snapshotFrom(deck),
    });
    return tx
      .update(decksTable)
      .set({
        cards: cards as unknown as DeckJson[],
        commanderName: derived.commanderName,
        legality: derived.legality as unknown as DeckJson,
        pricing: derived.pricing as unknown as DeckJson,
        stats: derived.stats as unknown as DeckJson,
        guide: derived.guide as unknown as DeckJson,
        unresolvedNames,
        updatedAt: new Date(),
      })
      .where(
        and(eq(decksTable.id, deck.id), eq(decksTable.userId, userId)),
      )
      .returning();
  });
  return toApiDeck(updated, userId);
}

export async function updateDeckCardList(
  userId: string,
  deck: DeckRecord,
  selections: Selection[],
): Promise<Deck> {
  const resolved = await resolveSelections(selections);
  let commanderCardId = deck.commanderCardId;
  if (deck.commanderCardId && !resolved.some((item) => item.card.id === deck.commanderCardId)) {
    commanderCardId = null;
  }
  if (!commanderCardId) {
    const desiredCommander = asDeckSettings(deck.settings).commanderName;
    const requested = resolved.find(
      (item) => item.card.name === desiredCommander,
    );
    if (requested && isCommanderCandidate(requested.card)) {
      commanderCardId = requested.card.id;
    }
  }
  const settings = asDeckSettings(deck.settings);
  const cards = toDeckCards(
    resolved,
    commanderCardId,
    settings.theme,
  );
  const originalCommander = deck.commanderCardId;
  const [updated] = await db.transaction(async (tx) => {
    await tx.insert(deckRevisionsTable).values({
      deckId: deck.id,
      userId,
      snapshot: snapshotFrom(deck),
    });
    return tx
      .update(decksTable)
      .set({
        cards: cards as unknown as DeckJson[],
        commanderCardId,
        commanderName:
          cards.find((item) => item.card.id === commanderCardId)?.card.name ?? null,
        legality: summarizeLegality(settings, cards, commanderCardId) as unknown as DeckJson,
        pricing: summarizePricing(cards, settings.budget) as unknown as DeckJson,
        stats: summarizeStats(cards) as unknown as DeckJson,
        guide: buildGuide(settings, cards) as unknown as DeckJson,
        unresolvedNames: [],
        updatedAt: new Date(),
      })
      .where(
        and(eq(decksTable.id, deck.id), eq(decksTable.userId, userId)),
      )
      .returning();
  });
  if (!updated) {
    throw new Error("Deck could not be updated.");
  }
  if (originalCommander !== commanderCardId) {
    updated.commanderName =
      cards.find((item) => item.card.id === commanderCardId)?.card.name ?? null;
  }
  return toApiDeck(updated, userId);
}

export async function previewDeckCardList(
  deck: DeckRecord,
  selections: Selection[],
): Promise<DeckRevisionPreview> {
  const currentCards = asDeckCards(deck.cards);
  const resolved = await resolveSelections(selections);
  const settings = asDeckSettings(deck.settings);
  const commanderCardId = deck.commanderCardId;
  const cards = toDeckCards(resolved, commanderCardId, settings.theme);
  const currentById = new Map(
    currentCards.map((item) => [item.card.id, item]),
  );
  const nextById = new Map(cards.map((item) => [item.card.id, item]));
  const additions: DeckCard[] = [];
  const removals: DeckCard[] = [];
  const quantityChanges: Array<{
    cardName: string;
    before: number;
    after: number;
  }> = [];
  for (const item of cards) {
    const current = currentById.get(item.card.id);
    if (!current) additions.push(item);
    else if (current.quantity !== item.quantity) {
      quantityChanges.push({
        cardName: item.card.name,
        before: current.quantity,
        after: item.quantity,
      });
    }
  }
  for (const item of currentCards) {
    if (!nextById.has(item.card.id)) removals.push(item);
  }
  const legality = summarizeLegality(settings, cards, commanderCardId);
  const pricing = summarizePricing(cards, settings.budget);
  const warnings = [...legality.issues];
  if (pricing.missingPriceCount > 0) {
    warnings.push(
      `Prices are missing for ${pricing.missingPriceCount} card(s); the known subtotal is $${pricing.knownSubtotal.toFixed(2)} and budget compliance cannot be verified.`,
    );
  }
  if (pricing.overBudgetBy != null) {
    warnings.push(
      `This revision is $${pricing.overBudgetBy.toFixed(2)} over budget.`,
    );
  }
  return {
    additions,
    removals,
    quantityChanges,
    cards,
    legality,
    pricing,
    warnings,
  };
}

export async function applyDeckCardList(
  userId: string,
  deck: DeckRecord,
  selections: Selection[],
): Promise<Deck> {
  const resolved = await resolveSelections(selections);
  return saveRevision(
    userId,
    deck,
    toDeckCards(
      resolved,
      deck.commanderCardId,
      asDeckSettings(deck.settings).theme,
    ),
  );
}

export async function undoDeck(userId: string, deck: DeckRecord): Promise<Deck | null> {
  const [revision] = await db
    .select()
    .from(deckRevisionsTable)
    .where(
      and(
        eq(deckRevisionsTable.deckId, deck.id),
        eq(deckRevisionsTable.userId, userId),
        eq(deckRevisionsTable.undone, false),
      ),
    )
    .orderBy(desc(deckRevisionsTable.createdAt))
    .limit(1);
  if (!revision) return null;
  const snapshot = revision.snapshot;
  const settings = asDeckSettings(snapshot.settings as DeckJson);
  const cards = asDeckCards(snapshot.cards as DeckJson[]);
  const derived = derive(settings, cards, snapshot.commanderCardId as string | null);
  const [updated] = await db.transaction(async (tx) => {
    await tx
      .update(deckRevisionsTable)
      .set({ undone: true })
      .where(eq(deckRevisionsTable.id, revision.id));
    return tx
      .update(decksTable)
      .set({
        title: snapshot.title as string,
        settings: settings as unknown as DeckJson,
        cards: cards as unknown as DeckJson[],
        commanderCardId: snapshot.commanderCardId as string | null,
        commanderName: derived.commanderName,
        viewPreference: snapshot.viewPreference as Deck["viewPreference"],
        legality: derived.legality as unknown as DeckJson,
        pricing: derived.pricing as unknown as DeckJson,
        stats: derived.stats as unknown as DeckJson,
        guide: derived.guide as unknown as DeckJson,
        unresolvedNames: (snapshot.unresolvedNames as string[]) ?? [],
        updatedAt: new Date(),
      })
      .where(
        and(eq(decksTable.id, deck.id), eq(decksTable.userId, userId)),
      )
      .returning();
  });
  return updated ? toApiDeck(updated, userId) : null;
}

export async function createImportedDeck(
  userId: string,
  input: DeckImportInput,
): Promise<{ deck: Deck; unresolvedNames: string[] }> {
  const settings = input.settings;
  const lines = input.decklist.split(/\r?\n/);
  const unresolvedNames: string[] = [];
  const aggregated = new Map<string, number>();
  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith("//") || /^sideboard:?$/i.test(line)) continue;
    const match = line.match(/^\s*(\d+)\s*x?\s+(.+?)\s*$/i);
    if (!match) {
      unresolvedNames.push(line);
      continue;
    }
    const quantity = Number.parseInt(match[1], 10);
    const name = match[2].replace(/\s+\([A-Z0-9]{2,8}\)\s+\S+$/, "").trim();
    if (!Number.isInteger(quantity) || quantity < 1 || quantity > 100) {
      unresolvedNames.push(name);
      continue;
    }
    aggregated.set(name, (aggregated.get(name) ?? 0) + quantity);
  }

  const resolved: Array<{ card: DeckCard["card"]; quantity: number }> = [];
  for (const [name, quantity] of aggregated) {
    const matches = await searchCards(`!"${name.replaceAll('"', '\\"')}"`, 20);
    const selected = matches.find(
      (card) =>
        card.legalCommander &&
        identityIsWithin(card.colorIdentity, settings.colors) &&
        (settings.setMode !== "only" ||
          settings.selectedSetCodes.some(
            (code) => code.toLowerCase() === card.setCode.toLowerCase(),
          )),
    );
    if (!selected) {
      unresolvedNames.push(name);
    } else {
      resolved.push({ card: selected, quantity });
    }
    await new Promise((resolve) => setTimeout(resolve, 110));
  }

  const commander = resolved.find(({ card }) =>
    settings.commanderName
      ? normalizedName(card.name) === normalizedName(settings.commanderName)
      : isCommanderCandidate(card),
  );
  const commanderCardId = commander?.card.id ?? null;
  const deck = await saveNewDeck(
    userId,
    input.title,
    {
      settings,
      cards: toDeckCards(resolved, commanderCardId, settings.theme),
      commanderCardId,
      commanderName: commander?.card.name ?? null,
      unresolvedNames,
    },
  );
  return { deck, unresolvedNames };
}

export async function getDeckExport(deck: DeckRecord): Promise<string> {
  return asDeckCards(deck.cards)
    .map((item) => `${item.quantity} ${item.card.name}`)
    .join("\n");
}

export function canAnswerMagicRequest(content: string): boolean {
  return scopeMatches(content);
}

export function noAiReply(): string {
  return NO_AI_REPLY;
}

export async function addAssistantUnavailableMessage(
  userId: string,
  deckId: string,
  threadId: string,
  userContent: string,
): Promise<{ userMessageId: string; assistantMessageId: string; content: string }> {
  const assistantContent = scopeMatches(userContent)
    ? NO_AI_REPLY
    : MAGIC_SCOPE_REPLY;
  const rows = await db
    .insert(deckMessagesTable)
    .values([
      {
        deckId,
        threadId,
        userId,
        role: "user",
        content: userContent,
      },
      {
        deckId,
        threadId,
        userId,
        role: "assistant",
        content: assistantContent,
      },
    ])
    .returning();
  await db
    .update(deckThreadsTable)
    .set({ updatedAt: new Date() })
    .where(
      and(
        eq(deckThreadsTable.id, threadId),
        eq(deckThreadsTable.deckId, deckId),
        eq(deckThreadsTable.userId, userId),
      ),
    );
  return {
    userMessageId: rows[0].id,
    assistantMessageId: rows[1].id,
    content: assistantContent,
  };
}

export async function resolveCatalogCards(
  selections: Array<{ cardId: string; quantity: number; locked?: boolean }>,
) {
  return resolveSelections(selections);
}

export function makeDeckCard(
  card: DeckCard["card"],
  quantity: number,
  commanderCardId: string | null,
  theme: string | null,
  locked = false,
): DeckCard {
  return withRoles(card, quantity, commanderCardId, theme, locked);
}

export function getDefaultDeckSettings(): DeckSettings {
  return { ...defaultSettings };
}

export async function cardsFromNames(names: string[]) {
  const result: Array<DeckCard["card"] | null> = [];
  for (const name of names) {
    const cards = await searchCards(`!"${name.replaceAll('"', '\\"')}"`, 10);
    result.push(cards[0] ?? null);
  }
  return result;
}

export function deckRecordToSummary(record: DeckRecord): DeckSummary {
  const settings = asDeckSettings(record.settings);
  const cards = asDeckCards(record.cards);
  const derived = derive(settings, cards, record.commanderCardId);
  return {
    id: record.id,
    title: record.title,
    format: "commander",
    commanderName: derived.commanderName,
    totalCards: derived.totalCards,
    status: derived.legality.status,
    estimatedTotal: derived.pricing.estimatedTotal,
    missingPriceCount: derived.pricing.missingPriceCount,
    viewPreference: record.viewPreference as Deck["viewPreference"],
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}
