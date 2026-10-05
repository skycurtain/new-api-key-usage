import type { Context, Next } from "hono";
import { getCookie } from "hono/cookie";
import { ERR, hashToken, type ErrorBody } from "@new-api-key-usage/core";
import type { Repos } from "@new-api-key-usage/db";

export const SESSION_COOKIE = "admin_session";
export const SESSION_TTL_SECONDS = 7 * 24 * 60 * 60;

export type AppVars = {
  repos: Repos;
  skKeyEncryptionSecret: string;
  newapiBase: string;
  cookieSecure: boolean;
  /** 登记时调上游验证；测试可注入 */
  fetchTokenUsage?: (skKey: string) => Promise<
    | { ok: true; data: import("@new-api-key-usage/core").TokenUsage }
    | { ok: false; kind: string }
  >;
  adminInitUsername?: string;
  adminInitPassword?: string;
  adminUsername?: string;
  adminUserId?: number;
  memberId?: number;
};

/** 错误信封统一出口；返回 any 以兼容 OpenAPIHono 严格响应联合 */
export function jsonError(
  c: Context,
  status: 400 | 401 | 404 | 409 | 422 | 429 | 500 | 502,
  body: ErrorBody,
): any {
  return c.json(body, status);
}

export async function requireAdminSession(
  c: Context<{ Variables: AppVars }>,
  next: Next,
) {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return jsonError(c, 401, ERR.session_expired());
  const tokenHash = await hashToken(token);
  const row = await c.get("repos").sessions.findValid(tokenHash, new Date());
  if (!row) return jsonError(c, 401, ERR.session_expired());
  c.set("adminUserId", row.user_id);
  c.set("adminUsername", row.username);
  await next();
}

export async function requireMemberToken(
  c: Context<{ Variables: AppVars }>,
  next: Next,
) {
  const header = c.req.header("Authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(header);
  if (!m?.[1]) return jsonError(c, 401, ERR.session_expired());
  const tokenHash = await hashToken(m[1]);
  const row = await c.get("repos").members.findByTokenHash(tokenHash);
  if (!row || row.status !== "active") {
    return jsonError(c, 401, ERR.session_expired());
  }
  c.set("memberId", row.id);
  await next();
}
