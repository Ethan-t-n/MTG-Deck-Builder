import { and, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  ApplyDeckRevisionBody,
  ApplyDeckRevisionParams,
  ApplyDeckRevisionResponse,
  CreateDeckBody,
  CreateDeckResponse,
  DeleteDeckParams,
  ExportDeckParams,
  ExportDeckResponse,
  GenerateDeckBody,
  GenerateDeckResponse,
  GetDeckParams,
  GetDeckResponse,
  ImportDeckBody,
  ImportDeckResponse,
  ListDecksResponse,
  PreviewDeckRevisionBody,
  PreviewDeckRevisionParams,
  PreviewDeckRevisionResponse,
  UndoDeckRevisionParams,
  UndoDeckRevisionResponse,
  UpdateDeckBody,
  UpdateDeckCardsBody,
  UpdateDeckCardsParams,
  UpdateDeckCardsResponse,
  UpdateDeckParams,
  UpdateDeckResponse,
  ValidateDeckParams,
  ValidateDeckResponse,
} from "@workspace/api-zod";
import type { BuildFailure } from "@workspace/api-zod";
import {
  db,
  deckThreadsTable,
  decksTable,
} from "@workspace/db";
import { getRequestUserId } from "../middlewares/requireAuth";
import {
  applyDeckCardList,
  createDraft,
  createImportedDeck,
  generateCommanderDeck,
  getDeckExport,
  getOwnedDeck,
  listDeckSummaries,
  previewDeckCardList,
  toApiDeck,
  undoDeck,
  updateDeckCardList,
  updateDeckSettings,
} from "../lib/deckService";

const router: IRouter = Router();

router.get("/decks", async (req, res): Promise<void> => {
  try {
    const userId = getRequestUserId(req);
    res.json(ListDecksResponse.parse(await listDeckSummaries(userId)));
  } catch (error) {
    req.log.error({ err: error }, "Failed to list saved decks");
    res.status(500).json({ error: "Saved decks could not be loaded." });
  }
});

router.post("/decks", async (req, res): Promise<void> => {
  const parsed = CreateDeckBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const deck = await createDraft(getRequestUserId(req), parsed.data);
    res.status(201).json(CreateDeckResponse.parse(deck));
  } catch (error) {
    req.log.error({ err: error }, "Failed to create deck draft");
    res.status(422).json({
      error: error instanceof Error ? error.message : "Deck draft could not be created.",
    });
  }
});

router.post("/decks/generate", async (req, res): Promise<void> => {
  const parsed = GenerateDeckBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const deck = await generateCommanderDeck(getRequestUserId(req), parsed.data);
    res.status(201).json(GenerateDeckResponse.parse(deck));
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "The deck could not be built.";
    req.log.warn({ message }, "Commander deck generation did not complete");
    const failure: BuildFailure = {
      error: message,
      blockingSettings: message.includes("selected sets")
        ? ["selectedSetCodes", "setMode"]
        : message.includes("color identity") || message.includes("colors")
          ? ["colors", "colorCount", "commanderName"]
          : ["commanderName", "theme", "includeCards", "excludeCards"],
      suggestions: [
        "Choose a different eligible commander.",
        "Broaden the set or card constraints.",
        "Remove an exclusion or include preference that blocks the list.",
      ],
    };
    res.status(422).json(failure);
  }
});

router.post("/decks/import", async (req, res): Promise<void> => {
  const parsed = ImportDeckBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  try {
    const result = await createImportedDeck(
      getRequestUserId(req),
      parsed.data,
    );
    res.status(201).json(ImportDeckResponse.parse(result));
  } catch (error) {
    req.log.error({ err: error }, "Failed to import decklist");
    res.status(422).json({
      error: error instanceof Error ? error.message : "Decklist could not be imported.",
    });
  }
});

router.get("/decks/:deckId", async (req, res): Promise<void> => {
  const params = GetDeckParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = getRequestUserId(req);
  const record = await getOwnedDeck(userId, params.data.deckId);
  if (!record) {
    res.status(404).json({ error: "Deck not found." });
    return;
  }
  res.json(GetDeckResponse.parse(await toApiDeck(record, userId)));
});

router.patch("/decks/:deckId", async (req, res): Promise<void> => {
  const params = UpdateDeckParams.safeParse(req.params);
  const parsed = UpdateDeckBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = getRequestUserId(req);
  const record = await getOwnedDeck(userId, params.data.deckId);
  if (!record) {
    res.status(404).json({ error: "Deck not found." });
    return;
  }
  const deck = await updateDeckSettings(userId, record, parsed.data);
  res.json(UpdateDeckResponse.parse(deck));
});

router.delete("/decks/:deckId", async (req, res): Promise<void> => {
  const params = DeleteDeckParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = getRequestUserId(req);
  const deleted = await db
    .delete(decksTable)
    .where(and(eq(decksTable.id, params.data.deckId), eq(decksTable.userId, userId)))
    .returning({ id: decksTable.id });
  if (deleted.length === 0) {
    res.status(404).json({ error: "Deck not found." });
    return;
  }
  res.sendStatus(204);
});

router.put("/decks/:deckId/cards", async (req, res): Promise<void> => {
  const params = UpdateDeckCardsParams.safeParse(req.params);
  const parsed = UpdateDeckCardsBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = getRequestUserId(req);
  const record = await getOwnedDeck(userId, params.data.deckId);
  if (!record) {
    res.status(404).json({ error: "Deck not found." });
    return;
  }
  try {
    const deck = await updateDeckCardList(userId, record, parsed.data.cards);
    res.json(UpdateDeckCardsResponse.parse(deck));
  } catch (error) {
    res.status(422).json({
      error: error instanceof Error ? error.message : "Cards could not be updated.",
    });
  }
});

router.post("/decks/:deckId/validate", async (req, res): Promise<void> => {
  const params = ValidateDeckParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = getRequestUserId(req);
  const record = await getOwnedDeck(userId, params.data.deckId);
  if (!record) {
    res.status(404).json({ error: "Deck not found." });
    return;
  }
  res.json(ValidateDeckResponse.parse(await toApiDeck(record, userId)));
});

router.get("/decks/:deckId/export", async (req, res): Promise<void> => {
  const params = ExportDeckParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const record = await getOwnedDeck(getRequestUserId(req), params.data.deckId);
  if (!record) {
    res.status(404).json({ error: "Deck not found." });
    return;
  }
  res.json(ExportDeckResponse.parse({ decklist: await getDeckExport(record) }));
});

router.post("/decks/:deckId/revisions/preview", async (req, res): Promise<void> => {
  const params = PreviewDeckRevisionParams.safeParse(req.params);
  const parsed = PreviewDeckRevisionBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const record = await getOwnedDeck(
    getRequestUserId(req),
    params.data.deckId,
  );
  if (!record) {
    res.status(404).json({ error: "Deck not found." });
    return;
  }
  try {
    res.json(
      PreviewDeckRevisionResponse.parse(
        await previewDeckCardList(record, parsed.data.cards),
      ),
    );
  } catch (error) {
    res.status(422).json({
      error: error instanceof Error ? error.message : "This revision could not be previewed.",
    });
  }
});

router.post("/decks/:deckId/revisions/apply", async (req, res): Promise<void> => {
  const params = ApplyDeckRevisionParams.safeParse(req.params);
  const parsed = ApplyDeckRevisionBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = getRequestUserId(req);
  const record = await getOwnedDeck(userId, params.data.deckId);
  if (!record) {
    res.status(404).json({ error: "Deck not found." });
    return;
  }
  try {
    const deck = await applyDeckCardList(userId, record, parsed.data.cards);
    res.json(ApplyDeckRevisionResponse.parse(deck));
  } catch (error) {
    res.status(422).json({
      error: error instanceof Error ? error.message : "This revision could not be applied.",
    });
  }
});

router.post("/decks/:deckId/revisions/undo", async (req, res): Promise<void> => {
  const params = UndoDeckRevisionParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = getRequestUserId(req);
  const record = await getOwnedDeck(userId, params.data.deckId);
  if (!record) {
    res.status(404).json({ error: "Deck not found." });
    return;
  }
  const deck = await undoDeck(userId, record);
  if (!deck) {
    res.status(409).json({ error: "There is no deck change to undo." });
    return;
  }
  res.json(UndoDeckRevisionResponse.parse(deck));
});

export default router;
