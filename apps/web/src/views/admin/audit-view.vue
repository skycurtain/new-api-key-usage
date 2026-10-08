<script setup lang="ts">
/**
 * 审计日志（交互设计-审计日志）：只读时间线 + 域筛选 + 分页
 * 表体内部滚动：高度按容器实测，避免内容区被撑出视口
 */
import { computed, onMounted, onUnmounted, ref, watch } from "vue";
import PageHeader from "@/components/common/page-header.vue";
import TimeRangePicker from "@/components/common/time-range-picker.vue";
import { useAuditLogs } from "@/queries/admin.ts";
import { formatDateTime, recentDaysRange } from "@/utils/time.ts";

const domain = ref<string | null>(null);
const page = ref(1);
const pageSize = ref(50);
const range = ref(recentDaysRange(30));
const boxRef = ref<HTMLElement | null>(null);
/** 表头 + 分页大约占掉的高度 */
const CHROME = 96;
const bodyY = ref(480);

const params = computed(() => ({
  page: page.value,
  page_size: pageSize.value,
  domain: domain.value ?? undefined,
  from: range.value.from,
  to: range.value.to,
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
  { title: "时间", key: "created_at", width: 160 },
  { title: "操作者", key: "operator", width: 100 },
  { title: "域", key: "domain", width: 80 },
  { title: "操作", key: "action", width: 140 },
  { title: "摘要", key: "summary", ellipsis: true },
];

watch([domain, range], () => {
  page.value = 1;
});

let ro: ResizeObserver | null = null;

function measure() {
  const h = boxRef.value?.clientHeight ?? 0;
  if (h > 0) bodyY.value = Math.max(200, h - CHROME);
}

onMounted(() => {
  measure();
  if (typeof ResizeObserver !== "undefined" && boxRef.value) {
    ro = new ResizeObserver(() => measure());
    ro.observe(boxRef.value);
  }
  window.addEventListener("resize", measure);
});

onUnmounted(() => {
  ro?.disconnect();
  window.removeEventListener("resize", measure);
});
</script>

<template>
  <section class="audit">
    <PageHeader title="审计日志" subtitle="管理操作留痕，只读">
      <template #actions>
        <span class="audit-range-label">时间范围</span>
        <TimeRangePicker v-model="range" />
        <a-select
          v-model:value="domain"
          :options="domainOptions"
          style="width: 140px"
          placeholder="域"
          allow-clear
        />
      </template>
    </PageHeader>

    <div ref="boxRef" class="audit__box">
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
          pageSizeOptions: ['20', '50', '100', '200'],
          showTotal: (t: number) => `共 ${t} 条`,
          onChange: (p: number, ps: number) => {
            page = p;
            pageSize = ps;
          },
        }"
        size="middle"
        :scroll="{ y: bodyY }"
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
    </div>
  </section>
</template>

<style scoped>
/*
 * 固定壳：视口高 − 顶栏 64 − 内容区 padding 24×2 − 内容面 padding 24×2
 * 表体高度由 ResizeObserver 量出，内容区不随表格增高
 */
.audit {
  height: calc(100vh - 64px - 48px - 48px);
  display: flex;
  flex-direction: column;
  min-height: 0;
}

.audit__box {
  flex: 1;
  min-height: 0;
}

.audit-action {
  font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, Courier,
    monospace;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.65);
}

.audit-range-label {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.65);
  line-height: 32px;
}
</style>
