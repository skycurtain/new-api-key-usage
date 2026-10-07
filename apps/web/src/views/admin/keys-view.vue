<script setup lang="ts">
import PageHeader from "@/components/common/page-header.vue";
</script>

<template>
  <section>
    <PageHeader
      title="Key 管理"
      subtitle="登记、启停、归属（信息结构见交互设计-key管理）"
    />
    <a-skeleton active :paragraph="{ rows: 4 }" />
  </section>
</template>
