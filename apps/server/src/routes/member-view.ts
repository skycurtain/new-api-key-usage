import { OpenAPIHono, createRoute } from "@hono/zod-openapi";
import {
  ERR,
  resolveQpuTimeline,
  sumUsage,
  usageRowPrecise,
  toUnixSec,
  type LogItem,
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
        "名下 key 的 type=2 用量 + 来源分解 + 支付参数（同账本域内可见）",
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
        log_synced_at: toUnixSec(v.log_synced_at),
        usage: sumUsage(v.rows, timeline),
      }));

      // 「该时段涉及」：订阅 = 日志出现过的 subscription_id ∪ 我域内进行中；
      // 充值 = 我域内且 paid_at ∈ [from,to)。未标域默认藏（仅「涉及我日志」的订阅例外）。
      const { quotaToUsdStr, qpuAt } = await import("@new-api-key-usage/core");
      const myDomains = new Set<string>();
      for (const k of allKeys) {
        if (k.billing_domain) myDomains.add(k.billing_domain);
      }
      const subRows = await repos.subscriptions.listAll();
      const usedSubIds = new Set(
        rows.map((x) => x.subscription_id).filter((v): v is number => v != null),
      );
      const subscriptionsOut = [];
      for (const s of subRows) {
        const ongoing =
          s.period_end == null ||
          s.period_end > new Date() ||
          (s.period_start <= range.to &&
            (s.period_end ?? new Date()) >= range.from);
        const involved = usedSubIds.has(s.subscription_id);
        const inMyDomain =
          s.billing_domain != null && myDomains.has(s.billing_domain);
        // 涉及我日志的始终可见（事实直连）；其余仅我域内进行中可见
        if (!involved && !(ongoing && inMyDomain)) continue;
        const qpu = qpuAt(s.paid_at ?? s.created_at, timeline);
        subscriptionsOut.push({
          id: s.id,
          subscription_id: s.subscription_id,
          period_start: toUnixSec(s.period_start)!,
          period_end: toUnixSec(s.period_end),
          quota_granted: s.quota_granted,
          quota_usd: quotaToUsdStr(s.quota_granted, qpu),
          paid_amount: s.paid_amount,
          paid_at: toUnixSec(s.paid_at),
          billing_domain: s.billing_domain,
          remark: s.remark,
          created_at: toUnixSec(s.created_at)!,
        });
      }
      const topupRows = await repos.topups.listAll();
      const topupsOut = [];
      for (const t of topupRows) {
        if (t.billing_domain == null || !myDomains.has(t.billing_domain)) continue;
        if (!(t.paid_at >= range.from && t.paid_at < range.to)) continue;
        const qpu = qpuAt(t.paid_at, timeline);
        const quota_derived = Math.round(t.amount * qpu);
        topupsOut.push({
          id: t.id,
          upstream_id: t.upstream_id,
          amount: t.amount,
          money: t.money,
          trade_no: t.trade_no,
          payment_method: t.payment_method,
          payment_provider: t.payment_provider,
          status: t.status,
          paid_at: toUnixSec(t.paid_at)!,
          billing_domain: t.billing_domain,
          quota_derived,
          quota_usd: quotaToUsdStr(quota_derived, qpu),
          remark: t.remark,
          created_at: toUnixSec(t.created_at)!,
        });
      }

      return c.json(
        {
          member: { id: memberId, name: member?.name ?? null },
          usage,
          by_source,
          keys,
          subscriptions: subscriptionsOut,
          topups: topupsOut,
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
      description:
        "分页；默认全类型（可 type / model_name 筛）；DTO 与管理面同构；附带 summary 与 models",
      tags: ["成员视图"],
      security: [{ memberToken: [] }],
      request: {
        query: z.object({
          from: z.string(),
          to: z.string(),
          page: z.string().optional(),
          page_size: z.string().optional(),
          api_key_id: z.string().optional(),
          billing_source: z.string().optional(),
          subscription_id: z.string().optional(),
          model_name: z.string().optional(),
          type: z.string().optional(),
        }),
      },
      responses: {
        200: {
          description: "items/total/summary/models",
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
      const page_size = Math.min(
        200,
        Math.max(1, Number(q.page_size ?? 50) || 50),
      );
      const repos = c.get("repos");
      const timeline = resolveQpuTimeline(await repos.qpu.listTimeline());
      const member_id = c.get("memberId")!;
      const filters = {
        member_id,
        from: range.from,
        to: range.to,
        api_key_id: q.api_key_id ? Number(q.api_key_id) : undefined,
        billing_source:
          q.billing_source === "none" ? "none" : q.billing_source || undefined,
        subscription_id: q.subscription_id
          ? Number(q.subscription_id)
          : undefined,
        model_name: q.model_name || undefined,
        type:
          q.type === "error"
            ? ("error" as const)
            : q.type != null && q.type !== ""
              ? Number(q.type)
              : undefined,
      };
      const { rows, total } = await repos.logs.listMemberPage({
        ...filters,
        page,
        page_size,
      });
      const sum = await repos.logs.summarizeMember(filters);
      const usage = sumUsage(sum.usage_rows, timeline);
      const models = await repos.logs.listMemberModels(filters);
      const items: LogItem[] = rows.map((row) => {
        const { quota_usd } = usageRowPrecise(
          row.quota,
          row.created_at,
          timeline,
        );
        return {
          id: row.id,
          api_key_id: row.api_key_id,
          created_at: toUnixSec(row.created_at)!,
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
          raw: {
            id: row.id,
            api_key_id: row.api_key_id,
            dedupe_key: row.dedupe_key,
            billing_source: row.billing_source,
            subscription_id: row.subscription_id,
            user_id: row.user_id,
            created_at: toUnixSec(row.created_at),
            type: row.type,
            content: row.content,
            username: row.username,
            token_name: row.token_name,
            model_name: row.model_name,
            quota: row.quota,
            prompt_tokens: row.prompt_tokens,
            completion_tokens: row.completion_tokens,
            use_time: row.use_time,
            is_stream: row.is_stream,
            channel: row.channel,
            channel_name: row.channel_name,
            token_id: row.token_id,
            group_name: row.group_name,
            ip: row.ip,
            request_id: row.request_id,
            upstream_request_id: row.upstream_request_id,
            other: row.other,
          },
        };
      });
      return c.json(
        {
          items,
          total,
          summary: {
            hit_count: sum.hit_count,
            usage_count: sum.usage_count,
            error_count: sum.error_count,
            quota: usage.quota,
            quota_usd: usage.quota_usd,
          },
          models,
        },
        200,
      );
    },
  );

  return r;
}
