import { Router, type IRouter } from "express";
import {
  GetCapabilitiesResponse,
  GetCatalogCardParams,
  GetCatalogCardResponse,
  GetCatalogSetsResponse,
  SearchCatalogCardsQueryParams,
  SearchCatalogCardsResponse,
} from "@workspace/api-zod";
import { getCardById, getSets, searchCards } from "../lib/scryfall";

const router: IRouter = Router();

router.get("/capabilities", (_req, res): void => {
  res.json(
    GetCapabilitiesResponse.parse({
      supportedFormats: ["commander"],
      aiAvailable: false,
      catalogName: "Scryfall",
    }),
  );
});

router.get("/catalog/sets", async (req, res): Promise<void> => {
  try {
    res.json(GetCatalogSetsResponse.parse(await getSets()));
  } catch (error) {
    req.log.error({ err: error }, "Failed to load Scryfall sets");
    res.status(502).json({
      error: "The Magic set catalog is unavailable. Try again shortly.",
    });
  }
});

router.get("/catalog/cards", async (req, res): Promise<void> => {
  const parsed = SearchCatalogCardsQueryParams.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  try {
    const cards = await searchCards(parsed.data.q, parsed.data.limit ?? 20);
    res.json(SearchCatalogCardsResponse.parse(cards));
  } catch (error) {
    req.log.error({ err: error }, "Failed to search Scryfall cards");
    res.status(502).json({
      error: "The Magic card catalog is unavailable. Try again shortly.",
    });
  }
});

router.get("/catalog/cards/:cardId", async (req, res): Promise<void> => {
  const params = GetCatalogCardParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }

  try {
    const card = await getCardById(params.data.cardId);
    if (!card) {
      res.status(404).json({ error: "Card not found." });
      return;
    }
    res.json(GetCatalogCardResponse.parse(card));
  } catch (error) {
    req.log.error({ err: error }, "Failed to load Scryfall card");
    res.status(502).json({
      error: "Card details are unavailable. Try again shortly.",
    });
  }
});

export default router;
