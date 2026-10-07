import { defineStore } from "pinia";

/**
 * 管理面登录态（客户端镜像）。
 * 服务端事实以 GET /api/admin/session 为准——刷新后由 queries/session 恢复。
 */
export const useAdminSessionStore = defineStore("admin-session", {
  state: () => ({
    username: "" as string,
  }),
  getters: {
    isLoggedIn: (s) => s.username.length > 0,
  },
  actions: {
    signIn(username: string) {
      this.username = username;
    },
    signOut() {
      this.username = "";
    },
  },
});
