<script setup lang="ts">
/** 登录 + 空库三态分流（交互登录篇） */
import type { FormInstance } from "antdv-next";
import { computed, reactive, ref, shallowRef } from "vue";
import { useRoute, useRouter } from "vue-router";
import { useLogin, useSetup, useSetupState } from "@/queries/session.ts";

const route = useRoute();
const router = useRouter();
const setupState = useSetupState();
const login = useLogin();
const setup = useSetup();
const formRef = shallowRef<FormInstance>();

const model = reactive({
  username: "",
  password: "",
  passwordConfirm: "",
});
const error = ref("");

const isSetup = computed(() => setupState.data.value?.initialized === false);
const loading = computed(() => login.isPending.value || setup.isPending.value);

async function onFinish() {
  error.value = "";
  try {
    if (isSetup.value) {
      if (model.password !== model.passwordConfirm) {
        error.value = "两次输入的密码不一致";
        return;
      }
      await setup.mutateAsync({
        username: model.username,
        password: model.password,
      });
    } else {
      await login.mutateAsync({
        username: model.username,
        password: model.password,
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
  <div class="login-shell">
    <a-card class="login-shell__card" :title="isSetup ? '初始化管理员' : '管理面登录'">
      <a-form
        ref="formRef"
        :model="model"
        layout="vertical"
        auto-complete="off"
        @finish="onFinish"
      >
        <a-form-item
          name="username"
          label="用户名"
          :rules="[{ required: true, message: '请输入用户名' }]"
        >
          <a-input v-model:value="model.username" autocomplete="username" />
        </a-form-item>
        <a-form-item
          name="password"
          label="密码"
          :rules="[{ required: true, message: '请输入密码' }]"
        >
          <a-input-password
            v-model:value="model.password"
            autocomplete="current-password"
          />
        </a-form-item>
        <a-form-item
          v-if="isSetup"
          name="passwordConfirm"
          label="确认密码"
          :rules="[{ required: true, message: '请再次输入密码' }]"
        >
          <a-input-password v-model:value="model.passwordConfirm" />
        </a-form-item>
        <a-alert
          v-if="error"
          type="error"
          show-icon
          :message="error"
          style="margin-bottom: 16px"
        />
        <a-button type="primary" html-type="submit" block :loading="loading">
          {{ isSetup ? "完成设置" : "登录" }}
        </a-button>
      </a-form>
    </a-card>
  </div>
</template>

<style scoped>
.login-shell {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f0f2f5;
  padding: 24px;
}

.login-shell__card {
  width: 380px;
}
</style>
