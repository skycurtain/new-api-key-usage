<script setup lang="ts">
/**
 * 审计日志（交互设计-审计日志）：只读时间线 + 域筛选 + 分页
 */
import { computed, ref, watch } from "vue";
import PageHeader from "@/components/common/page-header.vue";
import { useAuditLogs } from "@/queries/admin.ts";
import { formatDateTime } from "@/utils/time.ts";

const domain = ref<string | null>(null);
const page = ref(1);
const pageSize = ref(50);

const params = computed(() => ({
  page: page.value,
  page_size: pageSize.value,
  domain: domain.value ?? undefined,
}));

const auditQuery = useAuditLogs(() => params.value);
const rows = computed(() => auditQuery.data.value?.items ?? []);
const total = computed(() => auditQuery.data.value?.total ?? 0);

const domainOptions = [
  { value: null, label: "全部域" },
  { value: "key", label: "Key" },
  { value: "payment", label: "支付" },
  { value: "member", label: "成员" },
  { value: "account", label: "账号" },
];

const columns = [
  { title: "时间", key: "created_at", width: 170 },
  { title: "操作者", key: "operator", width: 120 },
  { title: "域", key: "domain", width: 90 },
  { title: "操作", key: "action", width: 160 },
  { title: "摘要", key: "summary" },
];

watch(domain, () => {
  page.value = 1;
});
</script>

<template>
  <section>
    <PageHeader title="审计日志" subtitle="管理操作留痕，只读">
      <template #actions>
        <a-select
          v-model:value="domain"
          :options="domainOptions"
          style="width: 140px"
          placeholder="域"
          allow-clear
        />
      </template>
    </PageHeader>

    <a-table
      :columns="columns"
      :data-source="rows"
      :row-key="(r: { id: number }) => r.id"
      :loading="auditQuery.isPending.value || auditQuery.isFetching.value"
      :pagination="{
        current: page,
        pageSize,
        total,
        showSizeChanger: true,
        pageSizeOptions: ['50', '100'],
        showTotal: (t: number) => `共 ${t} 条`,
        onChange: (p: number, ps: number) => {
          page = p;
          pageSize = ps;
        },
      }"
      size="middle"
      :scroll="{ x: 900 }"
    >
      <template #bodyCell="{ column, record }">
        <template v-if="column.key === 'created_at'">
          {{ formatDateTime(record.created_at) }}
        </template>
        <template v-else-if="column.key === 'operator'">
          {{ record.operator || "系统" }}
        </template>
        <template v-else-if="column.key === 'domain'">
          <a-tag>{{ record.domain }}</a-tag>
        </template>
        <template v-else-if="column.key === 'action'">
          <span class="audit-action">{{ record.action }}</span>
        </template>
        <template v-else-if="column.key === 'summary'">
          {{ record.summary }}
        </template>
      </template>
    </a-table>
  </section>
</template>

<style scoped>
.audit-action {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier,
    monospace;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.65);
}
</style>
