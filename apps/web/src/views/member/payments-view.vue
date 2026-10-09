<script setup lang="ts">
/**
 * 成员支付参数（交互设计-成员视图 §5）：订阅 + 充值清单
 */
import { computed } from "vue";
import PageHeader from "@/components/common/page-header.vue";
import TimeRangePicker from "@/components/common/time-range-picker.vue";
import QuotaText from "@/components/common/quota-text.vue";
import { useMemberRange } from "@/composables/use-member-range.ts";
import { useMemberOverview } from "@/queries/member.ts";
import { formatDateTime } from "@/utils/time.ts";
import { formatPaidAmount } from "@/utils/format.ts";

const { range, onRangeChange } = useMemberRange();
const overviewQuery = useMemberOverview(() => range.value);
const subs = computed(() => overviewQuery.data.value?.subscriptions ?? []);
const tops = computed(() => overviewQuery.data.value?.topups ?? []);

const extraPresets = computed(() =>
  subs.value
    .map((p) => ({
      label: `订阅 #${p.subscription_id} 期间`,
      from: new Date((p.period_start ?? 0) * 1000).toISOString(),
      to: new Date(
        (p.period_end ?? Math.floor(Date.now() / 1000)) * 1000,
      ).toISOString(),
    }))
    .slice(0, 4),
);

function periodText(p: {
  period_start: number;
  period_end: number | null;
}): string {
  const end = p.period_end == null ? "进行中" : formatDateTime(p.period_end);
  return `${formatDateTime(p.period_start)} ~ ${end}`;
}

const subColumns = [
  { title: "订阅 ID", key: "subscription_id", width: 100 },
  { title: "期间", key: "period", width: 200 },
  { title: "额度", key: "quota", width: 160 },
  { title: "付款", key: "paid", width: 140 },
  { title: "备注", key: "remark" },
];

const topColumns = [
  { title: "时间", key: "paid_at", width: 150 },
  { title: "计费单位 / 实付", key: "money", width: 140 },
  { title: "交易号 / 渠道", key: "trade", width: 180 },
  { title: "派生额度", key: "quota", width: 150 },
  { title: "备注", key: "remark" },
];
</script>

<template>
  <section>
    <PageHeader
      title="支付参数"
      subtitle="订阅与充值的登记参数 · 对成员完全公开"
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

    <a-alert
      v-if="overviewQuery.isError.value"
      type="error"
      show-icon
      message="支付参数加载失败"
      :description="overviewQuery.error.value?.message"
      style="margin-bottom: 16px"
    >
      <template #action>
        <a-button size="small" @click="() => overviewQuery.refetch()">重试</a-button>
      </template>
    </a-alert>

    <a-skeleton
      v-if="overviewQuery.isPending.value"
      active
      :paragraph="{ rows: 4 }"
    />
    <a-empty
      v-else-if="!overviewQuery.isError.value && subs.length === 0 && tops.length === 0"
      description="暂无支付记录信息"
    />
    <template v-else>
      <h3 class="mv-sec">订阅</h3>
      <a-empty v-if="subs.length === 0" description="暂无订阅登记" />
      <a-table
        v-else
        :columns="subColumns"
        :data-source="subs"
        :row-key="(r: { id: number }) => r.id"
        size="middle"
        :pagination="false"
        :scroll="{ x: 800 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'period'">
            {{ periodText(record) }}
          </template>
          <template v-else-if="column.key === 'quota'">
            <QuotaText :quota="record.quota_granted" :quota-usd="record.quota_usd" />
          </template>
          <template v-else-if="column.key === 'paid'">
            {{
              record.paid_amount != null
                ? `${formatPaidAmount(record.paid_amount)} · ${formatDateTime(record.paid_at)}`
                : "—"
            }}
          </template>
          <template v-else-if="column.key === 'remark'">
            {{ record.remark || "—" }}
          </template>
        </template>
      </a-table>

      <h3 class="mv-sec">充值</h3>
      <a-empty v-if="tops.length === 0" description="暂无充值登记" />
      <a-table
        v-else
        :columns="topColumns"
        :data-source="tops"
        :row-key="(r: { id: number }) => r.id"
        size="middle"
        :pagination="false"
        :scroll="{ x: 760 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'paid_at'">
            {{ formatDateTime(record.paid_at) }}
          </template>
          <template v-else-if="column.key === 'money'">
            {{ record.amount }} · {{ formatPaidAmount(record.money) }}
          </template>
          <template v-else-if="column.key === 'trade'">
            {{ record.trade_no || "—" }}
            <span v-if="record.payment_method" class="mv-note">
              · {{ record.payment_method }}
            </span>
          </template>
          <template v-else-if="column.key === 'quota'">
            <QuotaText :quota="record.quota_derived" :quota-usd="record.quota_usd" />
          </template>
          <template v-else-if="column.key === 'remark'">
            {{ record.remark || "—" }}
          </template>
        </template>
      </a-table>

      <div class="mv-foot">
        支付参数对成员完全公开；币种由成员与作者约定
      </div>
    </template>
  </section>
</template>

<style scoped>
.mv-range-label {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.65);
}

.mv-sec {
  margin: 20px 0 12px;
  font-size: 14px;
  font-weight: 600;
}

.mv-note {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}

.mv-foot {
  margin-top: 16px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
</style>
