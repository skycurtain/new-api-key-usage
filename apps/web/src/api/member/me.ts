import type {
  LogItem,
  Paginated,
  SubscriptionItem,
  TopupItem,
  UnixSec,
  UsageTotals,
} from "@new-api-key-usage/core";
import { memberHttp } from "../http.ts";

export type MemberMe = {
  id: number;
  name: string;
};

export type MemberOverview = {
  member: { id: number | null; name: string | null };
  usage: UsageTotals;
  by_source: Array<{
    billing_source: string;
    count: number;
    quota: number;
    quota_usd: string;
  }>;
  keys: Array<{
    key_id: number;
    token_name: string;
    log_synced_at: UnixSec | null;
    usage: UsageTotals;
  }>;
  subscriptions: SubscriptionItem[];
  topups: TopupItem[];
};

export async function fetchMe(): Promise<MemberMe> {
  const { data } = await memberHttp.get<MemberMe>("/me");
  return data;
}

export async function fetchOverview(range: {
  from: string;
  to: string;
}): Promise<MemberOverview> {
  const { data } = await memberHttp.get<MemberOverview>("/overview", {
    params: range,
  });
  return data;
}

export type MemberLogQuery = {
  from: string;
  to: string;
  page: number;
  page_size: number;
  api_key_id?: number;
  billing_source?: string;
  subscription_id?: number;
  type?: number | "error";
};

export async function fetchLogs(query: MemberLogQuery): Promise<Paginated<LogItem>> {
  const { data } = await memberHttp.get<Paginated<LogItem>>("/logs", {
    params: query,
  });
  return data;
}
