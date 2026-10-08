<script setup lang="ts">
/**
 * 支付登记/编辑：订阅与充值同构；额度双输入（落库恒 quota 原值）
 */
import { computed, reactive, ref, watch } from "vue";
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import type { PaymentItem } from "@new-api-key-usage/core";
import type { ApiError } from "@/api/http.ts";
import { unixToBeijingWall, wallAsBeijingIso } from "@/utils/time.ts";
import {
  useCreatePayment,
  usePayments,
  useQpuLatest,
  useUpdatePayment,
} from "@/queries/admin.ts";
import PlatformSubscriptionPicker from "@/components/admin/platform-subscription-picker.vue";
import type { PlatformSubscription } from "@/api/admin/platform.ts";

const props = defineProps<{
  open: boolean;
  /** 有则为编辑 */
  editing?: PaymentItem | null;
}>();

const emit = defineEmits<{
  (e: "update:open", v: boolean): void;
}>();

const createPay = useCreatePayment();
const updatePay = useUpdatePayment();
const qpuQuery = useQpuLatest();
const paymentsQuery = usePayments();
const qpu = computed(() => qpuQuery.data.value?.qpu ?? null);

const form = reactive({
  kind: "subscription" as "subscription" | "topup",
  paid_amount: null as number | null,
  paid_at: null as Dayjs | null,
  period_start: null as Dayjs | null,
  period_end: null as Dayjs | null,
  subscription_id: null as number | null,
  remark: "",
  quotaMode: "quota" as "quota" | "usd",
  quota_granted: null as number | null,
  quota_usd_input: null as number | null,
});
const error = ref("");
const pickerOpen = ref(false);

function onPickSubscription(s: PlatformSubscription) {
  form.kind = "subscription";
  form.subscription_id = s.id;
  form.period_start = unixToBeijingWall(s.start_time);
  form.period_end = s.end_time > 0 ? unixToBeijingWall(s.end_time) : null;
  form.quotaMode = "quota";
  form.quota_granted = s.amount_total;
  form.quota_usd_input = null;
}

const isEdit = computed(() => props.editing != null);
const saving = computed(() => createPay.isPending.value || updatePay.isPending.value);

const quotaPreview = computed(() => {
  if (form.quotaMode === "quota") {
    const q = form.quota_granted;
    if (q == null || !qpu.value) return null;
    return `≈ $${(q / qpu.value).toFixed(2)}（按当前换算率）`;
  }
  const u = form.quota_usd_input;
  if (u == null || !qpu.value) return null;
  return `≈ ${Math.round(u * qpu.value)} quota`;
});

const quotaGrantedFinal = computed(() => {
  if (form.quotaMode === "quota") return form.quota_granted;
  if (form.quota_usd_input == null || !qpu.value) return null;
  return Math.round(form.quota_usd_input * qpu.value);
});

watch(
  () => props.open,
  (v) => {
    if (!v) return;
    error.value = "";
    const ed = props.editing;
    if (ed) {
      form.kind = ed.kind;
      form.paid_amount = ed.paid_amount;
      // 北京墙钟进控件，保存时 wallAsBeijingIso 可无损回写
      form.paid_at = ed.paid_at != null ? unixToBeijingWall(ed.paid_at) : null;
      form.period_start =
        ed.period_start != null ? unixToBeijingWall(ed.period_start) : null;
      form.period_end =
        ed.period_end != null ? unixToBeijingWall(ed.period_end) : null;
      form.subscription_id = ed.subscription_id;
      form.remark = ed.remark;
      form.quotaMode = "quota";
      form.quota_granted = ed.quota_granted;
      form.quota_usd_input = null;
    } else {
      form.kind = "subscription";
      form.paid_amount = null;
      form.paid_at = dayjs();
      form.period_start = null;
      form.period_end = null;
      form.subscription_id = null;
      form.remark = "";
      form.quotaMode = "quota";
      form.quota_granted = null;
      form.quota_usd_input = null;
    }
  },
);

function toIso(d: Dayjs | null): string | null {
  return d ? wallAsBeijingIso(d) : null;
}

async function onSubmit() {
  error.value = "";
  if (form.paid_amount == null) {
    error.value = "请填写金额";
    return;
  }
  if (!form.paid_at) {
    error.value = "请填写支付时间";
    return;
  }
  const quota = quotaGrantedFinal.value;
  if (quota == null) {
    error.value = "请填写额度";
    return;
  }
  if (form.kind === "subscription") {
    if (!form.period_start) {
      error.value = "订阅必须填写期间起点";
      return;
    }
    if (form.subscription_id == null) {
      error.value = "订阅必须填写订阅编号";
      return;
    }
    // 一笔订阅只应登记一条支付记录；改错走「编辑」
    const dup = (paymentsQuery.data.value ?? []).find(
      (p) =>
        p.subscription_id === form.subscription_id &&
        p.id !== (props.editing?.id ?? -1),
    );
    if (dup) {
      error.value = `订阅 #${form.subscription_id} 已有支付登记——请编辑原记录，不要重复登记`;
      return;
    }
  }
  const body = {
    kind: form.kind,
    paid_at: toIso(form.paid_at)!,
    paid_amount: form.paid_amount,
    remark: form.remark.trim(),
    quota_granted: quota,
    ...(form.kind === "subscription"
      ? {
          period_start: toIso(form.period_start),
          period_end: toIso(form.period_end),
          subscription_id: form.subscription_id,
        }
      : {
          period_start: null,
          period_end: null,
          subscription_id: null,
        }),
  };
  try {
    if (isEdit.value && props.editing) {
      await updatePay.mutateAsync({ id: props.editing.id, body });
    } else {
      await createPay.mutateAsync(body);
    }
    emit("update:open", false);
  } catch (e) {
    error.value = (e as ApiError).message || "保存失败";
  }
}
</script>

<template>
  <a-modal
    :open="open"
    :title="isEdit ? '编辑支付记录' : '登记支付'"
    :confirm-loading="saving"
    ok-text="保存"
    cancel-text="取消"
    :styles="{ body: { maxHeight: '62vh', overflowY: 'auto' } }"
    @update:open="emit('update:open', $event)"
    @ok="onSubmit"
  >
    <a-form layout="vertical">
      <a-form-item label="类型" required>
        <a-radio-group v-model:value="form.kind" :disabled="isEdit">
          <a-radio value="subscription">订阅</a-radio>
          <a-radio value="topup">充值</a-radio>
        </a-radio-group>
      </a-form-item>
      <a-button
        v-if="form.kind === 'subscription' && !isEdit"
        class="pay-form__pick"
        block
        @click="pickerOpen = true"
      >
        从平台选择订阅（自动填写编号、期间与额度）
      </a-button>
      <a-form-item label="金额（币种自定）" required>
        <a-input-number
          v-model:value="form.paid_amount"
          :min="0"
          :precision="2"
          style="width: 100%"
        />
        <div class="pay-form__note">金额数值——币种由你们约定，系统不预设</div>
      </a-form-item>
      <a-form-item label="支付时间" required>
        <a-date-picker
          v-model:value="form.paid_at"
          show-time
          style="width: 100%"
        />
      </a-form-item>
      <template v-if="form.kind === 'subscription'">
        <a-form-item label="期间起" required>
          <a-date-picker
            v-model:value="form.period_start"
            show-time
            style="width: 100%"
          />
        </a-form-item>
        <a-form-item label="期间止（空 = 进行中）">
          <a-date-picker
            v-model:value="form.period_end"
            show-time
            style="width: 100%"
          />
        </a-form-item>
        <a-form-item label="订阅 ID" required>
          <a-input-number
            v-model:value="form.subscription_id"
            :min="1"
            :precision="0"
            style="width: 100%"
            placeholder="钱包页面「订阅 #N」"
          />
        </a-form-item>
      </template>
      <a-form-item label="本笔额度" required>
        <a-radio-group v-model:value="form.quotaMode">
          <a-radio value="quota">原始 quota</a-radio>
          <a-radio value="usd">按美元换算</a-radio>
        </a-radio-group>
        <a-input-number
          v-if="form.quotaMode === 'quota'"
          v-model:value="form.quota_granted"
          :min="0"
          :precision="0"
          style="width: 100%; margin-top: 8px"
        />
        <a-input-number
          v-else
          v-model:value="form.quota_usd_input"
          :min="0"
          :precision="2"
          style="width: 100%; margin-top: 8px"
          placeholder="美元金额"
        />
        <div v-if="quotaPreview" class="pay-form__note">
          {{ quotaPreview }} · 落库为原始 quota
        </div>
      </a-form-item>
      <a-form-item label="备注">
        <a-input v-model:value="form.remark" placeholder="备注（可选）" />
      </a-form-item>
      <a-alert v-if="error" type="error" show-icon :message="error" />
    </a-form>
    <PlatformSubscriptionPicker
      v-model:open="pickerOpen"
      @select="onPickSubscription"
    />
  </a-modal>
</template>

<style scoped>
.pay-form__pick {
  margin-bottom: 16px;
}

.pay-form__note {
  margin-top: 4px;
  font-size: 12px;
  line-height: 20px;
  color: rgba(0, 0, 0, 0.45);
}


</style>
