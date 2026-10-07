/**
 * 时间口径（API 响应统一 Unix 秒整数；请求 from/to 仍收 ISO 8601 便于试调）
 * 库内 timestamptz ↔ JS Date ↔ Unix 秒
 */
function toDate(value: number | string | Date | null | undefined): Date | null {
  if (value === null || value === undefined) return null;
  let d: Date;
  if (value instanceof Date) {
    d = value;
  } else if (typeof value === "number") {
    d = new Date(value < 1e12 ? value * 1000 : value);
  } else {
    d = new Date(value);
  }
  return Number.isNaN(d.getTime()) ? null : d;
}

/** → Unix 秒（UTC）；无效则 null */
export function toUnixSec(
  value: number | string | Date | null | undefined,
): number | null {
  const d = toDate(value);
  if (!d) return null;
  return Math.floor(d.getTime() / 1000);
}

/** 兼容旧名：ISO 串（仅本地/文档用；API 响应改用 toUnixSec） */
export function unixToIso(
  value: number | string | Date | null | undefined,
): string | null {
  const d = toDate(value);
  if (!d) return null;
  return d.toISOString().replace(/\.\d{3}Z$/, "Z");
}

export function isoToUnix(iso: string): number {
  return Math.floor(new Date(iso).getTime() / 1000);
}

export function requireIso(value: string | null | undefined, field: string): string {
  if (!value) throw new Error(`missing time field: ${field}`);
  return value;
}

/** 左闭右开 [from, to) 的毫秒边界（前端传 ISO，查询用） */
export function rangeToMs(fromIso: string, toIso: string): { fromMs: number; toMs: number } {
  return {
    fromMs: new Date(fromIso).getTime(),
    toMs: new Date(toIso).getTime(),
  };
}
