import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  fetchKeys,
  patchKey,
  registerKey,
  type KeyListFilters,
} from "@/api/admin/keys.ts";
import { fetchOverview } from "@/api/admin/overview.ts";
import { fetchEngine, fetchQpuLatest } from "@/api/admin/engine.ts";
import {
  createSubscription,
  deleteSubscription,
  fetchSubscriptions,
  updateSubscription,
  type SubscriptionBody,
} from "@/api/admin/subscriptions.ts";
import {
  createTopup,
  deleteTopup,
  fetchTopups,
  updateTopup,
  type TopupBody,
} from "@/api/admin/topups.ts";
import {
  createMember,
  deleteMember,
  fetchMembers,
  issueMemberToken,
  patchMember,
} from "@/api/admin/members.ts";
import { fetchAuditLogs } from "@/api/admin/audit.ts";
import { fetchLogs } from "@/api/admin/logs.ts";
import { qk, type PageQuery, type TimeRange } from "@/api/query-keys.ts";

export function useAdminOverview(range: () => TimeRange) {
  return useQuery({
    queryKey: () => qk.admin.overview(range()),
    queryFn: () => fetchOverview(range()),
    // 页面可长时间挂起：定期拉取引擎新写入的数据
    refetchInterval: 60_000,
  });
}

export function useEngine() {
  return useQuery({
    queryKey: qk.admin.engine(),
    queryFn: fetchEngine,
    refetchInterval: 60_000,
  });
}

export function useQpuLatest() {
  return useQuery({
    queryKey: qk.admin.qpuLatest(),
    queryFn: fetchQpuLatest,
  });
}

export function useKeys(filters: () => KeyListFilters) {
  return useQuery({
    queryKey: () => qk.admin.keys(filters()),
    queryFn: () => fetchKeys(filters()),
    // 切页回列表时立即反映最新归属/状态
    staleTime: 0,
  });
}

export function useRegisterKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: registerKey,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "keys"] });
      void qc.invalidateQueries({ queryKey: qk.admin.members() });
    },
  });
}

export function usePatchKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: number;
      body: { status?: "active" | "disabled"; member_id?: number | null };
    }) => patchKey(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "keys"] });
      // 归属变更会改成员「名下 Key 数」
      void qc.invalidateQueries({ queryKey: qk.admin.members() });
    },
  });
}

export function useAdminLogs(
  params: () => Parameters<typeof fetchLogs>[0],
) {
  return useQuery({
    queryKey: () => qk.admin.logs(params()),
    queryFn: () => fetchLogs(params()),
  });
}

export function useSubscriptions() {
  return useQuery({
    queryKey: qk.admin.subscriptions(),
    queryFn: fetchSubscriptions,
    staleTime: 0,
  });
}

export function useCreateSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: SubscriptionBody) => createSubscription(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.admin.subscriptions() });
    },
  });
}

export function useUpdateSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: SubscriptionBody }) =>
      updateSubscription(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.admin.subscriptions() });
    },
  });
}

export function useDeleteSubscription() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteSubscription,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.admin.subscriptions() });
    },
  });
}

export function useTopups() {
  return useQuery({
    queryKey: qk.admin.topups(),
    queryFn: fetchTopups,
    staleTime: 0,
  });
}

export function useCreateTopup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: TopupBody) => createTopup(body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.admin.topups() });
    },
  });
}

export function useUpdateTopup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: TopupBody }) =>
      updateTopup(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.admin.topups() });
    },
  });
}

export function useDeleteTopup() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteTopup,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.admin.topups() });
    },
  });
}

export function useMembers() {
  return useQuery({
    queryKey: qk.admin.members(),
    queryFn: fetchMembers,
    staleTime: 0,
  });
}

export function useCreateMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createMember,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.admin.members() });
      void qc.invalidateQueries({ queryKey: ["admin", "keys"] });
    },
  });
}

export function usePatchMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({
      id,
      body,
    }: {
      id: number;
      body: {
        name?: string;
        remark?: string;
        status?: "active" | "disabled";
      };
    }) => patchMember(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.admin.members() });
      void qc.invalidateQueries({ queryKey: ["admin", "keys"] });
    },
  });
}

export function useDeleteMember() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deleteMember,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.admin.members() });
      void qc.invalidateQueries({ queryKey: ["admin", "keys"] });
    },
  });
}

export function useIssueMemberToken() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: issueMemberToken,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.admin.members() });
    },
  });
}

export function useAuditLogs(
  params: () => PageQuery & { domain?: string; from?: string; to?: string },
) {
  return useQuery({
    queryKey: () => qk.admin.auditLogs(params()),
    queryFn: () => fetchAuditLogs(params()),
  });
}
