<script setup lang="ts">
import { computed } from "vue";
import { useMemberTokenStore } from "@/stores/member-token.ts";
import { useMemberMe } from "@/queries/member.ts";

const tokenStore = useMemberTokenStore();
const meQuery = useMemberMe();

const memberName = computed(
  () => tokenStore.memberName || meQuery.data.value?.name || "",
);
</script>

<template>
  <div class="member-layout">
    <header class="member-layout__header">
      <div class="member-layout__brand">成员入口</div>
      <div class="member-layout__name">{{ memberName }}</div>
    </header>
    <main class="member-layout__main">
      <div class="member-layout__surface">
        <router-view />
      </div>
    </main>
  </div>
</template>

<style scoped>
/* design.md：bg-layout 底 + bg-container 内容面；间距 24/16 对齐 spacing lg/md */
.member-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
  background: #f5f5f5;
}

.member-layout__header {
  height: 64px;
  padding: 0 24px;
  background: #fff;
  border-bottom: 1px solid #f0f0f0;
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.member-layout__brand {
  font-weight: 600;
  font-size: 16px;
  line-height: 24px;
}

.member-layout__name {
  color: rgba(0, 0, 0, 0.65);
  font-size: 14px;
}

.member-layout__main {
  flex: 1;
  width: 100%;
  max-width: 960px;
  margin: 0 auto;
  padding: 24px 16px 48px;
}

.member-layout__surface {
  background: #fff;
  border-radius: 8px;
  padding: 24px;
}
</style>
