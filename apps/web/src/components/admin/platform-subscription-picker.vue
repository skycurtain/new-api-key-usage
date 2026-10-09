<script setup lang="ts">
/**
 * 订阅选择弹层：登录（仅一次/标签页）+ 列表选用，与登记表单解耦
 */
import { ref } from "vue";
import {
  listPlatformSubscriptions,
  loginPlatform,
  type PlatformSubscription,
} from "@/api/admin/platform.ts";
import type { ApiError } from "@/api/http.ts";
import { formatDateTime } from "@/utils/time.ts";

const props = defineProps<{
  open: boolean;
}>();

const emit = defineEmits<{
  (e: "update:open", v: boolean): void;
  (e: "select", sub: PlatformSubscription): void;
}>();

const TOKEN_KEY = "naku_platform_token";

const username = ref("");
const password = ref("");
const error = ref("");
const loading = ref(false);
const list = ref<PlatformSubscription[]>([]);

function readToken(): string {
  try {
    return sessionStorage.getItem(TOKEN_KEY) ?? "";
  } catch {
    return "";
  }
}

function writeToken(token: string) {
  try {
    if (token) sessionStorage.setItem(TOKEN_KEY, token);
    else sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}

async function load() {
  if (!username.value.trim() || !password.value || loading.value) return;
  error.value = "";
  loading.value = true;
  try {
    let token = readToken();
    if (!token) {
      const login = await loginPlatform({
        username: username.value.trim(),
        password: password.value,
      });
      token = login.access_token;
      writeToken(token);
      password.value = "";
    }
    list.value = await listPlatformSubscriptions(token);
    if (list.value.length === 0) {
      error.value = "账号下没有订阅记录";
    }
  } catch (e) {
    const err = e as ApiError;
    if (err.status === 401) {
      writeToken("");
      error.value = "平台登录已失效——请重新输入密码";
    } else {
      error.value = err.message || "拉取失败";
    }
    list.value = [];
    password.value = "";
  } finally {
    loading.value = false;
  }
}

function onUse(s: PlatformSubscription) {
  emit("select", s);
  emit("update:open", false);
}
</script>

<template>
  <a-modal
    :open="open"
    title="从平台选择订阅"
    :footer="null"
    :width="520"
    centered
    :styles="{ body: { maxHeight: '70vh', overflowY: 'auto' } }"
    destroy-on-hidden
    @update:open="emit('update:open', $event)"
  >
    <template v-if="list.length === 0">
      <p class="plat-pick__hint">
        使用 NewAPI 控制台账号登录后拉取订阅，仅用于预填登记；密码不保存。
      </p>
      <a-form layout="vertical" @finish="load">
        <a-form-item label="账号">
          <a-input
            v-model:value="username"
            autocomplete="username"
            @press-enter="load"
          />
        </a-form-item>
        <a-form-item label="密码">
          <a-input-password
            v-model:value="password"
            autocomplete="current-password"
            @press-enter="load"
          />
        </a-form-item>
        <a-button
          type="primary"
          html-type="submit"
          block
          :loading="loading"
          :disabled="!username.trim() || !password"
        >
          登录并拉取
        </a-button>
      </a-form>
      <a-alert
        v-if="error"
        type="warning"
        show-icon
        :message="error"
        style="margin-top: 12px"
      />
    </template>
    <template v-else>
      <div class="plat-pick__list">
        <div
          v-for="s in list"
          :key="s.id"
          class="plat-pick__item"
          @click="onUse(s)"
        >
          <div class="plat-pick__head">
            <strong>订阅 #{{ s.id }}</strong>
            <span class="plat-pick__status">{{ s.status }}</span>
          </div>
          <div class="plat-pick__meta">
            {{ formatDateTime(s.start_time) }} ~
            {{ s.end_time ? formatDateTime(s.end_time) : "进行中" }}
            · 额度 {{ s.amount_total }}
          </div>
        </div>
      </div>
    </template>
  </a-modal>
</template>

<style scoped>
.plat-pick__hint {
  margin: 0 0 16px;
  font-size: 12px;
  line-height: 20px;
  color: rgba(0, 0, 0, 0.45);
}

.plat-pick__list {
  max-height: 360px;
  overflow-y: auto;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
}

.plat-pick__item {
  padding: 12px 16px;
  cursor: pointer;
  border-bottom: 1px solid #f0f0f0;
}

.plat-pick__item:hover {
  background: #fafafa;
}

.plat-pick__item:last-child {
  border-bottom: none;
}

.plat-pick__head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 4px;
}

.plat-pick__status {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}

.plat-pick__meta {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.65);
  font-variant-numeric: tabular-nums;
}
</style>
