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
/** 请求时间序列化：ISO 8601 带偏移（契约 §4；墙钟按北京时间） */
const REQUEST_OFFSET = "+08:00";

/**
 * 绝对时刻（Date / Unix / 带时区的 ISO）→ 北京墙钟 + `+08:00`。
 * 先转 Asia/Shanghai，与主机时区无关。
 */
export function toRequestIso(value: Date | string | number | dayjs.Dayjs): string {
  return shanghaiIso(dayjs(value as never));
}

/**
 * 表单/日历墙钟（用户当作北京时间）→ `+08:00`。
 * 不做时区换算，只给墙钟贴偏移。
 */
export function wallAsBeijingIso(value: Date | dayjs.Dayjs): string {
  const wall = dayjs(value as never).format("YYYY-MM-DDTHH:mm:ss.SSS");
  return `${wall}${REQUEST_OFFSET}`;
}

/** Unix 秒 → 可放进日历控件的「北京墙钟」dayjs */
export function unixToBeijingWall(unixSec: number): dayjs.Dayjs {
  return dayjs(
    dayjs.unix(unixSec).tz(DISPLAY_TZ).format("YYYY-MM-DD HH:mm:ss.SSS"),
  );
}

/** 已在 Asia/Shanghai 上的时刻 → 带偏移 ISO */
function shanghaiIso(d: dayjs.Dayjs): string {
  const wall = d.tz(DISPLAY_TZ).format("YYYY-MM-DDTHH:mm:ss.SSS");
  return `${wall}${REQUEST_OFFSET}`;
}

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

/** 北京时间日初 → 请求用 ISO（带 +08:00 偏移） */
export function beijingDayStartToIso(date: string): string {
  return shanghaiIso(dayjs.tz(date, DISPLAY_TZ).startOf("day"));
}

/** 北京时间日界（次日零点，左闭右开的 to）→ ISO 带偏移 */
export function beijingDayEndToIso(date: string): string {
  return shanghaiIso(dayjs.tz(date, DISPLAY_TZ).add(1, "day").startOf("day"));
}

export type RangeValue = { from: string; to: string };

/** 快捷项：最近 N 天（含今日），返回 [from, to) 的 ISO 带偏移 */
export function recentDaysRange(
  days: number,
  nowMs: number = Date.now(),
): { from: string; to: string } {
  const to = dayjs(nowMs).tz(DISPLAY_TZ).add(1, "day").startOf("day");
  const from = to.subtract(days, "day");
  return { from: shanghaiIso(from), to: shanghaiIso(to) };
}

/** 快捷项：今天（北京时间日界，左闭右开） */
export function todayRange(nowMs: number = Date.now()): {
  from: string;
  to: string;
} {
  return recentDaysRange(1, nowMs);
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
