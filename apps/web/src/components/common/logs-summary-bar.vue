<script setup lang="ts">
/**
 * 调用日志汇总条（交互设计-调用日志 §2.5）：
 * 单行低高度——请求次数 + 消费用量；用量恒 type=2 口径由上层保证。
 */
import QuotaText from "./quota-text.vue";

defineProps<{
  hitCount: number;
  usageCount: number;
  errorCount: number;
  quota: number;
  quotaUsd: string;
  loading?: boolean;
}>();
</script>

<template>
  <div class="logs-summary-bar" :class="{ 'is-loading': loading }">
    <div class="logs-summary-bar__seg">
      <span class="logs-summary-bar__label">请求次数</span>
      <span class="logs-summary-bar__value">
        <template v-if="loading">—</template>
        <template v-else>
          {{ hitCount }} 条<template v-if="errorCount > 0">
            （消费 {{ usageCount }} / 错误 {{ errorCount }}）</template>
        </template>
      </span>
    </div>
    <div class="logs-summary-bar__seg">
      <span class="logs-summary-bar__label">消费用量</span>
      <span class="logs-summary-bar__value">
        <QuotaText v-if="!loading" :quota="quota" :quota-usd="quotaUsd" />
        <template v-else>—</template>
      </span>
    </div>
  </div>
</template>

<style scoped>
.logs-summary-bar {
  display: flex;
  align-items: center;
  gap: 24px;
  min-height: 36px;
  padding: 0 12px;
  margin-bottom: 12px;
  border: 1px solid #e8ecf4;
  border-radius: 6px;
  background: #f7f9fc;
}

.logs-summary-bar.is-loading {
  opacity: 0.55;
}

.logs-summary-bar__seg {
  display: inline-flex;
  align-items: baseline;
  gap: 8px;
  white-space: nowrap;
}

.logs-summary-bar__label {
  font-size: 12px;
  color: #8a8f99;
}

.logs-summary-bar__value {
  font-size: 13px;
  font-weight: 500;
  color: #1f2329;
}
</style>
