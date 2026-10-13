import type { SubscriptionItem } from "@new-api-key-usage/core";
import { adminHttp } from "../http.ts";

export type SubscriptionBody = {
  subscription_id: number;
  period_start: string;
  period_end?: string | null;
  quota_granted: number;
  paid_amount?: number | null;
  paid_at?: string | null;
  billing_domain?: string | null;
  remark?: string;
};

export async function fetchSubscriptions(filter?: {
  billing_domain?: string | "none";
}): Promise<SubscriptionItem[]> {
  const { data } = await adminHttp.get<SubscriptionItem[]>("/subscriptions", {
    params: filter,
  });
  return data;
}

export async function createSubscription(
  body: SubscriptionBody,
): Promise<SubscriptionItem> {
  const { data } = await adminHttp.post<SubscriptionItem>("/subscriptions", body);
  return data;
}

export async function updateSubscription(
  id: number,
  body: SubscriptionBody,
): Promise<SubscriptionItem> {
  const { data } = await adminHttp.put<SubscriptionItem>(
    `/subscriptions/${id}`,
    body,
  );
  return data;
}

export async function deleteSubscription(id: number): Promise<void> {
  await adminHttp.delete(`/subscriptions/${id}`);
}
