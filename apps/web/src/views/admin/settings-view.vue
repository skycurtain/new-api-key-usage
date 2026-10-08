<script setup lang="ts">
/**
 * 账号设置——改密（交互设计-登录与会话 §3）
 */
import { computed, reactive, ref } from "vue";
import { message } from "antdv-next";
import type { ApiError } from "@/api/http.ts";
import PageHeader from "@/components/common/page-header.vue";
import { useChangePassword } from "@/queries/session.ts";

const changePassword = useChangePassword();

const form = reactive({
  old_password: "",
  new_password: "",
  confirm_password: "",
});

const fieldError = ref<{ old_password?: string; new_password?: string }>({});
const formError = ref("");
const successMsg = ref("");

const canSubmit = computed(
  () =>
    form.old_password.length > 0 &&
    form.new_password.length > 0 &&
    form.confirm_password.length > 0,
);

async function onSubmit() {
  if (!canSubmit.value || changePassword.isPending.value) return;
  fieldError.value = {};
  formError.value = "";
  successMsg.value = "";

  if (form.new_password !== form.confirm_password) {
    formError.value = "两次输入的新密码不一致";
    return;
  }
  try {
    await changePassword.mutateAsync({
      old_password: form.old_password,
      new_password: form.new_password,
    });
    form.old_password = "";
    form.new_password = "";
    form.confirm_password = "";
    successMsg.value = "密码已更新；其他设备的登录已失效";
    message.success(successMsg.value);
  } catch (e) {
    const err = e as ApiError;
    if (err.fields?.old_password) {
      fieldError.value.old_password = err.fields.old_password;
    } else if (err.fields?.new_password) {
      fieldError.value.new_password = err.fields.new_password;
    } else {
      formError.value = err.message || "修改失败";
    }
  }
}
</script>

<template>
  <section class="settings">
    <PageHeader title="账号设置" subtitle="修改管理面登录密码" />

    <a-form layout="vertical" class="settings__form">
      <a-form-item
        label="旧密码"
        required
        :validate-status="fieldError.old_password ? 'error' : undefined"
        :help="fieldError.old_password"
      >
        <a-input-password
          v-model:value="form.old_password"
          autocomplete="current-password"
          @press-enter="onSubmit"
        />
      </a-form-item>
      <a-form-item
        label="新密码"
        required
        :validate-status="fieldError.new_password ? 'error' : undefined"
        :help="fieldError.new_password"
      >
        <a-input-password
          v-model:value="form.new_password"
          autocomplete="new-password"
          @press-enter="onSubmit"
        />
      </a-form-item>
      <a-form-item label="确认新密码" required>
        <a-input-password
          v-model:value="form.confirm_password"
          autocomplete="new-password"
          @press-enter="onSubmit"
        />
      </a-form-item>

      <a-alert
        v-if="formError"
        type="error"
        show-icon
        :message="formError"
        style="margin-bottom: 16px"
      />
      <a-alert
        v-else-if="successMsg"
        type="success"
        show-icon
        :message="successMsg"
        style="margin-bottom: 16px"
      />

      <a-button
        type="primary"
        :loading="changePassword.isPending.value"
        :disabled="!canSubmit"
        @click="onSubmit"
      >
        修改密码
      </a-button>
    </a-form>
  </section>
</template>

<style scoped>
.settings__form {
  max-width: 420px;
}
</style>
