import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import {
  ERR,
  errorBody,
  qpuAt,
  quotaToUsdStr,
  resolveQpuTimeline,
  toUnixSec,
  type SubscriptionItem,
} from "@new-api-key-usage/core";
import type { SubscriptionRow } from "@new-api-key-usage/db";
import {
  jsonError,
  requireAdminSession,
  type AppVars,
} from "../middleware.ts";
import {
  createSubscriptionBodySchema,
  err401,
  err404,
  err422,
  errorSchema,
  subscriptionItemSchema,
} from "../api-schemas.ts";
import { z } from "zod";

function toSubscriptionItem(
  row: SubscriptionRow,
  quota_usd: string,
): SubscriptionItem {
  return {
    id: row.id,
    subscription_id: row.subscription_id,
    period_start: toUnixSec(row.period_start)!,
    period_end: toUnixSec(row.period_end),
    quota_granted: row.quota_granted,
    quota_usd,
    paid_amount: row.paid_amount,
    paid_at: toUnixSec(row.paid_at),
    remark: row.remark,
    created_at: toUnixSec(row.created_at)!,
  };
}

function parseSubBody(body: z.infer<typeof createSubscriptionBodySchema>):
  | { fields: Record<string, string> }
  | {
      values: {
        subscription_id: number;
        period_start: Date;
        period_end: Date | null;
        quota_granted: number;
        paid_amount: number | null;
        paid_at: Date | null;
        remark: string;
      };
    } {
  const fields: Record<string, string> = {};
  if (body.subscription_id == null || body.subscription_id <= 0) {
    fields.subscription_id = "请填写订阅编号";
  }
  if (!body.period_start) fields.period_start = "请填写期间起点";
  if (body.quota_granted == null || body.quota_granted <= 0) {
    fields.quota_granted = "请填写套餐总额度";
  }
  if (Object.keys(fields).length > 0) return { fields };
  return {
    values: {
      subscription_id: body.subscription_id,
      period_start: new Date(body.period_start),
      period_end: body.period_end
        ? new Date(body.period_end)
        : null,
      quota_granted: body.quota_granted,
      paid_amount: body.paid_amount ?? null,
      paid_at: body.paid_at ? new Date(body.paid_at) : null,
      remark: body.remark ?? "",
    },
  };
}

export function adminSubscriptionRoutes() {
  const r = new OpenAPIHono<{ Variables: AppVars }>();
  r.use("*", requireAdminSession);

  r.openapi(
    createRoute({
      method: "get",
      path: "/subscriptions",
      summary: "订阅权益清单",
      tags: ["支付记录"],
      security: [{ adminSession: [] }],
      responses: {
        200: {
          description: "subscription 数组",
          content: {
            "application/json": { schema: z.array(subscriptionItemSchema) },
          },
        },
        401: err401,
      },
    }),
    async (c) => {
      const repos = c.get("repos");
      const timeline = resolveQpuTimeline(await repos.qpu.listTimeline());
      const rows = await repos.subscriptions.listAll();
      return c.json(
        rows.map((row) =>
          toSubscriptionItem(
            row,
            quotaToUsdStr(
              row.quota_granted,
              qpuAt(row.paid_at ?? row.created_at, timeline),
            ),
          ),
        ),
        200,
      );
    },
  );

  r.openapi(
    createRoute({
      method: "post",
      path: "/subscriptions",
      summary: "登记订阅权益",
      tags: ["支付记录"],
      security: [{ adminSession: [] }],
      request: {
        body: {
          content: {
            "application/json": { schema: createSubscriptionBodySchema },
          },
        },
      },
      responses: {
        201: {
          description: "subscription",
          content: {
            "application/json": { schema: subscriptionItemSchema },
          },
        },
        401: err401,
        409: {
          description: "重复登记",
          content: { "application/json": { schema: errorSchema } },
        },
        422: err422,
      },
    }),
    async (c) => {
      const body = c.req.valid("json");
      const parsed = parseSubBody(body);
      if ("fields" in parsed) {
        return jsonError(c, 422, ERR.validation_failed(parsed.fields));
      }
      const repos = c.get("repos");
      const exists = await repos.subscriptions.findBySubscriptionId(
        parsed.values.subscription_id,
      );
      if (exists) {
        return jsonError(
          c,
          409,
          errorBody(
            "duplicate",
            `订阅 #${parsed.values.subscription_id} 已有登记`,
          ),
        );
      }
      const row = await repos.subscriptions.insert(parsed.values);
      const timeline = resolveQpuTimeline(await repos.qpu.listTimeline());
      await repos.audit.insert({
        operator: c.get("adminUsername") ?? null,
        domain: "payment",
        action: "subscription.create",
        summary: `订阅 #${row.subscription_id} · 登记`,
      });
      return c.json(
        toSubscriptionItem(
          row,
          quotaToUsdStr(
            row.quota_granted,
            qpuAt(row.paid_at ?? row.created_at, timeline),
          ),
        ),
        201,
      );
    },
  );

  r.openapi(
    createRoute({
      method: "put",
      path: "/subscriptions/{id}",
      summary: "编辑订阅权益",
      tags: ["支付记录"],
      security: [{ adminSession: [] }],
      request: {
        params: z.object({ id: z.string() }),
        body: {
          content: {
            "application/json": { schema: createSubscriptionBodySchema },
          },
        },
      },
      responses: {
        200: {
          description: "subscription",
          content: {
            "application/json": { schema: subscriptionItemSchema },
          },
        },
        401: err401,
        404: err404,
        422: err422,
      },
    }),
    async (c) => {
      const id = Number(c.req.param("id"));
      const body = c.req.valid("json");
      const parsed = parseSubBody(body);
      if ("fields" in parsed) {
        return jsonError(c, 422, ERR.validation_failed(parsed.fields));
      }
      const repos = c.get("repos");
      if (!(await repos.subscriptions.findById(id))) {
        return jsonError(c, 404, ERR.not_found());
      }
      const row = await repos.subscriptions.update(id, parsed.values);
      const timeline = resolveQpuTimeline(await repos.qpu.listTimeline());
      await repos.audit.insert({
        operator: c.get("adminUsername") ?? null,
        domain: "payment",
        action: "subscription.update",
        summary: `订阅 #${row.subscription_id} · 编辑`,
      });
      return c.json(
        toSubscriptionItem(
          row,
          quotaToUsdStr(
            row.quota_granted,
            qpuAt(row.paid_at ?? row.created_at, timeline),
          ),
        ),
        200,
      );
    },
  );

  r.openapi(
    createRoute({
      method: "delete",
      path: "/subscriptions/{id}",
      summary: "删除订阅权益",
      tags: ["支付记录"],
      security: [{ adminSession: [] }],
      request: { params: z.object({ id: z.string() }) },
      responses: {
        204: { description: "deleted" },
        401: err401,
        404: err404,
      },
    }),
    async (c) => {
      const id = Number(c.req.param("id"));
      const repos = c.get("repos");
      const before = await repos.subscriptions.findById(id);
      if (!before) return jsonError(c, 404, ERR.not_found());
      await repos.subscriptions.remove(id);
      await repos.audit.insert({
        operator: c.get("adminUsername") ?? null,
        domain: "payment",
        action: "subscription.delete",
        summary: `订阅 #${before.subscription_id} · 删除`,
      });
      return c.body(null, 204);
    },
  );

  return r;
}
