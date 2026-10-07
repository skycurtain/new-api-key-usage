<script setup lang="ts">
/**
 * Key 管理（交互设计-key管理）：清单表 · 行内归属/启停 · 登记 · 停滞显形
 */
import { computed, h, ref, watch } from "vue";
import { Tooltip, message } from "antdv-next";
import { QuestionCircleOutlined } from "@antdv-next/icons";
import { useRoute, useRouter } from "vue-router";
import type { KeyItem } from "@new-api-key-usage/core";
import type { ApiError } from "@/api/http.ts";
import PageHeader from "@/components/common/page-header.vue";
import RegisterKeyModal from "@/components/admin/register-key-modal.vue";
import { useEngine, useKeys, useMembers, usePatchKey } from "@/queries/admin.ts";
import { formatInt } from "@/utils/format.ts";
import { formatMinute, hoursSince } from "@/utils/time.ts";

const route = useRoute();
const router = useRouter();

const registerOpen = ref(false);
const highlightKeyId = ref<number | null>(null);

const filterMember = ref<number | "unassigned" | null>(null);
const filterStatus = ref<"active" | "disabled" | null>(null);
const filterRecentFailed = ref(false);

/** URL → 筛选（总览跳入） */
function syncFromRoute() {
  const q = route.query;
  const m = q.member_id;
  if (m === "unassigned") filterMember.value = "unassigned";
  else if (typeof m === "string" && m) filterMember.value = Number(m);
  else filterMember.value = null;

  if (q.status === "active" || q.status === "disabled") filterStatus.value = q.status;
  else filterStatus.value = null;

  filterRecentFailed.value = q.recent_failed === "1" || q.recent_failed === "true";

  const kid = q.key_id;
  highlightKeyId.value = typeof kid === "string" && kid ? Number(kid) : null;
}
syncFromRoute();
watch(
  () => route.query,
  () => syncFromRoute(),
);

function pushQuery() {
  const query: Record<string, string> = {};
  if (filterMember.value === "unassigned") query.member_id = "unassigned";
  else if (filterMember.value != null) query.member_id = String(filterMember.value);
  if (filterStatus.value) query.status = filterStatus.value;
  if (filterRecentFailed.value) query.recent_failed = "1";
  if (highlightKeyId.value != null) query.key_id = String(highlightKeyId.value);
  void router.replace({ path: "/admin/keys", query });
}

watch([filterMember, filterStatus, filterRecentFailed], () => {
  pushQuery();
});

const filters = computed(() => ({
  member_id: filterMember.value ?? undefined,
  status: filterStatus.value ?? undefined,
  recent_failed: filterRecentFailed.value ? true : undefined,
}));

const keysQuery = useKeys(() => filters.value);
const engineQuery = useEngine();
const membersQuery = useMembers();
const patchKey = usePatchKey();

const rows = computed(() => {
  const list = [...(keysQuery.data.value ?? [])];
  // 异常在前：无截止/停滞 → 旧截止 → 新截止（交互：停滞预警）
  list.sort((a, b) => {
    const ta = a.log_synced_at ?? 0;
    const tb = b.log_synced_at ?? 0;
    return ta - tb;
  });
  return list;
});

const failedCount = computed(
  () => engineQuery.data.value?.last_round?.failed ?? 0,
);

const hasActiveFilter = computed(
  () =>
    filterMember.value != null ||
    filterStatus.value != null ||
    filterRecentFailed.value,
);

const memberOptions = computed(() => [
  { value: "unassigned", label: "未归属" },
  ...(membersQuery.data.value ?? []).map((m) => ({ value: m.id, label: m.name })),
]);

function isStalled(logSyncedAt: number | null | undefined): boolean {
  const h = hoursSince(logSyncedAt);
  return h != null && h > 2;
}

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

const columns = [
  { title: "名称", key: "token_name", width: 160 },
  { title: "归属", key: "member_name", width: 140 },
  { title: "状态", key: "status", width: 100 },
  {
    title: tipTitle(
      "数据截止",
      "该 key 最近一次日志同步成功的时刻；落后超过 2 小时标为停滞。检查引擎日志；若持续 401 请停用",
    ),
    key: "data_cutoff",
    width: 170,
  },
  {
    title: tipTitle("累计已用", "上游累计已消耗额度（quota）"),
    key: "total_used",
  },
  {
    title: tipTitle("剩余", "上游剩余可用额度；不限额度显示「不限」"),
    key: "total_available",
  },
  { title: "登记时间", key: "registered_at", width: 160 },
  { title: "操作", key: "actions", width: 120 },
];

async function onMemberChange(
  record: KeyItem,
  memberId: number | "unassigned" | null,
) {
  const next = memberId === "unassigned" || memberId == null ? null : memberId;
  try {
    await patchKey.mutateAsync({ id: record.id, body: { member_id: next } });
    message.success("归属已更新");
  } catch (e) {
    message.error((e as ApiError).message || "归属更新失败");
  }
}

async function onToggleStatus(record: KeyItem) {
  const next = record.status === "active" ? "disabled" : "active";
  try {
    await patchKey.mutateAsync({ id: record.id, body: { status: next } });
    if (next === "disabled") {
      message.success("已停用——移出轮询清单，数据保留");
    } else {
      message.success("已启用——下一轮同步（≤5 分钟）将自动验证");
    }
  } catch (e) {
    message.error((e as ApiError).message || "状态更新失败");
  }
}

function onRegistered(keyId: number) {
  highlightKeyId.value = keyId;
  pushQuery();
  void keysQuery.refetch();
}

function onFailedClick() {
  filterRecentFailed.value = !filterRecentFailed.value;
}

function onRowClass(record: KeyItem) {
  return record.id === highlightKeyId.value ? "key-row--highlight" : "";
}
</script>

<template>
  <section>
    <PageHeader title="Key 管理" subtitle="登记、启停、归属与同步显形">
      <template #actions>
        <a-button type="primary" @click="registerOpen = true">登记 Key</a-button>
      </template>
    </PageHeader>

    <div class="keys-toolbar">
      <span class="keys-toolbar__summary">
        <template v-if="failedCount > 0">
          最近轮次失败
          <a-button type="link" size="small" @click="onFailedClick">
            {{ failedCount }} 枚
          </a-button>
          （点击筛选）
        </template>
        <template v-else>最近轮次无失败 key</template>
      </span>
      <a-space wrap>
        <a-select
          v-model:value="filterMember"
          :options="[
            { value: null, label: '全部成员' },
            { value: 'unassigned', label: '未归属' },
            ...(membersQuery.data.value?.map((m) => ({ value: m.id, label: m.name })) ?? []),
          ]"
          style="width: 140px"
          placeholder="成员"
          allow-clear
        />
        <a-select
          v-model:value="filterStatus"
          :options="[
            { value: null, label: '全部状态' },
            { value: 'active', label: '启用中' },
            { value: 'disabled', label: '已停用' },
          ]"
          style="width: 120px"
          placeholder="状态"
          allow-clear
        />
        <a-checkbox v-model:checked="filterRecentFailed">最近轮次失败</a-checkbox>
      </a-space>
    </div>

    <a-empty
      v-if="!keysQuery.isPending.value && rows.length === 0"
      :description="
        hasActiveFilter
          ? '当前筛选条件下没有 key——可清除筛选，或登记新的 key'
          : '还没有登记任何 key——把你在 NewAPI 创建的 sk-key 粘贴进来'
      "
    >
      <a-button v-if="!hasActiveFilter" type="primary" @click="registerOpen = true">
        登记 Key
      </a-button>
    </a-empty>

    <a-table
      v-else
      :columns="columns"
      :data-source="rows"
      :row-key="(r: KeyItem) => r.id"
      :loading="keysQuery.isPending.value || keysQuery.isFetching.value"
      :pagination="false"
      :scroll="{ x: 1100 }"
      :row-class-name="onRowClass"
      size="middle"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'token_name'">
          {{ record.token_name }}
        </template>
        <template v-else-if="column.key === 'member_name'">
          <a-select
            :value="record.member_id == null ? 'unassigned' : record.member_id"
            :options="memberOptions"
            size="small"
            style="width: 120px"
            @change="(v: number | 'unassigned') => onMemberChange(record, v)"
          />
        </template>
        <template v-else-if="column.key === 'status'">
          <a-badge
            :status="record.status === 'active' ? 'success' : 'default'"
            :text="record.status === 'active' ? '启用中' : '已停用'"
          />
        </template>
        <template v-else-if="column.key === 'data_cutoff'">
          <a-tooltip
            v-if="isStalled(record.log_synced_at)"
            title="检查引擎日志；若持续 401 请停用"
          >
            <span class="keys-stall">{{ formatMinute(record.log_synced_at) }} 停滞</span>
          </a-tooltip>
          <span v-else-if="record.log_synced_at == null" class="keys-syncing">
            同步中…
          </span>
          <span v-else>{{ formatMinute(record.log_synced_at) }}</span>
        </template>
        <template v-else-if="column.key === 'total_used'">
          <span class="keys-num">{{ formatInt(record.total_used) }}</span>
        </template>
        <template v-else-if="column.key === 'total_available'">
          <span class="keys-num">
            {{ record.unlimited_quota ? "不限" : formatInt(record.total_available) }}
          </span>
        </template>
        <template v-else-if="column.key === 'registered_at'">
          {{ formatMinute(record.registered_at) }}
        </template>
        <template v-else-if="column.key === 'actions'">
          <a-popconfirm
            v-if="record.status === 'active'"
            title="停用后移出轮询清单（数据保留）。成员若仍在用它调用 API 不受影响——只有采集停止。"
            ok-text="停用"
            cancel-text="取消"
            @confirm="() => onToggleStatus(record)"
          >
            <a-button size="small" danger>停用</a-button>
          </a-popconfirm>
          <a-button v-else size="small" @click="() => onToggleStatus(record)">
            启用
          </a-button>
        </template>
      </template>
    </a-table>

    <RegisterKeyModal
      v-model:open="registerOpen"
      :members="membersQuery.data.value ?? []"
      @registered="onRegistered"
    />
  </section>
</template>

<style scoped>
.keys-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px 16px;
  margin-bottom: 16px;
}

.keys-toolbar__summary {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.65);
}

.keys-stall {
  color: #d48806;
  font-weight: 600;
}

.keys-syncing {
  color: rgba(0, 0, 0, 0.45);
}

.keys-num {
  font-variant-numeric: tabular-nums;
}

:deep(.key-row--highlight) {
  background: #e6f4ff;
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
</style>
