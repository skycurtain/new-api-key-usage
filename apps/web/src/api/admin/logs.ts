import type { LogItem, Paginated } from "@new-api-key-usage/core";
import { adminHttp } from "../http.ts";

export async function fetchLogs(
  range: { from: string; to: string; page: number; page_size: number },
): Promise<Paginated<LogItem>> {
  const { data } = await adminHttp.get<Paginated<LogItem>>("/logs", {
    params: range,
  });
  return data;
}
