import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import {
  ERR,
  qpuAt,
  quotaToUsdStr,
  resolveQpuTimeline,
  toUnixSec,
  type PaymentItem,
} from "@new-api-key-usage/core";
import type { PaymentRow } from "@new-api-key-usage/db";
import {
  jsonError,
  requireAdminSession,
  type AppVars,
} from "../middleware.ts";
import { err401, err404, err422, paymentItemSchema } from "../api-schemas.ts";
import { z } from "zod";

const createBody = z.object({
  kind: z.enum(["subscription", "topup"]),
  paid_at: z.string(),
  paid_amount: z.number(),
  remark: z.string().optional().default(""),
  period_start: z.string().nullable().optional(),
  period_end: z.string().nullable().optional(),
  subscription_id: z.number().int().positive().nullable().optional(),
  quota_granted: z.number().int().nullable().optional(),
});

function toPaymentItem(row: PaymentRow, quota_usd: string): PaymentItem {
  return {
    id: row.id,
    kind: row.kind as PaymentItem["kind"],
    paid_at: toUnixSec(row.paid_at)!,
    paid_amount: row.paid_amount,
    remark: row.remark,
    period_start: toUnixSec(row.period_start),
    period_end: toUnixSec(row.period_end),
    subscription_id: row.subscription_id,
    quota_granted: row.quota_granted,
    quota_usd,
  };
}

function validatePaymentBody(
  body: Record<string, unknown>,
):
  | { fields: Record<string, string> }
  | {
      values: {
        kind: string;
        paid_at: Date;
        paid_amount: number;
        remark: string;
        period_start: Date | null;
        period_end: Date | null;
        subscription_id: number | null;
        quota_granted: number | null;
      };
    } {
  const fields: Record<string, string> = {};
  const kind = body?.kind;
  if (kind !== "subscription" && kind !== "topup") {
    fields.kind = "请选择订阅或充值";
    return { fields };
  }
  if (!body?.paid_at) fields.paid_at = "请填写支付时间";
  if (typeof body?.paid_amount !== "number") {
    fields.paid_amount = "请填写支付金额";
  }
  if (body?.quota_granted == null) fields.quota_granted = "请填写本笔额度";
  if (kind === "subscription") {
    if (!body?.period_start) fields.period_start = "订阅必须填写期间起点";
    if (body?.subscription_id == null) {
      fields.subscription_id = "订阅必须填写订阅编号";
    }
  }
  if (Object.keys(fields).length > 0) return { fields };
  return {
    values: {
      kind: kind as string,
      paid_at: new Date(String(body.paid_at)),
      paid_amount: Number(body.paid_amount),
      remark: typeof body.remark === "string" ? body.remark : "",
      period_start:
        kind === "subscription" && body.period_start
          ? new Date(String(body.period_start))
          : null,
      period_end:
        body.period_end != null && body.period_end !== ""
          ? new Date(String(body.period_end))
          : null,
      subscription_id:
        kind === "subscription" && body.subscription_id != null
          ? Number(body.subscription_id)
          : null,
      quota_granted: Number(body.quota_granted),
    },
  };
}

export function adminPaymentRoutes() {
  const r = new OpenAPIHono<{ Variables: AppVars }>();
  r.use("*", requireAdminSession);

  r.openapi(
    createRoute({
      method: "get",
      path: "/payments",
      summary: "支付记录清单",
      description: "全量直返、支付时间倒序；quota_usd 按 paid_at 时刻 QPU 换算",
      tags: ["支付记录"],
      security: [{ adminSession: [] }],
      responses: {
        200: {
          description: "payment 数组",
          content: {
            "application/json": { schema: z.array(paymentItemSchema) },
          },
        },
        401: err401,
      },
    }),
    async (c) => {
      const repos = c.get("repos");
      const timeline = resolveQpuTimeline(await repos.qpu.listTimeline());
      const rows = await repos.payments.listAll();
      const items = rows.map((row) => {
        const qpu = qpuAt(row.paid_at, timeline);
        return toPaymentItem(
          row,
          row.quota_granted != null
            ? quotaToUsdStr(row.quota_granted, qpu)
            : "0.00",
        );
      });
      return c.json(items, 200);
    },
  );

  r.openapi(
    createRoute({
      method: "post",
      path: "/payments",
      summary: "登记支付",
      description: "订阅/充值同构；kind 决定期间与订阅编号是否必填",
      tags: ["支付记录"],
      security: [{ adminSession: [] }],
      request: {
        body: {
          content: { "application/json": { schema: createBody } },
          required: true,
        },
      },
      responses: {
        201: {
          description: "payment",
          content: { "application/json": { schema: paymentItemSchema } },
        },
        401: err401,
        422: err422,
      },
    }),
    async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      const parsed = validatePaymentBody(body);
      if ("fields" in parsed) {
        return jsonError(c, 422, ERR.validation_failed(parsed.fields));
      }
      const repos = c.get("repos");
      const row = await repos.payments.insert(parsed.values);
      await repos.audit.insert({
        operator: c.get("adminUsername") ?? null,
        domain: "payment",
        action: "payment.create",
        summary: `登记支付 #${row.id} ${row.kind}`,
      });
      const timeline = resolveQpuTimeline(await repos.qpu.listTimeline());
      const qpu = qpuAt(row.paid_at, timeline);
      return c.json(
        toPaymentItem(
          row,
          row.quota_granted != null
            ? quotaToUsdStr(row.quota_granted, qpu)
            : "0.00",
        ),
        201,
      );
    },
  );

  r.openapi(
    createRoute({
      method: "put",
      path: "/payments/{id}",
      summary: "编辑支付",
      tags: ["支付记录"],
      security: [{ adminSession: [] }],
      request: {
        params: z.object({ id: z.string() }),
        body: {
          content: { "application/json": { schema: createBody } },
          required: true,
        },
      },
      responses: {
        200: {
          description: "payment",
          content: { "application/json": { schema: paymentItemSchema } },
        },
        401: err401,
        404: err404,
        422: err422,
      },
    }),
    async (c) => {
      const id = Number(c.req.param("id"));
      const body = (await c.req.json().catch(() => ({}))) as Record<
        string,
        unknown
      >;
      const parsed = validatePaymentBody(body);
      if ("fields" in parsed) {
        return jsonError(c, 422, ERR.validation_failed(parsed.fields));
      }
      const repos = c.get("repos");
      if (!(await repos.payments.findById(id))) {
        return jsonError(c, 404, ERR.not_found());
      }
      const row = await repos.payments.update(id, parsed.values);
      await repos.audit.insert({
        operator: c.get("adminUsername") ?? null,
        domain: "payment",
        action: "payment.update",
        summary: `编辑支付 #${row.id}`,
      });
      const timeline = resolveQpuTimeline(await repos.qpu.listTimeline());
      const qpu = qpuAt(row.paid_at, timeline);
      return c.json(
        toPaymentItem(
          row,
          row.quota_granted != null
            ? quotaToUsdStr(row.quota_granted, qpu)
            : "0.00",
        ),
        200,
      );
    },
  );

  r.openapi(
    createRoute({
      method: "delete",
      path: "/payments/{id}",
      summary: "删除支付",
      tags: ["支付记录"],
      security: [{ adminSession: [] }],
      request: {
        params: z.object({ id: z.string() }),
      },
      responses: {
        204: { description: "No Content" },
        401: err401,
        404: err404,
      },
    }),
    async (c) => {
      const id = Number(c.req.param("id"));
      const repos = c.get("repos");
      const before = await repos.payments.findById(id);
      if (!before) return jsonError(c, 404, ERR.not_found());
      await repos.payments.remove(id);
      await repos.audit.insert({
        operator: c.get("adminUsername") ?? null,
        domain: "payment",
        action: "payment.delete",
        summary: `删除支付 #${id}`,
      });
      return c.body(null, 204);
    },
  );

  return r;
}
