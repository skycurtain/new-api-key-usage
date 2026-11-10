import type { LogPage, LogVerify } from "@new-api-key-usage/core";
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
  model_name?: string;
  type?: number | "error";
};

export async function fetchLogs(params: AdminLogFilters): Promise<LogPage> {
  const { data } = await adminHttp.get<LogPage>("/logs", {
    params,
  });
  return data;
}

/** 单行「计算过程」——详情弹窗打开时按需拉取，不进列表载荷 */
export async function fetchLogVerify(id: number): Promise<LogVerify> {
  const { data } = await adminHttp.get<LogVerify>(`/logs/${id}/verify`);
  return data;
}
