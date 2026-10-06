import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import type { EngineStatus } from "@new-api-key-usage/core";
import { requireAdminSession, type AppVars } from "../middleware.ts";
import { engineStatusSchema, err401 } from "../api-schemas.ts";

/** 状态存储归同步引擎设计；此处只暴露契约字段 */
let engineStatus: EngineStatus = {
  running: false,
  last_round: null,
};

export function adminEngineRoutes() {
  const r = new OpenAPIHono<{ Variables: AppVars }>();
  r.use("*", requireAdminSession);

  r.openapi(
    createRoute({
      method: "get",
      path: "/engine",
      summary: "引擎状态",
      description:
        "最近轮次摘要；last_round 为 null 表示引擎尚未跑过。状态存储细节归同步引擎设计。",
      tags: ["引擎"],
      security: [{ adminSession: [] }],
      responses: {
        200: {
          description: "status",
          content: { "application/json": { schema: engineStatusSchema } },
        },
        401: err401,
      },
    }),
    async (c) => {
      return c.json(engineStatus, 200);
    },
  );

  return r;
}

export function setEngineStatus(next: EngineStatus) {
  engineStatus = next;
}

export function getEngineStatus(): EngineStatus {
  return engineStatus;
}
