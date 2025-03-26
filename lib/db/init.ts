"use server";

import Database from "better-sqlite3";
import { BetterSQLite3Database, drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import * as schema from "./schema";

let _db: BetterSQLite3Database<typeof schema> | null = null;

export async function initializeDatabase() {
  if (_db) return _db;

  try {
    console.log("⏳ Initializing database...");
    const start = Date.now();

    const dbUrl = process.env.DATABASE_URL || "file:./data/chat.db";
    const dbPath = dbUrl.replace(/^file:/, "").replace(/\?.*$/, "");

    const sqlite = new Database(dbPath, {
      verbose: console.log,
    });

    // Enable foreign keys
    sqlite.pragma("foreign_keys = ON");

    // Verify foreign keys are enabled
    const fkEnabled = sqlite.pragma("foreign_keys", { simple: true });
    if (!fkEnabled) {
      throw new Error("Failed to enable SQLite foreign key constraints");
    }

    // Test write access
    sqlite.exec(
      "CREATE TABLE IF NOT EXISTS _test_write (id INTEGER PRIMARY KEY); DROP TABLE _test_write;"
    );

    _db = drizzle(sqlite, {
      schema,
      logger: true,
    });

    // Run migrations
    console.log("⏳ Running migrations...");
    try {
      await migrate(_db, { migrationsFolder: "./lib/db/migrations" });
      console.log("✅ Migrations completed successfully");
    } catch (error) {
      console.error("❌ Migration failed:", error);
      throw error;
    }

    // Verify database connection
    sqlite.prepare("SELECT 1").get();
    const end = Date.now();
    console.log(
      "✅ Database connection and setup completed in",
      end - start,
      "ms"
    );

    return _db;
  } catch (error) {
    console.error("Failed to initialize database:", error);
    throw error;
  }
}

// Initialize the database when this module is imported
initializeDatabase()
  .then((db) => {
    _db = db;
  })
  .catch((error) => {
    console.error("Failed to initialize database:", error);
    process.exit(1);
  });

// Export a function to get the db instance
export async function getDb() {
  if (!_db) {
    return initializeDatabase();
  }
  return _db;
}
