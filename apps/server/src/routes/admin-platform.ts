import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { z } from "zod";
import {
  ERR,
  fetchPlatformSubscriptions,
  platformLogin,
} from "@new-api-key-usage/core";
import { jsonError, requireAdminSession, type AppVars } from "../middleware.ts";
import { err401, err422, err502 } from "../api-schemas.ts";

const platformSubsSchema = z.object({
  subscriptions: z.array(
    z.object({
      id: z.number().int(),
      plan_id: z.number().int(),
      start_time: z.number().int(),
      end_time: z.number().int(),
      status: z.string(),
      amount_total: z.number(),
      amount_used: z.number(),
    }),
  ),
});

const loginBody = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

const listBody = z.object({
  access_token: z.string().min(1),
});

/**
 * 登记辅助：控制台账号登录 + 拉订阅。密码不落库；access_token 由前端短暂持有。
 */
export function adminPlatformRoutes() {
  const r = new OpenAPIHono<{ Variables: AppVars }>();
  r.use("*", requireAdminSession);

  r.openapi(
    createRoute({
      method: "post",
      path: "/platform/login",
      summary: "登录 NewAPI 控制台（登记辅助）",
      tags: ["支付"],
      security: [{ adminSession: [] }],
      request: {
        body: {
          content: { "application/json": { schema: loginBody } },
          required: true,
        },
      },
      responses: {
        200: {
          description: "access_token",
          content: {
            "application/json": {
              schema: z.object({ access_token: z.string() }),
            },
          },
        },
        401: err401,
        422: err422,
        502: err502,
      },
    }),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      const username = String(body?.username ?? "");
      const password = String(body?.password ?? "");
      if (!username || !password) {
        return jsonError(
          c,
          422,
          ERR.validation_failed({
            username: username ? "" : "请填写用户名",
            password: password ? "" : "请填写密码",
          }),
        );
      }
      const login = await platformLogin(c.get("newapiBase"), username, password);
      if (!login.ok) {
        if (login.kind === "rejected") return jsonError(c, 422, ERR.invalid_credentials());
        if (login.kind === "unreachable") return jsonError(c, 502, ERR.upstream_unreachable());
        return jsonError(
          c,
          422,
          ERR.validation_failed({
            password: "登录未成功——可能需验证码/加密登录，或账号密码不正确",
          }),
        );
      }
      return c.json({ access_token: login.data.access_token }, 200);
    },
  );

  r.openapi(
    createRoute({
      method: "post",
      path: "/platform/subscriptions",
      summary: "拉取订阅列表（登记辅助）",
      tags: ["支付"],
      security: [{ adminSession: [] }],
      request: {
        body: {
          content: { "application/json": { schema: listBody } },
          required: true,
        },
      },
      responses: {
        200: {
          description: "subscriptions",
          content: { "application/json": { schema: platformSubsSchema } },
        },
        401: err401,
        422: err422,
        502: err502,
      },
    }),
    async (c) => {
      const body = await c.req.json().catch(() => null);
      const token = String(body?.access_token ?? "");
      if (!token) {
        return jsonError(
          c,
          422,
          ERR.validation_failed({ access_token: "缺少 access_token" }),
        );
      }
      const subs = await fetchPlatformSubscriptions(c.get("newapiBase"), token);
      if (!subs.ok) {
        if (subs.kind === "rejected") {
          return jsonError(c, 401, ERR.session_expired());
        }
        return jsonError(c, 502, ERR.upstream_unreachable());
      }
      return c.json({ subscriptions: subs.data }, 200);
    },
  );

  return r;
}
