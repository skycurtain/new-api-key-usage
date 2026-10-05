/**
 * quota → 额度美元换算（公共约定 §5）
 * 内部以微分（1/100 美分 = 1e-6 美元）整数运算，仅输出时四舍五入到分。
 */

/** quota → 微分（1e-6 USD） */
export function quotaToMicroUsd(quota: number, qpu: number): number {
  if (qpu <= 0) throw new Error("qpu must be positive");
  // quota / qpu = USD；再 * 1_000_000 = micro-USD
  return Math.round((quota * 1_000_000) / qpu);
}

export function microUsdToQuotaUsdStr(micro: number): string {
  // 四舍五入到分（10000 micro = 1 cent）
  const cents = Math.round(micro / 10_000);
  const dollars = Math.floor(cents / 100);
  const rem = cents % 100;
  return `${dollars}.${String(rem).padStart(2, "0")}`;
}

export function quotaToUsdStr(quota: number, qpu: number): string {
  return microUsdToQuotaUsdStr(quotaToMicroUsd(quota, qpu));
}

/** 聚合：先微分求和再一次取整（小行贡献不丢失） */
export function sumQuotaToUsdStr(quotas: readonly number[], qpu: number): string {
  let micro = 0;
  for (const q of quotas) micro += quotaToMicroUsd(q, qpu);
  return microUsdToQuotaUsdStr(micro);
}

/** 由微分总和直接出字符串（仓储层先累加再调用） */
export function microSumToUsdStr(microSum: number): string {
  return microUsdToQuotaUsdStr(microSum);
}

/**
 * qpuAt(t)：按时刻取 QPU 时间线
 * timeline 按 effective_from 升序。
 */
export function qpuAt(
  t: Date | number,
  timeline: ReadonlyArray<{ qpu: number; effective_from: Date | number }>,
): number {
  const tMs = t instanceof Date ? t.getTime() : t * 1000;
  let picked: number | null = null;
  for (const row of timeline) {
    const fromMs =
      row.effective_from instanceof Date
        ? row.effective_from.getTime()
        : row.effective_from * 1000;
    if (fromMs <= tMs) picked = row.qpu;
    else break;
  }
  if (picked === null) {
    // 时刻早于全部时间线：取最早一条
    const first = timeline[0];
    if (!first) throw new Error("qpu timeline is empty");
    return first.qpu;
  }
  return picked;
}
