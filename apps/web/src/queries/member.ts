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

/**
 * 总览聚合。仅「总览」传 `refetchInterval`（看板心智）；日志/支付不轮询。
 */
export function useMemberOverview(
  range: () => TimeRange,
  opts?: { refetchInterval?: number },
) {
  return useQuery({
    queryKey: () => qk.member.overview(range()),
    queryFn: () => fetchOverview(range()),
    ...(opts?.refetchInterval != null
      ? { refetchInterval: opts.refetchInterval }
      : {}),
  });
}

export function useMemberLogs(params: () => MemberLogQuery) {
  return useQuery({
    queryKey: () => qk.member.logs(params()),
    queryFn: () => fetchLogs(params()),
  });
}
