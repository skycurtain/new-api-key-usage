<script setup lang="ts">
import { computed } from "vue";
import { useMemberTokenStore } from "@/stores/member-token.ts";
import { useMemberMe } from "@/queries/member.ts";

const tokenStore = useMemberTokenStore();
const meQuery = useMemberMe();

const memberName = computed(() => tokenStore.memberName || meQuery.data.value?.name || "");
</script>

<template>
  <div class="member-layout">
    <header class="member-layout__header">
      <strong>成员入口</strong>
      <span>{{ memberName }}</span>
    </header>
    <main class="member-layout__main">
      <router-view />
    </main>
  </div>
</template>

<style scoped>
.member-layout {
  min-height: 100vh;
  display: flex;
  flex-direction: column;
}
.member-layout__header {
  display: flex;
  justify-content: space-between;
  padding: 12px 16px;
  border-bottom: 1px solid #eee;
}
.member-layout__main {
  padding: 16px;
}
</style>
