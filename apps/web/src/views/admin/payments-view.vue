<script setup lang="ts">
/**
 * 支付记录（交互设计-支付记录）：订阅 / 充值两 Tab · 核对提示
 */
import { computed, ref, watch } from "vue";
import { message } from "antdv-next";
import type { SubscriptionItem, TopupItem } from "@new-api-key-usage/core";
import type { ApiError } from "@/api/http.ts";
import { fetchLogs } from "@/api/admin/logs.ts";
import { useRoute, useRouter } from "vue-router";
import PageHeader from "@/components/common/page-header.vue";
import TableRefresh from "@/components/common/table-refresh.vue";
import PaymentFormModal from "@/components/admin/payment-form-modal.vue";
import QuotaText from "@/components/common/quota-text.vue";
import {
  useDeleteSubscription,
  useDeleteTopup,
  useSubscriptions,
  useTopups,
} from "@/queries/admin.ts";
import { formatDateTime, toRequestIso } from "@/utils/time.ts";
import { formatPaidAmount } from "@/utils/format.ts";

const route = useRoute();
const router = useRouter();
const subsQuery = useSubscriptions();
const topupsQuery = useTopups();

const filterDomain = ref<string | "none" | null>(null);
const filterSubId = ref<number | null>(null);
const filterTradeNo = ref<string | null>(null);
const domainOptions = computed(() => {
  const set = new Set<string>();
  for (const s of subsQuery.data.value ?? []) {
    if (s.billing_domain) set.add(s.billing_domain);
  }
  for (const t of topupsQuery.data.value ?? []) {
    if (t.billing_domain) set.add(t.billing_domain);
  }
  return [...set].sort().map((v) => ({ value: v, label: v }));
});

const filteredSubs = computed(() => {
  let list = subsQuery.data.value ?? [];
  if (filterSubId.value != null) {
    list = list.filter((r) => r.subscription_id === filterSubId.value);
  }
  if (!filterDomain.value) return list;
  if (filterDomain.value === "none") {
    return list.filter((r) => r.billing_domain == null);
  }
  return list.filter((r) => r.billing_domain === filterDomain.value);
});

const filteredTops = computed(() => {
  let list = topupsQuery.data.value ?? [];
  if (filterTradeNo.value) {
    const q = filterTradeNo.value.trim().toLowerCase();
    list = list.filter(
      (r) =>
        (r.trade_no ?? "").toLowerCase().includes(q) ||
        (r.upstream_id != null && String(r.upstream_id).includes(q)),
    );
  }
  if (!filterDomain.value) return list;
  if (filterDomain.value === "none") {
    return list.filter((r) => r.billing_domain == null);
  }
  return list.filter((r) => r.billing_domain === filterDomain.value);
});
const deleteSub = useDeleteSubscription();
const deleteTop = useDeleteTopup();

const tab = ref<"subs" | "topups">("subs");
const formOpen = ref(false);
const editingSub = ref<SubscriptionItem | null>(null);
const editingTop = ref<TopupItem | null>(null);
const missingSubs = ref<number[]>([]);
const checking = ref(false);

function syncFromRoute() {
  tab.value = route.query.tab === "topups" ? "topups" : "subs";
  const sid = route.query.subscription_id;
  filterSubId.value = typeof sid === "string" && sid ? Number(sid) || null : null;
  const tn = route.query.trade_no;
  filterTradeNo.value = typeof tn === "string" && tn ? tn : null;
}

function pushQuery() {
  const query: Record<string, string> = {};
  if (tab.value === "topups") query.tab = "topups";
  if (filterSubId.value != null) query.subscription_id = String(filterSubId.value);
  if (filterTradeNo.value) query.trade_no = filterTradeNo.value;
  void router.replace({ path: "/admin/payments", query });
}

syncFromRoute();
watch(() => route.query, () => syncFromRoute());
watch([tab, filterSubId, filterTradeNo], () => pushQuery());

const subRows = computed(() => [...filteredSubs.value]);
const topRows = computed(() => {
  const list = [...filteredTops.value];
  list.sort((a, b) => (b.paid_at ?? 0) - (a.paid_at ?? 0));
  return list;
});

const subColumns = [
  { title: "订阅 ID", dataIndex: "subscription_id", key: "subscription_id", width: 100 },
  { title: "期间", key: "period", width: 200 },
  { title: "额度", key: "quota", width: 160 },
  { title: "付款金额 / 时间", key: "paid", width: 170 },
  { title: "账本域", key: "billing_domain", width: 110 },
  { title: "备注", key: "remark" },
  { title: "登记", key: "created_at", width: 150 },
  { title: "操作", key: "actions", width: 120 },
];

const topColumns = [
  { title: "时间", key: "paid_at", width: 150 },
  {
    title: "充值金额",
    dataIndex: "amount",
    key: "amount",
    width: 100,
  },
  { title: "实付金额", dataIndex: "money", key: "money", width: 100 },
  { title: "交易号 / 渠道", key: "trade", width: 180 },
  { title: "派生额度", key: "quota", width: 150 },
  { title: "账本域", key: "billing_domain", width: 110 },
  { title: "备注", key: "remark" },
  { title: "操作", key: "actions", width: 120 },
];

function periodLines(s: SubscriptionItem): { start: string; end: string } {
  return {
    start: formatDateTime(s.period_start),
    end: s.period_end == null ? "进行中" : formatDateTime(s.period_end),
  };
}

function onCreateSub() {
  editingSub.value = null;
  editingTop.value = null;
  formOpen.value = true;
}

function onCreateTop() {
  editingSub.value = null;
  editingTop.value = null;
  tab.value = "topups";
  formOpen.value = true;
}

function onEditSub(s: SubscriptionItem) {
  editingSub.value = s;
  editingTop.value = null;
  formOpen.value = true;
}

function onEditTop(t: TopupItem) {
  editingTop.value = t;
  editingSub.value = null;
  formOpen.value = true;
}

async function onDeleteSub(s: SubscriptionItem) {
  try {
    await deleteSub.mutateAsync(s.id);
    message.success("已删除");
  } catch (e) {
    message.error((e as ApiError).message || "删除失败");
  }
}

async function onDeleteTop(t: TopupItem) {
  try {
    await deleteTop.mutateAsync(t.id);
    message.success("已删除");
  } catch (e) {
    message.error((e as ApiError).message || "删除失败");
  }
}

/** 观测订阅号 ↔ 已登记：只提示不回填；双表皆空则静默 */
async function reconcile(subs: SubscriptionItem[]) {
  if (subs.length === 0 && topupsQuery.data.value?.length === 0) {
    missingSubs.value = [];
    return;
  }
  if (subs.length === 0) {
    missingSubs.value = [];
    return;
  }
  checking.value = true;
  try {
    const known = new Set(subs.map((s) => s.subscription_id));
    const earliest = Math.min(
      ...subs.map((s) => s.period_start ?? 0),
      Date.now() / 1000,
    );
    const from = toRequestIso(new Date((earliest - 30 * 86400) * 1000));
    const to = toRequestIso(new Date());
    const page = await fetchLogs({
      from,
      to,
      page: 1,
      page_size: 200,
      type: 2,
    });
    const observed = new Set<number>();
    for (const it of page.items) {
      if (it.type === 2 && it.subscription_id != null) {
        observed.add(it.subscription_id);
      }
    }
    missingSubs.value = [...observed].filter((id) => !known.has(id)).sort((a, b) => a - b);
  } catch {
    missingSubs.value = [];
  } finally {
    checking.value = false;
  }
}

watch(
  () => subsQuery.data.value,
  (subs) => {
    if (!subs) return;
    void reconcile(subs);
  },
  { immediate: true },
);
</script>

<template>
  <section>
    <PageHeader title="支付记录" subtitle="订阅权益与充值入账登记">
      <template #actions>
        <a-button v-if="tab === 'subs'" type="primary" @click="onCreateSub">
          登记订阅
        </a-button>
        <a-button v-else type="primary" @click="onCreateTop">登记充值</a-button>
      </template>
    </PageHeader>

    <a-tabs v-model:active-key="tab">
      <a-tab-pane key="subs" tab="订阅" />
      <a-tab-pane key="topups" tab="充值" />
    </a-tabs>

    <div class="payments-toolbar">
      <template v-if="tab === 'subs'">
        <a-input-number
          v-model:value="filterSubId"
          :min="1"
          :precision="0"
          style="width: 140px"
          placeholder="订阅 ID"
          allow-clear
        />
      </template>
      <template v-else>
        <a-input
          v-model:value="filterTradeNo"
          style="width: 180px"
          placeholder="交易号 / 上游 ID"
          allow-clear
        />
      </template>
      <a-select
        v-model:value="filterDomain"
        :options="[
          { value: null, label: '全部账本域' },
          { value: 'none', label: '未标注' },
          ...domainOptions,
        ]"
        style="width: 160px"
        placeholder="账本域"
        allow-clear
      />
    </div>

    <a-alert
      v-if="tab === 'subs' && missingSubs.length"
      type="warning"
      show-icon
      style="margin-bottom: 16px"
      :message="`观测到 ${missingSubs.length} 个订阅有消耗但尚无对应登记`"
    >
      <template #description>
        <div class="pay-missing__tags">
          <a-tag v-for="id in missingSubs" :key="id">#{{ id }}</a-tag>
        </div>
        <div class="pay-missing__note">
          若本部署不登记支付，可忽略此提示；需要入账的请核对补录。
        </div>
      </template>
    </a-alert>

    <template v-if="tab === 'subs'">
      <TableRefresh
        :loading="subsQuery.isFetching.value"
        @refresh="() => subsQuery.refetch()"
      />
      <a-empty
        v-if="!subsQuery.isPending.value && subRows.length === 0"
        description="还没有订阅登记——从平台选用或手工登记"
      >
        <a-button @click="onCreateSub">登记订阅</a-button>
      </a-empty>
      <a-table
        v-else
        :columns="subColumns"
        :data-source="subRows"
        :row-key="(r: SubscriptionItem) => r.id"
        :loading="subsQuery.isPending.value || subsQuery.isFetching.value || checking"
        :pagination="false"
        size="middle"
        :scroll="{ x: 960 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'period'">
            <div class="pay-period">
              <span>{{ periodLines(record).start }}</span>
              <span class="pay-period__end">~ {{ periodLines(record).end }}</span>
            </div>
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
          <template v-else-if="column.key === 'billing_domain'">
            {{ record.billing_domain || "—" }}
          </template>
          <template v-else-if="column.key === 'remark'">
            {{ record.remark || "—" }}
          </template>
          <template v-else-if="column.key === 'created_at'">
            {{ formatDateTime(record.created_at) }}
          </template>
          <template v-else-if="column.key === 'actions'">
            <a-space>
              <a-button size="small" @click="() => onEditSub(record)">编辑</a-button>
              <a-popconfirm
                title="删除后该条将消失"
                ok-text="删除"
                cancel-text="取消"
                @confirm="() => onDeleteSub(record)"
              >
                <a-button size="small" danger>删除</a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>
    </template>

    <template v-else>
      <TableRefresh
        :loading="topupsQuery.isFetching.value"
        @refresh="() => topupsQuery.refetch()"
      />
      <a-empty
        v-if="!topupsQuery.isPending.value && topRows.length === 0"
        description="还没有充值登记"
      >
        <a-button @click="onCreateTop">登记充值</a-button>
      </a-empty>
      <a-table
        v-else
        :columns="topColumns"
        :data-source="topRows"
        :row-key="(r: TopupItem) => r.id"
        :loading="topupsQuery.isPending.value || topupsQuery.isFetching.value"
        :pagination="false"
        size="middle"
        :scroll="{ x: 900 }"
      >
        <template #bodyCell="{ column, record }">
          <template v-if="column.key === 'paid_at'">
            {{ formatDateTime(record.paid_at) }}
          </template>
          <template v-else-if="column.key === 'amount'">
            {{ formatPaidAmount(record.amount) }}
          </template>
          <template v-else-if="column.key === 'money'">
            {{ formatPaidAmount(record.money) }}
          </template>
          <template v-else-if="column.key === 'trade'">
            {{ record.trade_no || "—" }}
            <span v-if="record.payment_method" class="pay-note">
              · {{ record.payment_method }}
            </span>
          </template>
          <template v-else-if="column.key === 'quota'">
            <QuotaText :quota="record.quota_derived" :quota-usd="record.quota_usd" />
          </template>
          <template v-else-if="column.key === 'billing_domain'">
            {{ record.billing_domain || "—" }}
          </template>
          <template v-else-if="column.key === 'remark'">
            {{ record.remark || "—" }}
          </template>
          <template v-else-if="column.key === 'actions'">
            <a-space>
              <a-button size="small" @click="() => onEditTop(record)">编辑</a-button>
              <a-popconfirm
                title="删除后该条将消失"
                ok-text="删除"
                cancel-text="取消"
                @confirm="() => onDeleteTop(record)"
              >
                <a-button size="small" danger>删除</a-button>
              </a-popconfirm>
            </a-space>
          </template>
        </template>
      </a-table>
    </template>

    <PaymentFormModal
      v-model:open="formOpen"
      :tab="tab"
      :editing-sub="editingSub"
      :editing-top="editingTop"
    />
  </section>
</template>

<style scoped>
.payments-toolbar {
  margin-bottom: 12px;
}

.pay-period {
  display: flex;
  flex-direction: column;
  line-height: 20px;
  font-variant-numeric: tabular-nums;
}

.pay-period__end {
  color: rgba(0, 0, 0, 0.65);
}

.pay-missing__tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-bottom: 4px;
}

.pay-missing__note,
.pay-note {
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
</style>
