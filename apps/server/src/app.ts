import { OpenAPIHono } from "@hono/zod-openapi";
import { apiReference } from "@scalar/hono-api-reference";
import { ERR, appLogger } from "@new-api-key-usage/core";
import { createRepos, type Db } from "@new-api-key-usage/db";
import { jsonError, type AppVars } from "./middleware.ts";
import { adminSessionRoutes } from "./routes/admin-session.ts";
import { adminPlatformRoutes } from "./routes/admin-platform.ts";
import { adminEngineRoutes } from "./routes/admin-engine.ts";
import { adminKeyRoutes } from "./routes/admin-keys.ts";
import { adminMemberRoutes } from "./routes/admin-members.ts";
import { adminUsageRoutes } from "./routes/admin-usage.ts";
import { adminSubscriptionRoutes } from "./routes/admin-subscriptions.ts";
import { adminTopupRoutes } from "./routes/admin-topups.ts";
import { adminAuditRoutes } from "./routes/admin-audit.ts";
import { memberViewRoutes } from "./routes/member-view.ts";

export interface CreateAppOptions {
  db: Db;
  skKeyEncryptionSecret: string;
  newapiBase: string;
  cookieSecure?: boolean;
  adminInitUsername?: string;
  adminInitPassword?: string;
  /** 可注入的上游验证（测试）；默认走 real HTTP */
  fetchTokenUsage?: AppVars["fetchTokenUsage"];
}

export function createApp(opts: CreateAppOptions) {
  const app = new OpenAPIHono<{ Variables: AppVars }>({
    defaultHook: (result, c) => {
      if (!result.success) {
        const fields: Record<string, string> = {};
        for (const issue of result.error.issues) {
          const key = issue.path.join(".") || "body";
          fields[key] = issue.message;
        }
        return jsonError(c, 422, ERR.validation_failed(fields));
      }
    },
  });
  const repos = createRepos(opts.db);

  app.use("*", async (c, next) => {
    const start = Date.now();
    try {
      await next();
    } finally {
      appLogger("http").info(
        `${c.req.method} ${c.req.path} -> ${c.res.status} | ${Date.now() - start}ms`,
      );
    }
  });
  app.use("*", async (c, next) => {
    c.set("repos", repos);
    c.set("skKeyEncryptionSecret", opts.skKeyEncryptionSecret);
    c.set("newapiBase", opts.newapiBase);
    c.set("cookieSecure", opts.cookieSecure ?? true);
    if (opts.fetchTokenUsage) c.set("fetchTokenUsage", opts.fetchTokenUsage);
    if (opts.adminInitUsername)
      c.set("adminInitUsername", opts.adminInitUsername);
    if (opts.adminInitPassword)
      c.set("adminInitPassword", opts.adminInitPassword);
    await next();
  });

  app.notFound((c) => {
    if (c.req.path.startsWith("/api")) {
      return jsonError(c, 404, ERR.not_found());
    }
    return c.text("Not Found", 404);
  });

  app.onError((err, c) => {
    appLogger("server").error(`未捕获错误 ${c.req.method} ${c.req.path}：${err}`);
    return jsonError(c, 500, ERR.internal());
  });

  app.openAPIRegistry.registerComponent("securitySchemes", "adminSession", {
    type: "apiKey",
    in: "cookie",
    name: "admin_session",
    description: "管理面会话 cookie（HttpOnly · Path=/api/admin）",
  });
  app.openAPIRegistry.registerComponent("securitySchemes", "memberToken", {
    type: "http",
    scheme: "bearer",
    description: "成员视图 Bearer 令牌",
  });

  app.doc("/api/openapi.json", {
    openapi: "3.1.0",
    info: {
      title: "new-api-key-usage",
      version: "0.0.0",
      description:
        "NewAPI key 用量统计——管理面 `/api/admin/*`（会话 cookie）与成员视图 `/api/member/*`（Bearer）。成功响应无信封，错误见 ErrorEnvelope。",
    },
    tags: [
      { name: "引导与会话", description: "三态判定 / 登录 / 改密" },
      { name: "引擎", description: "同步引擎状态" },
      { name: "Key 管理", description: "登记 / 启停 / 归属" },
      { name: "成员管理", description: "开户 / 档案 / 令牌 / 启停 / 空壳删除" },
      { name: "成员视图", description: "令牌自助查询" },
    ],
  });

  app.get(
    "/api/docs",
    apiReference({
      theme: "kepler",
      spec: { url: "/api/openapi.json" },
    }),
  );

  const admin = new OpenAPIHono<{ Variables: AppVars }>();
  admin.route("/", adminSessionRoutes());
  admin.route("/", adminEngineRoutes());
  admin.route("/", adminKeyRoutes());
  admin.route("/", adminMemberRoutes());
  admin.route("/", adminUsageRoutes());
  admin.route("/", adminSubscriptionRoutes());
  admin.route("/", adminTopupRoutes());
  admin.route("/", adminAuditRoutes());
  admin.route("/", adminPlatformRoutes());
  app.route("/api/admin", admin);

  app.route("/api/member", memberViewRoutes());

  return app;
}
