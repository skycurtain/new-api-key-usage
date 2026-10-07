<script setup lang="ts">
import PageHeader from "@/components/common/page-header.vue";
</script>

<template>
  <section>
    <PageHeader
      title="成员管理"
      subtitle="开户、令牌、停用（信息结构见交互设计-成员管理）"
    />
    <a-skeleton active :paragraph="{ rows: 4 }" />
  </section>
</template>
