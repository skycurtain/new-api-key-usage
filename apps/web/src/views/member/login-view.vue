<script setup lang="ts">
/** 成员令牌登录壳——明文仅存 sessionStorage（交互登录篇 §4） */
import type { FormInstance } from "antdv-next";
import { reactive, ref, shallowRef } from "vue";
import { useRouter } from "vue-router";
import { useMemberTokenStore } from "@/stores/member-token.ts";
import { fetchMe } from "@/api/member/me.ts";

const router = useRouter();
const tokenStore = useMemberTokenStore();
const formRef = shallowRef<FormInstance>();
const model = reactive({ token: "" });
const error = ref("");
const pending = ref(false);

async function onFinish() {
  error.value = "";
  pending.value = true;
  try {
    tokenStore.setToken(model.token.trim());
    const me = await fetchMe();
    tokenStore.setMemberName(me.name);
    void router.replace({ name: "member-overview" });
  } catch {
    tokenStore.clearToken();
    error.value = "令牌无效或已停用";
  } finally {
    pending.value = false;
  }
}
</script>

<template>
  <div class="member-login-shell">
    <a-card class="member-login-shell__card" title="成员入口">
      <a-form
        ref="formRef"
        :model="model"
        layout="vertical"
        auto-complete="off"
        @finish="onFinish"
      >
        <a-form-item
          name="token"
          label="令牌"
          :rules="[{ required: true, message: '请输入成员令牌' }]"
        >
          <a-input-password v-model:value="model.token" placeholder="粘贴成员令牌" />
        </a-form-item>
        <a-alert
          v-if="error"
          type="error"
          show-icon
          :message="error"
          style="margin-bottom: 16px"
        />
        <a-button type="primary" html-type="submit" block :loading="pending">
          进入
        </a-button>
      </a-form>
    </a-card>
  </div>
</template>

<style scoped>
.member-login-shell {
  min-height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  background: #f0f2f5;
  padding: 24px;
}

.member-login-shell__card {
  width: 380px;
}
</style>
