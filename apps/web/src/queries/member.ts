import { useQuery } from "@tanstack/vue-query";
import {
  fetchLogs,
  fetchMe,
  fetchOverview,
} from "@/api/member/me.ts";
import { qk, type PageQuery, type TimeRange } from "@/api/query-keys.ts";

export function useMemberMe() {
  return useQuery({
    queryKey: qk.member.me(),
    queryFn: fetchMe,
    retry: false,
  });
}

export function useMemberOverview(range: () => TimeRange) {
  return useQuery({
    queryKey: () => qk.member.overview(range()),
    queryFn: () => fetchOverview(range()),
  });
}

export function useMemberLogs(params: () => TimeRange & PageQuery) {
  return useQuery({
    queryKey: () => qk.member.logs(params()),
    queryFn: () => fetchLogs(params()),
  });
}
