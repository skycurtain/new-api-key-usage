<script setup lang="ts">
/** 登录 + 空库三态分流（交互登录篇）；视觉细节待与 antdv-next 工具链一并设计 */
import { computed, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useLogin, useSetup, useSetupState } from "@/queries/session.ts";

const route = useRoute();
const router = useRouter();
const setupState = useSetupState();
const login = useLogin();
const setup = useSetup();

const username = ref("");
const password = ref("");
const passwordConfirm = ref("");
const error = ref("");

const isSetup = computed(() => setupState.data.value?.initialized === false);

async function onSubmit() {
  error.value = "";
  try {
    if (isSetup.value) {
      if (password.value !== passwordConfirm.value) {
        error.value = "两次输入的密码不一致";
        return;
      }
      await setup.mutateAsync({
        username: username.value,
        password: password.value,
      });
    } else {
      await login.mutateAsync({
        username: username.value,
        password: password.value,
      });
    }
    const redirect = route.query.redirect;
    void router.replace(typeof redirect === "string" ? redirect : "/admin/overview");
  } catch (e) {
    error.value = e instanceof Error ? e.message : "登录失败";
  }
}
</script>

<template>
  <div class="login-view">
    <h1>{{ isSetup ? "初始化管理员" : "管理面登录" }}</h1>
    <form @submit.prevent="onSubmit">
      <label>
        用户名
        <input v-model="username" name="username" autocomplete="username" required />
      </label>
      <label>
        密码
        <input
          v-model="password"
          name="password"
          type="password"
          autocomplete="current-password"
          required
        />
      </label>
      <label v-if="isSetup">
        确认密码
        <input v-model="passwordConfirm" name="password_confirm" type="password" required />
      </label>
      <button type="submit" :disabled="login.isPending.value || setup.isPending.value">
        {{ isSetup ? "完成设置" : "登录" }}
      </button>
    </form>
    <p v-if="error" role="alert">{{ error }}</p>
  </div>
</template>

<style scoped>
.login-view {
  max-width: 360px;
  margin: 10vh auto;
  display: flex;
  flex-direction: column;
  gap: 12px;
}
.login-view label {
  display: flex;
  flex-direction: column;
  gap: 4px;
}
</style>
