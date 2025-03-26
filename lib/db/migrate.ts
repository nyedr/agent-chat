import { config } from "dotenv";
import { drizzle } from "drizzle-orm/better-sqlite3";
import { migrate } from "drizzle-orm/better-sqlite3/migrator";
import Database from "better-sqlite3";
import { mkdir } from "fs/promises";

config({
  path: ".env.local",
});

const runMigrate = async () => {
  const dbUrl = process.env.DATABASE_URL || "file:./data/chat.db";
  const dbPath = dbUrl.replace("file:", "");

  // Ensure data directory exists
  try {
    await mkdir("./data", { recursive: true });
  } catch (error) {
    if ((error as { code?: string }).code !== "EEXIST") {
      console.error("Failed to create data directory:", error);
      process.exit(1);
    }
  }

  const sqlite = new Database(dbPath);
  const db = drizzle(sqlite);

  console.log("⏳ Running migrations...");

  const start = Date.now();

  try {
    migrate(db, { migrationsFolder: "./lib/db/migrations" });
    const end = Date.now();
    console.log("✅ Migrations completed in", end - start, "ms");
    process.exit(0);
  } catch (error) {
    console.error("❌ Migration failed");
    console.error(error);
    process.exit(1);
  } finally {
    sqlite.close();
  }
};

runMigrate().catch((err) => {
  console.error("❌ Migration failed");
  console.error(err);
  process.exit(1);
});
