<script setup lang="ts">
import PageHeader from "@/components/common/page-header.vue";
</script>

<template>
  <section>
    <PageHeader
      title="支付记录"
      subtitle="订阅 / 充值登记与核对（信息结构见交互设计-支付记录）"
    />
    <a-skeleton active :paragraph="{ rows: 4 }" />
  </section>
</template>
