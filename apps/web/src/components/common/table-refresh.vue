<script setup lang="ts">
/**
 * 表格工具行刷新钮（纯图标 + tooltip）——放在筛选行下一行、右对齐
 */
import { ReloadOutlined } from "@antdv-next/icons";

defineProps<{ loading?: boolean }>();
const emit = defineEmits<{ (e: "refresh"): void }>();
</script>

<template>
  <div class="table-refresh">
    <a-tooltip title="刷新">
      <a-button
        :loading="loading"
        aria-label="刷新"
        @click="emit('refresh')"
      >
        <template #icon>
          <ReloadOutlined />
        </template>
      </a-button>
    </a-tooltip>
  </div>
</template>

<style scoped>
.table-refresh {
  display: flex;
  justify-content: flex-end;
  margin-bottom: 8px;
}
</style>
