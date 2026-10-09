<script setup lang="ts">
/**
 * 成员调用日志（交互设计-成员视图 §4）：
 * 行展开 = 模型调用详情；来源徽章 = 订阅支付参数弹窗（R12）
 */
import { computed, h, nextTick, onMounted, onUnmounted, ref, watch } from "vue";
import type { LogItem, PaymentItem } from "@new-api-key-usage/core";
import { Tooltip } from "antdv-next";
import { QuestionCircleOutlined } from "@antdv-next/icons";
import { useRoute, useRouter } from "vue-router";
import PageHeader from "@/components/common/page-header.vue";
import TimeRangePicker from "@/components/common/time-range-picker.vue";
import QuotaText from "@/components/common/quota-text.vue";
import { useMemberRange } from "@/composables/use-member-range.ts";
import { useMemberLogs, useMemberOverview } from "@/queries/member.ts";
import { formatDateTime } from "@/utils/time.ts";
import { formatInt, formatPaidAmount } from "@/utils/format.ts";

const route = useRoute();
const router = useRouter();
const { range, setRange } = useMemberRange();

const apiKeyId = ref<number | null>(null);
const billingSource = ref<string | null>(null);
const subscriptionId = ref<number | null>(null);
const typeFilter = ref<number | "error" | null>(null);
const page = ref(1);
const pageSize = ref(50);

const overviewQuery = useMemberOverview(() => range.value);
const payments = computed(() => overviewQuery.data.value?.payments ?? []);
const keys = computed(() => overviewQuery.data.value?.keys ?? []);

const params = computed(() => ({
  ...range.value,
  page: page.value,
  page_size: pageSize.value,
  api_key_id: apiKeyId.value ?? undefined,
  billing_source: billingSource.value ?? undefined,
  subscription_id: subscriptionId.value ?? undefined,
  type: typeFilter.value ?? undefined,
}));

const logsQuery = useMemberLogs(() => params.value);
const rows = computed(() => logsQuery.data.value?.items ?? []);
const total = computed(() => logsQuery.data.value?.total ?? 0);

const keyOptions = computed(() => [
  { value: null, label: "全部 Key" },
  ...keys.value.map((k) => ({ value: k.key_id, label: k.token_name })),
]);

const paymentBySub = computed(() => {
  const m = new Map<number, PaymentItem>();
  for (const p of payments.value) {
    if (p.subscription_id != null) m.set(p.subscription_id, p);
  }
  return m;
});

function tipTitle(label: string, tip: string) {
  return h("span", { class: "mv-col-title" }, [
    label,
    h(Tooltip, { title: tip }, () => h(QuestionCircleOutlined, { class: "mv-col-title__icon" })),
  ]);
}

const columns = [
  { title: "时间", key: "created_at", width: 150 },
  { title: "Key", key: "token_name", dataIndex: "token_name", width: 120 },
  { title: "模型", key: "model_name", dataIndex: "model_name", width: 120 },
  { title: "类型", key: "type", width: 80 },
  { title: "来源", key: "source", width: 120 },
  {
    title: tipTitle("用量", "quota 原值与按当时换算率折算的美元"),
    key: "usage",
    width: 150,
  },
  { title: "操作", key: "actions", width: 72 },
];

const detailOpen = ref(false);
const detailRecord = ref<LogItem | null>(null);
/** 正在从 URL 灌入状态——避免筛选 watcher 误重置 page */
const applyingRoute = ref(false);

function openDetail(record: LogItem) {
  detailRecord.value = record;
  detailOpen.value = true;
}

function formatRaw(record: LogItem | null): string {
  if (!record) return "";
  return JSON.stringify(record.raw ?? record, null, 2);
}

function sourceBadge(record: LogItem) {
  if (record.billing_source === "subscription" && record.subscription_id != null) {
    return {
      text: `订阅 #${record.subscription_id}`,
      kind: "sub" as const,
      id: record.subscription_id,
    };
  }
  if (record.billing_source === "wallet") {
    return { text: "充值", kind: "wallet" as const, id: null };
  }
  return { text: "未关联", kind: "none" as const, id: null };
}

function onBadge(record: LogItem, e: MouseEvent) {
  e.stopPropagation();
  if (sourceBadge(record).kind !== "sub") return;
  payModalSubId.value = sourceBadge(record).id;
  payModalOpen.value = true;
}

function periodText(p: PaymentItem): string {
  if (p.kind !== "subscription") return formatDateTime(p.paid_at);
  const end = p.period_end == null ? "进行中" : formatDateTime(p.period_end);
  return `${formatDateTime(p.period_start)} ~ ${end}`;
}

const payModalOpen = ref(false);
const payModalSubId = ref<number | null>(null);
const payModalPayment = computed(() =>
  payModalSubId.value == null
    ? undefined
    : paymentBySub.value.get(payModalSubId.value),
);

function syncFromRoute() {
  applyingRoute.value = true;
  const q = route.query;
  const k = q.api_key_id ?? q.key_id;
  apiKeyId.value = typeof k === "string" && k ? Number(k) || null : null;
  billingSource.value =
    typeof q.billing_source === "string" && q.billing_source
      ? q.billing_source
      : null;
  const s = q.subscription_id;
  subscriptionId.value = typeof s === "string" && s ? Number(s) || null : null;
  const t = q.type;
  if (t === "2") typeFilter.value = 2;
  else if (t === "error") typeFilter.value = "error";
  else typeFilter.value = null;
  const p = q.page;
  page.value = typeof p === "string" && p ? Number(p) || 1 : 1;
  void nextTick(() => {
    applyingRoute.value = false;
  });
}

function pushQuery() {
  const query: Record<string, string> = {
    from: range.value.from,
    to: range.value.to,
  };
  if (apiKeyId.value != null) query.api_key_id = String(apiKeyId.value);
  if (billingSource.value) query.billing_source = billingSource.value;
  if (subscriptionId.value != null) {
    query.subscription_id = String(subscriptionId.value);
  }
  if (typeFilter.value) query.type = String(typeFilter.value);
  if (page.value > 1) query.page = String(page.value);
  void router.replace({ path: "/member/logs", query });
}

syncFromRoute();
watch(() => route.query, () => syncFromRoute());
watch([apiKeyId, billingSource, subscriptionId, typeFilter], () => {
  if (applyingRoute.value) return;
  page.value = 1;
  pushQuery();
});
watch(page, () => pushQuery());

function onRangeChange(v: { from: string; to: string }, k: "recent-7" | "recent-30" | "fixed") {
  setRange(v, k);
  page.value = 1;
  pushQuery();
}

function onPageChange(p: number, ps: number) {
  page.value = p;
  pageSize.value = ps;
}

const boxRef = ref<HTMLElement | null>(null);
const bodyY = ref(480);
const CHROME = 96;
let ro: ResizeObserver | null = null;

function measure() {
  const h = boxRef.value?.clientHeight ?? 0;
  if (h > 0) bodyY.value = Math.max(200, h - CHROME);
}

function bindObserve() {
  ro?.disconnect();
  ro = null;
  if (typeof ResizeObserver !== "undefined" && boxRef.value) {
    ro = new ResizeObserver(() => measure());
    ro.observe(boxRef.value);
  }
  measure();
}

onMounted(() => {
  bindObserve();
  window.addEventListener("resize", measure);
});
onUnmounted(() => {
  ro?.disconnect();
  window.removeEventListener("resize", measure);
});
// 空态/有数据切换会重建 box 节点，需重新挂 RO
watch(
  () => rows.value.length === 0 && !logsQuery.isPending.value,
  async () => {
    await nextTick();
    bindObserve();
  },
);
</script>

<template>
  <section class="member-logs">
    <PageHeader title="调用日志" subtitle="名下 key 的模型请求流水">
      <template #actions>
        <span class="member-logs__label">时间范围</span>
        <TimeRangePicker :model-value="range" @change="onRangeChange" />
      </template>
    </PageHeader>

    <div class="member-logs__filters">
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

    <a-alert
      v-if="logsQuery.isError.value"
      type="error"
      show-icon
      message="调用日志加载失败"
      :description="logsQuery.error.value?.message"
      style="margin-bottom: 16px"
    >
      <template #action>
        <a-button size="small" @click="() => logsQuery.refetch()">重试</a-button>
      </template>
    </a-alert>

    <a-empty
      v-if="!logsQuery.isPending.value && !logsQuery.isError.value && rows.length === 0"
      description="该时段内无调用日志"
    />
    <div v-else ref="boxRef" class="member-logs__box">
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
          onChange: onPageChange,
        }"
        size="middle"
        :scroll="{ x: 780, y: bodyY }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'created_at'">
            {{ formatDateTime(record.created_at) }}
          </template>
          <template v-else-if="column.key === 'usage'">
            <QuotaText :quota="record.quota" :quota-usd="record.quota_usd" />
          </template>
          <template v-else-if="column.key === 'type'">
            <a-tag :color="record.type === 2 ? 'blue' : 'red'">
              {{ record.type === 2 ? "消费" : "错误" }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'source'">
            <a-tooltip
              v-if="sourceBadge(record).kind === 'sub'"
              title="点击查看该订阅支付参数"
            >
              <a-tag
                color="blue"
                class="member-logs__badge"
                @click="(e: MouseEvent) => onBadge(record, e)"
              >
                {{ sourceBadge(record).text }}
              </a-tag>
            </a-tooltip>
            <a-tag v-else-if="sourceBadge(record).kind === 'wallet'" color="gold">
              充值
            </a-tag>
            <a-tag v-else>未关联</a-tag>
          </template>
          <template v-else-if="column.key === 'actions'">
            <a @click="openDetail(record)">详情</a>
          </template>
        </template>
      </a-table>
    </div>

    <a-modal
      v-model:open="detailOpen"
      title="调用详情"
      :footer="null"
      width="720"
      centered
      :styles="{ body: { maxHeight: '70vh', overflowY: 'auto' } }"
    >
      <div v-if="detailRecord" class="member-logs__detail">
        <div class="member-logs__kv">
          <span class="member-logs__note">时间</span>
          <span>{{ formatDateTime(detailRecord.created_at) }}</span>
        </div>
        <div class="member-logs__kv">
          <span class="member-logs__note">Key / 模型</span>
          <span>{{ detailRecord.token_name }} · {{ detailRecord.model_name }}</span>
        </div>
        <div class="member-logs__kv">
          <span class="member-logs__note">类型</span>
          <a-tag :color="detailRecord.type === 2 ? 'blue' : 'red'">
            {{ detailRecord.type === 2 ? "消费" : "错误" }}
          </a-tag>
        </div>
        <div class="member-logs__kv">
          <span class="member-logs__note">用量</span>
          <QuotaText :quota="detailRecord.quota" :quota-usd="detailRecord.quota_usd" />
        </div>
        <div class="member-logs__kv">
          <span class="member-logs__note">Tokens</span>
          <span class="member-logs__num">
            提示 {{ formatInt(detailRecord.prompt_tokens) }} · 补全 {{ formatInt(detailRecord.completion_tokens) }}
          </span>
        </div>
        <div class="member-logs__kv">
          <span class="member-logs__note">耗时</span>
          <span class="member-logs__num">
            {{ detailRecord.use_time }}s · {{ detailRecord.is_stream ? "流式" : "非流式" }}
          </span>
        </div>
        <div class="member-logs__kv">
          <span class="member-logs__note">来源</span>
          <a-tag :color="sourceBadge(detailRecord).kind === 'sub' ? 'blue' : sourceBadge(detailRecord).kind === 'wallet' ? 'gold' : undefined">
            {{ sourceBadge(detailRecord).text }}
          </a-tag>
        </div>
        <div v-if="detailRecord.content" class="member-logs__kv">
          <span class="member-logs__note">内容</span>
          <span class="member-logs__content">{{ detailRecord.content }}</span>
        </div>
        <div class="member-logs__raw">
          <div class="member-logs__note">原始数据</div>
          <pre class="member-logs__json">{{ formatRaw(detailRecord) }}</pre>
        </div>
      </div>
    </a-modal>

    <a-modal
      v-model:open="payModalOpen"
      :title="payModalSubId != null ? `订阅 #${payModalSubId} 支付参数` : '支付参数'"
      :footer="null"
      width="480"
      centered
      :styles="{ body: { maxHeight: '56vh', overflowY: 'auto' } }"
    >
      <div v-if="payModalPayment" class="member-logs__pay">
        <div class="member-logs__kv">
          <span class="member-logs__note">期间</span>
          <span>{{ periodText(payModalPayment) }}</span>
        </div>
        <div class="member-logs__kv">
          <span class="member-logs__note">额度</span>
          <QuotaText
            :quota="payModalPayment.quota_granted"
            :quota-usd="payModalPayment.quota_usd"
          />
        </div>
        <div class="member-logs__kv">
          <span class="member-logs__note">金额</span>
          <span class="member-logs__num">{{ formatPaidAmount(payModalPayment.paid_amount) }}</span>
        </div>
        <div v-if="payModalPayment.remark" class="member-logs__kv">
          <span class="member-logs__note">备注</span>
          <span>{{ payModalPayment.remark }}</span>
        </div>
        <div class="member-logs__foot">
          支付参数对成员完全公开；币种由成员与作者约定
        </div>
      </div>
      <div v-else class="member-logs__note">该订阅无登记信息</div>
    </a-modal>
  </section>
</template>

<style scoped>
.member-logs {
  display: flex;
  flex-direction: column;
  height: calc(100vh - 64px - 48px - 48px);
  min-height: 0;
}

.member-logs__label {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.65);
}

.member-logs__filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-bottom: 16px;
}

.member-logs__box {
  flex: 1;
  min-height: 0;
}

.member-logs__badge {
  cursor: pointer;
}

.member-logs__detail {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.member-logs__expand {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 4px 0;
}

.member-logs__pay {
  display: flex;
  flex-direction: column;
  gap: 12px;
}

.member-logs__foot {
  margin-top: 4px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}

.member-logs__kv {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.member-logs__note {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
  min-width: 72px;
}

.member-logs__num {
  font-variant-numeric: tabular-nums;
}

.member-logs__content {
  white-space: pre-wrap;
  word-break: break-all;
  flex: 1;
  min-width: 0;
}

.member-logs__raw {
  margin-top: 4px;
}

.member-logs__json {
  margin: 4px 0 0;
  padding: 12px;
  max-height: 360px;
  overflow: auto;
  background: #fafafa;
  border: 1px solid #f0f0f0;
  border-radius: 6px;
  font-size: 12px;
  line-height: 20px;
  font-family: ui-monospace, "Cascadia Code", Consolas, monospace;
}

.member-logs :deep(.mv-col-title) {
  display: inline-flex;
  align-items: center;
  gap: 4px;
}

.member-logs :deep(.mv-col-title__icon) {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
</style>
