<script setup lang="ts">
/**
 * 管理面调用日志（交互设计-调用日志）：筛选 + 明细表 + 与 key/成员跳转
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import type { LogItem } from "@new-api-key-usage/core";
import { useRoute, useRouter } from "vue-router";
import PageHeader from "@/components/common/page-header.vue";
import TimeRangePicker from "@/components/common/time-range-picker.vue";
import QuotaText from "@/components/common/quota-text.vue";
import { useLiveTimeRange } from "@/composables/use-live-time-range.ts";
import { useAdminLogs, useKeys, useMembers } from "@/queries/admin.ts";
import { formatDateTime, recentDaysRange } from "@/utils/time.ts";
import { formatInt } from "@/utils/format.ts";

const route = useRoute();
const router = useRouter();
const { range, setRange } = useLiveTimeRange("recent-30");

const memberId = ref<number | "unassigned" | null>(null);
const apiKeyId = ref<number | null>(null);
const billingSource = ref<string | null>(null);
const subscriptionId = ref<number | null>(null);
const typeFilter = ref<number | "error" | null>(null);
const page = ref(1);
const pageSize = ref(50);

const membersQuery = useMembers();
const keysQuery = useKeys(() => ({}));

const keyById = computed(() => {
  const m = new Map<number, { token_name: string; member_id: number | null; member_name: string | null }>();
  for (const k of keysQuery.data.value ?? []) {
    m.set(k.id, {
      token_name: k.token_name,
      member_id: k.member_id,
      member_name: k.member_name,
    });
  }
  return m;
});

const params = computed(() => ({
  ...range.value,
  page: page.value,
  page_size: pageSize.value,
  api_key_id: apiKeyId.value ?? undefined,
  member_id: memberId.value ?? undefined,
  billing_source: billingSource.value ?? undefined,
  subscription_id: subscriptionId.value ?? undefined,
  type: typeFilter.value ?? undefined,
}));

const logsQuery = useAdminLogs(() => params.value);
const rows = computed(() => logsQuery.data.value?.items ?? []);
const total = computed(() => logsQuery.data.value?.total ?? 0);

const memberOptions = computed(() => [
  { value: null, label: "全部成员" },
  { value: "unassigned", label: "未归属" },
  ...(membersQuery.data.value ?? []).map((m) => ({ value: m.id, label: m.name })),
]);

const keyOptions = computed(() => [
  { value: null, label: "全部 Key" },
  ...(keysQuery.data.value ?? []).map((k) => ({
    value: k.id,
    label: k.token_name,
  })),
]);

const columns = [
  { title: "时间", key: "created_at", width: 150 },
  { title: "Key", key: "token_name", width: 120 },
  { title: "归属", key: "member_name", width: 110 },
  { title: "模型", key: "model_name", dataIndex: "model_name", width: 110 },
  { title: "类型", key: "type", width: 80 },
  { title: "来源", key: "source", width: 110 },
  { title: "用量", key: "usage", width: 140 },
  { title: "Tokens", key: "tokens", width: 110 },
];

function syncFromRoute() {
  const q = route.query;
  const m = q.member_id;
  if (m === "unassigned") memberId.value = "unassigned";
  else if (typeof m === "string" && m) memberId.value = Number(m);
  const k = q.api_key_id ?? q.key_id;
  if (typeof k === "string" && k) apiKeyId.value = Number(k);
  if (typeof q.billing_source === "string" && q.billing_source) {
    billingSource.value = q.billing_source;
  }
  const s = q.subscription_id;
  if (typeof s === "string" && s) subscriptionId.value = Number(s);
  const t = q.type;
  if (t === "2") typeFilter.value = 2;
  else if (t === "error") typeFilter.value = "error";
  else typeFilter.value = null;
  const p = q.page;
  if (typeof p === "string" && p) page.value = Number(p) || 1;
  const from = q.from;
  const to = q.to;
  if (typeof from === "string" && from && typeof to === "string" && to) {
    setRange({ from, to }, "fixed");
  }
}

function pushQuery() {
  const query: Record<string, string> = {
    from: range.value.from,
    to: range.value.to,
  };
  if (memberId.value === "unassigned") query.member_id = "unassigned";
  else if (memberId.value != null) query.member_id = String(memberId.value);
  if (apiKeyId.value != null) query.api_key_id = String(apiKeyId.value);
  if (billingSource.value) query.billing_source = billingSource.value;
  if (subscriptionId.value != null) {
    query.subscription_id = String(subscriptionId.value);
  }
  if (typeFilter.value) query.type = String(typeFilter.value);
  if (page.value > 1) query.page = String(page.value);
  void router.replace({ path: "/admin/logs", query });
}

syncFromRoute();
watch(
  () => route.query,
  () => syncFromRoute(),
);
watch(
  [memberId, apiKeyId, billingSource, subscriptionId, typeFilter],
  () => {
    page.value = 1;
    pushQuery();
  },
);
watch(page, () => pushQuery());

function sourceBadge(record: LogItem) {
  if (record.billing_source === "subscription" && record.subscription_id != null) {
    return { text: `订阅 #${record.subscription_id}`, color: "blue" as const };
  }
  if (record.billing_source === "wallet") {
    return { text: "充值", color: "gold" as const };
  }
  return { text: "未关联", color: undefined };
}

function goKey(keyId: number) {
  void router.push({ path: "/admin/keys", query: { key_id: String(keyId) } });
}

function goMember(memberId: number | null) {
  if (memberId == null) return;
  void router.push({
    path: "/admin/members",
    query: { member_id: String(memberId) },
  });
}

let ro: ResizeObserver | null = null;
const boxRef = ref<HTMLElement | null>(null);
const bodyY = ref(480);
const CHROME = 96;

function measure() {
  const h = boxRef.value?.clientHeight ?? 0;
  if (h > 0) bodyY.value = Math.max(200, h - CHROME);
}

onMounted(() => {
  measure();
  if (typeof ResizeObserver !== "undefined" && boxRef.value) {
    ro = new ResizeObserver(() => measure());
    ro.observe(boxRef.value);
  }
  window.addEventListener("resize", measure);
});

onUnmounted(() => {
  ro?.disconnect();
  window.removeEventListener("resize", measure);
});
</script>

<template>
  <section class="call-logs">
    <PageHeader title="调用日志" subtitle="全池模型请求查询与筛选">
      <template #actions>
        <span class="call-logs__label">时间范围</span>
        <TimeRangePicker
          :model-value="range"
          @change="
            (v, k) => {
              setRange(v, k);
              page = 1;
              pushQuery();
            }
          "
        />
      </template>
    </PageHeader>

    <div class="call-logs__filters">
      <a-select
        v-model:value="memberId"
        :options="memberOptions"
        style="width: 140px"
        allow-clear
        placeholder="成员"
      />
      <a-select
        v-model:value="apiKeyId"
        :options="keyOptions"
        style="width: 160px"
        allow-clear
        placeholder="Key"
        show-search
        option-filter-prop="label"
      />
      <a-select
        v-model:value="billingSource"
        :options="[
          { value: null, label: '全部来源' },
          { value: 'subscription', label: '订阅' },
          { value: 'wallet', label: '充值' },
          { value: 'none', label: '未关联' },
        ]"
        style="width: 120px"
        allow-clear
        placeholder="来源"
      />
      <a-input-number
        v-model:value="subscriptionId"
        :min="1"
        :precision="0"
        style="width: 120px"
        placeholder="订阅 ID"
      />
      <a-select
        v-model:value="typeFilter"
        :options="[
          { value: null, label: '全部类型' },
          { value: 2, label: '消费' },
          { value: 'error', label: '错误' },
        ]"
        style="width: 120px"
        placeholder="类型"
      />
    </div>

    <a-empty
      v-if="!logsQuery.isPending.value && rows.length === 0"
      description="该时段内无调用日志"
    />
    <div v-else ref="boxRef" class="call-logs__box">
      <a-table
        :columns="columns"
        :data-source="rows"
        :row-key="(r: LogItem) => r.id"
        :loading="logsQuery.isPending.value || logsQuery.isFetching.value"
        :pagination="{
          current: page,
          pageSize,
          total,
          showSizeChanger: true,
          pageSizeOptions: ['20', '50', '100', '200'],
          showTotal: (t: number) => `共 ${t} 条`,
          onChange: (p: number, ps: number) => {
            page = p;
            pageSize = ps;
          },
        }"
        size="middle"
        :scroll="{ y: bodyY }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'created_at'">
            {{ formatDateTime(record.created_at) }}
          </template>
          <template v-else-if="column.key === 'token_name'">
            <a @click="goKey(record.api_key_id)">{{ record.token_name }}</a>
          </template>
          <template v-else-if="column.key === 'member_name'">
            <a
              v-if="keyById.get(record.api_key_id)?.member_id != null"
              @click="goMember(keyById.get(record.api_key_id)!.member_id)"
            >
              {{ keyById.get(record.api_key_id)?.member_name ?? "成员" }}
            </a>
            <span v-else>未归属</span>
          </template>
          <template v-else-if="column.key === 'type'">
            <a-tag :color="record.type === 2 ? 'blue' : 'red'">
              {{ record.type === 2 ? "消费" : "错误" }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'source'">
            <a-tag :color="sourceBadge(record).color">
              {{ sourceBadge(record).text }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'usage'">
            <QuotaText :quota="record.quota" :quota-usd="record.quota_usd" />
          </template>
          <template v-else-if="column.key === 'tokens'">
            {{ formatInt(record.prompt_tokens) }} / {{ formatInt(record.completion_tokens) }}
          </template>
        </template>
      </a-table>
    </div>
  </section>
</template>

<style scoped>
.call-logs {
  height: calc(100vh - 64px - 48px - 48px);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.call-logs__label {
  font-size: 13px;
  line-height: 32px;
  color: rgba(0, 0, 0, 0.65);
}

.call-logs__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.call-logs__box {
  flex: 1;
  min-height: 0;
}
</style>
