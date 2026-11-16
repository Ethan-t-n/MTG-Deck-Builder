import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uuid,
} from "drizzle-orm/pg-core";

export type DeckJson = Record<string, unknown>;

export const decksTable = pgTable(
  "decksmith_decks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    format: text("format").notNull().default("commander"),
    settings: jsonb("settings").$type<DeckJson>().notNull(),
    cards: jsonb("cards").$type<DeckJson[]>().notNull().default([]),
    commanderCardId: text("commander_card_id"),
    commanderName: text("commander_name"),
    viewPreference: text("view_preference").notNull().default("list"),
    legality: jsonb("legality").$type<DeckJson>().notNull(),
    pricing: jsonb("pricing").$type<DeckJson>().notNull(),
    stats: jsonb("stats").$type<DeckJson>().notNull(),
    guide: jsonb("guide").$type<DeckJson>().notNull(),
    unresolvedNames: text("unresolved_names").array().notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [index("decksmith_decks_user_id_idx").on(table.userId)],
);

export const deckThreadsTable = pgTable(
  "decksmith_threads",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deckId: uuid("deck_id")
      .notNull()
      .references(() => decksTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    title: text("title").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (table) => [
    index("decksmith_threads_deck_id_idx").on(table.deckId),
    index("decksmith_threads_user_id_idx").on(table.userId),
  ],
);

export const deckMessagesTable = pgTable(
  "decksmith_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deckId: uuid("deck_id")
      .notNull()
      .references(() => decksTable.id, { onDelete: "cascade" }),
    threadId: uuid("thread_id")
      .notNull()
      .references(() => deckThreadsTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    role: text("role").notNull(),
    content: text("content").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("decksmith_messages_thread_id_idx").on(table.threadId),
    index("decksmith_messages_user_id_idx").on(table.userId),
  ],
);

export const deckRevisionsTable = pgTable(
  "decksmith_revisions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    deckId: uuid("deck_id")
      .notNull()
      .references(() => decksTable.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    snapshot: jsonb("snapshot").$type<DeckJson>().notNull(),
    undone: boolean("undone").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => [
    index("decksmith_revisions_deck_id_idx").on(table.deckId),
    index("decksmith_revisions_user_id_idx").on(table.userId),
    index("decksmith_revisions_created_at_idx").on(table.createdAt),
  ],
);

export type DeckRecord = typeof decksTable.$inferSelect;
export type DeckThreadRecord = typeof deckThreadsTable.$inferSelect;
export type DeckMessageRecord = typeof deckMessagesTable.$inferSelect;
export type DeckRevisionRecord = typeof deckRevisionsTable.$inferSelect;
export type NewDeckRecord = typeof decksTable.$inferInsert;
export type NewDeckThreadRecord = typeof deckThreadsTable.$inferInsert;
export type NewDeckMessageRecord = typeof deckMessagesTable.$inferInsert;
