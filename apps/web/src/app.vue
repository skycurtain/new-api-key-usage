<script setup lang="ts">
// 路由出口 + 全局中文（DatePicker 等默认 en-US，须用 ConfigProvider）
import zhCN from "antdv-next/locale/zh_CN";
import dayjs from "dayjs";
import "dayjs/locale/zh-cn";

dayjs.locale("zh-cn");
</script>

<template>
  <a-config-provider :locale="zhCN">
    <router-view />
  </a-config-provider>
</template>
