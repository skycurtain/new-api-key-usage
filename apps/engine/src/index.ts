import { appLogger, setupLogging } from "@new-api-key-usage/core";
import { createDb, createRepos } from "@new-api-key-usage/db";
import { loadEnv } from "./env.ts";
import { createSyncLoop } from "./loop.ts";

const env = loadEnv(process.env);
setupLogging(env.LOG_LEVEL);
const log = appLogger("engine");

const db = createDb(env.DATABASE_URL);
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
