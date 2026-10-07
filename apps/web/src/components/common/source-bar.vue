<script setup lang="ts">
/**
 * 来源分解分段条（交互共性 §3.7：订阅 / 充值）——前端现算比例（公共约定 §5）
 */
import { computed } from "vue";

type SourceRow = {
  billing_source: string;
  count: number;
  quota: number;
  quota_usd: string;
};

const props = defineProps<{
  rows: SourceRow[];
}>();

const segments = computed(() => {
  const total = props.rows.reduce((s, r) => s + r.quota, 0);
  return props.rows.map((r) => {
    const pct = total > 0 ? (r.quota / total) * 100 : 0;
    const isSub = r.billing_source === "subscription";
    return {
      key: r.billing_source,
      label: isSub ? "订阅" : r.billing_source === "wallet" ? "充值" : r.billing_source,
      pct,
      count: r.count,
      quota_usd: r.quota_usd,
      color: isSub ? "#1677ff" : "#faad14",
    };
  });
});

const hasData = computed(() => segments.value.some((s) => s.pct > 0));
</script>

<template>
  <div class="source-bar">
    <div v-if="!hasData" class="source-bar__empty">
      本时段内没有任何消费调用，因此没有可分解的来源。
    </div>
    <template v-else>
      <div class="source-bar__track">
        <div
          v-for="seg in segments"
          :key="seg.key"
          class="source-bar__seg"
          :style="{ width: `${seg.pct}%`, background: seg.color }"
          :title="`${seg.label}来源：占额度 ${seg.pct.toFixed(1)}%，调用 ${seg.count} 次，$${seg.quota_usd}`"
        />
      </div>
      <div class="source-bar__legend">
        <span v-for="seg in segments" :key="seg.key" class="source-bar__item">
          <i class="source-bar__dot" :style="{ background: seg.color }" />
          <span class="source-bar__label">{{ seg.label }}</span>
          <span class="source-bar__meta">
            调用 {{ seg.count }} 次，消耗 ${{ seg.quota_usd }}
            （占 {{ seg.pct.toFixed(1) }}%）
          </span>
        </span>
      </div>
    </template>
  </div>
</template>

<style scoped>
.source-bar__track {
  display: flex;
  height: 8px;
  border-radius: 4px;
  overflow: hidden;
  background: #f0f0f0;
}

.source-bar__seg {
  height: 100%;
  min-width: 2px;
}

.source-bar__legend {
  display: flex;
  flex-direction: column;
  gap: 8px;
  margin-top: 12px;
  font-size: 13px;
  line-height: 22px;
  color: rgba(0, 0, 0, 0.88);
}

.source-bar__item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  flex-wrap: wrap;
}

.source-bar__dot {
  width: 8px;
  height: 8px;
  border-radius: 9999px;
  flex-shrink: 0;
  position: relative;
  top: -1px;
}

.source-bar__label {
  font-weight: 600;
  min-width: 2.5em;
}

.source-bar__meta {
  color: rgba(0, 0, 0, 0.65);
  font-variant-numeric: tabular-nums;
}

.source-bar__empty {
  font-size: 13px;
  color: rgba(0, 0, 0, 0.45);
}
</style>
