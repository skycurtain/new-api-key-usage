import { z } from "zod";

/**
 * 契约 zod schema（字段权威 = API契约三篇；DTO 类型见 types.ts）。
 * OpenAPI 装饰（.openapi 组件名等）留在 apps/server，core 不依赖 hono。
 */

export const errorShape = z.object({
  code: z.string(),
  message: z.string(),
  fields: z.record(z.string(), z.string()).optional(),
  key_id: z.number().int().optional(),
});

export const errorEnvelope = z.object({ error: errorShape });
export type ErrorEnvelope = z.infer<typeof errorEnvelope>;

export const setupState = z.object({ initialized: z.boolean() });
export const usernameBody = z.object({ username: z.string() });

export const setupBody = z.object({
  username: z.string().min(1).max(64),
  password: z.string().min(1).max(128),
});

export const loginBody = z.object({
  username: z.string().min(1),
  password: z.string().min(1),
});

export const changePasswordBody = z.object({
  old_password: z.string().min(1),
  new_password: z.string().min(1).max(128),
});

export const timeRangeQuery = z.object({
  from: z.string().min(1),
  to: z.string().min(1),
});

export const pageQuery = z.object({
  page: z.coerce.number().int().min(1).default(1),
  page_size: z.coerce.number().int().min(1).max(200).default(50),
});

export const usageTotals = z.object({
  count: z.number().int(),
  quota: z.number(),
  quota_usd: z.string(),
});

export const logItem = z.object({
  id: z.number().int(),
  api_key_id: z.number().int(),
  created_at: z.number().int(),
  token_name: z.string(),
  model_name: z.string(),
  type: z.number().int(),
  content: z.string(),
  quota: z.number(),
  quota_usd: z.string(),
  prompt_tokens: z.number().int(),
  completion_tokens: z.number().int(),
  use_time: z.number().int(),
  is_stream: z.boolean(),
  billing_source: z.string().nullable(),
  subscription_id: z.number().int().nullable(),
  raw: z.record(z.string(), z.unknown()).optional(),
});

export const logPage = z.object({
  items: z.array(logItem),
  total: z.number().int(),
});

export const keyItem = z.object({
  id: z.number().int(),
  token_name: z.string(),
  status: z.enum(["active", "disabled"]),
  member_id: z.number().int().nullable(),
  member_name: z.string().nullable(),
  registered_at: z.number().int(),
  log_synced_at: z.number().int().nullable(),
  usage_synced_at: z.number().int().nullable(),
  total_used: z.number(),
  total_available: z.number(),
  total_granted: z.number(),
  unlimited_quota: z.boolean(),
  expires_at: z.number().int().nullable(),
});

export const registerKeyBody = z.object({
  sk_key: z.string().min(8),
  member_id: z.number().int().positive().nullable().optional(),
});

export const patchKeyBody = z.object({
  status: z.enum(["active", "disabled"]).optional(),
  member_id: z.number().int().positive().nullable().optional(),
});

export const memberItem = z.object({
  id: z.number().int(),
  name: z.string(),
  remark: z.string(),
  status: z.enum(["active", "disabled"]),
  token_issued_at: z.number().int().nullable(),
  created_at: z.number().int(),
  key_count: z.number().int(),
});

export const createMemberBody = z.object({
  name: z.string().min(1).max(64),
  remark: z.string().optional().default(""),
});

export const patchMemberBody = z.object({
  name: z.string().min(1).max(64).optional(),
  remark: z.string().optional(),
  status: z.enum(["active", "disabled"]).optional(),
});

export const memberWithToken = z.object({
  member: memberItem,
  token: z.string(),
});

export const tokenOnly = z.object({ token: z.string() });

export const memberMe = z.object({
  id: z.number().int(),
  name: z.string(),
});

export const subscriptionItem = z.object({
  id: z.number().int(),
  subscription_id: z.number().int(),
  period_start: z.number().int(),
  period_end: z.number().int().nullable(),
  quota_granted: z.number().int(),
  quota_usd: z.string(),
  paid_amount: z.number().nullable(),
  paid_at: z.number().int().nullable(),
  remark: z.string(),
  created_at: z.number().int(),
});

export const topupItem = z.object({
  id: z.number().int(),
  upstream_id: z.number().int().nullable(),
  amount: z.number(),
  money: z.number(),
  trade_no: z.string().nullable(),
  payment_method: z.string().nullable(),
  payment_provider: z.string().nullable(),
  status: z.string().nullable(),
  paid_at: z.number().int(),
  quota_derived: z.number().int(),
  quota_usd: z.string(),
  remark: z.string(),
  created_at: z.number().int(),
});

export const engineStatus = z.object({
  running: z.boolean(),
  sync_interval_ms: z.number().int().optional(),
  last_round: z
    .object({
      started_at: z.number().int(),
      keys_total: z.number().int(),
      succeeded: z.number().int(),
      failed: z.number().int(),
      failed_api_key_ids: z.array(z.number().int()),
    })
    .nullable(),
});

export const auditLogItem = z.object({
  id: z.number().int(),
  created_at: z.number().int(),
  operator: z.string().nullable(),
  domain: z.enum(["key", "payment", "member", "account"]),
  action: z.string(),
  summary: z.string(),
});

export const memberOverview = z.object({
  member: z.object({
    id: z.number().int().nullable(),
    name: z.string().nullable(),
  }),
  usage: usageTotals,
  by_source: z.array(
    z.object({
      billing_source: z.string(),
      count: z.number().int(),
      quota: z.number(),
      quota_usd: z.string(),
    }),
  ),
  keys: z.array(
    z.object({
      key_id: z.number().int(),
      token_name: z.string(),
      log_synced_at: z.number().int().nullable(),
      usage: usageTotals,
    }),
  ),
  subscriptions: z.array(subscriptionItem),
  topups: z.array(topupItem),
});

export const createSubscriptionBody = z
  .object({
    subscription_id: z.number().int().positive(),
    period_start: z.string().min(1),
    period_end: z.string().min(1).nullable().optional(),
    quota_granted: z.number().int().positive(),
    paid_amount: z.number().nullable().optional(),
    paid_at: z.string().min(1).nullable().optional(),
    remark: z.string().default(""),
  });

export const createTopupBody = z.object({
  upstream_id: z.number().int().nullable().optional(),
  amount: z.number().positive(),
  money: z.number().positive(),
  trade_no: z.string().nullable().optional(),
  payment_method: z.string().nullable().optional(),
  payment_provider: z.string().nullable().optional(),
  status: z.string().nullable().optional(),
  paid_at: z.string().min(1),
  remark: z.string().default(""),
});

export {
  setupBody as setupBodySchema,
  loginBody as loginBodySchema,
  changePasswordBody as changePasswordBodySchema,
  registerKeyBody as registerKeyBodySchema,
  patchKeyBody as patchKeyBodySchema,
  createMemberBody as createMemberBodySchema,
  patchMemberBody as patchMemberBodySchema,
  createSubscriptionBody as createSubscriptionBodySchema,
  createTopupBody as createTopupBodySchema,
  subscriptionItem as subscriptionItemSchema,
  topupItem as topupItemSchema,
  timeRangeQuery as timeRangeQuerySchema,
  pageQuery as pageQuerySchema,
};
