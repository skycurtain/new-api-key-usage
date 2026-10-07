import type { UsageTotals, UnixSec } from "@new-api-key-usage/core";
import { adminHttp } from "../http.ts";

export type AdminOverview = {
  data_cutoff: UnixSec | null;
  unassigned_subscription: UsageTotals;
  by_source: Array<{
    billing_source: string;
    count: number;
    quota: number;
    quota_usd: string;
  }>;
  by_member: Array<{
    member_id: number | null;
    member_name: string | null;
    key_count: number;
    data_cutoff: UnixSec | null;
    usage: UsageTotals;
  }>;
  by_key: Array<{
    key_id: number;
    token_name: string;
    member_id: number | null;
    member_name: string | null;
    status: string;
    data_cutoff: UnixSec | null;
    usage: UsageTotals;
  }>;
};

export async function fetchOverview(range: {
  from: string;
  to: string;
}): Promise<AdminOverview> {
  const { data } = await adminHttp.get<AdminOverview>("/overview", {
    params: range,
  });
  return data;
}
