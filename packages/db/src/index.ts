import { drizzle } from "drizzle-orm/postgres-js";
import { migrate } from "drizzle-orm/postgres-js/migrator";
import postgres from "postgres";
import * as schema from "./schema.ts";

export function createDb(connectionString: string) {
  const client = postgres(connectionString, { max: 10 });
  return drizzle(client, { schema });
}

export type Db = ReturnType<typeof createDb>;

/** 启动时按 journal 应用缺失迁移（幂等）；`migrationsFolder` 指向 drizzle/ 目录 */
export async function runMigrations(db: Db, migrationsFolder: string) {
  await migrate(db, { migrationsFolder });
}

export * from "./schema.ts";
export * from "./repos.ts";
