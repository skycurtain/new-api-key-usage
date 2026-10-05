/** 存储层 UTC Unix 秒 / Date / ISO 字符串 ↔ DTO 层 ISO 8601 UTC */
export function unixToIso(
  value: number | string | Date | null | undefined,
): string | null {
  if (value === null || value === undefined) return null;
  let d: Date;
  if (value instanceof Date) {
    d = value;
  } else if (typeof value === "number") {
    // Unix 秒（或毫秒：量级区分）
    d = new Date(value < 1e12 ? value * 1000 : value);
  } else {
    d = new Date(value);
  }
  if (Number.isNaN(d.getTime())) return null;
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
