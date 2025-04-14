import Database from "better-sqlite3";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import { mkdir, unlink } from "fs/promises";
import { dirname } from "path";
import { generateUUID } from "../utils";
import { chat } from "./schema";

async function resetDatabase() {
  const dbUrl = process.env.DATABASE_URL || "file:./data/chat.db";
  const dbPath = dbUrl.replace(/^file:/, "").replace(/\?.*$/, "");

  try {
    // Delete the existing database file
    try {
      await unlink(dbPath);
      console.log("✅ Removed existing database");
    } catch (error) {
      // Ignore if file doesn't exist
      if ((error as { code?: string }).code !== "ENOENT") {
        throw error;
      }
    }

    // Ensure data directory exists
    const dbDir = dirname(dbPath);
    await mkdir(dbDir, { recursive: true });
    console.log("✅ Created data directory");

    // Create new database connection
    const sqlite = new Database(dbPath);

    // Drop old tables if they exist
    const dropQueries = [
      "DROP TABLE IF EXISTS `chat`;",
      "DROP TABLE IF EXISTS `document`;",
      // Drop migrations table to start fresh
      "DROP TABLE IF EXISTS `__drizzle_migrations`;",
      "DROP TABLE IF EXISTS `folder`;",
    ];

    sqlite.exec("PRAGMA foreign_keys=OFF;");
    for (const query of dropQueries) {
      sqlite.exec(query);
    }
    sqlite.exec("PRAGMA foreign_keys=ON;");

    const db = drizzle(sqlite);

    // Run migrations on fresh database
    console.log("⏳ Running migrations...");
    try {
      await migrate(db, { migrationsFolder: "./lib/db/migrations" });
      console.log("✅ Migrations completed");

      // Create initial chat
      const chatId = generateUUID();
      console.log("⏳ Creating initial chat...");
      db.insert(chat)
        .values({
          id: chatId,
          title: "Welcome to Assistant Web UI",
          chat: JSON.stringify({
            currentId: null,
            messages: [],
          }),
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          archived: false,
          meta: JSON.stringify({}),
        })
        .run();
      console.log(`✅ Created initial chat with ID: ${chatId}`);
    } finally {
      // Close connection
      sqlite.close();
    }
    console.log("✅ Database reset completed successfully");
  } catch (error) {
    console.error("Failed to reset database:", error);
    throw error;
  }
}

resetDatabase().catch((error) => {
  console.error("Fatal error during database reset:", error);
  process.exit(1);
});
