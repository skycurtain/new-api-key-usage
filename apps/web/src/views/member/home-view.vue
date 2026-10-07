<script setup lang="ts">
import PageHeader from "@/components/common/page-header.vue";
</script>

<template>
  <section>
    <PageHeader
      title="我的用量"
      subtitle="聚合 · 来源徽章 · 明细（信息结构见交互设计-成员视图）"
    />
    <a-skeleton active :paragraph="{ rows: 4 }" />
  </section>
</template>
