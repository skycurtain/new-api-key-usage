import type { KeyItem } from "@new-api-key-usage/core";
import { adminHttp } from "../http.ts";

export type KeyListFilters = {
  member_id?: number | "unassigned";
  status?: "active" | "disabled";
  billing_domain?: string | "none";
  recent_failed?: boolean;
};

export async function fetchKeys(filters: KeyListFilters = {}): Promise<KeyItem[]> {
  const { data } = await adminHttp.get<KeyItem[]>("/keys", { params: filters });
  return data;
}

export async function registerKey(body: {
  sk_key: string;
  member_id?: number | null;
  billing_domain?: string | null;
}): Promise<KeyItem> {
  const { data } = await adminHttp.post<KeyItem>("/keys", body);
  return data;
}

export async function patchKey(
  id: number,
  body: {
    status?: "active" | "disabled";
    member_id?: number | null;
    billing_domain?: string | null;
  },
): Promise<KeyItem> {
  const { data } = await adminHttp.patch<KeyItem>(`/keys/${id}`, body);
  return data;
}
