<script setup lang="ts">
import PageHeader from "@/components/common/page-header.vue";
</script>

<template>
  <section>
    <PageHeader
      title="审计日志"
      subtitle="管理操作留痕（信息结构见交互设计-审计日志）"
    />
    <a-skeleton active :paragraph="{ rows: 4 }" />
  </section>
</template>
