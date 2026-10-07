<script setup lang="ts">
/**
 * 支付记录（交互设计-支付记录）：同构登记 · 编辑删除 · 核对提示
 */
import { computed, ref, watch } from "vue";
import { message } from "antdv-next";
import type { PaymentItem } from "@new-api-key-usage/core";
import type { ApiError } from "@/api/http.ts";
import { fetchLogs } from "@/api/admin/logs.ts";
import PageHeader from "@/components/common/page-header.vue";
import PaymentFormModal from "@/components/admin/payment-form-modal.vue";
import QuotaText from "@/components/common/quota-text.vue";
import { useDeletePayment, usePayments } from "@/queries/admin.ts";
import { formatDate, formatDateTime } from "@/utils/time.ts";
import { formatPaidAmount } from "@/utils/format.ts";

const paymentsQuery = usePayments();
const deletePay = useDeletePayment();

const formOpen = ref(false);
const editing = ref<PaymentItem | null>(null);
const missingSubs = ref<number[]>([]);
const checking = ref(false);

const rows = computed(() => {
  const list = [...(paymentsQuery.data.value ?? [])];
  list.sort((a, b) => (b.paid_at ?? 0) - (a.paid_at ?? 0));
  return list;
});

const columns = [
  { title: "类型", key: "kind", width: 90 },
  { title: "金额（币种自定）", key: "paid_amount", width: 140 },
  { title: "时间", key: "time", width: 180 },
  { title: "订阅 ID", key: "subscription_id", width: 100 },
  { title: "额度", key: "quota", width: 160 },
  { title: "备注", key: "remark" },
  { title: "操作", key: "actions", width: 120 },
];

function timeText(p: PaymentItem): string {
  if (p.kind === "topup") return formatDateTime(p.paid_at);
  const start = formatDate(p.period_start);
  const end = p.period_end == null ? "进行中" : formatDate(p.period_end);
  return `${start} ~ ${end}`;
}

function onCreate() {
  editing.value = null;
  formOpen.value = true;
}

function onEdit(p: PaymentItem) {
  editing.value = p;
  formOpen.value = true;
}

async function onDelete(p: PaymentItem) {
  try {
    await deletePay.mutateAsync(p.id);
    message.success("已删除");
  } catch (e) {
    message.error((e as ApiError).message || "删除失败");
  }
}

/** 观测订阅号 ↔ 已登记：只提示不回填；payments 全空则静默 */
async function reconcile(pays: PaymentItem[]) {
  if (pays.length === 0) {
    missingSubs.value = [];
    return;
  }
  checking.value = true;
  try {
    const known = new Set(
      pays.map((p) => p.subscription_id).filter((v): v is number => v != null),
    );
    const earliest = Math.min(...pays.map((p) => p.paid_at ?? 0), Date.now() / 1000);
    const from = new Date((earliest - 30 * 86400) * 1000).toISOString();
    const to = new Date().toISOString();
    const observed = new Set<number>();
    let page = 1;
    for (;;) {
      const res = await fetchLogs({
        from,
        to,
        page,
        page_size: 200,
      });
      for (const it of res.items) {
        if (it.type === 2 && it.subscription_id != null) {
          observed.add(it.subscription_id);
        }
      }
      if (page * 200 >= res.total || page >= 20) break;
      page += 1;
    }
    missingSubs.value = [...observed]
      .filter((id) => !known.has(id))
      .sort((a, b) => a - b);
  } catch {
    missingSubs.value = [];
  } finally {
    checking.value = false;
  }
}

// 数据到达/失效刷新后再核对（挂载时尚未 resolve）
watch(
  () => paymentsQuery.data.value,
  (pays) => {
    if (!pays) return;
    void reconcile(pays);
  },
  { immediate: true },
);
</script>

<template>
  <section>
    <PageHeader title="支付记录" subtitle="订阅与充值的人工登记">
      <template #actions>
        <a-button type="primary" @click="onCreate">登记支付</a-button>
      </template>
    </PageHeader>

    <a-alert
      v-for="id in missingSubs"
      :key="id"
      type="warning"
      show-icon
      :message="`观测到订阅 #${id} 有消耗，但尚无对应登记——请核对补录`"
      style="margin-bottom: 8px"
    />

    <a-empty
      v-if="!paymentsQuery.isPending.value && rows.length === 0"
      description="还没有支付记录——订阅/充值同构登记"
    >
      <a-button @click="onCreate">登记支付</a-button>
    </a-empty>

    <a-table
      v-else
      :columns="columns"
      :data-source="rows"
      :row-key="(r: PaymentItem) => r.id"
      :loading="paymentsQuery.isPending.value || paymentsQuery.isFetching.value || checking"
      :pagination="false"
      size="middle"
      :scroll="{ x: 1000 }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'kind'">
          <a-tag :color="record.kind === 'subscription' ? 'blue' : 'gold'">
            {{ record.kind === "subscription" ? "订阅" : "充值" }}
          </a-tag>
        </template>
        <template v-else-if="column.key === 'paid_amount'">
          {{ formatPaidAmount(record.paid_amount) }}
        </template>
        <template v-else-if="column.key === 'time'">
          {{ timeText(record) }}
        </template>
        <template v-else-if="column.key === 'subscription_id'">
          {{ record.subscription_id ?? "—" }}
        </template>
        <template v-else-if="column.key === 'quota'">
          <QuotaText :quota="record.quota_granted" :quota-usd="record.quota_usd" />
        </template>
        <template v-else-if="column.key === 'remark'">
          {{ record.remark || "—" }}
        </template>
        <template v-else-if="column.key === 'actions'">
          <a-space>
            <a-button size="small" @click="() => onEdit(record)">编辑</a-button>
            <a-popconfirm
              title="删除后该条支付记录将消失"
              description="改错即修，删除即消失"
              ok-text="删除"
              cancel-text="取消"
              @confirm="() => onDelete(record)"
            >
              <a-button size="small" danger>删除</a-button>
            </a-popconfirm>
          </a-space>
        </template>
      </template>
    </a-table>

    <PaymentFormModal v-model:open="formOpen" :editing="editing" />
  </section>
</template>
