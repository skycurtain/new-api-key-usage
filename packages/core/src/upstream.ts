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

export interface TokenLogRow {
  id?: number;
  user_id?: number;
  created_at: number;
  type: number;
  content?: string;
  username?: string;
  token_name?: string;
  model_name?: string;
  quota?: number;
  prompt_tokens?: number;
  completion_tokens?: number;
  use_time?: number;
  is_stream?: boolean;
  channel?: number;
  channel_name?: string;
  token_id?: number;
  group?: string;
  ip?: string;
  request_id?: string;
  upstream_request_id?: string;
  other?: string;
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

    /** 轮询日志：GET /api/log/token（最近最多 1000 条） */
    async fetchTokenLogs(skKey: string): Promise<UpstreamResult<TokenLogRow[]>> {
      return requestJson<TokenLogRow[]>(
        joinUrl(opts.baseUrl, "/api/log/token"),
        skKey,
        timeoutMs,
      );
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

/** 平台账号订阅（GET /api/subscription/self → all_subscriptions） */
export interface PlatformSubscription {
  id: number;
  plan_id: number;
  start_time: number;
  end_time: number;
  status: string;
  amount_total: number;
  amount_used: number;
}

export interface PlatformLoginResult {
  access_token: string;
}

/**
 * 登录 NewAPI 控制台账号（UserAuth 体系，非 sk-key）。
 * 密码与 access_token 均不落库，仅本次代拉使用。
 */
export async function platformLogin(
  baseUrl: string,
  username: string,
  password: string,
  timeoutMs = 8_000,
): Promise<UpstreamResult<PlatformLoginResult>> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(joinUrl(baseUrl, "/api/user/login"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({ username, password }),
      signal: ac.signal,
    });
    if (res.status === 401) return { ok: false, kind: "rejected" };
    if (!res.ok) return { ok: false, kind: "http", status: res.status };
    const body = (await res.json()) as {
      code?: boolean | number;
      success?: boolean;
      data?: PlatformLoginResult & Record<string, unknown>;
      message?: string;
    };
    if (body.code === false || body.success === false) {
      return { ok: false, kind: "rejected" };
    }
    const token = body.data?.access_token;
    if (typeof token !== "string" || !token) {
      return { ok: false, kind: "http", status: res.status };
    }
    return { ok: true, data: { access_token: token } };
  } catch {
    return { ok: false, kind: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/** 用控制台 access_token 拉订阅列表（含已过期） */
export async function fetchPlatformSubscriptions(
  baseUrl: string,
  accessToken: string,
  timeoutMs = 8_000,
): Promise<UpstreamResult<PlatformSubscription[]>> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const res = await fetch(joinUrl(baseUrl, "/api/subscription/self"), {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: ac.signal,
    });
    if (res.status === 401) return { ok: false, kind: "rejected" };
    if (!res.ok) return { ok: false, kind: "http", status: res.status };
    const body = (await res.json()) as {
      code?: boolean | number;
      success?: boolean;
      data?: {
        all_subscriptions?: Array<{ subscription?: PlatformSubscription }>;
      };
    };
    if (body.code === false || body.success === false) {
      return { ok: false, kind: "rejected" };
    }
    const raw = body.data?.all_subscriptions ?? [];
    const list: PlatformSubscription[] = [];
    for (const item of raw) {
      const s = item?.subscription;
      if (s && typeof s.id === "number") list.push(s);
    }
    return { ok: true, data: list };
  } catch {
    return { ok: false, kind: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}

/** 平台充值单（GET /api/user/topup/self 单页） */
export interface PlatformTopup {
  id: number;
  user_id?: number;
  amount: number;
  money: number;
  trade_no?: string;
  payment_method?: string;
  payment_provider?: string;
  create_time?: number;
  complete_time?: number;
  status?: string;
}

/** 用控制台 access_token 分页拉充值单（仅 p / page_size，无时间参数） */
export async function fetchPlatformTopups(
  baseUrl: string,
  accessToken: string,
  page = 1,
  pageSize = 10,
  timeoutMs = 8_000,
): Promise<
  UpstreamResult<{
    items: PlatformTopup[];
    total: number;
    page: number;
    page_size: number;
  }>
> {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const full = `${joinUrl(baseUrl, "/api/user/topup/self")}?p=${page}&page_size=${pageSize}`;
    const res = await fetch(full, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/json",
      },
      signal: ac.signal,
    });
    if (res.status === 401) return { ok: false, kind: "rejected" };
    if (!res.ok) return { ok: false, kind: "http", status: res.status };
    const body = (await res.json()) as {
      code?: boolean | number;
      success?: boolean;
      data?: {
        page?: number;
        page_size?: number;
        total?: number;
        items?: PlatformTopup[];
      };
    };
    if (body.code === false || body.success === false) {
      return { ok: false, kind: "rejected" };
    }
    const data = body.data ?? {};
    return {
      ok: true,
      data: {
        items: data.items ?? [],
        total: data.total ?? 0,
        page: data.page ?? page,
        page_size: data.page_size ?? pageSize,
      },
    };
  } catch {
    return { ok: false, kind: "unreachable" };
  } finally {
    clearTimeout(timer);
  }
}
