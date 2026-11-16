import { and, asc, eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  CreateDeckThreadBody,
  CreateDeckThreadParams,
  CreateDeckThreadResponse,
  GetDeckThreadParams,
  GetDeckThreadResponse,
  ListDeckThreadsParams,
  ListDeckThreadsResponse,
  SendDeckMessageBody,
  SendDeckMessageParams,
  SendDeckMessageResponse,
  UpdateDeckThreadBody,
  UpdateDeckThreadParams,
  UpdateDeckThreadResponse,
} from "@workspace/api-zod";
import type {
  DeckMessage,
  DeckThread,
  DeckThreadDetail,
} from "@workspace/api-zod";
import {
  db,
  deckMessagesTable,
  deckThreadsTable,
} from "@workspace/db";
import { getRequestUserId } from "../middlewares/requireAuth";
import {
  addAssistantUnavailableMessage,
  canAnswerMagicRequest,
  getOwnedDeck,
} from "../lib/deckService";

const router: IRouter = Router();

async function threadBelongsToUser(
  deckId: string,
  threadId: string,
  userId: string,
) {
  if (!/^[a-f\d]{8}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{4}-[a-f\d]{12}$/i.test(threadId)) {
    return null;
  }
  const rows = await db
    .select()
    .from(deckThreadsTable)
    .where(
      and(
        eq(deckThreadsTable.id, threadId),
        eq(deckThreadsTable.deckId, deckId),
        eq(deckThreadsTable.userId, userId),
      ),
    )
    .limit(1);
  return rows[0] ?? null;
}

router.get("/decks/:deckId/threads", async (req, res): Promise<void> => {
  const params = ListDeckThreadsParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = getRequestUserId(req);
  const deck = await getOwnedDeck(userId, params.data.deckId);
  if (!deck) {
    res.status(404).json({ error: "Deck not found." });
    return;
  }
  const rows = await db
    .select()
    .from(deckThreadsTable)
    .where(
      and(
        eq(deckThreadsTable.deckId, deck.id),
        eq(deckThreadsTable.userId, userId),
      ),
    )
    .orderBy(asc(deckThreadsTable.createdAt));
  res.json(
    ListDeckThreadsResponse.parse(
      rows.map((thread) => ({
        id: thread.id,
        deckId: thread.deckId,
        title: thread.title,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
      })),
    ),
  );
});

router.post("/decks/:deckId/threads", async (req, res): Promise<void> => {
  const params = CreateDeckThreadParams.safeParse(req.params);
  const parsed = CreateDeckThreadBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = getRequestUserId(req);
  const deck = await getOwnedDeck(userId, params.data.deckId);
  if (!deck) {
    res.status(404).json({ error: "Deck not found." });
    return;
  }
  const [thread] = await db
    .insert(deckThreadsTable)
    .values({
      deckId: deck.id,
      userId,
      title: parsed.data.title.trim(),
    })
    .returning();
  res.status(201).json(
    CreateDeckThreadResponse.parse({
      id: thread.id,
      deckId: thread.deckId,
      title: thread.title,
      createdAt: thread.createdAt,
      updatedAt: thread.updatedAt,
    }),
  );
});

router.get("/decks/:deckId/threads/:threadId", async (req, res): Promise<void> => {
  const params = GetDeckThreadParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  const userId = getRequestUserId(req);
  const thread = await threadBelongsToUser(
    params.data.deckId,
    params.data.threadId,
    userId,
  );
  if (!thread) {
    res.status(404).json({ error: "Thread not found." });
    return;
  }
  const messages = await db
    .select()
    .from(deckMessagesTable)
    .where(
      and(
        eq(deckMessagesTable.threadId, thread.id),
        eq(deckMessagesTable.userId, userId),
      ),
    )
    .orderBy(asc(deckMessagesTable.createdAt));
  const apiMessages: DeckMessage[] = messages.map((message) => {
    if (message.role !== "user" && message.role !== "assistant") {
      throw new Error("Unexpected message role in saved thread.");
    }
    return {
      id: message.id,
      threadId: message.threadId,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt,
    };
  });
  res.json(
    GetDeckThreadResponse.parse({
      thread: {
        id: thread.id,
        deckId: thread.deckId,
        title: thread.title,
        createdAt: thread.createdAt,
        updatedAt: thread.updatedAt,
      } satisfies DeckThread,
      messages: apiMessages,
    } satisfies DeckThreadDetail),
  );
});

router.patch("/decks/:deckId/threads/:threadId", async (req, res): Promise<void> => {
  const params = UpdateDeckThreadParams.safeParse(req.params);
  const parsed = UpdateDeckThreadBody.safeParse(req.body);
  if (!params.success) {
    res.status(400).json({ error: params.error.message });
    return;
  }
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }
  const userId = getRequestUserId(req);
  const thread = await threadBelongsToUser(
    params.data.deckId,
    params.data.threadId,
    userId,
  );
  if (!thread) {
    res.status(404).json({ error: "Thread not found." });
    return;
  }
  const [updated] = await db
    .update(deckThreadsTable)
    .set({ title: parsed.data.title.trim(), updatedAt: new Date() })
    .where(
      and(
        eq(deckThreadsTable.id, thread.id),
        eq(deckThreadsTable.userId, userId),
      ),
    )
    .returning();
  res.json(
    UpdateDeckThreadResponse.parse({
      id: updated.id,
      deckId: updated.deckId,
      title: updated.title,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    }),
  );
});

router.post(
  "/decks/:deckId/threads/:threadId/messages",
  async (req, res): Promise<void> => {
    const params = SendDeckMessageParams.safeParse(req.params);
    const parsed = SendDeckMessageBody.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: params.error.message });
      return;
    }
    if (!parsed.success) {
      res.status(400).json({ error: parsed.error.message });
      return;
    }
    const userId = getRequestUserId(req);
    const thread = await threadBelongsToUser(
      params.data.deckId,
      params.data.threadId,
      userId,
    );
    if (!thread) {
      res.status(404).json({ error: "Thread not found." });
      return;
    }
    const content = parsed.data.content.trim();
    const messages = await addAssistantUnavailableMessage(
      userId,
      thread.deckId,
      thread.id,
      content,
    );
    const [assistantMessage] = await db
      .select()
      .from(deckMessagesTable)
      .where(
        and(
          eq(deckMessagesTable.id, messages.assistantMessageId),
          eq(deckMessagesTable.userId, userId),
        ),
      )
      .limit(1);
    const responseMessage = {
      id: assistantMessage.id,
      threadId: assistantMessage.threadId,
      role: assistantMessage.role,
      content: assistantMessage.content,
      createdAt: assistantMessage.createdAt,
    };
    const inScope = canAnswerMagicRequest(content);
    res.json(
      SendDeckMessageResponse.parse({
        message: responseMessage,
        aiAvailable: false,
        statusMessage: inScope
          ? "AI assistance is unavailable. Your message and thread history were saved."
          : messages.content,
      }),
    );
  },
);

export default router;
