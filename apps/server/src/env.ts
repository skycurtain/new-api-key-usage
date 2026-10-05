export interface Env {
  /** 本服务监听端口（避开 3000/3001 等占用） */
  PORT: number;
  /** PostgreSQL 连接串 */
  DATABASE_URL: string;
  /**
   * 已登记 sk-key 的加密密钥（≥32 字节 base64url）。
   * 经 HKDF 派生 hmac / aes 子密钥；**入库后不可更换**，否则存量 key_ciphertext 无法解密。
   */
  SK_KEY_ENCRYPTION_SECRET: string;
  /** 上游 NewAPI 实例根地址（非本服务） */
  NEWAPI_BASE: string;
  /** 会话 cookie 是否带 Secure；默认 true。本地 HTTP 调试可设 false */
  COOKIE_SECURE: boolean;
  /** 业务日志级别，默认 info */
  LOG_LEVEL: "debug" | "info" | "warning" | "error" | "fatal";
  /** 空库 + 二者均存在时静默落库管理员（与引导页双通道） */
  ADMIN_INIT_USERNAME?: string;
  ADMIN_INIT_PASSWORD?: string;
}

function parseBool(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  const v = value.trim().toLowerCase();
  if (v === "1" || v === "true" || v === "yes" || v === "on") return true;
  if (v === "0" || v === "false" || v === "no" || v === "off") return false;
  throw new Error(`invalid boolean: ${value}`);
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
  throw new Error(`LOG_LEVEL must be debug|info|warning|error|fatal`);
}

export function loadEnv(source: Record<string, string | undefined>): Env {
  const databaseUrl = source.DATABASE_URL;
  const skKeyEncryptionSecret = source.SK_KEY_ENCRYPTION_SECRET;
  if (!databaseUrl) throw new Error("DATABASE_URL is required");
  if (!skKeyEncryptionSecret) {
    throw new Error("SK_KEY_ENCRYPTION_SECRET is required");
  }

  const port = Number(source.PORT ?? 18456);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PORT must be an integer in 1..65535");
  }

  return {
    PORT: port,
    DATABASE_URL: databaseUrl,
    SK_KEY_ENCRYPTION_SECRET: skKeyEncryptionSecret,
    NEWAPI_BASE: source.NEWAPI_BASE ?? "http://127.0.0.1:8080",
    COOKIE_SECURE: parseBool(source.COOKIE_SECURE, true),
    LOG_LEVEL: parseLogLevel(source.LOG_LEVEL),
    ADMIN_INIT_USERNAME: source.ADMIN_INIT_USERNAME,
    ADMIN_INIT_PASSWORD: source.ADMIN_INIT_PASSWORD,
  };
}
