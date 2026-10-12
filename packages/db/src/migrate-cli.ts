import { createDb, runMigrations } from "./index.ts";

/**
 * 部署用迁移入口：按 journal 幂等应用 packages/db/drizzle，成功 exit 0。
 * 只依赖 DATABASE_URL；MIGRATIONS_FOLDER 缺省为同目录 ./drizzle。
 */
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) {
  console.error("[migrate] DATABASE_URL is required");
  process.exit(1);
}

const migrationsFolder = process.env.MIGRATIONS_FOLDER ?? "./drizzle";

const db = createDb(databaseUrl);
try {
  await runMigrations(db, migrationsFolder);
  console.log(`[migrate] ok (folder=${migrationsFolder})`);
  process.exit(0);
} catch (err) {
  console.error("[migrate] failed:", err);
  process.exit(1);
}
