<script setup lang="ts">
/**
 * 页面标题区——对齐 design.md 排版：
 * 标题 headline-sm（20/600/28）· 说明 body-sm 三级字（rgba 0.45）
 */
defineProps<{
  title: string;
  subtitle?: string;
}>();
</script>

<template>
  <header class="page-header">
    <div class="page-header__text">
      <h1 class="page-header__title">{{ title }}</h1>
      <p v-if="subtitle" class="page-header__subtitle">{{ subtitle }}</p>
    </div>
    <div v-if="$slots.actions" class="page-header__actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.page-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
  margin-bottom: 24px;
}

.page-header__title {
  margin: 0;
  font-size: 20px;
  font-weight: 600;
  line-height: 28px;
  color: rgba(0, 0, 0, 0.88);
}

.page-header__subtitle {
  margin: 4px 0 0;
  font-size: 12px;
  line-height: 20px;
  color: rgba(0, 0, 0, 0.45);
}

.page-header__actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-shrink: 0;
  /* 与标题块上缘对齐时，控件 32px 高与 label 竖向居中 */
  min-height: 32px;
}
</style>
