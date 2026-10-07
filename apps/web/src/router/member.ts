import type { RouteRecordRaw } from "vue-router";
import MemberLayout from "@/layouts/member-layout.vue";

/** 成员视图 `/member/*`：登录壳 → 单页（交互共性 §1） */
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
        name: "member-home",
        component: () => import("@/views/member/home-view.vue"),
      },
    ],
  },
];
