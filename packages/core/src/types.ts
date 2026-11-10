import type { UnsupportedReason } from "./quota-verify/types.ts";

/** Unix 秒（UTC 时刻）——API 响应时刻字段统一此类型 */
export type UnixSec = number;

/** 支付金额（币种无关数值） */
export type PaidAmount = number;

/** quota 原值整数 */
export type Quota = number;

/** 两位小数美元字符串，如 "25.00" */
export type QuotaUsd = string;

export type BillingSource = "subscription" | "wallet";
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
  created_at: UnixSec;
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
  /** 完整落库行（上游字段原貌）——「原始数据」视图 */
  raw?: Record<string, unknown>;
}

/**
 * 单行 quota 的「计算过程」（详情弹窗按需拉取）。
 *
 * 三态语义与验算模块一致：**只有 `matched` 可把数字当结果展示**；
 * `unmatched` 展示重算值与差值，`unsupported` 只展示原因。
 * 表达式原文不在这里——前端从 `LogItem.raw.other.expr_b64` 本地解码。
 */
export type LogVerify =
  | {
      status: "matched" | "unmatched";
      branch: "tiered_expr" | "multiplier";
      semantic: "anthropic" | "openai";
      /** 日志里的 quota */
      logged: number;
      /** 重算值（已四舍五入 + int32 饱和） */
      computed: number;
      /** `computed − logged` */
      delta: number;
      /** 该行**写时**的 QPU（按 created_at 从 qpu_history 解析） */
      quota_per_unit: number;
      group_ratio: number;
      tiered_expr: {
        matched_tier: string | null;
        /** 表达式求值结果（$/1M 中间量），换算前 */
        expr_value: number;
        /** **仅表达式引用到的**变量，已归一化 */
        vars: Record<string, number>;
      } | null;
      multiplier: {
        model_ratio: number;
        completion_ratio: number;
        /** 扣减缓存后的输入 token 基数 */
        base: number;
        /** 以下三项均已乘各自倍率 */
        cached: number;
        cache_creation: number;
        output: number;
        prompt_part: number;
        /** `(prompt_part + output) × model_ratio × group_ratio`，取整前 */
        total: number;
      } | null;
    }
  | {
      status: "unsupported";
      reason: UnsupportedReason;
      detail: string;
    };

export interface KeyItem {
  id: number;
  token_name: string;
  status: KeyStatus;
  member_id: number | null;
  member_name: string | null;
  billing_domain: string | null;
  registered_at: UnixSec;
  log_synced_at: UnixSec | null;
  usage_synced_at: UnixSec | null;
  total_used: number;
  total_available: number;
  total_granted: number;
  unlimited_quota: boolean;
  expires_at: UnixSec | null;
}

/** 订阅权益登记 */
export interface SubscriptionItem {
  id: number;
  subscription_id: number;
  period_start: UnixSec;
  period_end: UnixSec | null;
  quota_granted: Quota;
  quota_usd: QuotaUsd;
  paid_amount: PaidAmount | null;
  paid_at: UnixSec | null;
  billing_domain: string | null;
  remark: string;
  created_at: UnixSec;
}

/** 充值入账（对齐上游充值单；无 quota_granted 入库列） */
export interface TopupItem {
  id: number;
  upstream_id: number | null;
  amount: number;
  money: PaidAmount;
  trade_no: string | null;
  payment_method: string | null;
  payment_provider: string | null;
  status: string | null;
  paid_at: UnixSec;
  quota_derived: Quota;
  quota_usd: QuotaUsd;
  billing_domain: string | null;
  remark: string;
  created_at: UnixSec;
}

export interface MemberItem {
  id: number;
  name: string;
  remark: string;
  status: MemberStatus;
  token_issued_at: UnixSec | null;
  created_at: UnixSec;
  key_count: number;
}

export interface AuditLogItem {
  id: number;
  created_at: UnixSec;
  operator: string | null;
  domain: "key" | "payment" | "member" | "account";
  action: string;
  summary: string;
}

export interface Paginated<T> {
  items: T[];
  total: number;
}

/** 日志页汇总：条数跟全部筛选；用量恒 type=2 + 其余筛选 */
export interface LogPageSummary {
  hit_count: number;
  usage_count: number;
  error_count: number;
  quota: Quota;
  quota_usd: QuotaUsd;
}

/** 调用日志分页响应（含汇总条与模型下拉选项） */
export interface LogPage extends Paginated<LogItem> {
  summary: LogPageSummary;
  models: string[];
}

export interface EngineLastRound {
  started_at: UnixSec;
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
  effective_from: UnixSec;
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
  | "member.update"
  | "member.enable"
  | "member.disable"
  | "member.token_issue"
  | "member.token_reissue"
  | "member.delete"
  | "account.password_change"
  | "account.init";

/** 消费行（聚合口径仅此类型） */
export const LOG_TYPE_CONSUME = 2;
