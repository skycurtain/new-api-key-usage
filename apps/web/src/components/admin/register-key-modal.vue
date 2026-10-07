<script setup lang="ts">
/**
 * 登记 Key：sk-key 明文在 web 的唯一露面处（交互-key管理 §2）
 */
import { computed, reactive, ref, watch } from "vue";
import type { MemberItem } from "@new-api-key-usage/core";
import type { ApiError } from "@/api/http.ts";
import { useCreateMember, useRegisterKey } from "@/queries/admin.ts";

const props = defineProps<{
  open: boolean;
  members: MemberItem[];
}>();

const emit = defineEmits<{
  (e: "update:open", v: boolean): void;
  (e: "registered", keyId: number): void;
}>();

const register = useRegisterKey();
const createMember = useCreateMember();

const form = reactive({
  sk_key: "",
  member_id: null as number | "unassigned" | null,
});
const resultMsg = ref<{ type: "success" | "error" | "warning"; text: string } | null>(
  null,
);
const showNewMember = ref(false);
const newMemberName = ref("");
const newMemberRemark = ref("");

watch(
  () => props.open,
  (v) => {
    if (!v) {
      form.sk_key = "";
      form.member_id = null;
      resultMsg.value = null;
      showNewMember.value = false;
      newMemberName.value = "";
      newMemberRemark.value = "";
    }
  },
);

const memberOptions = computed(() => [
  { value: "unassigned", label: "未归属" },
  ...props.members.map((m) => ({ value: m.id, label: m.name })),
]);

async function onSubmit() {
  resultMsg.value = null;
  if (!form.sk_key.trim()) {
    resultMsg.value = { type: "warning", text: "请粘贴 sk-key" };
    return;
  }
  try {
    const key = await register.mutateAsync({
      sk_key: form.sk_key.trim(),
      member_id:
        form.member_id === "unassigned" || form.member_id == null
          ? null
          : form.member_id,
    });
    resultMsg.value = {
      type: "success",
      text: "已登记，首轮同步进行中（约 5 分钟内完成）",
    };
    emit("registered", key.id);
  } catch (e) {
    const err = e as ApiError;
    if (err.status === 409) {
      resultMsg.value = {
        type: "warning",
        text: "该 key 已在清单中",
      };
      if (err.keyId != null) emit("registered", err.keyId);
    } else if (err.status === 422) {
      // 上游拒绝 vs 本地表单校验（如 sk- 前缀）文案不同
      const fieldMsg = err.fields?.sk_key;
      resultMsg.value = {
        type: "error",
        text:
          fieldMsg ??
          (err.code === "validation_failed"
            ? err.message || "请检查填写内容"
            : "上游拒绝了这枚 key——可能不存在或已被禁用"),
      };
    } else if (err.status === 502 || err.status === 0) {
      resultMsg.value = {
        type: "error",
        text: "上游站点暂时不可达，请稍后重试",
      };
    } else {
      resultMsg.value = {
        type: "error",
        text: err.message || "登记失败，请稍后重试",
      };
    }
  }
}

async function onCreateMember() {
  const name = newMemberName.value.trim();
  if (!name) return;
  try {
    const m = await createMember.mutateAsync({
      name,
      remark: newMemberRemark.value.trim(),
    });
    form.member_id = m.id;
    showNewMember.value = false;
    newMemberName.value = "";
    newMemberRemark.value = "";
    resultMsg.value = { type: "success", text: `已新建成员「${m.name}」并选为归属` };
  } catch (e) {
    const err = e as ApiError;
    resultMsg.value = { type: "error", text: err.message || "新建成员失败" };
  }
}
</script>

<template>
  <a-modal
    :open="open"
    title="登记 Key"
    :confirm-loading="register.isPending.value"
    ok-text="登记"
    cancel-text="取消"
    @update:open="emit('update:open', $event)"
    @ok="onSubmit"
  >
    <a-form layout="vertical">
      <a-form-item label="sk-key" required>
        <a-textarea
          v-model:value="form.sk_key"
          :rows="4"
          placeholder="粘贴你在 NewAPI 创建的 sk-…"
        />
        <div class="register-key__note">
          粘贴后立即加密存储，界面不再回显明文
        </div>
      </a-form-item>
      <a-form-item label="归属成员">
        <a-select
          v-model:value="form.member_id"
          :options="memberOptions"
          placeholder="未归属"
          allow-clear
        />
        <a-button
          type="link"
          size="small"
          style="padding-left: 0"
          @click="showNewMember = !showNewMember"
        >
          + 新建成员
        </a-button>
      </a-form-item>
      <a-form-item v-if="showNewMember" label="新成员名称">
        <a-input
          v-model:value="newMemberName"
          placeholder="成员名称"
          @press-enter="onCreateMember"
        />
        <a-input
          v-model:value="newMemberRemark"
          placeholder="备注（可选）"
          style="margin-top: 8px"
        />
        <a-button
          type="primary"
          size="small"
          style="margin-top: 8px"
          :loading="createMember.isPending.value"
          @click="onCreateMember"
        >
          创建并选用
        </a-button>
      </a-form-item>
      <a-alert
        v-if="resultMsg"
        :type="resultMsg.type"
        show-icon
        :message="resultMsg.text"
      />
    </a-form>
  </a-modal>
</template>

<style scoped>
.register-key__note {
  margin-top: 4px;
  font-size: 12px;
  line-height: 20px;
  color: rgba(0, 0, 0, 0.45);
}
</style>
