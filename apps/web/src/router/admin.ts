import type { RouteRecordRaw } from "vue-router";
import AdminLayout from "@/layouts/admin-layout.vue";

/**
 * 管理面路由 `/admin/*`（契约：页面路由永不进入 `/api`）。
 * 侧边栏六项 + 账号设置（交互共性 §2）。
 */
export const adminRoutes: RouteRecordRaw[] = [
  {
    path: "/admin/login",
    name: "admin-login",
    component: () => import("@/views/admin/login-view.vue"),
    meta: { public: true, world: "admin" },
  },
  {
    path: "/admin",
    component: AdminLayout,
    meta: { requiresAdmin: true, world: "admin" },
    children: [
      {
        path: "",
        redirect: { name: "admin-overview" },
      },
      {
        path: "overview",
        name: "admin-overview",
        component: () => import("@/views/admin/overview-view.vue"),
      },
      {
        path: "keys",
        name: "admin-keys",
        component: () => import("@/views/admin/keys-view.vue"),
      },
      {
        path: "payments",
        name: "admin-payments",
        component: () => import("@/views/admin/payments-view.vue"),
      },
      {
        path: "members",
        name: "admin-members",
        component: () => import("@/views/admin/members-view.vue"),
      },
      {
        path: "audit",
        name: "admin-audit",
        component: () => import("@/views/admin/audit-view.vue"),
      },
      {
        path: "settings",
        name: "admin-settings",
        component: () => import("@/views/admin/settings-view.vue"),
      },
    ],
  },
];
