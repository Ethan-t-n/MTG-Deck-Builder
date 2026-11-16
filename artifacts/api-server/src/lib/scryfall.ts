import type { CatalogCard, CatalogCardFace, CatalogSet } from "@workspace/api-zod";

interface ScryfallCardFace {
  name?: string;
  image_uris?: { normal?: string; large?: string };
  mana_cost?: string;
  type_line?: string;
  oracle_text?: string;
}

interface ScryfallCard {
  id: string;
  oracle_id?: string;
  name: string;
  image_uris?: { normal?: string; large?: string };
  card_faces?: ScryfallCardFace[];
  mana_cost?: string;
  cmc?: number;
  type_line?: string;
  oracle_text?: string;
  colors?: string[];
  color_identity?: string[];
  set: string;
  set_name: string;
  prices?: { usd?: string | null };
  legalities?: { commander?: string };
}

interface ScryfallSearchResult {
  data: ScryfallCard[];
  has_more: boolean;
}

interface ScryfallCollectionResult {
  data: ScryfallCard[];
}

interface ScryfallSetsResult {
  data: Array<{
    code: string;
    name: string;
    set_type: string;
    released_at?: string;
    card_count: number;
    icon_svg_uri?: string;
  }>;
}

const API_BASE = "https://api.scryfall.com";
const CACHE_MS = 10 * 60 * 1000;
const cache = new Map<string, { expiresAt: number; value: unknown }>();

async function fetchJson<T>(
  url: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: {
      "User-Agent": "Decksmith/1.0 (Magic deck builder)",
      Accept: "application/json",
      ...init.headers,
    },
    signal: init.signal ?? AbortSignal.timeout(15_000),
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => null)) as
      | { details?: string }
      | null;
    throw new Error(
      body?.details ?? `The card catalog returned HTTP ${response.status}.`,
    );
  }
  return (await response.json()) as T;
}

async function cached<T>(key: string, load: () => Promise<T>): Promise<T> {
  const current = cache.get(key);
  if (current && current.expiresAt > Date.now()) {
    return current.value as T;
  }
  const value = await load();
  cache.set(key, { expiresAt: Date.now() + CACHE_MS, value });
  return value;
}

function faceImage(face: ScryfallCardFace): string | null {
  return face.image_uris?.large ?? face.image_uris?.normal ?? null;
}

export function mapScryfallCard(card: ScryfallCard): CatalogCard {
  const faces = (card.card_faces ?? []).map(
    (face): CatalogCardFace => ({
      name: face.name ?? card.name,
      imageUri: faceImage(face),
      manaCost: face.mana_cost ?? null,
      typeLine: face.type_line ?? null,
      oracleText: face.oracle_text ?? null,
    }),
  );
  const frontFace = card.card_faces?.[0];
  const imageUri =
    card.image_uris?.normal ?? frontFace?.image_uris?.normal ?? null;
  const imageLargeUri =
    card.image_uris?.large ?? frontFace?.image_uris?.large ?? imageUri;
  const rawPrice = card.prices?.usd;
  const price = rawPrice ? Number.parseFloat(rawPrice) : Number.NaN;

  return {
    id: card.id,
    oracleId: card.oracle_id ?? null,
    name: card.name,
    imageUri,
    imageLargeUri,
    manaCost: card.mana_cost ?? frontFace?.mana_cost ?? null,
    cmc: Number.isFinite(card.cmc) ? Number(card.cmc) : 0,
    typeLine: card.type_line ?? frontFace?.type_line ?? "",
    oracleText: card.oracle_text ?? frontFace?.oracle_text ?? null,
    colors: (card.colors ?? []) as CatalogCard["colors"],
    colorIdentity: (card.color_identity ?? []) as CatalogCard["colorIdentity"],
    setCode: card.set,
    setName: card.set_name,
    priceUsd: Number.isFinite(price) ? price : null,
    legalCommander: card.legalities?.commander === "legal",
    cardFaces: faces,
  };
}

export async function getSets(): Promise<CatalogSet[]> {
  return cached("sets", async () => {
    const result = await fetchJson<ScryfallSetsResult>(`${API_BASE}/sets`);
    return result.data.map((set) => ({
      code: set.code.toUpperCase(),
      name: set.name,
      setType: set.set_type,
      releasedAt: set.released_at ?? null,
      cardCount: set.card_count,
      iconUri: set.icon_svg_uri ?? null,
    }));
  });
}

export async function searchCards(
  query: string,
  limit = 20,
  unique: "cards" | "prints" = "prints",
): Promise<CatalogCard[]> {
  const normalized = query.trim();
  if (!normalized) return [];
  const safeLimit = Math.max(1, Math.min(limit, 50));
  const cacheKey = `cards:${unique}:${safeLimit}:${normalized.toLowerCase()}`;
  return cached(cacheKey, async () => {
    const url = new URL(`${API_BASE}/cards/search`);
    url.searchParams.set("q", normalized);
    url.searchParams.set("unique", unique);
    url.searchParams.set("order", "edhrec");
    url.searchParams.set("page", "1");
    try {
      const result = await fetchJson<ScryfallSearchResult>(url.toString());
      return result.data.slice(0, safeLimit).map(mapScryfallCard);
    } catch (error) {
      if (error instanceof Error && /couldn't find|no cards/i.test(error.message)) {
        return [];
      }
      throw error;
    }
  });
}

export async function getCardById(id: string): Promise<CatalogCard | null> {
  const normalizedId = id.trim();
  if (!normalizedId) return null;
  return cached(`card:${normalizedId}`, async () => {
    try {
      const card = await fetchJson<ScryfallCard>(
        `${API_BASE}/cards/${encodeURIComponent(normalizedId)}`,
      );
      return mapScryfallCard(card);
    } catch (error) {
      if (error instanceof Error && /not found/i.test(error.message)) return null;
      throw error;
    }
  });
}

export async function getCardsByIds(ids: string[]): Promise<CatalogCard[]> {
  const uniqueIds = [...new Set(ids.map((id) => id.trim()).filter(Boolean))];
  const cards: CatalogCard[] = [];
  for (let offset = 0; offset < uniqueIds.length; offset += 75) {
    const chunk = uniqueIds.slice(offset, offset + 75);
    const result = await fetchJson<ScryfallCollectionResult>(
      `${API_BASE}/cards/collection`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          identifiers: chunk.map((id) => ({ id })),
        }),
      },
    );
    cards.push(...result.data.map(mapScryfallCard));
    if (offset + 75 < uniqueIds.length) {
      await new Promise((resolve) => setTimeout(resolve, 110));
    }
  }
  return cards;
}

export async function getCardsForQuery(
  query: string,
  maxPages = 3,
): Promise<CatalogCard[]> {
  const results: CatalogCard[] = [];
  const seen = new Set<string>();

  for (let page = 1; page <= maxPages; page += 1) {
    const url = new URL(`${API_BASE}/cards/search`);
    url.searchParams.set("q", query);
    url.searchParams.set("unique", "cards");
    url.searchParams.set("order", "edhrec");
    url.searchParams.set("page", String(page));
    let response: ScryfallSearchResult;
    try {
      response = await fetchJson<ScryfallSearchResult>(url.toString());
    } catch (error) {
      if (page === 1 && error instanceof Error && /couldn't find|no cards/i.test(error.message)) {
        return [];
      }
      throw error;
    }

    for (const card of response.data) {
      const mapped = mapScryfallCard(card);
      const key = mapped.oracleId ?? mapped.name.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        results.push(mapped);
      }
    }
    if (!response.has_more) break;
    await new Promise((resolve) => setTimeout(resolve, 110));
  }
  return results;
}

export function scryfallSearchUrl(query: string): string {
  return `${API_BASE}/cards/search?q=${encodeURIComponent(query)}`;
}
