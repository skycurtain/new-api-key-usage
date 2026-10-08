import type { LogItem, Paginated } from "@new-api-key-usage/core";
import { adminHttp } from "../http.ts";

export type AdminLogFilters = {
  from: string;
  to: string;
  page: number;
  page_size: number;
  api_key_id?: number;
  member_id?: number | "unassigned";
  billing_source?: string;
  subscription_id?: number;
  type?: number | "error";
};

export async function fetchLogs(
  params: AdminLogFilters,
): Promise<Paginated<LogItem>> {
  const { data } = await adminHttp.get<Paginated<LogItem>>("/logs", {
    params,
  });
  return data;
}
