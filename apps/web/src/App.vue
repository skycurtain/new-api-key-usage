<script setup lang="ts">
/**
 * antdv-next §3.7 能力 spike——逐项覆盖《交互设计-总览与共性》清单。
 * 任一项不覆盖即触发回退（Element Plus / ant-design-vue）并回报作者。
 */
import { h, ref } from "vue";

const collapsed = ref(false);
const drawerOpen = ref(false);
const modalOpen = ref(false);
const confirmLoading = ref(false);
const range = ref<[string, string] | null>(null);
const skKey = ref("");
const quotaMode = ref<"usd" | "quota">("usd");
const page = ref(1);

const dataSource = [
  {
    key: "1",
    token_name: "小张-01",
    billing_source: "subscription",
    status: "active",
    quota: 250000,
    quota_usd: "0.50",
  },
  {
    key: "2",
    token_name: "小李-02",
    billing_source: "wallet",
    status: "disabled",
    quota: 100000,
    quota_usd: "0.20",
  },
];

const columns = [
  { title: "名称", dataIndex: "token_name", key: "token_name" },
  {
    title: "来源",
    key: "billing_source",
    customRender: ({ record }: { record: (typeof dataSource)[0] }) =>
      h(
        "a-tag",
        { color: record.billing_source === "subscription" ? "blue" : "gold" },
        () => (record.billing_source === "subscription" ? "订阅" : "充值"),
      ),
  },
  {
    title: "状态",
    key: "status",
    customRender: ({ record }: { record: (typeof dataSource)[0] }) =>
      h(
        "a-badge",
        {
          status: record.status === "active" ? "success" : "default",
          text: record.status === "active" ? "启用" : "停用",
        },
      ),
  },
  { title: "quota", dataIndex: "quota", key: "quota" },
  { title: "额度美元", dataIndex: "quota_usd", key: "quota_usd" },
];

function onCopy() {
  // toast：复制反馈
  (window as unknown as { antd?: { message?: { success: (m: string) => void } } })
    .antd?.message?.success?.("已复制");
}

function onRangeChange(vals: [string, string] | null) {
  range.value = vals;
}
</script>

<template>
  <a-layout style="min-height: 100vh">
    <a-layout-sider v-model:collapsed="collapsed" collapsible>
      <div style="color: #fff; padding: 16px; font-weight: 600">
        new-api-key-usage
      </div>
      <a-menu theme="dark" mode="inline" default-selected-keys="['spike']">
        <a-menu-item key="spike">能力 Spike</a-menu-item>
        <a-menu-item key="overview" disabled>全员总览</a-menu-item>
        <a-menu-item key="keys" disabled>Key 管理</a-menu-item>
      </a-menu>
    </a-layout-sider>
    <a-layout>
      <a-layout-content style="margin: 16px; background: #fff; padding: 16px">
        <a-alert
          type="info"
          show-icon
          closable
          message="antdv-next §3.7 能力 spike"
          description="可折叠侧边栏 / 抽屉 · 密集表格与展开行 · 对话框与二次确认 · message / Alert · DatePicker 范围 · 大号粘贴 · 徽章 / Segmented / Skeleton / Pagination"
          style="margin-bottom: 16px"
        />

        <a-space direction="vertical" style="width: 100%" :size="16">
          <a-space wrap>
            <a-button type="primary" @click="drawerOpen = true">打开抽屉</a-button>
            <a-button @click="modalOpen = true">打开对话框</a-button>
            <a-button @click="onCopy">message.toast</a-button>
            <a-popconfirm title="确认停用？" @confirm="onCopy">
              <a-button danger>二次确认</a-button>
            </a-popconfirm>
          </a-space>

          <a-space wrap>
            <a-range-picker
              style="width: 320px"
              @change="(_: unknown, vals: [string, string]) => onRangeChange(vals)"
            />
            <a-segmented
              v-model:value="quotaMode"
              :options="[
                { label: '美元', value: 'usd' },
                { label: 'quota', value: 'quota' },
              ]"
            />
          </a-space>

          <a-textarea
            v-model:value="skKey"
            :rows="4"
            placeholder="大号粘贴输入框：sk-key 登记对话框用"
          />

          <a-table
            :columns="columns"
            :data-source="dataSource"
            :pagination="false"
            size="small"
            :scroll="{ x: 800 }"
            :expand-column-width="48"
          >
            <template #expandedRowRender="{ record }">
              <div style="padding: 8px">
                来源徽章展开行：{{ record.billing_source }} ·
                <a-tag color="green">订阅 #3</a-tag>
              </div>
            </template>
          </a-table>

          <a-pagination v-model:current="page" :total="50" show-size-changer />
          <a-skeleton active :paragraph="{ rows: 2 }" />
        </a-space>

        <a-drawer
          v-model:open="drawerOpen"
          title="可折叠侧边栏 / 抽屉"
          placement="right"
          :width="320"
        >
          <p>抽屉能力：筛选面板 / 详情。</p>
        </a-drawer>

        <a-modal
          v-model:open="modalOpen"
          title="对话框"
          :confirm-loading="confirmLoading"
          @ok="modalOpen = false"
        >
          <p>对话框 + 二次确认能力。</p>
        </a-modal>
      </a-layout-content>
    </a-layout>
  </a-layout>
</template>
