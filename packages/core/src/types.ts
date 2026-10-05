/** ISO 8601 UTC 字符串，如 2026-10-02T14:22:05Z */
export type Iso8601Utc = string;

/** 支付金额（币种无关数值） */
export type PaidAmount = number;

/** quota 原值整数 */
export type Quota = number;

/** 两位小数美元字符串，如 "25.00" */
export type QuotaUsd = string;

export type BillingSource = "subscription" | "wallet";
export type PaymentKind = "subscription" | "topup";
export type KeyStatus = "active" | "disabled";
export type MemberStatus = "active" | "disabled";

export interface UsageTotals {
  count: number;
  quota: Quota;
  quota_usd: QuotaUsd;
}

export interface LogItem {
  id: number;
  api_key_id: number;
  created_at: Iso8601Utc;
  token_name: string;
  model_name: string;
  type: number;
  content: string;
  quota: Quota;
  quota_usd: QuotaUsd;
  prompt_tokens: number;
  completion_tokens: number;
  use_time: number;
  is_stream: boolean;
  billing_source: BillingSource | null;
  subscription_id: number | null;
}

export interface KeyItem {
  id: number;
  token_name: string;
  status: KeyStatus;
  member_id: number | null;
  member_name: string | null;
  registered_at: Iso8601Utc;
  log_synced_at: Iso8601Utc | null;
  usage_synced_at: Iso8601Utc | null;
  total_used: number;
  total_available: number;
  total_granted: number;
  unlimited_quota: boolean;
  expires_at: Iso8601Utc | null;
}

export interface PaymentItem {
  id: number;
  kind: PaymentKind;
  paid_at: Iso8601Utc;
  paid_amount: PaidAmount;
  remark: string;
  period_start: Iso8601Utc | null;
  period_end: Iso8601Utc | null;
  subscription_id: number | null;
  quota_granted: number | null;
  quota_usd: QuotaUsd;
}

export interface MemberItem {
  id: number;
  name: string;
  remark: string;
  status: MemberStatus;
  token_issued_at: Iso8601Utc | null;
  created_at: Iso8601Utc;
  key_count: number;
}

export interface AuditLogItem {
  id: number;
  created_at: Iso8601Utc;
  operator: string | null;
  domain: "key" | "payment" | "member" | "account";
  action: string;
  summary: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
}

export interface EngineLastRound {
  started_at: Iso8601Utc;
  keys_total: number;
  succeeded: number;
  failed: number;
  failed_api_key_ids: number[];
}

export interface EngineStatus {
  running: boolean;
  last_round: EngineLastRound | null;
}

export interface QpuLatest {
  qpu: number;
  effective_from: Iso8601Utc;
}

export type AuditAction =
  | "key.register"
  | "key.enable"
  | "key.disable"
  | "key.reassign"
  | "payment.create"
  | "payment.update"
  | "payment.delete"
  | "member.create"
  | "member.enable"
  | "member.disable"
  | "member.token_issue"
  | "member.token_reissue"
  | "account.password_change"
  | "account.init";

/** 消费行（聚合口径仅此类型） */
export const LOG_TYPE_CONSUME = 2;
