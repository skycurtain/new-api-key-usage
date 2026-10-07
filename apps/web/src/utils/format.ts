/** 呈现层格式化（不做业务换算——换算责任在后端，契约公共约定 §5） */

/** 千分位整数；口径内精确显示，不四舍五入 */
export function formatInt(value: number | null | undefined): string {
  if (value == null) return "—";
  return value.toLocaleString("en-US");
}

/** quota 原值 + 美元双单位展示片段 */
export function formatQuotaDual(
  quota: number | null | undefined,
  quotaUsd: string | null | undefined,
): string {
  if (quota == null) return "—";
  const usd = quotaUsd ?? "—";
  return `${formatInt(quota)}（$${usd}）`;
}

/** 支付金额：纯数字、无货币符号（R9 币种无关） */
export function formatPaidAmount(value: number | null | undefined): string {
  if (value == null) return "—";
  return String(value);
}
