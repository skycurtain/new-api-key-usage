import type { AuditLogItem, Paginated } from "@new-api-key-usage/core";
import { adminHttp } from "../http.ts";

export async function fetchAuditLogs(params: {
  page: number;
  page_size: number;
  domain?: string;
  from?: string;
  to?: string;
}): Promise<Paginated<AuditLogItem>> {
  const { data } = await adminHttp.get<Paginated<AuditLogItem>>("/audit-logs", {
    params,
  });
  return data;
}
