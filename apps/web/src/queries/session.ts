import { useMutation, useQuery, useQueryClient } from "@tanstack/vue-query";
import {
  changePassword,
  fetchSession,
  fetchSetupState,
  login,
  logout,
  setup,
} from "@/api/admin/session.ts";
import { qk } from "@/api/query-keys.ts";
import { useAdminSessionStore } from "@/stores/admin-session.ts";

export function useSetupState() {
  return useQuery({
    queryKey: qk.admin.setupState(),
    queryFn: fetchSetupState,
    staleTime: 60_000,
  });
}

export function useSession() {
  const store = useAdminSessionStore();
  return useQuery({
    queryKey: qk.admin.session(),
    queryFn: async () => {
      const data = await fetchSession();
      store.signIn(data.username);
      return data;
    },
    staleTime: 60_000,
    retry: false,
  });
}

export function useLogin() {
  const store = useAdminSessionStore();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: login,
    onSuccess: (data) => {
      store.signIn(data.username);
      void qc.invalidateQueries({ queryKey: qk.admin.session() });
    },
  });
}

export function useSetup() {
  const store = useAdminSessionStore();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: setup,
    onSuccess: (data) => {
      store.signIn(data.username);
      void qc.invalidateQueries({ queryKey: qk.admin.setupState() });
    },
  });
}

export function useLogout() {
  const store = useAdminSessionStore();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: logout,
    onSuccess: () => {
      store.signOut();
      qc.clear();
    },
  });
}

export function useChangePassword() {
  return useMutation({ mutationFn: changePassword });
}
