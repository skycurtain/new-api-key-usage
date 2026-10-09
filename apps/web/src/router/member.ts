import type { RouteRecordRaw } from "vue-router";
import MemberLayout from "@/layouts/member-layout.vue";

/** 成员视图 `/member/*`：登录壳 → 侧边栏三页（与管理端同构壳） */
export const memberRoutes: RouteRecordRaw[] = [
  {
    path: "/member/login",
    name: "member-login",
    component: () => import("@/views/member/login-view.vue"),
    meta: { public: true, world: "member" },
  },
  {
    path: "/member",
    component: MemberLayout,
    meta: { requiresMember: true, world: "member" },
    children: [
      {
        path: "",
        name: "member-overview",
        component: () => import("@/views/member/overview-view.vue"),
      },
      {
        path: "logs",
        name: "member-logs",
        component: () => import("@/views/member/logs-view.vue"),
      },
      {
        path: "payments",
        name: "member-payments",
        component: () => import("@/views/member/payments-view.vue"),
      },
    ],
  },
];
