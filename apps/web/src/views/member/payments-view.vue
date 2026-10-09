<script setup lang="ts">
/**
 * 成员支付参数（交互设计-成员视图 §5）：完全公开的登记参数表
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
const payments = computed(() => overviewQuery.data.value?.payments ?? []);

const extraPresets = computed(() =>
  payments.value
    .filter((p) => p.kind === "subscription" && p.period_start != null)
    .map((p) => ({
      label: `订阅 #${p.subscription_id ?? p.id} 期间`,
      from: new Date((p.period_start ?? 0) * 1000).toISOString(),
      to: new Date((p.period_end ?? Math.floor(Date.now() / 1000)) * 1000).toISOString(),
    }))
    .slice(0, 4),
);

function periodText(p: { kind: string; paid_at: number; period_start: number | null; period_end: number | null }): string {
  if (p.kind !== "subscription") return "—";
  const end = p.period_end == null ? "进行中" : formatDateTime(p.period_end);
  return `${formatDateTime(p.period_start)} ~ ${end}`;
}

const columns = [
  { title: "类型", key: "kind", width: 80 },
  { title: "编号 / 时间", key: "id_or_time", width: 160 },
  { title: "期间", key: "period", width: 220 },
  { title: "额度", key: "quota", width: 160 },
  { title: "金额", key: "amount", width: 100 },
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
      v-else-if="!overviewQuery.isError.value && payments.length === 0"
      description="暂无支付记录信息"
    />
    <template v-else-if="payments.length > 0">
      <a-table
        :columns="columns"
        :data-source="payments"
        :row-key="(r: { id: number }) => r.id"
        size="middle"
        :pagination="false"
        :scroll="{ x: 860 }"
        :loading="overviewQuery.isFetching.value"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'kind'">
            <a-tag :color="record.kind === 'subscription' ? 'blue' : 'gold'">
              {{ record.kind === "subscription" ? "订阅" : "充值" }}
            </a-tag>
          </template>
          <template v-else-if="column.key === 'id_or_time'">
            <template v-if="record.kind === 'subscription'">
              订阅 #{{ record.subscription_id ?? record.id }}
            </template>
            <template v-else>
              {{ formatDateTime(record.paid_at) }}
            </template>
          </template>
          <template v-else-if="column.key === 'period'">
            {{ periodText(record) }}
          </template>
          <template v-else-if="column.key === 'quota'">
            <QuotaText
              v-if="record.quota_granted != null"
              :quota="record.quota_granted"
              :quota-usd="record.quota_usd"
            />
            <span v-else>—</span>
          </template>
          <template v-else-if="column.key === 'amount'">
            {{ formatPaidAmount(record.paid_amount) }}
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

.mv-foot {
  margin-top: 16px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
</style>
