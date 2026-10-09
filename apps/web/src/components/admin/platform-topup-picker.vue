<script setup lang="ts">
/**
 * 充值选用弹层：登录 + 传统分页；已登记按 upstream_id 灰显
 */
import { computed, ref, watch } from "vue";
import {
  listPlatformTopups,
  loginPlatform,
  type PlatformTopup,
} from "@/api/admin/platform.ts";
import type { ApiError } from "@/api/http.ts";
import { formatDateTime } from "@/utils/time.ts";

const props = defineProps<{
  open: boolean;
  registeredIds?: number[];
}>();

const emit = defineEmits<{
  (e: "update:open", v: boolean): void;
  (e: "select", topup: PlatformTopup & { paid_at_iso: string }): void;
}>();

const TOKEN_KEY = "naku_platform_token";
const PAGE_SIZE = 10;

const username = ref("");
const password = ref("");
const error = ref("");
const loading = ref(false);
const items = ref<PlatformTopup[]>([]);
const total = ref(0);
const page = ref(1);

const totalPages = computed(() =>
  Math.max(1, Math.ceil(total.value / PAGE_SIZE)),
);

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

async function ensureToken(): Promise<string> {
  let token = readToken();
  if (token) return token;
  const login = await loginPlatform({
    username: username.value.trim(),
    password: password.value,
  });
  token = login.access_token;
  writeToken(token);
  password.value = "";
  return token;
}

async function loadPage(p: number, opts?: { allowTokenOnly?: boolean }) {
  if (loading.value) return;
  if (!opts?.allowTokenOnly && !readToken() && (!username.value.trim() || !password.value)) {
    return;
  }
  error.value = "";
  loading.value = true;
  try {
    const token = await ensureToken();
    password.value = "";
    const data = await listPlatformTopups(token, p, PAGE_SIZE);
    items.value = data.items;
    total.value = data.total;
    page.value = data.page || p;
    if (items.value.length === 0 && p === 1) {
      error.value = "账号下没有充值记录";
    }
  } catch (e) {
    const err = e as ApiError;
    if (err.status === 401 || err.code === "platform_token_invalid") {
      writeToken("");
      error.value = "平台登录已失效——请重新输入密码";
    } else {
      error.value = err.message || "拉取失败";
    }
    items.value = [];
    password.value = "";
  } finally {
    loading.value = false;
  }
}

async function onLogin() {
  if (!username.value.trim() || !password.value || loading.value) return;
  await loadPage(1);
}

function isRegistered(t: PlatformTopup): boolean {
  return (props.registeredIds ?? []).includes(t.id);
}

function onUse(t: PlatformTopup) {
  if (isRegistered(t)) return;
  const sec = t.complete_time ?? t.create_time ?? Math.floor(Date.now() / 1000);
  emit("select", {
    ...t,
    paid_at_iso: new Date(sec * 1000).toISOString(),
  });
  emit("update:open", false);
}

watch(
  () => props.open,
  (v) => {
    if (v) {
      // 每次打开重拉第一页（有 token 则免再输密码）
      if (readToken()) void loadPage(1, { allowTokenOnly: true });
    } else {
      items.value = [];
      total.value = 0;
      page.value = 1;
      error.value = "";
      password.value = "";
    }
  },
);
</script>

<template>
  <a-modal
    :open="open"
    title="从平台选择充值"
    :footer="null"
    :width="560"
    centered
    :styles="{ body: { maxHeight: '70vh', overflowY: 'auto' } }"
    destroy-on-hidden
    @update:open="emit('update:open', $event)"
  >
    <template v-if="items.length === 0 && !loading">
      <p class="top-pick__hint">
        登录 NewAPI 控制台拉取充值单（传统分页）；密码不保存。
      </p>
      <a-form layout="vertical" @finish="onLogin">
        <a-form-item label="账号">
          <a-input v-model:value="username" autocomplete="username" />
        </a-form-item>
        <a-form-item label="密码">
          <a-input-password
            v-model:value="password"
            autocomplete="current-password"
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
      <div class="top-pick__list">
        <div
          v-for="t in items"
          :key="t.id"
          class="top-pick__item"
          :class="{ 'is-registered': isRegistered(t) }"
          @click="onUse(t)"
        >
          <div class="top-pick__head">
            <strong>
              {{ formatDateTime(t.complete_time ?? t.create_time) }}
            </strong>
            <span class="top-pick__status">
              {{ isRegistered(t) ? "已登记" : t.status || "" }}
            </span>
          </div>
          <div class="top-pick__meta">
            amount {{ t.amount }} · money {{ t.money }}
            <template v-if="t.trade_no"> · {{ t.trade_no }}</template>
          </div>
        </div>
      </div>
      <div class="top-pick__pager">
        <a-pagination
          :current="page"
          :page-size="PAGE_SIZE"
          :total="total"
          size="small"
          :show-total="(t: number) => `共 ${t} 条`"
          @change="(p: number) => loadPage(p)"
        />
      </div>
      <a-alert
        v-if="error"
        type="warning"
        show-icon
        :message="error"
        style="margin-top: 8px"
      />
    </template>
  </a-modal>
</template>

<style scoped>
.top-pick__hint {
  margin: 0 0 16px;
  font-size: 12px;
  line-height: 20px;
  color: rgba(0, 0, 0, 0.45);
}

.top-pick__list {
  max-height: 360px;
  overflow-y: auto;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
}

.top-pick__item {
  padding: 12px 16px;
  cursor: pointer;
  border-bottom: 1px solid #f0f0f0;
}

.top-pick__item:hover {
  background: #fafafa;
}

.top-pick__item.is-registered {
  opacity: 0.45;
  cursor: not-allowed;
}

.top-pick__item.is-registered:hover {
  background: transparent;
}

.top-pick__item:last-child {
  border-bottom: none;
}

.top-pick__head {
  display: flex;
  justify-content: space-between;
  align-items: baseline;
  margin-bottom: 4px;
}

.top-pick__status {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}

.top-pick__meta {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.65);
  font-variant-numeric: tabular-nums;
}

.top-pick__pager {
  display: flex;
  justify-content: center;
  margin-top: 12px;
}
</style>
