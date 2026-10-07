import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import {
  ERR,
  resolveQpuTimeline,
  sumUsage,
  toUnixSec,
  type LogItem,
} from "@new-api-key-usage/core";
import {
  jsonError,
  requireAdminSession,
  type AppVars,
} from "../middleware.ts";
import {
  err401,
  err422,
  logPageSchema,
} from "../api-schemas.ts";
import { z } from "zod";

const usageTotals = z.object({
  count: z.number().int(),
  quota: z.number(),
  quota_usd: z.string(),
});

const overviewSchema = z.object({
  data_cutoff: z.number().int().nullable(),
  unassigned_subscription: usageTotals,
  by_source: z.array(
    z.object({
      billing_source: z.string(),
      count: z.number().int(),
      quota: z.number(),
      quota_usd: z.string(),
    }),
  ),
  by_member: z.array(
    z.object({
      member_id: z.number().int().nullable(),
      member_name: z.string().nullable(),
      key_count: z.number().int(),
      data_cutoff: z.number().int().nullable(),
      usage: usageTotals,
    }),
  ),
  by_key: z.array(
    z.object({
      key_id: z.number().int(),
      token_name: z.string(),
      member_id: z.number().int().nullable(),
      member_name: z.string().nullable(),
      status: z.string(),
      data_cutoff: z.number().int().nullable(),
      usage: usageTotals,
    }),
  ),
});

const qpuLatestSchema = z.object({
  qpu: z.number(),
  effective_from: z.number().int(),
});

const timeRange = z.object({
  from: z.string(),
  to: z.string(),
});

function parseRange(
  query: { from?: string; to?: string },
): { from: Date; to: Date } | { fields: Record<string, string> } {
  const fields: Record<string, string> = {};
  if (!query.from) fields.from = "缺少起始时间";
  if (!query.to) fields.to = "缺少结束时间";
  if (Object.keys(fields).length > 0) return { fields };
  const from = new Date(query.from!);
  const to = new Date(query.to!);
  if (Number.isNaN(from.getTime())) fields.from = "时间格式无效";
  if (Number.isNaN(to.getTime())) fields.to = "时间格式无效";
  else if (to.getTime() <= from.getTime()) fields.to = "结束时间必须晚于起始时间";
  if (Object.keys(fields).length > 0) return { fields };
  return { from, to };
}

export function adminUsageRoutes() {
  const r = new OpenAPIHono<{ Variables: AppVars }>();
  r.use("*", requireAdminSession);

  r.openapi(
    createRoute({
      method: "get",
      path: "/qpu/latest",
      summary: "当前换算率",
      description: "支付表单美元 ↔ quota 双输入换算用；库空时回退 500000",
      tags: ["用量"],
      security: [{ adminSession: [] }],
      responses: {
        200: {
          description: "qpu",
          content: { "application/json": { schema: qpuLatestSchema } },
        },
        401: err401,
      },
    }),
    async (c) => {
      const latest = await c.get("repos").qpu.latest();
      if (!latest) {
        return c.json(
          { qpu: 500_000, effective_from: 0 },
          200,
        );
      }
      return c.json(
        {
          qpu: latest.qpu,
          effective_from: toUnixSec(latest.effective_from)!,
        },
        200,
      );
    },
  );

  r.openapi(
    createRoute({
      method: "get",
      path: "/overview",
      summary: "全员总览",
      description:
        "from/to 必填、左闭右开；聚合仅 type=2。unassigned_subscription 为健康指示器。",
      tags: ["用量"],
      security: [{ adminSession: [] }],
      request: { query: timeRange },
      responses: {
        200: {
          description: "overview",
          content: { "application/json": { schema: overviewSchema } },
        },
        401: err401,
        422: err422,
      },
    }),
    async (c) => {
      const q = c.req.query();
      const range = parseRange(q);
      if ("fields" in range) {
        return jsonError(c, 422, ERR.validation_failed(range.fields));
      }
      const repos = c.get("repos");
      const timeline = resolveQpuTimeline(await repos.qpu.listTimeline());
      const rows = await repos.logs.listForAggregate(range.from, range.to);

      const data_cutoff = await repos.keysExtra.slowestLogSyncedAt();

      const unassigned_rows = rows.filter(
        (x) => x.billing_source === "subscription" && x.subscription_id == null,
      );
      const unassigned_subscription = sumUsage(unassigned_rows, timeline);

      const bySourceMap = new Map<
        string,
        Array<{ quota: number; created_at: Date }>
      >();
      for (const x of rows) {
        const key = x.billing_source ?? "unknown";
        const list = bySourceMap.get(key) ?? [];
        list.push({ quota: x.quota, created_at: x.created_at });
        bySourceMap.set(key, list);
      }
      const by_source = [...bySourceMap.entries()].map(([billing_source, list]) => ({
        billing_source,
        ...sumUsage(list, timeline),
      }));

      // 按 key / 成员（含未归属）
      const keyMap = new Map<
        number,
        {
          token_name: string;
          member_id: number | null;
          member_name: string | null;
          status: string;
          log_synced_at: Date | null;
          rows: Array<{ quota: number; created_at: Date }>;
        }
      >();
      const keyMeta = await repos.keysExtra.listIdsWithCutoff();
      const memberNameById = new Map(
        (await repos.members.listAll()).map((m) => [m.id, m.name]),
      );
      for (const k of keyMeta) {
        keyMap.set(k.id, {
          token_name: k.token_name,
          member_id: k.member_id,
          member_name:
            k.member_id == null ? null : (memberNameById.get(k.member_id) ?? null),
          status: k.status,
          log_synced_at: k.log_synced_at,
          rows: [],
        });
      }
      for (const x of rows) {
        const entry = keyMap.get(x.api_key_id);
        if (entry) {
          entry.rows.push({ quota: x.quota, created_at: x.created_at });
          if (x.member_name) entry.member_name = x.member_name;
        }
      }

      const by_key = [...keyMap.entries()]
        .map(([key_id, v]) => ({
          key_id,
          token_name: v.token_name,
          member_id: v.member_id,
          member_name: v.member_name,
          status: v.status,
          data_cutoff: toUnixSec(v.log_synced_at),
          usage: sumUsage(v.rows, timeline),
        }))
        .sort((a, b) => b.usage.quota - a.usage.quota);

      const memberBuckets = new Map<
        string,
        {
          member_id: number | null;
          member_name: string | null;
          key_count: number;
          cutoff: Date | null;
          rows: Array<{ quota: number; created_at: Date }>;
        }
      >();
      for (const [key_id, v] of keyMap) {
        const mid = v.member_id == null ? "null" : String(v.member_id);
        const b = memberBuckets.get(mid) ?? {
          member_id: v.member_id,
          member_name: v.member_name,
          key_count: 0,
          cutoff: null,
          rows: [],
        };
        b.key_count += 1;
        if (
          v.log_synced_at &&
          (b.cutoff === null || v.log_synced_at < b.cutoff)
        ) {
          b.cutoff = v.log_synced_at;
        }
        b.rows.push(...v.rows);
        if (!b.member_name && v.member_name) b.member_name = v.member_name;
        memberBuckets.set(mid, b);
      }

      const by_member = [...memberBuckets.values()].map((b) => ({
        member_id: b.member_id,
        member_name: b.member_name,
        key_count: b.key_count,
        data_cutoff: toUnixSec(b.cutoff),
        usage: sumUsage(b.rows, timeline),
      }));

      return c.json(
        {
          data_cutoff: toUnixSec(data_cutoff),
          unassigned_subscription,
          by_source,
          by_member,
          by_key,
        },
        200,
      );
    },
  );

  r.openapi(
    createRoute({
      method: "get",
      path: "/logs",
      summary: "日志明细（下钻）",
      description:
        "分页；from/to 必填；默认全类型（可 type 筛）；token_name 取当前名",
      tags: ["用量"],
      security: [{ adminSession: [] }],
      request: {
        query: timeRange.extend({
          page: z.string().optional(),
          page_size: z.string().optional(),
          api_key_id: z.string().optional(),
          member_id: z.string().optional(),
          billing_source: z.string().optional(),
          subscription_id: z.string().optional(),
          type: z.string().optional(),
        }),
      },
      responses: {
        200: {
          description: "items/total",
          content: { "application/json": { schema: logPageSchema } },
        },
        401: err401,
        422: err422,
      },
    }),
    async (c) => {
      const q = c.req.query();
      const range = parseRange(q);
      if ("fields" in range) {
        return jsonError(c, 422, ERR.validation_failed(range.fields));
      }
      const page = Math.max(1, Number(q.page ?? 1) || 1);
      const page_size = Math.min(200, Math.max(1, Number(q.page_size ?? 50) || 50));
      const repos = c.get("repos");
      const timeline = resolveQpuTimeline(await repos.qpu.listTimeline());
      const { rows, total } = await repos.logs.listPage({
        from: range.from,
        to: range.to,
        page,
        page_size,
        api_key_id: q.api_key_id ? Number(q.api_key_id) : undefined,
        member_id: q.member_id ? Number(q.member_id) : undefined,
        billing_source: q.billing_source || undefined,
        subscription_id: q.subscription_id
          ? Number(q.subscription_id)
          : undefined,
        type: q.type != null && q.type !== "" ? Number(q.type) : undefined,
      });

      const items: LogItem[] = rows.map((row) => {
        const { quota_usd } = sumUsage(
          [{ quota: row.quota, created_at: row.created_at }],
          timeline,
        );
        return {
          id: row.id,
          api_key_id: row.api_key_id,
          created_at: toUnixSec(row.created_at)!,
          token_name: row.token_name,
          model_name: row.model_name,
          type: row.type,
          content: row.content,
          quota: row.quota,
          quota_usd,
          prompt_tokens: row.prompt_tokens,
          completion_tokens: row.completion_tokens,
          use_time: row.use_time,
          is_stream: row.is_stream,
          billing_source: row.billing_source as LogItem["billing_source"],
          subscription_id: row.subscription_id,
        };
      });

      return c.json({ items, total }, 200);
    },
  );

  return r;
}
