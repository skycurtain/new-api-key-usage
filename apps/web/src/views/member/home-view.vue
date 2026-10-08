<script setup lang="ts">
/**
 * 成员视图单页（交互设计-成员视图）：聚合 · 支付参数 · 我的 key · 日志徽章展开
 */
import { computed, ref, watch } from "vue";
import type { LogItem, PaymentItem } from "@new-api-key-usage/core";
import PageHeader from "@/components/common/page-header.vue";
import TimeRangePicker from "@/components/common/time-range-picker.vue";
import QuotaText from "@/components/common/quota-text.vue";
import SourceBar from "@/components/common/source-bar.vue";
import { useLiveTimeRange } from "@/composables/use-live-time-range.ts";
import { useMemberLogs, useMemberOverview, useMemberMe } from "@/queries/member.ts";
import { formatDateTime, formatMinute, hoursSince } from "@/utils/time.ts";
import { formatInt } from "@/utils/format.ts";

const { range, setRange } = useLiveTimeRange("recent-30");
const meQuery = useMemberMe();
const overviewQuery = useMemberOverview(() => range.value);
const page = ref(1);
const pageSize = ref(50);

const logsQuery = useMemberLogs(() => ({
  ...range.value,
  page: page.value,
  page_size: pageSize.value,
}));

const overview = computed(() => overviewQuery.data.value);
const me = computed(() => overview.value?.member ?? meQuery.data.value ?? null);
const usage = computed(() => overview.value?.usage);
const bySource = computed(() => overview.value?.by_source ?? []);
const keys = computed(() => overview.value?.keys ?? []);
const payments = computed(() => overview.value?.payments ?? []);

const extraPresets = computed(() =>
  payments.value
    .filter((p) => p.kind === "subscription" && p.period_start != null)
    .map((p) => ({
      label: `订阅 #${p.subscription_id ?? p.id} 期间`,
      from: new Date((p.period_start ?? 0) * 1000).toISOString(),
      to: new Date(
        (p.period_end ?? Math.floor(Date.now() / 1000)) * 1000,
      ).toISOString(),
    }))
    .slice(0, 4),
);

const paymentBySub = computed(() => {
  const m = new Map<number, PaymentItem>();
  for (const p of payments.value) {
    if (p.subscription_id != null) m.set(p.subscription_id, p);
  }
  return m;
});

const logs = computed(() => logsQuery.data.value?.items ?? []);
const logTotal = computed(() => logsQuery.data.value?.total ?? 0);

const expandedRowKeys = ref<number[]>([]);

const logColumns = [
  { title: "时间", key: "created_at", width: 150 },
  { title: "Key", key: "token_name", width: 120 },
  { title: "模型", key: "model_name", width: 120 },
  { title: "来源", key: "source", width: 120 },
  { title: "用量", key: "usage", width: 150 },
  { title: "Tokens", key: "tokens", width: 110 },
];

watch(range, () => {
  page.value = 1;
  expandedRowKeys.value = [];
});

function isStalled(at: number | null | undefined): boolean {
  const h = hoursSince(at);
  return h != null && h > 2;
}

function sourceBadge(record: LogItem) {
  if (record.billing_source === "subscription" && record.subscription_id != null) {
    return { text: `订阅 #${record.subscription_id}`, kind: "sub" as const, id: record.subscription_id };
  }
  if (record.billing_source === "wallet") {
    return { text: "充值", kind: "wallet" as const, id: null };
  }
  return { text: "未关联", kind: "none" as const, id: null };
}

function onBadge(record: LogItem) {
  const b = sourceBadge(record);
  if (b.kind !== "sub") return;
  const i = expandedRowKeys.value.indexOf(record.id);
  if (i >= 0) expandedRowKeys.value.splice(i, 1);
  else expandedRowKeys.value.push(record.id);
}

function paymentText(p: PaymentItem | undefined): string {
  if (!p) return "该订阅无登记信息";
  const period =
    p.kind === "subscription"
      ? `${formatDateTime(p.period_start)} ~ ${p.period_end == null ? "进行中" : formatDateTime(p.period_end)}`
      : formatDateTime(p.paid_at);
  return `${period} · 订阅 #${p.subscription_id ?? p.id} · 额度 ${formatInt(p.quota_granted)} ($${p.quota_usd}) · 金额 ${p.paid_amount}${p.remark ? ` · ${p.remark}` : ""}`;
}

function onRangeChange(v: { from: string; to: string }, kind: "recent-7" | "recent-30" | "fixed") {
  setRange(v, kind);
}

function onExpand(expanded: boolean, record: LogItem) {
  const i = expandedRowKeys.value.indexOf(record.id);
  if (expanded && i < 0) expandedRowKeys.value.push(record.id);
  if (!expanded && i >= 0) expandedRowKeys.value.splice(i, 1);
}
</script>

<template>
  <section>
    <PageHeader
      :title="me?.name ? `${me.name}` : '我的用量'"
      subtitle="你在本池的名下用量"
    >
      <template #actions>
        <span class="mv-range-label">时间范围</span>
        <TimeRangePicker
          :model-value="range"
          :extra-presets="extraPresets"
          @change="onRangeChange"
        />
      </template>
    </PageHeader>

    <a-skeleton
      v-if="overviewQuery.isPending.value"
      active
      :paragraph="{ rows: 4 }"
    />

    <a-empty
      v-else-if="keys.length === 0"
      description="作者尚未为你分配 key"
    />

    <template v-else>
      <section class="mv-block">
        <h2 class="mv-block__title">总用量</h2>
        <template v-if="usage && usage.count > 0">
          <div class="mv-agg">
            <span>调用 {{ formatInt(usage.count) }} 次</span>
            <QuotaText :quota="usage.quota" :quota-usd="usage.quota_usd" />
            <span class="mv-note">按当时换算率</span>
          </div>
          <SourceBar :rows="bySource" />
        </template>
        <div v-else class="mv-empty">该时段内无调用</div>
      </section>

      <section class="mv-block">
        <h2 class="mv-block__title">支付参数</h2>
        <div v-if="payments.length === 0" class="mv-empty">暂无支付记录信息</div>
        <template v-else>
          <div
            v-for="p in payments"
            :key="p.id"
            class="mv-pay"
          >
            <a-tag :color="p.kind === 'subscription' ? 'blue' : 'gold'">
              {{ p.kind === "subscription" ? "订阅" : "充值" }}
            </a-tag>
            <template v-if="p.kind === 'subscription'">
              <span>
                {{ formatDateTime(p.period_start) }} ~
                {{ p.period_end == null ? "进行中" : formatDateTime(p.period_end) }}
                · 订阅 #{{ p.subscription_id }}
              </span>
            </template>
            <template v-else>
              <span>支付于 {{ formatDateTime(p.paid_at) }}</span>
            </template>
            <QuotaText :quota="p.quota_granted" :quota-usd="p.quota_usd" />
            <span>金额 {{ p.paid_amount }}</span>
            <span v-if="p.remark" class="mv-note">{{ p.remark }}</span>
          </div>
          <div class="mv-note mv-foot">
            支付参数对成员完全公开；币种由成员与作者约定
          </div>
        </template>
      </section>

      <section class="mv-block">
        <h2 class="mv-block__title">我的 key</h2>
        <div class="mv-keys">
          <div v-for="k in keys" :key="k.key_id" class="mv-key">
            <strong>{{ k.token_name }}</strong>
            <span v-if="isStalled(k.log_synced_at)" class="mv-stall">
              截止 {{ formatMinute(k.log_synced_at) }} 停滞
            </span>
            <span v-else class="mv-note">截止 {{ formatMinute(k.log_synced_at) }}</span>
            <span>调用 {{ formatInt(k.usage.count) }} 次</span>
            <QuotaText :quota="k.usage.quota" :quota-usd="k.usage.quota_usd" />
          </div>
        </div>
      </section>

      <section class="mv-block">
        <h2 class="mv-block__title">日志明细</h2>
        <a-table
          :columns="logColumns"
          :data-source="logs"
          :row-key="(r: LogItem) => r.id"
          :loading="logsQuery.isPending.value || logsQuery.isFetching.value"
          :pagination="{
            current: page,
            pageSize,
            total: logTotal,
            showSizeChanger: true,
            pageSizeOptions: ['20', '50', '100'],
            onChange: (p: number, ps: number) => {
              page = p;
              pageSize = ps;
            },
          }"
          size="middle"
          :scroll="{ x: 800 }"
          :expanded-row-keys="expandedRowKeys"
          :expand-column-width="24"
          :expandable="{
            showExpandColumn: false,
            rowExpandable: (r: LogItem) => sourceBadge(r).kind === 'sub',
          }"
          @expand="onExpand"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'created_at'">
              {{ formatDateTime(record.created_at) }}
            </template>
            <template v-else-if="column.key === 'usage'">
              <QuotaText :quota="record.quota" :quota-usd="record.quota_usd" />
            </template>
            <template v-else-if="column.key === 'tokens'">
              {{ formatInt(record.prompt_tokens) }} / {{ formatInt(record.completion_tokens) }}
            </template>
            <template v-else-if="column.key === 'source'">
              <a-tooltip
                v-if="sourceBadge(record).kind === 'sub'"
                title="点击查看该订阅支付参数"
              >
                <a-tag
                  color="blue"
                  class="mv-badge"
                  @click="onBadge(record)"
                >
                  {{ sourceBadge(record).text }}
                </a-tag>
              </a-tooltip>
              <a-tag
                v-else-if="sourceBadge(record).kind === 'wallet'"
                color="gold"
              >
                充值
              </a-tag>
              <a-tag v-else>未关联</a-tag>
            </template>
          </template>
          <template #expandedRowRender="{ record }">
            <div class="mv-expand">
              {{ paymentText(paymentBySub.get(sourceBadge(record).id ?? -1)) }}
            </div>
          </template>
        </a-table>
      </section>
    </template>
  </section>
</template>

<style scoped>
.mv-range-label {
  font-size: 13px;
  line-height: 32px;
  color: rgba(0, 0, 0, 0.65);
}

.mv-block {
  margin-bottom: 24px;
}

.mv-block__title {
  margin: 0 0 12px;
  font-size: 14px;
  font-weight: 600;
  line-height: 22px;
}

.mv-agg {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  gap: 16px;
  margin-bottom: 12px;
  font-variant-numeric: tabular-nums;
}

.mv-note {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}

.mv-foot {
  margin-top: 8px;
}

.mv-empty {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.45);
}

.mv-pay {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 12px;
  padding: 10px 0;
  border-bottom: 1px solid #f0f0f0;
  font-size: 13px;
}

.mv-keys {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(240px, 1fr));
  gap: 12px;
}

.mv-key {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 12px 16px;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  font-size: 13px;
}

.mv-stall {
  color: #d48806;
  font-weight: 600;
}

.mv-badge {
  cursor: pointer;
}

.mv-expand {
  padding: 4px 8px;
  font-size: 13px;
}
</style>
