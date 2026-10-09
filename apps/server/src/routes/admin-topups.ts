import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import {
  ERR,
  qpuAt,
  quotaToUsdStr,
  resolveQpuTimeline,
  toUnixSec,
  type TopupItem,
} from "@new-api-key-usage/core";
import type { TopupRow } from "@new-api-key-usage/db";
import {
  jsonError,
  requireAdminSession,
  type AppVars,
} from "../middleware.ts";
import {
  createTopupBodySchema,
  err401,
  err404,
  err422,
  topupItemSchema,
} from "../api-schemas.ts";
import { z } from "zod";

function toTopupItem(row: TopupRow, qpu: number): TopupItem {
  const quota_derived = Math.round(row.amount * qpu);
  return {
    id: row.id,
    upstream_id: row.upstream_id,
    amount: row.amount,
    money: row.money,
    trade_no: row.trade_no,
    payment_method: row.payment_method,
    payment_provider: row.payment_provider,
    status: row.status,
    paid_at: toUnixSec(row.paid_at)!,
    quota_derived,
    quota_usd: quotaToUsdStr(quota_derived, qpu),
    remark: row.remark,
    created_at: toUnixSec(row.created_at)!,
  };
}

function parseTopupBody(body: z.infer<typeof createTopupBodySchema>):
  | { fields: Record<string, string> }
  | {
      values: {
        upstream_id: number | null;
        amount: number;
        money: number;
        trade_no: string | null;
        payment_method: string | null;
        payment_provider: string | null;
        status: string | null;
        paid_at: Date;
        remark: string;
      };
    } {
  const fields: Record<string, string> = {};
  if (!body.paid_at) fields.paid_at = "请填写入账时间";
  if (typeof body.amount !== "number") fields.amount = "请填写计费单位金额";
  if (typeof body.money !== "number") fields.money = "请填写实付金额";
  if (Object.keys(fields).length > 0) return { fields };
  return {
    values: {
      upstream_id: body.upstream_id ?? null,
      amount: body.amount,
      money: body.money,
      trade_no: body.trade_no ?? null,
      payment_method: body.payment_method ?? null,
      payment_provider: body.payment_provider ?? null,
      status: body.status ?? "success",
      paid_at: new Date(body.paid_at),
      remark: body.remark ?? "",
    },
  };
}

export function adminTopupRoutes() {
  const r = new OpenAPIHono<{ Variables: AppVars }>();
  r.use("*", requireAdminSession);

  r.openapi(
    createRoute({
      method: "get",
      path: "/topups",
      summary: "充值入账清单",
      tags: ["支付记录"],
      security: [{ adminSession: [] }],
      responses: {
        200: {
          description: "topup 数组",
          content: {
            "application/json": { schema: z.array(topupItemSchema) },
          },
        },
        401: err401,
      },
    }),
    async (c) => {
      const repos = c.get("repos");
      const timeline = resolveQpuTimeline(await repos.qpu.listTimeline());
      const rows = await repos.topups.listAll();
      return c.json(
        rows.map((row) => toTopupItem(row, qpuAt(row.paid_at, timeline))),
        200,
      );
    },
  );

  r.openapi(
    createRoute({
      method: "post",
      path: "/topups",
      summary: "登记充值",
      tags: ["支付记录"],
      security: [{ adminSession: [] }],
      request: {
        body: {
          content: {
            "application/json": { schema: createTopupBodySchema },
          },
          required: true,
        },
      },
      responses: {
        201: {
          description: "topup",
          content: { "application/json": { schema: topupItemSchema } },
        },
        401: err401,
        422: err422,
      },
    }),
    async (c) => {
      const body = (await c.req.json().catch(() => ({}))) as z.infer<
        typeof createTopupBodySchema
      >;
      const parsed = parseTopupBody(body as z.infer<typeof createTopupBodySchema>);
      if ("fields" in parsed) {
        return jsonError(c, 422, ERR.validation_failed(parsed.fields));
      }
      const repos = c.get("repos");
      const row = await repos.topups.insert(parsed.values);
      await repos.audit.insert({
        operator: c.get("adminUsername") ?? null,
        domain: "payment",
        action: "topup.create",
        summary: `充值 #${row.id} · 登记`,
      });
      const timeline = resolveQpuTimeline(await repos.qpu.listTimeline());
      return c.json(toTopupItem(row, qpuAt(row.paid_at, timeline)), 201);
    },
  );

  r.openapi(
    createRoute({
      method: "put",
      path: "/topups/{id}",
      summary: "编辑充值",
      tags: ["支付记录"],
      security: [{ adminSession: [] }],
      request: {
        params: z.object({ id: z.string() }),
        body: {
          content: {
            "application/json": { schema: createTopupBodySchema },
          },
          required: true,
        },
      },
      responses: {
        200: {
          description: "topup",
          content: { "application/json": { schema: topupItemSchema } },
        },
        401: err401,
        404: err404,
        422: err422,
      },
    }),
    async (c) => {
      const id = Number(c.req.param("id"));
      const body = (await c.req.json().catch(() => ({}))) as z.infer<
        typeof createTopupBodySchema
      >;
      const parsed = parseTopupBody(body as z.infer<typeof createTopupBodySchema>);
      if ("fields" in parsed) {
        return jsonError(c, 422, ERR.validation_failed(parsed.fields));
      }
      const repos = c.get("repos");
      if (!(await repos.topups.findById(id))) {
        return jsonError(c, 404, ERR.not_found());
      }
      const row = await repos.topups.update(id, parsed.values);
      await repos.audit.insert({
        operator: c.get("adminUsername") ?? null,
        domain: "payment",
        action: "topup.update",
        summary: `充值 #${row.id} · 编辑`,
      });
      const timeline = resolveQpuTimeline(await repos.qpu.listTimeline());
      return c.json(toTopupItem(row, qpuAt(row.paid_at, timeline)), 200);
    },
  );

  r.openapi(
    createRoute({
      method: "delete",
      path: "/topups/{id}",
      summary: "删除充值",
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
      const before = await repos.topups.findById(id);
      if (!before) return jsonError(c, 404, ERR.not_found());
      await repos.topups.remove(id);
      await repos.audit.insert({
        operator: c.get("adminUsername") ?? null,
        domain: "payment",
        action: "topup.delete",
        summary: `充值 #${before.id} · 删除`,
      });
      return c.body(null, 204);
    },
  );

  return r;
}
