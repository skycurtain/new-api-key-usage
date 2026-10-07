import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import { toUnixSec, type AuditLogItem } from "@new-api-key-usage/core";
import {
  requireAdminSession,
  type AppVars,
} from "../middleware.ts";
import { auditLogItemSchema, err401, err422 } from "../api-schemas.ts";
import { z } from "zod";

const pageSchema = z.object({
  items: z.array(auditLogItemSchema),
  total: z.number().int(),
});

export function adminAuditRoutes() {
  const r = new OpenAPIHono<{ Variables: AppVars }>();
  r.use("*", requireAdminSession);

  r.openapi(
    createRoute({
      method: "get",
      path: "/audit-logs",
      summary: "审计日志",
      description: "分页、时间倒序；可按 domain 过滤（key/payment/member/account）",
      tags: ["审计"],
      security: [{ adminSession: [] }],
      request: {
        query: z.object({
          page: z.string().optional(),
          page_size: z.string().optional(),
          domain: z
            .enum(["key", "payment", "member", "account"])
            .optional(),
        }),
      },
      responses: {
        200: {
          description: "items/total",
          content: { "application/json": { schema: pageSchema } },
        },
        401: err401,
        422: err422,
      },
    }),
    async (c) => {
      const q = c.req.query();
      const page = Math.max(1, Number(q.page ?? 1) || 1);
      const page_size = Math.min(
        200,
        Math.max(1, Number(q.page_size ?? 50) || 50),
      );
      const { rows, total } = await c.get("repos").audit.listPage({
        domain: q.domain,
        page,
        page_size,
      });
      const items: AuditLogItem[] = rows.map((row) => ({
        id: row.id,
        created_at: toUnixSec(row.created_at)!,
        operator: row.operator,
        domain: row.domain as AuditLogItem["domain"],
        action: row.action,
        summary: row.summary,
      }));
      return c.json({ items, total }, 200);
    },
  );

  return r;
}
