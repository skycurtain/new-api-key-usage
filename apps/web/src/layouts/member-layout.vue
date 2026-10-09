<script setup lang="ts">
import type { MenuInfo, MenuItemType } from "antdv-next";
import { theme } from "antdv-next";
import {
  AccountBookOutlined,
  DashboardOutlined,
  DownOutlined,
  FileTextOutlined,
  LogoutOutlined,
  MenuFoldOutlined,
  MenuUnfoldOutlined,
  UserOutlined,
} from "@antdv-next/icons";
import { computed, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useMemberTokenStore } from "@/stores/member-token.ts";
import { useMemberRangeStore } from "@/stores/member-range.ts";
import { useMemberMe } from "@/queries/member.ts";

const { token } = theme.useToken();
const route = useRoute();
const router = useRouter();
const tokenStore = useMemberTokenStore();
const rangeStore = useMemberRangeStore();
const meQuery = useMemberMe();

const collapsed = ref(false);
const brandTitle = "NAKU";
const brandDescription = "成员用量";
const memberName = computed(
  () => tokenStore.memberName || meQuery.data.value?.name || "",
);

const items: MenuItemType[] = [
  { key: "/member", icon: DashboardOutlined, label: "总览" },
  { key: "/member/logs", icon: FileTextOutlined, label: "调用日志" },
  { key: "/member/payments", icon: AccountBookOutlined, label: "支付参数" },
];

const selectedKeys = ref<string[]>([route.path === "/member" ? "/member" : route.path]);
watch(
  () => route.path,
  (path) => {
    selectedKeys.value = [path === "/member" ? "/member" : path];
  },
);

function onMenuClick({ key }: MenuInfo) {
  // 切页保留对账窗口（from/to），不带页内筛选
  void router.push({
    path: String(key),
    query: {
      from: rangeStore.range.from,
      to: rangeStore.range.to,
    },
  });
}

const userMenuItems: MenuItemType[] = [
  { key: "logout", icon: LogoutOutlined, label: "退出", danger: true },
];

function onUserMenuClick({ key }: MenuInfo) {
  if (key === "logout") {
    tokenStore.clearToken();
    void router.replace({ name: "member-login" });
  }
}
</script>

<template>
  <a-layout class="member-layout">
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

      <div
        class="member-layout__brand"
        :class="{ 'is-collapsed': collapsed }"
        :title="collapsed ? `${brandTitle} · ${brandDescription}` : undefined"
      >
        <span class="member-layout__mark" aria-hidden="true">N</span>
        <div v-if="!collapsed" class="member-layout__brand-text">
          <div class="member-layout__brand-title">{{ brandTitle }}</div>
          <div class="member-layout__brand-desc">{{ brandDescription }}</div>
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
    <a-layout class="member-layout__main">
      <a-layout-header class="member-layout__header">
        <a-dropdown
          :menu="{ items: userMenuItems }"
          placement="bottomRight"
          :trigger="['click']"
          @menu-click="onUserMenuClick"
        >
          <a class="member-layout__account">
            <UserOutlined class="member-layout__account-icon" />
            <span v-if="memberName" class="member-layout__username">{{ memberName }}</span>
            <span v-else class="member-layout__username is-muted">…</span>
            <DownOutlined class="member-layout__account-caret" />
          </a>
        </a-dropdown>
      </a-layout-header>
      <a-layout-content class="member-layout__content">
        <div
          class="member-layout__surface"
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
.member-layout {
  height: 100vh;
  overflow: hidden;
}

.member-layout__main {
  height: 100vh;
  min-width: 0;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.member-layout__brand {
  height: 64px;
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 0 24px;
  overflow: hidden;
  border-bottom: 1px solid rgba(255, 255, 255, 0.08);
  box-sizing: border-box;
}

.member-layout__brand.is-collapsed {
  justify-content: center;
  padding: 0;
  gap: 0;
}

.member-layout__mark {
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

.member-layout__brand-text {
  min-width: 0;
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 0;
}

.member-layout__brand-title {
  color: rgba(255, 255, 255, 0.92);
  font-size: 14px;
  font-weight: 600;
  line-height: 22px;
  letter-spacing: 0.01em;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.member-layout__brand-desc {
  color: rgba(255, 255, 255, 0.45);
  font-size: 12px;
  font-weight: 400;
  line-height: 20px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.member-layout__header {
  flex: 0 0 64px;
  display: flex;
  align-items: center;
  justify-content: flex-end;
  background: #fff;
  padding: 0 24px;
  height: 64px;
  line-height: 64px;
  border-bottom: 1px solid #f0f0f0;
}

.member-layout__account {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 0 8px;
  height: 40px;
  color: rgba(0, 0, 0, 0.88);
  cursor: pointer;
  border-radius: 6px;
  transition: background-color 0.2s;
}

.member-layout__account:hover {
  background: rgba(0, 0, 0, 0.06);
}

.member-layout__account-icon {
  font-size: 14px;
  color: rgba(0, 0, 0, 0.65);
}

.member-layout__account-caret {
  font-size: 10px;
  color: rgba(0, 0, 0, 0.45);
}

.member-layout__username {
  color: rgba(0, 0, 0, 0.88);
  max-width: 160px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.member-layout__username.is-muted {
  color: rgba(0, 0, 0, 0.45);
}

.member-layout__content {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  overflow-x: hidden;
  background: #f5f5f5;
  padding: 24px;
}

.member-layout__surface {
  padding: 24px;
  min-height: 100%;
}
</style>
