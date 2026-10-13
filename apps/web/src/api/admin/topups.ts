import type { TopupItem } from "@new-api-key-usage/core";
import { adminHttp } from "../http.ts";

export type TopupBody = {
  upstream_id?: number | null;
  amount: number;
  money: number;
  trade_no?: string | null;
  payment_method?: string | null;
  payment_provider?: string | null;
  status?: string | null;
  paid_at: string;
  billing_domain?: string | null;
  remark?: string;
};

export async function fetchTopups(filter?: {
  billing_domain?: string | "none";
}): Promise<TopupItem[]> {
  const { data } = await adminHttp.get<TopupItem[]>("/topups", {
    params: filter,
  });
  return data;
}

export async function createTopup(body: TopupBody): Promise<TopupItem> {
  const { data } = await adminHttp.post<TopupItem>("/topups", body);
  return data;
}

export async function updateTopup(
  id: number,
  body: TopupBody,
): Promise<TopupItem> {
  const { data } = await adminHttp.put<TopupItem>(`/topups/${id}`, body);
  return data;
}

export async function deleteTopup(id: number): Promise<void> {
  await adminHttp.delete(`/topups/${id}`);
}
