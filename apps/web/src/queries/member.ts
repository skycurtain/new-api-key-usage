import { useQuery } from "@tanstack/vue-query";
import {
  fetchLogs,
  fetchMe,
  fetchOverview,
  type MemberLogQuery,
} from "@/api/member/me.ts";
import { qk, type TimeRange } from "@/api/query-keys.ts";

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

export function useMemberLogs(params: () => MemberLogQuery) {
  return useQuery({
    queryKey: () => qk.member.logs(params()),
    queryFn: () => fetchLogs(params()),
    staleTime: 0,
  });
}
