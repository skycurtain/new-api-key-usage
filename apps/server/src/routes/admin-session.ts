import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { setCookie, deleteCookie, getCookie } from "hono/cookie";
import {
  ERR,
  generateToken,
  hashPassword,
  hashToken,
  verifyPassword,
} from "@new-api-key-usage/core";
import {
  jsonError,
  requireAdminSession,
  SESSION_COOKIE,
  SESSION_TTL_SECONDS,
  type AppVars,
} from "../middleware.ts";
import {
  changePasswordBodySchema,
  err401,
  err409,
  err422,
  loginBodySchema,
  setupBodySchema,
  setupStateSchema,
  usernameSchema,
} from "../api-schemas.ts";
import {
  isLoginThrottled,
  recordLoginFailure,
  recordLoginSuccess,
} from "../login-throttle.ts";

function setSessionCookie(
  c: Parameters<typeof setCookie>[0],
  plaintext: string,
  secure: boolean,
) {
  setCookie(c, SESSION_COOKIE, plaintext, {
    httpOnly: true,
    secure,
    sameSite: "Lax",
    path: "/api/admin",
    maxAge: SESSION_TTL_SECONDS,
  });
}

/** 哑哈希：用户不存在时也跑一次 PBKDF2，抹平时序侧信道 */
const DUMMY_PASSWORD_HASH =
  "pbkdf2$210000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export function adminSessionRoutes() {
  const r = new OpenAPIHono<{ Variables: AppVars }>();

  // 只保护需要会话的端点：GET/DELETE /session、PUT /password
  // POST /session 是登录、setup* 是引导——不能套鉴权
  r.use("/session", async (c, next) => {
    if (c.req.method === "POST") return next();
    return requireAdminSession(c, next);
  });
  r.use("/password", requireAdminSession);

  r.openapi(
    createRoute({
      method: "get",
      path: "/setup-state",
      summary: "入口三态判定",
      description:
        "users 非空 → true（登录页）；空库 + env 凭证在 → 静默落库后 true；空库 + 无凭证 → false（引导页）",
      tags: ["引导与会话"],
      responses: {
        200: {
          description: "initialized",
          content: { "application/json": { schema: setupStateSchema } },
        },
      },
    }),
    async (c) => {
      const repos = c.get("repos");
      if ((await repos.users.countAll()) > 0) {
        return c.json({ initialized: true }, 200);
      }
      const initUser = c.get("adminInitUsername");
      const initPass = c.get("adminInitPassword");
      if (initUser && initPass) {
        try {
          const password_hash = await hashPassword(initPass);
          await repos.users.insert(initUser, password_hash);
          await repos.audit.insert({
            operator: null,
            domain: "account",
            action: "account.init",
            summary: "空库 env 静默重建管理员",
          });
        } catch {
          // 并发/重复初始化：唯一约束冲突时视为已初始化
        }
        return c.json({ initialized: true }, 200);
      }
      return c.json({ initialized: false }, 200);
    },
  );

  r.openapi(
    createRoute({
      method: "post",
      path: "/setup",
      summary: "引导页落库（一次性）",
      description: "仅空库 + 无 env 凭证时有效；成功即建立会话",
      tags: ["引导与会话"],
      request: {
        body: {
          content: { "application/json": { schema: setupBodySchema } },
          required: true,
        },
      },
      responses: {
        200: {
          description: "username + Set-Cookie",
          content: { "application/json": { schema: usernameSchema } },
        },
        409: err409,
        422: err422,
      },
    }),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      const username =
        typeof body?.username === "string" ? body.username.trim() : "";
      const password = typeof body?.password === "string" ? body.password : "";
      const fields: Record<string, string> = {};
      if (!username) fields.username = "请填写用户名";
      if (!password) fields.password = "请填写密码";
      if (Object.keys(fields).length > 0) {
        return jsonError(c, 422, ERR.validation_failed(fields));
      }
      const repos = c.get("repos");
      if ((await repos.users.countAll()) > 0) {
        return jsonError(c, 409, ERR.already_initialized());
      }
      const password_hash = await hashPassword(password);
      const user = await repos.users.insert(username, password_hash);
      const token = await generateToken();
      const expires_at = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
      await repos.sessions.insert(user.id, token.hash, expires_at);
      await repos.audit.insert({
        operator: username,
        domain: "account",
        action: "account.init",
        summary: `引导页创建管理员 ${username}`,
      });
      setSessionCookie(c, token.plaintext, c.get("cookieSecure"));
      return c.json({ username: user.username }, 200);
    },
  );

  r.openapi(
    createRoute({
      method: "post",
      path: "/session",
      summary: "登录",
      tags: ["引导与会话"],
      request: {
        body: {
          content: { "application/json": { schema: loginBodySchema } },
          required: true,
        },
      },
      responses: {
        200: {
          description: "username + Set-Cookie",
          content: { "application/json": { schema: usernameSchema } },
        },
        401: err401,
        429: {
          description: "登录过于频繁",
          content: {
            "application/json": {
              schema: err422.content["application/json"].schema,
            },
          },
        },
      },
    }),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      const username = typeof body?.username === "string" ? body.username : "";
      const password = typeof body?.password === "string" ? body.password : "";
      if (isLoginThrottled(username)) {
        return jsonError(c, 429, ERR.too_many_requests());
      }
      const repos = c.get("repos");
      const user = await repos.users.findByUsername(username);
      const ok = await verifyPassword(
        password,
        user?.password_hash ?? DUMMY_PASSWORD_HASH,
      );
      if (!user || !ok) {
        recordLoginFailure(username || "_");
        return jsonError(c, 401, ERR.invalid_credentials());
      }
      recordLoginSuccess(username);

      const token = await generateToken();
      const expires_at = new Date(Date.now() + SESSION_TTL_SECONDS * 1000);
      await repos.sessions.insert(user.id, token.hash, expires_at);
      setSessionCookie(c, token.plaintext, c.get("cookieSecure"));
      return c.json({ username: user.username }, 200);
    },
  );

  r.openapi(
    createRoute({
      method: "get",
      path: "/session",
      summary: "当前会话",
      tags: ["引导与会话"],
      security: [{ adminSession: [] }],
      responses: {
        200: {
          description: "username",
          content: { "application/json": { schema: usernameSchema } },
        },
        401: err401,
      },
    }),
    async (c) => {
      return c.json({ username: c.get("adminUsername") ?? "" }, 200);
    },
  );

  r.openapi(
    createRoute({
      method: "delete",
      path: "/session",
      summary: "登出",
      tags: ["引导与会话"],
      security: [{ adminSession: [] }],
      responses: {
        204: { description: "No Content" },
        401: err401,
      },
    }),
    async (c) => {
      const token = getCookie(c, SESSION_COOKIE);
      if (token) {
        await c.get("repos").sessions.deleteByTokenHash(await hashToken(token));
      }
      deleteCookie(c, SESSION_COOKIE, { path: "/api/admin" });
      return c.body(null, 204);
    },
  );

  r.openapi(
    createRoute({
      method: "put",
      path: "/password",
      summary: "改密",
      description: "成功后删除其他会话、保留当前",
      tags: ["引导与会话"],
      security: [{ adminSession: [] }],
      request: {
        body: {
          content: { "application/json": { schema: changePasswordBodySchema } },
          required: true,
        },
      },
      responses: {
        204: { description: "No Content" },
        401: err401,
        422: err422,
      },
    }),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      const old_password = String(body?.old_password ?? "");
      const new_password = String(body?.new_password ?? "");
      if (!new_password) {
        return jsonError(
          c,
          422,
          ERR.validation_failed({ new_password: "请填写新密码" }),
        );
      }
      const repos = c.get("repos");
      const userId = c.get("adminUserId")!;
      const user = await repos.users.findById(userId);
      if (!user) return jsonError(c, 401, ERR.session_expired());
      const ok = await verifyPassword(old_password, user.password_hash);
      if (!ok) {
        return jsonError(
          c,
          422,
          ERR.validation_failed({ old_password: "旧密码不正确" }),
        );
      }
      await repos.users.updatePassword(
        userId,
        await hashPassword(new_password),
      );
      const token = getCookie(c, SESSION_COOKIE);
      const currentHash = token ? await hashToken(token) : null;
      const all = await repos.sessions.listByUser(userId);
      for (const s of all) {
        if (s.token_hash !== currentHash) {
          await repos.sessions.deleteById(s.id);
        }
      }
      await repos.audit.insert({
        operator: user.username,
        domain: "account",
        action: "account.password_change",
        summary: "修改密码，其他会话已失效",
      });
      return c.body(null, 204);
    },
  );

  return r;
}
