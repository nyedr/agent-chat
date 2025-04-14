import type { InferSelectModel } from "drizzle-orm";
import {
  sqliteTable,
  text,
  integer,
  primaryKey,
} from "drizzle-orm/sqlite-core";
import { generateUUID } from "../utils";
import { relations } from "drizzle-orm";

export const folder = sqliteTable("folder", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => generateUUID()),
  name: text("name").notNull(),
  created_at: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updated_at: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const chat = sqliteTable("chat", {
  id: text("id")
    .primaryKey()
    .$defaultFn(() => generateUUID()),
  title: text("title").notNull(),
  folder_id: text("folder_id").references(() => folder.id),
  chat: text("chat")
    .notNull()
    .$default(() =>
      JSON.stringify({
        currentId: null,
        messages: [],
      })
    ),
  created_at: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updated_at: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  meta: text("meta")
    .notNull()
    .$default(() => JSON.stringify({})),
  archived: integer("archived", { mode: "boolean" }).notNull().default(false),
});

export type Chat = InferSelectModel<typeof chat>;

export const document = sqliteTable(
  "document",
  {
    id: text("id").notNull(),
    chatId: text("chatId")
      .notNull()
      .references(() => chat.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    content: text("content"),
    kind: text("kind", {
      enum: ["text", "code", "image", "sheet", "html"],
    }).notNull(),
    extension: text("extension").notNull().default("txt"),
    createdAt: text("createdAt").notNull(),
  },
  (table) => {
    return {
      pk: primaryKey({ columns: [table.id, table.createdAt] }),
    };
  }
);

export type Document = InferSelectModel<typeof document>;

export const documentRelations = relations(document, ({ one }) => ({
  chat: one(chat, {
    fields: [document.chatId],
    references: [chat.id],
  }),
}));
