import { drizzle } from "drizzle-orm/better-sqlite3";
import Database from "better-sqlite3";
import { chat, document, suggestion } from "./schema";
import path from "path";
import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";

// Define schema for test database
type Schema = {
  chat: typeof chat;
  document: typeof document;
  suggestion: typeof suggestion;
};

const schema: Schema = {
  chat,
  document,
  suggestion,
};

export const initializeTestDatabase = async () => {
  const dbPath = path.join(process.cwd(), "data", "test.db");

  try {
    // Initialize SQLite database
    const sqlite = new Database(dbPath);

    // Enable foreign keys
    sqlite.exec("PRAGMA foreign_keys = ON");

    // Create database instance with schema
    const db = drizzle(sqlite, { schema });

    // Run migrations and wait for completion
    migrate(db, {
      migrationsFolder: path.join(process.cwd(), "lib", "db", "migrations"),
    });

    // Verify tables were created
    const requiredTables = ["chat", "document", "suggestion"];
    const existingTables = db
      .select({ name: sql<string>`name` })
      .from(sql`sqlite_master`)
      .where(
        sql`type = 'table' AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_migrations%'`
      )
      .all()
      .map((t) => t.name.toLowerCase());

    const missingTables = requiredTables.filter(
      (table) => !existingTables.includes(table.toLowerCase())
    );

    if (missingTables.length > 0) {
      throw new Error(
        `Database initialization failed: Missing tables: ${missingTables.join(
          ", "
        )}`
      );
    }

    return db;
  } catch (error) {
    console.error("Failed to initialize test database:", error);
    throw error;
  }
};
