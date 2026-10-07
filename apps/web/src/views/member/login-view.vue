<script setup lang="ts">
/** 成员令牌登录壳——明文仅存 sessionStorage（交互登录篇 §4） */
import { ref } from "vue";
import { useRouter } from "vue-router";
import { useMemberTokenStore } from "@/stores/member-token.ts";
import { fetchMe } from "@/api/member/me.ts";

const router = useRouter();
const tokenStore = useMemberTokenStore();
const token = ref("");
const error = ref("");
const pending = ref(false);

async function onSubmit() {
  error.value = "";
  pending.value = true;
  try {
    tokenStore.setToken(token.value.trim());
    const me = await fetchMe();
    tokenStore.setMemberName(me.name);
    void router.replace({ name: "member-home" });
  } catch {
    tokenStore.clearToken();
    error.value = "令牌无效或已停用";
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div class="member-login">
    <h1>成员入口</h1>
    <form @submit.prevent="onSubmit">
      <label>
        令牌
        <input v-model="token" name="token" type="password" required />
      </label>
      <button type="submit" :disabled="pending">进入</button>
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.member-login {
  max-width: 360px;
  margin: 12vh auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.member-login label {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
