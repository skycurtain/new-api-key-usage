/**
 * quota 数值契约：取整、饱和、日志字段读取
 *
 * 对齐 `common/quota_math.go`：`QuotaFromDecimalChecked` =
 * `decimal.Round(0)`（half away from zero）后按 `int32` 饱和。
 */

/** 单请求 quota 上限：`common.MaxQuota = math.MaxInt32` */
const MAX_QUOTA = 2_147_483_647;
const MIN_QUOTA = -2_147_483_648;

/**
 * 验算值与日志 `quota` 的比对口径：四舍五入（half away from zero）+ int32 饱和。
 *
 * 注意上游的预扣路径（`QuotaFromFloatStrict`）是**向零截断**，两者不可混用。
 */
export function toQuota(raw: number): number {
  if (Number.isNaN(raw)) return 0;
  const rounded = raw >= 0 ? Math.floor(raw + 0.5) : Math.ceil(raw - 0.5);
  if (rounded > MAX_QUOTA) return MAX_QUOTA;
  if (rounded < MIN_QUOTA) return MIN_QUOTA;
  return rounded;
}

/** 读取 `other` 中的数值字段；缺失或非有限数按 0 处理 */
export function readNumber(o: Record<string, unknown>, key: string): number {
  const v = o[key];
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** 读取 `other` 中的数值字段，缺失时用给定默认值 */
export function readNumberOr(
  o: Record<string, unknown>,
  key: string,
  fallback: number,
): number {
  const v = o[key];
  return typeof v === "number" && Number.isFinite(v) ? v : fallback;
}
