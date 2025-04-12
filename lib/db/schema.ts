import type { InferSelectModel } from "drizzle-orm";
import { sqliteTable, text, integer } from "drizzle-orm/sqlite-core";
import { generateUUID } from "../utils";

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

export const document = sqliteTable("document", {
  id: text("id").primaryKey(),
  createdAt: text("createdAt")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  title: text("title").notNull(),
  content: text("content"),
  kind: text("kind", { enum: ["text", "code", "image", "sheet"] }).notNull(),
  chatId: text("chatId").references(() => chat.id),
});

export type Document = InferSelectModel<typeof document>;

export const suggestion = sqliteTable("suggestion", {
  id: text("id").primaryKey(),
  documentId: text("documentId")
    .notNull()
    .references(() => document.id),
  documentCreatedAt: text("documentCreatedAt").notNull(),
  originalText: text("originalText").notNull(),
  suggestedText: text("suggestedText").notNull(),
  description: text("description"),
  isResolved: integer("isResolved", { mode: "boolean" })
    .notNull()
    .default(false),
  createdAt: text("createdAt")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export type Suggestion = InferSelectModel<typeof suggestion>;
