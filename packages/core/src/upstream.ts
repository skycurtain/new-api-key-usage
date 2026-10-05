/**
 * 上游 NewAPI 客户端（仅 Web 标准 API——Bun 纪律）
 * 接口实证：docs/references/NewAPI-接口范围.md
 */

export interface TokenUsage {
  name: string;
  total_granted: number;
  total_used: number;
  total_available: number;
  unlimited_quota: boolean;
  model_limits: Record<string, unknown> | null;
  model_limits_enabled: boolean;
  /** Unix 秒，0 = 永不过期 */
  expires_at: number;
}

export type UpstreamFailure =
  /** 401：key 不存在或被显式禁用 */
  | { ok: false; kind: "rejected" }
  /** 网络失败 / 超时 */
  | { ok: false; kind: "unreachable" }
  /** 其他非预期 HTTP / 403 封禁 / 5xx */
  | { ok: false; kind: "http"; status: number };

export type UpstreamResult<T> = { ok: true; data: T } | UpstreamFailure;

export interface UpstreamClientOptions {
  baseUrl: string;
  timeoutMs?: number;
}

function joinUrl(base: string, path: string): string {
  return `${base.replace(/\/+$/, "")}${path}`;
}

async function requestJson<T>(
  url: string,
  skKey: string,
  timeoutMs: number,
): Promise<UpstreamResult<T>> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${skKey}`,
        Accept: "application/json",
      },
      signal: ac.signal,
    });
    if (res.status === 401) return { ok: false, kind: "rejected" };
    if (!res.ok) return { ok: false, kind: "http", status: res.status };
    const body = (await res.json()) as {
      code?: boolean | number;
      success?: boolean;
      message?: string;
      data?: T;
    };
    // NewAPI 包装：code:true / success:true + data
    if (body.code === false || body.success === false) {
      return { ok: false, kind: "rejected" };
    }
    if (body.data === undefined) {
      return { ok: false, kind: "http", status: res.status };
    }
    return { ok: true, data: body.data };
  } catch {
    return { ok: false, kind: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

export function createUpstreamClient(opts: UpstreamClientOptions) {
  const timeoutMs = opts.timeoutMs ?? 8_000;

  return {
    /** 登记验证 / 轮询额度：GET /api/usage/token */
    async fetchTokenUsage(skKey: string): Promise<UpstreamResult<TokenUsage>> {
      const r = await requestJson<TokenUsage>(
        joinUrl(opts.baseUrl, "/api/usage/token"),
        skKey,
        timeoutMs,
      );
      return r;
    },

    /** 换算率权威来源：GET /api/status（取 quota_per_unit） */
    async fetchQuotaPerUnit(): Promise<UpstreamResult<{ quota_per_unit: number }>> {
      return requestJson<{ quota_per_unit: number }>(
        joinUrl(opts.baseUrl, "/api/status"),
        "sk-unused",
        timeoutMs,
      );
    },
  };
}

export type UpstreamClient = ReturnType<typeof createUpstreamClient>;

/** expires_at：上游 0 = 永不过期 → 我们存 null */
export function normalizeExpiresAt(unixSeconds: number): Date | null {
  if (!unixSeconds) return null;
  return new Date(unixSeconds * 1000);
}
