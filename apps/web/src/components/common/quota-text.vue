<script setup lang="ts">
/**
 * 额度双单位：原始 quota + 美元（契约公共约定 §5；前端只呈现不换算）
 */
import { computed } from "vue";
import { formatInt } from "@/utils/format.ts";

const props = defineProps<{
  quota: number | null | undefined;
  quotaUsd: string | null | undefined;
}>();

const quotaText = computed(() => formatInt(props.quota));
</script>

<template>
  <span class="quota-text">
    <span class="quota-text__num">{{ quotaText }}</span>
    <span class="quota-text__usd">(${{ quotaUsd ?? "—" }})</span>
  </span>
</template>

<style scoped>
.quota-text {
  font-variant-numeric: tabular-nums;
  white-space: nowrap;
}

.quota-text__num {
  color: rgba(0, 0, 0, 0.88);
  font-weight: 600;
}

.quota-text__usd {
  margin-left: 6px;
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
  font-weight: 400;
}
</style>
