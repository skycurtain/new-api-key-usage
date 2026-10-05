/**
 * 登录节流（契约：429，最小实现）
 * 同一用户名失败计数 + 固定退避；进程内存即可（单机母体）。
 */

const WINDOW_MS = 5 * 60_000;
const MAX_FAILURES = 5;
const LOCK_MS = 60_000;

type Entry = { count: number; firstAt: number; lockedUntil: number };

const buckets = new Map<string, Entry>();

export function isLoginThrottled(username: string): boolean {
  const e = buckets.get(username);
  if (!e) return false;
  if (e.lockedUntil > Date.now()) return true;
  if (Date.now() - e.firstAt > WINDOW_MS) buckets.delete(username);
  return false;
}

export function recordLoginFailure(username: string): void {
  const now = Date.now();
  const e = buckets.get(username);
  if (!e || now - e.firstAt > WINDOW_MS) {
    buckets.set(username, { count: 1, firstAt: now, lockedUntil: 0 });
    return;
  }
  e.count += 1;
  if (e.count >= MAX_FAILURES) {
    e.lockedUntil = now + LOCK_MS;
    e.count = 0;
    e.firstAt = now;
  }
}

export function recordLoginSuccess(username: string): void {
  buckets.delete(username);
}

/** 测试用 */
export function resetLoginThrottle(): void {
  buckets.clear();
}
