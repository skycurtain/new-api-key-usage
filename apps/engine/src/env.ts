export interface EngineEnv {
  DATABASE_URL: string;
  SK_KEY_ENCRYPTION_SECRET: string;
  NEWAPI_BASE: string;
  SYNC_INTERVAL_MS: number;
  LOG_LEVEL: "debug" | "info" | "warning" | "error" | "fatal";
}

function parseLogLevel(
  value: string | undefined,
): "debug" | "info" | "warning" | "error" | "fatal" {
  const v = (value ?? "info").trim().toLowerCase();
  if (
    v === "debug" ||
    v === "info" ||
    v === "warning" ||
    v === "error" ||
    v === "fatal"
  ) {
    return v;
  }
  throw new Error("LOG_LEVEL must be debug|info|warning|error|fatal");
}

export function loadEnv(source: Record<string, string | undefined>): EngineEnv {
  const databaseUrl = source.DATABASE_URL;
  const secret = source.SK_KEY_ENCRYPTION_SECRET;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!secret) throw new Error("SK_KEY_ENCRYPTION_SECRET is required");

  const interval = Number(source.SYNC_INTERVAL_MS ?? 300_000);
  if (!Number.isInteger(interval) || interval < 1000) {
    throw new Error("SYNC_INTERVAL_MS must be an integer >= 1000");
  }

  return {
    DATABASE_URL: databaseUrl,
    SK_KEY_ENCRYPTION_SECRET: secret,
    NEWAPI_BASE: source.NEWAPI_BASE ?? "http://127.0.0.1:8080",
    SYNC_INTERVAL_MS: interval,
    LOG_LEVEL: parseLogLevel(source.LOG_LEVEL),
  };
}
