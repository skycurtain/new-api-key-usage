import { fileURLToPath } from "node:url";
import { appLogger, setupLogging } from "@new-api-key-usage/core";
import { createDb, createRepos, runMigrations } from "@new-api-key-usage/db";
import { loadEnv } from "./env.ts";
import { createSyncLoop } from "./loop.ts";

const env = loadEnv(process.env);
setupLogging(env.LOG_LEVEL);
const log = appLogger("engine");

const db = createDb(env.DATABASE_URL);

const migrationsFolder =
  process.env.MIGRATIONS_FOLDER ??
  fileURLToPath(new URL("../../../packages/db/drizzle", import.meta.url));
await runMigrations(db, migrationsFolder);
log.info("数据库迁移已就绪");

const repos = createRepos(db);

const loop = createSyncLoop({
  repos,
  newapiBase: env.NEWAPI_BASE,
  skKeyEncryptionSecret: env.SK_KEY_ENCRYPTION_SECRET,
  intervalMs: env.SYNC_INTERVAL_MS,
});

loop.start();

log.info`apps/engine 已就绪`;

process.on("SIGINT", () => {
  void loop.stop().then(() => process.exit(0));
});
process.on("SIGTERM", () => {
  void loop.stop().then(() => process.exit(0));
});
