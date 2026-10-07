import { createRouter, createWebHistory, type Router } from "vue-router";
import { adminRoutes } from "./admin.ts";
import { memberRoutes } from "./member.ts";
import { setAuthRedirect } from "@/api/auth-redirect.ts";
import { useAdminSessionStore } from "@/stores/admin-session.ts";
import { useMemberTokenStore } from "@/stores/member-token.ts";

declare module "vue-router" {
  interface RouteMeta {
    public?: boolean;
    requiresAdmin?: boolean;
    requiresMember?: boolean;
    world?: "admin" | "member";
  }
}

export const router: Router = createRouter({
  history: createWebHistory(),
  routes: [
    { path: "/", redirect: "/admin/overview" },
    ...adminRoutes,
    ...memberRoutes,
    { path: "/:pathMatch(.*)*", redirect: "/admin/overview" },
  ],
});

router.beforeEach((to) => {
  if (to.meta.public) return true;

  const memberToken = useMemberTokenStore();

  // 管理面：硬刷新后 Pinia 为空但会话 cookie 仍在——交给 GET /session 与 401 分流裁决
  if (to.meta.requiresMember && !memberToken.hasToken) {
    return { name: "member-login" };
  }

  return true;
});

/** 401 分流接入 router（由 main.ts 调用一次） */
export function bindAuthRedirectToRouter(): void {
  setAuthRedirect((world, reason) => {
    const adminSession = useAdminSessionStore();
    const memberToken = useMemberTokenStore();
    if (world === "admin") {
      adminSession.signOut();
      void router.push({
        name: "admin-login",
        query: reason === "expired" ? { reason: "expired" } : {},
      });
    } else {
      memberToken.clearToken();
      void router.push({
        name: "member-login",
        query: reason === "expired" ? { reason: "expired" } : {},
      });
    }
  });
}
