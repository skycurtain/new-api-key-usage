<script setup lang="ts">
import { computed } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAdminSessionStore } from "@/stores/admin-session.ts";
import { useLogout, useSession } from "@/queries/session.ts";

const route = useRoute();
const router = useRouter();
const adminSession = useAdminSessionStore();
// 刷新后恢复侧边栏用户名（契约 GET /session）
const sessionQuery = useSession();
const logout = useLogout();

const username = computed(() => adminSession.username || sessionQuery.data.value?.username || "");

const menus = [
  { key: "/admin/overview", label: "总览" },
  { key: "/admin/keys", label: "Key 管理" },
  { key: "/admin/payments", label: "支付记录" },
  { key: "/admin/members", label: "成员管理" },
  { key: "/admin/audit", label: "审计日志" },
  { key: "/admin/settings", label: "账号设置" },
];

const selected = computed(() => route.path);

async function onLogout() {
  await logout.mutateAsync().catch(() => undefined);
  void router.push({ name: "admin-login" });
}
</script>

<template>
  <div class="admin-layout">
    <aside class="admin-layout__sider">
      <div class="admin-layout__brand">new-api-key-usage</div>
      <nav>
        <router-link
          v-for="item in menus"
          :key="item.key"
          :to="item.key"
          class="admin-layout__link"
          :class="{ 'is-active': selected === item.key }"
        >
          {{ item.label }}
        </router-link>
      </nav>
      <footer class="admin-layout__footer">
        <span>{{ username || "…" }}</span>
        <button type="button" @click="onLogout">登出</button>
      </footer>
    </aside>
    <main class="admin-layout__main">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.admin-layout {
  display: flex;
  min-height: 100vh;
}
.admin-layout__sider {
  width: 200px;
  padding: 16px;
  border-right: 1px solid #eee;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.admin-layout__main {
  flex: 1;
  padding: 16px;
}
.admin-layout__link {
  display: block;
  padding: 6px 8px;
  text-decoration: none;
  color: inherit;
}
.admin-layout__link.is-active {
  font-weight: 600;
}
.admin-layout__footer {
  margin-top: auto;
  display: flex;
  justify-content: space-between;
  gap: 8px;
}
</style>
