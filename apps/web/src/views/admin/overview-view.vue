<script setup lang="ts">
/**
 * 全员总览（交互设计-全员总览）：健康带 · 时间范围 · 按成员 · 按 key
 */
import { computed, h, ref } from "vue";
import { Tooltip } from "antdv-next";
import { QuestionCircleOutlined } from "@antdv-next/icons";
import { useRouter } from "vue-router";
import PageHeader from "@/components/common/page-header.vue";
import TimeRangePicker from "@/components/common/time-range-picker.vue";
import QuotaText from "@/components/common/quota-text.vue";
import SourceBar from "@/components/common/source-bar.vue";
import HealthBand from "@/components/admin/health-band.vue";
import {
  useLiveTimeRange,
  type RangeKind,
  type RangeValue,
} from "@/composables/use-live-time-range.ts";
import { useAdminOverview, useEngine, usePayments } from "@/queries/admin.ts";
import { formatMinute } from "@/utils/time.ts";
import { formatInt } from "@/utils/format.ts";

const router = useRouter();
const { range, setRange } = useLiveTimeRange("recent-30");

const overviewQuery = useAdminOverview(() => range.value);
const engineQuery = useEngine();
const paymentsQuery = usePayments();

const overview = computed(() => overviewQuery.data.value);
const engine = computed(() => engineQuery.data.value);
const loading = computed(
  () => overviewQuery.isPending.value || engineQuery.isPending.value,
);

/** 「本订阅期间」等预置：有 period 的订阅记录才出现（纯用量模式自动隐藏） */
const extraPresets = computed(() => {
  const list = paymentsQuery.data.value ?? [];
  return list
    .filter((p) => p.kind === "subscription" && p.period_start != null)
    .map((p) => ({
      label: `订阅 #${p.subscription_id ?? p.id} 期间`,
      from: new Date((p.period_start ?? 0) * 1000).toISOString(),
      to: new Date(
        (p.period_end ?? Math.floor(Date.now() / 1000)) * 1000,
      ).toISOString(),
    }))
    .slice(0, 4);
});

const byMember = computed(() => overview.value?.by_member ?? []);
const byKey = computed(() => overview.value?.by_key ?? []);
const bySource = computed(() => overview.value?.by_source ?? []);

const totalUsage = computed(() => {
  const rows = byMember.value;
  const count = rows.reduce((s, r) => s + r.usage.count, 0);
  const quota = rows.reduce((s, r) => s + r.usage.quota, 0);
  // 比例展示用 quota；美元仅示意合计（后端已逐行换算，这里加总展示仅供参考）
  return { count, quota };
});

function memberPercent(quota: number): number {
  const total = totalUsage.value.quota;
  return total > 0 ? Math.round((quota / total) * 1000) / 10 : 0;
}

function onRangeChange(value: RangeValue, kind: RangeKind) {
  setRange(value, kind);
}

function onMemberClick(memberId: number | null) {
  void router.push({
    path: "/admin/keys",
    query: memberId == null ? { member_id: "unassigned" } : { member_id: String(memberId) },
  });
}

function onKeyClick(keyId: number) {
  void router.push({ path: "/admin/keys", query: { key_id: String(keyId) } });
}

function goFailedKeys() {
  void router.push({ path: "/admin/keys", query: { recent_failed: "1" } });
}

/** 表头：标题 + 问号说明 */
function tipTitle(label: string, tip: string) {
  return h("span", { class: "overview-col-title" }, [
    label,
    h(
      Tooltip,
      { title: tip },
      () =>
        h(QuestionCircleOutlined, {
          class: "overview-col-title__icon",
          "aria-hidden": "true",
        }),
    ),
  ]);
}

const memberColumns = [
  { title: "成员", key: "member_name" },
  { title: "名下 Key 数", key: "key_count" },
  {
    title: tipTitle(
      "调用次数",
      "本时段内该成员名下的消费日志条数（type=2，一次调用一行）",
    ),
    key: "count",
  },
  {
    title: tipTitle(
      "额度消耗",
      "本时段消耗的 quota 原值，括号内为按当时换算率折算的美元",
    ),
    key: "usage",
  },
  {
    title: tipTitle(
      "用量占比",
      "该成员本时段 quota ÷ 全员同期 quota。只是用量事实占比，不是费用分摊",
    ),
    key: "share",
  },
  {
    title: tipTitle(
      "同步截止",
      "该成员名下各 key 的 log_synced_at 里最慢的一刻（北京时间）",
    ),
    key: "data_cutoff",
  },
];

const keyColumns = [
  { title: "Key 名称", dataIndex: "token_name", key: "token_name" },
  { title: "归属成员", key: "member_name" },
  {
    title: tipTitle("当前状态", "启用中才会进入同步轮询；已停用仍可查历史"),
    key: "status",
  },
  {
    title: tipTitle("同步截止", "该枚 key 最近一次成功写入日志的同步时刻"),
    key: "data_cutoff",
  },
  {
    title: tipTitle("调用次数", "本时段消费日志条数（type=2）"),
    key: "count",
  },
  {
    title: tipTitle("额度消耗", "本时段 quota 原值与按当时换算率折算的美元"),
    key: "usage",
  },
];
</script>

<template>
  <section>
    <PageHeader
      title="全员总览"
      subtitle="健康与用量全景 · 仅统计消费行（type=2）"
      class="overview-header"
    >
      <template #actions>
        <span class="overview-range-label">时间范围</span>
        <TimeRangePicker
          :model-value="range"
          :extra-presets="extraPresets"
          @change="onRangeChange"
        />
      </template>
    </PageHeader>

    <HealthBand
      :engine="engine"
      :overview="overview"
      :loading="loading"
      @go-failed-keys="goFailedKeys"
    />

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

    <!-- 来源分解 -->
    <section class="overview-block">
      <h2 class="overview-block__title">按来源分解</h2>
      <SourceBar :rows="bySource" />
    </section>

    <!-- 按成员 -->
    <section class="overview-block">
      <h2 class="overview-block__title">按成员汇总</h2>
      <a-empty
        v-if="!loading && byMember.length === 0"
        description="本时段内没有任何消费调用，因此没有成员用量可汇总"
      />
      <a-table
        v-else
        :columns="memberColumns"
        :data-source="byMember"
        :row-key="(r: { member_id: number | null }) => r.member_id ?? 'unassigned'"
        size="middle"
        :pagination="false"
        :scroll="{ x: 900 }"
        :loading="overviewQuery.isFetching.value"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'member_name'">
            <a @click="onMemberClick(record.member_id)">
              {{ record.member_name ?? "未归属" }}
            </a>
          </template>
          <template v-else-if="column.key === 'key_count'">
            {{ record.key_count }}
          </template>
          <template v-else-if="column.key === 'count'">
            {{ formatInt(record.usage.count) }}
          </template>
          <template v-else-if="column.key === 'usage'">
            <QuotaText :quota="record.usage.quota" :quota-usd="record.usage.quota_usd" />
          </template>
          <template v-else-if="column.key === 'share'">
            <span class="overview-share-cell__num">
              {{ memberPercent(record.usage.quota) }}%
            </span>
          </template>
          <template v-else-if="column.key === 'data_cutoff'">
            {{ formatMinute(record.data_cutoff) }}
          </template>
        </template>
      </a-table>
    </section>

    <!-- 按 key -->
    <section class="overview-block">
      <h2 class="overview-block__title">按 key 明细</h2>
      <a-table
        :columns="keyColumns"
        :data-source="byKey"
        :row-key="(r: { key_id: number }) => r.key_id"
        size="middle"
        :pagination="false"
        :scroll="{ x: 900 }"
        :loading="overviewQuery.isFetching.value"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'member_name'">
            {{
              record.member_name ??
              (record.member_id == null
                ? "未归属"
                : `成员 #${record.member_id}`)
            }}
          </template>
          <template v-else-if="column.key === 'status'">
            <a-badge
              :status="record.status === 'active' ? 'success' : 'default'"
              :text="record.status === 'active' ? '启用中' : '已停用'"
            />
          </template>
          <template v-else-if="column.key === 'data_cutoff'">
            {{ formatMinute(record.data_cutoff) }}
          </template>
          <template v-else-if="column.key === 'count'">
            {{ formatInt(record.usage.count) }}
          </template>
          <template v-else-if="column.key === 'usage'">
            <QuotaText :quota="record.usage.quota" :quota-usd="record.usage.quota_usd" />
          </template>
          <template v-else-if="column.key === 'token_name'">
            <a @click="onKeyClick(record.key_id)">{{ record.token_name }}</a>
          </template>
        </template>
      </a-table>
    </section>
  </section>
</template>

<style scoped>
.overview-range-label {
  font-size: 13px;
  line-height: 32px;
  color: rgba(0, 0, 0, 0.65);
  flex-shrink: 0;
}

.overview-block {
  margin-bottom: 32px;
}

.overview-block__title {
  margin: 0 0 16px;
  font-size: 14px;
  font-weight: 600;
  line-height: 22px;
  color: rgba(0, 0, 0, 0.88);
}

.overview-col-title {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  white-space: nowrap;
}

.overview-col-title__icon {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
  cursor: help;
}

.overview-share-cell__num {
  font-variant-numeric: tabular-nums;
  color: rgba(0, 0, 0, 0.88);
}
</style>
