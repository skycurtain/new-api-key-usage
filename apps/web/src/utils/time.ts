/**
 * 时间展示：API 响应时刻为 Unix 秒（UTC）；界面一律北京时间（交互共性 §3.3）。
 */
import dayjs from "dayjs";
import utc from "dayjs/plugin/utc";
import timezone from "dayjs/plugin/timezone";

dayjs.extend(utc);
dayjs.extend(timezone);

/** 北京时区展示（固定 +08:00，不随主机时区变） */
const DISPLAY_TZ = "Asia/Shanghai";

/** Unix 秒 → 北京时间「YYYY-MM-DD HH:mm:ss」 */
export function formatDateTime(unixSec: number | null | undefined): string {
  if (unixSec == null) return "—";
  return dayjs.unix(unixSec).tz(DISPLAY_TZ).format("YYYY-MM-DD HH:mm:ss");
}

/** Unix 秒 → 北京时间「YYYY-MM-DD」（统计口径到日） */
export function formatDate(unixSec: number | null | undefined): string {
  if (unixSec == null) return "—";
  return dayjs.unix(unixSec).tz(DISPLAY_TZ).format("YYYY-MM-DD");
}

/** Unix 秒 → 北京时间「HH:mm:ss」（明细时刻） */
export function formatTimeOfDay(unixSec: number | null | undefined): string {
  if (unixSec == null) return "—";
  return dayjs.unix(unixSec).tz(DISPLAY_TZ).format("HH:mm:ss");
}

/** 北京时间日初 → 请求用 ISO 8601 UTC（契约 §4：from/to 收 ISO） */
export function beijingDayStartToIso(date: string): string {
  return dayjs.tz(date, DISPLAY_TZ).startOf("day").toISOString();
}

/** 北京时间日界（次日零点，左闭右开的 to）→ ISO UTC */
export function beijingDayEndToIso(date: string): string {
  return dayjs.tz(date, DISPLAY_TZ).add(1, "day").startOf("day").toISOString();
}

export type RangeValue = { from: string; to: string };

/** 快捷项：最近 N 天（含今日），返回 [from, to) 的 ISO UTC */
export function recentDaysRange(
  days: number,
  nowMs: number = Date.now(),
): { from: string; to: string } {
  const to = dayjs(nowMs).tz(DISPLAY_TZ).add(1, "day").startOf("day");
  const from = to.subtract(days, "day");
  return { from: from.toISOString(), to: to.toISOString() };
}

/** 统计口径标注：「2026-09-02 ~ 10-01」（北京时间日） */
export function formatRangeCaption(fromIso: string, toIso: string): string {
  if (!fromIso || !toIso) return "—";
  const from = dayjs(fromIso).tz(DISPLAY_TZ).format("YYYY-MM-DD");
  const to = dayjs(toIso).tz(DISPLAY_TZ).format("YYYY-MM-DD");
  return `${from} ~ ${to}`;
}

/** 「数据截止」到分钟（交互共性 §3.3） */
export function formatMinute(unixSec: number | null | undefined): string {
  if (unixSec == null) return "—";
  return dayjs.unix(unixSec).tz(DISPLAY_TZ).format("YYYY-MM-DD HH:mm");
}

/** 距今小时数（用于数据截止停滞判定） */
export function hoursSince(unixSec: number | null | undefined): number | null {
  if (unixSec == null) return null;
  return (Date.now() / 1000 - unixSec) / 3600;
}
