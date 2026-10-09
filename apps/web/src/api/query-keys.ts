/**
 * vue-query key 工厂——失效与缓存的唯一命名源。
 * 约定：`[面, 端点, …参数]`，参数保持可 JSON 序列化。
 */
export type KeyFilters = {
  member_id?: number | "unassigned";
  status?: "active" | "disabled";
  recent_failed?: boolean;
};

export type PageQuery = {
  page: number;
  page_size: number;
};

export type TimeRange = {
  from: string;
  to: string;
};

export const qk = {
  admin: {
    setupState: () => ["admin", "setup-state"] as const,
    session: () => ["admin", "session"] as const,
    engine: () => ["admin", "engine"] as const,
    overview: (range: TimeRange) =>
      ["admin", "overview", range.from, range.to] as const,
    keys: (filters: KeyFilters) => ["admin", "keys", filters] as const,
    logs: (range: TimeRange & PageQuery & Record<string, unknown>) =>
      [
        "admin",
        "logs",
        range.from,
        range.to,
        range.page,
        range.page_size,
        range.api_key_id ?? "",
        range.member_id ?? "",
        range.billing_source ?? "",
        range.subscription_id ?? "",
        range.type ?? "",
      ] as const,
    payments: () => ["admin", "payments"] as const,
    qpuLatest: () => ["admin", "qpu-latest"] as const,
    members: () => ["admin", "members"] as const,
    auditLogs: (q: PageQuery & { domain?: string; from?: string; to?: string }) =>
      ["admin", "audit-logs", q.page, q.page_size, q.domain ?? "", q.from ?? "", q.to ?? ""] as const,
  },
  member: {
    me: () => ["member", "me"] as const,
    overview: (range: TimeRange) =>
      ["member", "overview", range.from, range.to] as const,
    logs: (range: TimeRange & PageQuery & Record<string, unknown>) =>
      [
        "member",
        "logs",
        range.from,
        range.to,
        range.page,
        range.page_size,
        range.api_key_id ?? "",
        range.billing_source ?? "",
        range.subscription_id ?? "",
        range.type ?? "",
      ] as const,
  },
};
