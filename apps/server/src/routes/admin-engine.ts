import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import type { EngineStatus } from "@new-api-key-usage/core";
import { requireAdminSession, type AppVars } from "../middleware.ts";
import { engineStatusSchema, err401 } from "../api-schemas.ts";

export type EngineStatusView = EngineStatus & { sync_interval_ms: number };

export function toEngineStatusView(row: {
  running: boolean;
  sync_interval_ms: number;
  last_round: unknown;
} | null): EngineStatusView {
  if (!row) {
    return { running: false, sync_interval_ms: 300_000, last_round: null };
  }
  return {
    running: row.running,
    sync_interval_ms: row.sync_interval_ms,
    last_round: (row.last_round as EngineStatus["last_round"]) ?? null,
  };
}

export function adminEngineRoutes() {
  const r = new OpenAPIHono<{ Variables: AppVars }>();
  r.use("*", requireAdminSession);

  r.openapi(
    createRoute({
      method: "get",
      path: "/engine",
      summary: "引擎状态",
      description:
        "同步引擎单行快照（engine_status）；last_round 为 null 表示尚未跑过。sync_interval_ms 只读。",
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
      const row = await c.get("repos").engine.getSnapshot();
      return c.json(toEngineStatusView(row), 200);
    },
  );

  return r;
}
