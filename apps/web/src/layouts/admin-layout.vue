<script setup lang="ts">
import type { MenuInfo, MenuItemType } from "antdv-next";
import { theme } from "antdv-next";
import {
  AccountBookOutlined,
  AuditOutlined,
  DashboardOutlined,
  KeyOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  SettingOutlined,
  TeamOutlined,
} from "@antdv-next/icons";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useAdminSessionStore } from "@/stores/admin-session.ts";
import { useLogout, useSession } from "@/queries/session.ts";

const { token } = theme.useToken();
const route = useRoute();
const router = useRouter();
const adminSession = useAdminSessionStore();
const sessionQuery = useSession();
const logout = useLogout();

const collapsed = ref(false);
/** 品牌区两行：主标题 + 一句描述（与日志前缀 naku 同源） */
const brandTitle = "NAKU";
const brandDescription = "NewAPI 用量统计";
const username = computed(
  () => adminSession.username || sessionQuery.data.value?.username || "",
);

/** 收起时仅剩图标——每项必须带 icon（交互共性侧边栏六项） */
const items: MenuItemType[] = [
  { key: "/admin/overview", icon: DashboardOutlined, label: "总览" },
  { key: "/admin/keys", icon: KeyOutlined, label: "Key 管理" },
  { key: "/admin/payments", icon: AccountBookOutlined, label: "支付记录" },
  { key: "/admin/members", icon: TeamOutlined, label: "成员管理" },
  { key: "/admin/audit", icon: AuditOutlined, label: "审计日志" },
  { key: "/admin/settings", icon: SettingOutlined, label: "账号设置" },
];

const selectedKeys = ref<string[]>([route.path]);
watch(
  () => route.path,
  (path) => {
    selectedKeys.value = [path];
  },
);

function onMenuClick({ key }: MenuInfo) {
  void router.push(String(key));
}

async function onLogout() {
  await logout.mutateAsync().catch(() => undefined);
  void router.push({ name: "admin-login" });
}
</script>

<template>
  <a-layout class="admin-layout">
    <a-layout-sider
      v-model:collapsed="collapsed"
      collapsible
      :width="220"
      :collapsed-width="80"
    >
      <template #trigger>
        <MenuUnfoldOutlined v-if="collapsed" />
        <MenuFoldOutlined v-else />
      </template>

      <!-- 品牌区：展开「徽标 + 标题/描述」两行；收起只留徽标 -->
      <div
        class="admin-layout__brand"
        :class="{ 'is-collapsed': collapsed }"
        :title="collapsed ? `${brandTitle} · ${brandDescription}` : undefined"
      >
        <span class="admin-layout__mark" aria-hidden="true">N</span>
        <div v-if="!collapsed" class="admin-layout__brand-text">
          <div class="admin-layout__brand-title">{{ brandTitle }}</div>
          <div class="admin-layout__brand-desc">{{ brandDescription }}</div>
        </div>
      </div>

      <a-menu
        theme="dark"
        mode="inline"
        :inline-collapsed="collapsed"
        :selected-keys="selectedKeys"
        :items="items"
        @click="onMenuClick"
      />
    </a-layout-sider>
    <a-layout>
      <a-layout-header class="admin-layout__header">
        <div class="admin-layout__account">
          <span class="admin-layout__username">{{ username || "…" }}</span>
          <a-button size="small" :loading="logout.isPending.value" @click="onLogout">
            登出
          </a-button>
        </div>
      </a-layout-header>
      <a-layout-content class="admin-layout__content">
        <div
          class="admin-layout__surface"
          :style="{
            background: token.colorBgContainer,
            borderRadius: `${token.borderRadiusLG}px`,
          }"
        >
          <router-view />
        </div>
      </a-layout-content>
    </a-layout>
  </a-layout>
</template>

<style scoped>
.admin-layout {
  min-height: 100vh;
}

/*
 * 品牌区：恒高 64，不随收起跳动。
 * 展开：徽标 + 两行文字（标题 title-md 级 14/600/22 · 描述 body-sm 12/400/20）——22+20=42，竖向居中。
 * 收起：只居中徽标；悬停 title 为「标题 · 描述」。
 */
.admin-layout__brand {
  height: 64px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 24px;
  overflow: hidden;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  box-sizing: border-box;
}

.admin-layout__brand.is-collapsed {
  justify-content: center;
  padding: 0;
  gap: 0;
}

.admin-layout__mark {
  flex: 0 0 28px;
  width: 28px;
  height: 28px;
  border-radius: 6px;
  background: #1677ff;
  color: #fff;
  font-size: 15px;
  font-weight: 600;
  line-height: 28px;
  text-align: center;
  user-select: none;
}

.admin-layout__brand-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0;
}

.admin-layout__brand-title {
  color: rgba(255, 255, 255, 0.92);
  font-size: 14px;
  font-weight: 600;
  line-height: 22px;
  letter-spacing: 0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.admin-layout__brand-desc {
  color: rgba(255, 255, 255, 0.45);
  font-size: 12px;
  font-weight: 400;
  line-height: 20px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.admin-layout__header {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  background: #fff;
  padding: 0 24px;
  height: 64px;
  line-height: 64px;
  border-bottom: 1px solid #f0f0f0;
}

.admin-layout__account {
  display: flex;
  align-items: center;
  gap: 16px;
  line-height: normal;
}

.admin-layout__username {
  color: rgba(0, 0, 0, 0.65);
}

.admin-layout__content {
  background: #f5f5f5;
  padding: 24px;
  min-height: calc(100vh - 64px);
}

.admin-layout__surface {
  padding: 24px;
  min-height: calc(100vh - 64px - 48px);
}
</style>
