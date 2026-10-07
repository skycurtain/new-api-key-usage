<script setup lang="ts">
import PageHeader from "@/components/common/page-header.vue";
</script>

<template>
  <section>
    <PageHeader
      title="全员总览"
      subtitle="健康带 · 按成员 / key 汇总（信息结构见交互设计-全员总览）"
    />
    <a-skeleton active :paragraph="{ rows: 4 }" />
  </section>
</template>
