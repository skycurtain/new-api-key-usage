import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import {
  ERR,
  resolveQpuTimeline,
  sumUsage,
  unixToIso,
  type LogItem,
  type PaymentItem,
} from "@new-api-key-usage/core";
import {
  jsonError,
  requireMemberToken,
  type AppVars,
} from "../middleware.ts";
import {
  err401,
  err422,
  logPageSchema,
  memberMeSchema,
  memberOverviewSchema,
  paymentItemSchema,
} from "../api-schemas.ts";
import { z } from "zod";

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

/** 成员视图（`/api/member/*`，Bearer）——与管理面物理隔离 */
export function memberViewRoutes() {
  const r = new OpenAPIHono<{ Variables: AppVars }>();
  r.use("*", requireMemberToken);

  r.openapi(
    createRoute({
      method: "get",
      path: "/me",
      summary: "令牌验证 + 页头",
      description: "不建会话；令牌即长期凭证",
      tags: ["成员视图"],
      security: [{ memberToken: [] }],
      responses: {
        200: {
          description: "member",
          content: { "application/json": { schema: memberMeSchema } },
        },
        401: err401,
      },
    }),
    async (c) => {
      const guard = await requireMemberToken(c, async () => {});
      if (guard) return guard;
      const row = await c.get("repos").members.findById(c.get("memberId")!);
      if (!row) return jsonError(c, 401, ERR.session_expired());
      return c.json({ id: row.id, name: row.name }, 200);
    },
  );

  r.openapi(
    createRoute({
      method: "get",
      path: "/overview",
      summary: "单页聚合",
      description:
        "名下 key 的 type=2 用量 + 来源分解 + 支付参数（完全公开透明）",
      tags: ["成员视图"],
      security: [{ memberToken: [] }],
      request: {
        query: z.object({ from: z.string(), to: z.string() }),
      },
      responses: {
        200: {
          description: "overview",
          content: { "application/json": { schema: memberOverviewSchema } },
        },
        401: err401,
        422: err422,
      },
    }),
    async (c) => {
      const guard = await requireMemberToken(c, async () => {});
      if (guard) return guard;
      const range = parseRange(c.req.query());
      if ("fields" in range) {
        return jsonError(c, 422, ERR.validation_failed(range.fields));
      }
      const repos = c.get("repos");
      const memberId = c.get("memberId")!;
      const timeline = resolveQpuTimeline(await repos.qpu.listTimeline());
      const member = await repos.members.findById(memberId);
      const rows = await repos.logs.listMemberForAggregate(
        memberId,
        range.from,
        range.to,
      );

      const usage = sumUsage(
        rows.map((x) => ({ quota: x.quota, created_at: x.created_at })),
        timeline,
      );

      const sourceMap = new Map<
        string,
        Array<{ quota: number; created_at: Date }>
      >();
      const keyMap = new Map<
        number,
        {
          token_name: string;
          log_synced_at: Date | null;
          rows: Array<{ quota: number; created_at: Date }>;
        }
      >();
      for (const x of rows) {
        const skey = x.billing_source ?? "unknown";
        const s = sourceMap.get(skey) ?? [];
        s.push({ quota: x.quota, created_at: x.created_at });
        sourceMap.set(skey, s);

        const k = keyMap.get(x.api_key_id) ?? {
          token_name: x.token_name,
          log_synced_at: x.log_synced_at,
          rows: [],
        };
        k.rows.push({ quota: x.quota, created_at: x.created_at });
        keyMap.set(x.api_key_id, k);
      }

      // 名下 key 全量（即使时段无用量）
      const allKeys = (await repos.keys.listAll()).filter(
        (k) => k.member_id === memberId,
      );
      for (const k of allKeys) {
        if (!keyMap.has(k.id)) {
          keyMap.set(k.id, {
            token_name: k.token_name,
            log_synced_at: k.log_synced_at,
            rows: [],
          });
        }
      }

      const by_source = [...sourceMap.entries()].map(([billing_source, list]) => ({
        billing_source,
        ...sumUsage(list, timeline),
      }));

      const keys = [...keyMap.entries()].map(([key_id, v]) => ({
        key_id,
        token_name: v.token_name,
        log_synced_at: unixToIso(v.log_synced_at),
        usage: sumUsage(v.rows, timeline),
      }));

      // 「该时段涉及」支付：订阅 = 日志出现过的 subscription_id ∪ 进行中；充值 = paid_at ∈ [from,to)
      const paymentRows = await repos.payments.listAll();
      const usedSubIds = new Set(
        rows.map((x) => x.subscription_id).filter((v): v is number => v != null),
      );
      const payments: PaymentItem[] = [];
      const { quotaToUsdStr, qpuAt } = await import("@new-api-key-usage/core");
      for (const p of paymentRows) {
        const inRange = p.paid_at >= range.from && p.paid_at < range.to;
        const ongoing =
          p.kind === "subscription" &&
          (p.period_end == null ||
            p.period_end > new Date() ||
            (p.period_start != null &&
              p.period_start <= range.to &&
              (p.period_end ?? new Date()) >= range.from));
        const involved =
          p.kind === "topup"
            ? inRange
            : usedSubIds.has(p.subscription_id ?? -1) || ongoing;
        if (!involved) continue;
        const qpu = qpuAt(p.paid_at, timeline);
        payments.push({
          id: p.id,
          kind: p.kind as PaymentItem["kind"],
          paid_at: unixToIso(p.paid_at)!,
          paid_amount: p.paid_amount,
          remark: p.remark,
          period_start: unixToIso(p.period_start),
          period_end: unixToIso(p.period_end),
          subscription_id: p.subscription_id,
          quota_granted: p.quota_granted,
          quota_usd:
            p.quota_granted != null
              ? quotaToUsdStr(p.quota_granted, qpu)
              : "0.00",
        });
      }

      return c.json(
        {
          member: { id: memberId, name: member?.name ?? null },
          usage,
          by_source,
          keys,
          payments: payments.map((p) => ({
            ...p,
            kind: p.kind as string,
            period_start: p.period_start ?? null,
            period_end: p.period_end ?? null,
            subscription_id: p.subscription_id ?? null,
            quota_granted: p.quota_granted ?? null,
          })),
        },
        200,
      );
    },
  );

  r.openapi(
    createRoute({
      method: "get",
      path: "/logs",
      summary: "日志明细（名下 key）",
      description: "分页；恒 type=2；DTO 与管理面同构",
      tags: ["成员视图"],
      security: [{ memberToken: [] }],
      request: {
        query: z.object({
          from: z.string(),
          to: z.string(),
          page: z.string().optional(),
          page_size: z.string().optional(),
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
      const guard = await requireMemberToken(c, async () => {});
      if (guard) return guard;
      const q = c.req.query();
      const range = parseRange(q);
      if ("fields" in range) {
        return jsonError(c, 422, ERR.validation_failed(range.fields));
      }
      const page = Math.max(1, Number(q.page ?? 1) || 1);
      const page_size = Math.min(
        200,
        Math.max(1, Number(q.page_size ?? 50) || 50),
      );
      const repos = c.get("repos");
      const timeline = resolveQpuTimeline(await repos.qpu.listTimeline());
      const { rows, total } = await repos.logs.listMemberPage({
        member_id: c.get("memberId")!,
        from: range.from,
        to: range.to,
        page,
        page_size,
      });
      const items: LogItem[] = rows.map((row) => {
        const { quota_usd } = sumUsage(
          [{ quota: row.quota, created_at: row.created_at }],
          timeline,
        );
        return {
          id: row.id,
          api_key_id: row.api_key_id,
          created_at: unixToIso(row.created_at)!,
          token_name: row.token_name ?? "",
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
