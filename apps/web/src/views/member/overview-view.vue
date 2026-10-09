<script setup lang="ts">
/**
 * 成员总览（交互设计-成员视图 §3）：紧凑摘要 + 我的 Key 表 + 支付入口
 */
import { computed } from "vue";
import { useRouter } from "vue-router";
import PageHeader from "@/components/common/page-header.vue";
import TimeRangePicker from "@/components/common/time-range-picker.vue";
import SourceBar from "@/components/common/source-bar.vue";
import QuotaText from "@/components/common/quota-text.vue";
import { useMemberRange } from "@/composables/use-member-range.ts";
import { useMemberOverview } from "@/queries/member.ts";
import { formatMinute, formatRangeCaption, hoursSince } from "@/utils/time.ts";
import { formatInt } from "@/utils/format.ts";

const router = useRouter();
const { range, onRangeChange } = useMemberRange();
const overviewQuery = useMemberOverview(() => range.value);

const usage = computed(() => overviewQuery.data.value?.usage);
const bySource = computed(() => overviewQuery.data.value?.by_source ?? []);
const keys = computed(() => overviewQuery.data.value?.keys ?? []);
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

const rangeCaption = computed(() =>
  formatRangeCaption(range.value.from, range.value.to),
);

function isStalled(at: number | null | undefined): boolean {
  const h = hoursSince(at);
  return h != null && h > 2;
}

function goLogs(keyId?: number) {
  const query: Record<string, string> = {
    from: range.value.from,
    to: range.value.to,
  };
  if (keyId != null) query.api_key_id = String(keyId);
  void router.push({ path: "/member/logs", query });
}

const keyColumns = [
  { title: "Key 名称", dataIndex: "token_name", key: "token_name" },
  {
    title: "数据截止",
    key: "data_cutoff",
  },
  { title: "调用次数", key: "count" },
  { title: "额度消耗", key: "usage" },
  { title: "", key: "actions", width: 80 },
];
</script>

<template>
  <section>
    <PageHeader title="总览" subtitle="你在本池的名下用量 · 仅统计消费行">
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
      message="总览数据加载失败"
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
      style="margin-bottom: 24px"
    />
    <a-empty
      v-else-if="!overviewQuery.isError.value && keys.length === 0"
      description="作者尚未为你分配 key"
      style="margin-bottom: 24px"
    />

    <template v-else-if="keys.length > 0">
      <section class="mv-block">
        <h2 class="mv-block__title">
          用量摘要
          <span class="mv-caption">{{ rangeCaption }}</span>
        </h2>
        <div class="mv-summary">
          <div class="mv-summary__main">
            <QuotaText
              v-if="usage"
              :quota="usage.quota"
              :quota-usd="usage.quota_usd"
            />
            <div class="mv-summary__sub">
              调用 {{ formatInt(usage?.count ?? 0) }} 次 · 按当时换算率
              <span v-if="usage && usage.count === 0" class="mv-note">· 该时段内无调用</span>
            </div>
          </div>
          <SourceBar :rows="bySource" />
        </div>
      </section>

      <section class="mv-block">
        <h2 class="mv-block__title">我的 Key</h2>
        <a-table
          :columns="keyColumns"
          :data-source="keys"
          :row-key="(r: { key_id: number }) => r.key_id"
          size="middle"
          :pagination="false"
          :scroll="{ x: 720 }"
          :loading="overviewQuery.isFetching.value"
        >
          <template #bodyCell="{ column, record }">
            <template v-if="column.key === 'data_cutoff'">
              <span
                v-if="record.log_synced_at == null"
                class="mv-syncing"
              >同步中…</span>
              <span
                v-else
                :class="{ 'is-stall': isStalled(record.log_synced_at) }"
              >
                {{ isStalled(record.log_synced_at) ? "同步停滞 " : "同步 " }}{{ formatMinute(record.log_synced_at) }}
              </span>
            </template>
            <template v-else-if="column.key === 'count'">
              {{ formatInt(record.usage.count) }}
            </template>
            <template v-else-if="column.key === 'usage'">
              <QuotaText :quota="record.usage.quota" :quota-usd="record.usage.quota_usd" />
            </template>
            <template v-else-if="column.key === 'actions'">
              <a-button size="small" @click="() => goLogs(record.key_id)">查调用</a-button>
            </template>
          </template>
        </a-table>
      </section>

      <section class="mv-block">
        <h2 class="mv-block__title">支付参数</h2>
        <div class="mv-pay-entry">
          <span v-if="payments.length === 0" class="mv-note">暂无支付记录信息</span>
          <span v-else class="mv-note">
            该时段涉及 {{ payments.length }} 笔登记参数（订阅 / 充值）
          </span>
          <a @click="() => router.push('/member/payments')">查看完整参数</a>
        </div>
      </section>
    </template>
  </section>
</template>

<style scoped>
.mv-range-label {
  font-size: 13px;
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

.mv-caption {
  margin-left: 8px;
  font-size: 12px;
  font-weight: 400;
  color: rgba(0, 0, 0, 0.45);
}

.mv-syncing {
  color: rgba(0, 0, 0, 0.45);
}

.mv-summary {
  display: flex;
  flex-direction: column;
  gap: 16px;
  padding: 16px;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
}

.mv-summary__sub {
  margin-top: 4px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}

.mv-note {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}

.mv-pay-entry {
  display: flex;
  align-items: center;
  gap: 16px;
}

.is-stall {
  color: #faad14;
}
</style>
