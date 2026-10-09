/**
 * 用量聚合辅助（公共约定 §5：后端换算、微分取整、聚合先求和再一次取整）
 */
import {
  microSumToUsdStr,
  microUsdToQuotaUsdStrPrecise,
  qpuAt,
  quotaToMicroUsd,
  quotaToUsdStr,
} from "./money.ts";

/** 上游事实：QuotaPerUnit 默认 500000（qpu_history 未采样时的回退） */
export const DEFAULT_QPU = 500_000;

export type QpuPoint = { qpu: number; effective_from: Date | number };

export function resolveQpuTimeline(
  rows: readonly QpuPoint[],
): QpuPoint[] {
  if (rows.length > 0) return [...rows];
  return [{ qpu: DEFAULT_QPU, effective_from: 0 }];
}

export interface UsageSum {
  count: number;
  quota: number;
  quota_usd: string;
}

export function emptyUsage(): UsageSum {
  return { count: 0, quota: 0, quota_usd: "0.00" };
}

/** 逐行微分累加（历史正确性：按日志时刻取 QPU） */
export function sumUsage(
  rows: ReadonlyArray<{ quota: number; created_at: Date | number }>,
  timeline: readonly QpuPoint[],
): UsageSum {
  let quota = 0;
  let micro = 0;
  for (const r of rows) {
    quota += r.quota;
    const qpu = qpuAt(r.created_at, timeline);
    micro += quotaToMicroUsd(r.quota, qpu);
  }
  return { count: rows.length, quota, quota_usd: microSumToUsdStr(micro) };
}

export function usageAt(
  quota: number,
  created_at: Date | number,
  timeline: readonly QpuPoint[],
): UsageSum {
  const qpu = qpuAt(created_at, timeline);
  return { count: 1, quota, quota_usd: quotaToUsdStr(quota, qpu) };
}

/** 明细行：按当时 QPU 换算，展示保留 6 位小数（微美元级，小额不被抹成 0） */
export function usageRowPrecise(
  quota: number,
  created_at: Date | number,
  timeline: readonly QpuPoint[],
): UsageSum {
  const qpu = qpuAt(created_at, timeline);
  const micro = quotaToMicroUsd(quota, qpu);
  return {
    count: 1,
    quota,
    quota_usd: microUsdToQuotaUsdStrPrecise(micro, 6),
  };
}

export function addUsage(a: UsageSum, b: UsageSum): UsageSum {
  // 合并已成形的两段时，quota_usd 需重算——调用方应尽量走 sumUsage
  return {
    count: a.count + b.count,
    quota: a.quota + b.quota,
    quota_usd: a.quota_usd,
  };
}

/** 解析日志行 other JSON（billing_source / subscription_id） */
export function parseOtherJson(other: string | undefined | null): {
  billing_source: string | null;
  subscription_id: number | null;
  raw: Record<string, unknown> | null;
} {
  if (!other) return { billing_source: null, subscription_id: null, raw: null };
  try {
    const o = JSON.parse(other) as Record<string, unknown>;
    return {
      billing_source: typeof o.billing_source === "string" ? o.billing_source : null,
      subscription_id:
        typeof o.subscription_id === "number" ? o.subscription_id : null,
      raw: o,
    };
  } catch {
    return { billing_source: null, subscription_id: null, raw: null };
  }
}
