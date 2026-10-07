<script setup lang="ts">
/**
 * 令牌明文对话框：仅签发/重发后出现一次（交互-成员管理 §3）
 */
import { ref, watch } from "vue";
import { message } from "antdv-next";
import { CopyOutlined, WarningOutlined } from "@antdv-next/icons";

const props = defineProps<{
  open: boolean;
  token: string;
  memberName?: string;
}>();

const emit = defineEmits<{
  (e: "update:open", v: boolean): void;
}>();

const confirmClose = ref(false);

watch(
  () => props.open,
  (v) => {
    if (v) {
      confirmClose.value = false;
    }
  },
);

async function onCopy() {
  try {
    await navigator.clipboard.writeText(props.token);
    message.success("已复制");
  } catch {
    message.error("复制失败，请手动选中复制");
  }
}

function tryClose() {
  if (!confirmClose.value) {
    confirmClose.value = true;
    return;
  }
  emit("update:open", false);
}
</script>

<template>
  <a-modal
    :open="open"
    :title="memberName ? `访问令牌 · ${memberName}` : '访问令牌'"
    :mask-closable="false"
    :closable="false"
    :keyboard="false"
    :footer="null"
  >
    <a-alert
      type="warning"
      show-icon
      style="margin-bottom: 16px"
      message="关闭后将无法再次查看——请立即复制并通过你信任的渠道发给成员"
    />
    <div class="token-plain">
      <code class="token-plain__text">{{ token }}</code>
      <a-button @click="onCopy">
        <CopyOutlined />
        复制
      </a-button>
    </div>
    <div class="token-plain__footer">
      <template v-if="!confirmClose">
        <a-button @click="tryClose">关闭</a-button>
      </template>
      <template v-else>
        <span class="token-plain__confirm">
          <WarningOutlined style="color: #faad14" />
          确认已保存并发送？
        </span>
        <a-space>
          <a-button @click="confirmClose = false">再看看</a-button>
          <a-button type="primary" @click="tryClose">我已保存并发送</a-button>
        </a-space>
      </template>
    </div>
  </a-modal>
</template>

<style scoped>
.token-plain {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px;
  border: 1px solid #f0f0f0;
  border-radius: 8px;
  background: #fafafa;
}

.token-plain__text {
  flex: 1;
  word-break: break-all;
  font-size: 13px;
  line-height: 22px;
  color: rgba(0, 0, 0, 0.88);
  user-select: all;
}

.token-plain__footer {
  display: flex;
  align-items: center;
  justify-content: flex-end;
  gap: 12px;
  margin-top: 16px;
  min-height: 32px;
}

.token-plain__confirm {
  margin-right: auto;
  font-size: 13px;
  color: rgba(0, 0, 0, 0.65);
}
</style>
