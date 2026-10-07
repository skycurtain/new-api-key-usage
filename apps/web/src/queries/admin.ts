import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  fetchKeys,
  patchKey,
  registerKey,
  type KeyListFilters,
} from "@/api/admin/keys.ts";
import { fetchOverview } from "@/api/admin/overview.ts";
import { fetchEngine } from "@/api/admin/engine.ts";
import {
  createPayment,
  deletePayment,
  fetchPayments,
  updatePayment,
} from "@/api/admin/payments.ts";
import {
  createMember,
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

export function useKeys(filters: () => KeyListFilters) {
  return useQuery({
    queryKey: () => qk.admin.keys(filters()),
    queryFn: () => fetchKeys(filters()),
  });
}

export function useRegisterKey() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: registerKey,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["admin", "keys"] });
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
    },
  });
}

export function useAdminLogs(params: () => TimeRange & PageQuery) {
  return useQuery({
    queryKey: () => qk.admin.logs(params()),
    queryFn: () => fetchLogs(params()),
  });
}

export function usePayments() {
  return useQuery({
    queryKey: qk.admin.payments(),
    queryFn: fetchPayments,
  });
}

export function useCreatePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: createPayment,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.admin.payments() });
    },
  });
}

export function useUpdatePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, body }: { id: number; body: Record<string, unknown> }) =>
      updatePayment(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.admin.payments() });
    },
  });
}

export function useDeletePayment() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: deletePayment,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.admin.payments() });
    },
  });
}

export function useMembers() {
  return useQuery({
    queryKey: qk.admin.members(),
    queryFn: fetchMembers,
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
      body: { status: "active" | "disabled" };
    }) => patchMember(id, body),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: qk.admin.members() });
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
  params: () => PageQuery & { domain?: string },
) {
  return useQuery({
    queryKey: () => qk.admin.auditLogs(params()),
    queryFn: () => fetchAuditLogs(params()),
  });
}
