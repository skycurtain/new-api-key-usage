<script setup lang="ts">
/**
 * 支付登记弹窗：订阅 / 充值分形态（拆表后）
 * 时间控件统一精确到秒（show-time）
 */
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import { computed, reactive, ref, watch } from "vue";
import { message } from "antdv-next";
import type { SubscriptionItem, TopupItem } from "@new-api-key-usage/core";
import type { ApiError } from "@/api/http.ts";
import PlatformSubscriptionPicker from "@/components/admin/platform-subscription-picker.vue";
import PlatformTopupPicker from "@/components/admin/platform-topup-picker.vue";
import type {
  PlatformSubscription,
  PlatformTopup,
} from "@/api/admin/platform.ts";
import {
  useBillingDomainOptions,
  useCreateSubscription,
  useCreateTopup,
  useQpuLatest,
  useSubscriptions,
  useTopups,
  useUpdateSubscription,
  useUpdateTopup,
} from "@/queries/admin.ts";
import { unixToBeijingWall, wallAsBeijingIso } from "@/utils/time.ts";

const TIME_FMT = "YYYY-MM-DD HH:mm:ss";

const props = defineProps<{
  open: boolean;
  tab: "subs" | "topups";
  editingSub?: SubscriptionItem | null;
  editingTop?: TopupItem | null;
}>();

const emit = defineEmits<{ (e: "update:open", v: boolean): void }>();

const createSub = useCreateSubscription();
const updateSub = useUpdateSubscription();
const createTop = useCreateTopup();
const updateTop = useUpdateTopup();
const subsQuery = useSubscriptions();
const topupsQuery = useTopups();
const qpuQuery = useQpuLatest();
const qpu = computed(() => qpuQuery.data.value?.qpu ?? null);

/** 额度双输入旁的换算预览（不入库，仅展示） */
const quotaPreview = computed(() => {
  if (isSub.value) {
    if (subForm.quotaMode === "quota") {
      const q = subForm.quota_granted;
      if (q == null || !qpu.value) return null;
      return `≈ $${(q / qpu.value).toFixed(2)}（按当前换算率）`;
    }
    const u = subForm.quota_usd;
    if (u == null || !qpu.value) return null;
    return `≈ ${Math.round(u * qpu.value)} quota`;
  }
  const a = topForm.amount;
  if (a == null || !qpu.value) return null;
  return `≈ ${Math.round(a * qpu.value)} quota（按当前换算率）`;
});

const pickerOpen = ref(false);
const topPickerOpen = ref(false);
const error = ref("");
const isSub = ref(props.tab === "subs");

const registeredSubIds = computed(
  () => (subsQuery.data.value ?? []).map((s) => s.subscription_id),
);
const registeredTopIds = computed(
  () =>
    (topupsQuery.data.value ?? [])
      .map((t) => t.upstream_id)
      .filter((v): v is number => v != null),
);

const domainOptions = useBillingDomainOptions();

const subForm = reactive({
  subscription_id: null as number | null,
  period_start: null as Dayjs | null,
  period_end: null as Dayjs | null,
  quota_granted: null as number | null,
  quotaMode: "quota" as "quota" | "usd",
  quota_usd: null as number | null,
  paid_amount: null as number | null,
  paid_at: null as Dayjs | null,
  billing_domain: "",
  remark: "",
});

const topForm = reactive({
  upstream_id: null as number | null,
  amount: null as number | null,
  money: null as number | null,
  trade_no: "",
  payment_method: "",
  payment_provider: "",
  paid_at: null as Dayjs | null,
  billing_domain: "",
  remark: "",
});

function resetSub() {
  Object.assign(subForm, {
    subscription_id: null,
    period_start: null,
    period_end: null,
    quota_granted: null,
    quotaMode: "quota",
    quota_usd: null,
    paid_amount: null,
    paid_at: null,
    billing_domain: "",
    remark: "",
  });
}

function resetTop() {
  Object.assign(topForm, {
    upstream_id: null,
    amount: null,
    money: null,
    trade_no: "",
    payment_method: "",
    payment_provider: "",
    paid_at: null,
    billing_domain: "",
    remark: "",
  });
}

watch(
  () => props.open,
  (v) => {
    if (!v) return;
    error.value = "";
    isSub.value = props.tab === "subs";
    if (props.editingSub) {
      isSub.value = true;
      const s = props.editingSub;
      subForm.subscription_id = s.subscription_id;
      subForm.period_start = unixToBeijingWall(s.period_start);
      subForm.period_end =
        s.period_end != null ? unixToBeijingWall(s.period_end) : null;
      subForm.quota_granted = s.quota_granted;
      subForm.quotaMode = "quota";
      subForm.quota_usd = null;
      subForm.paid_amount = s.paid_amount;
      subForm.paid_at =
        s.paid_at != null ? unixToBeijingWall(s.paid_at) : null;
      subForm.billing_domain = s.billing_domain ?? "";
      subForm.remark = s.remark;
    } else {
      // 订阅的 paid_at 是「套餐付款时刻」，可空——不默认填今天
      resetSub();
    }
    if (props.editingTop) {
      isSub.value = false;
      const t = props.editingTop;
      topForm.upstream_id = t.upstream_id;
      topForm.amount = t.amount;
      topForm.money = t.money;
      topForm.trade_no = t.trade_no ?? "";
      topForm.payment_method = t.payment_method ?? "";
      topForm.payment_provider = t.payment_provider ?? "";
      topForm.paid_at = unixToBeijingWall(t.paid_at);
      topForm.billing_domain = t.billing_domain ?? "";
      topForm.remark = t.remark;
    } else {
      resetTop();
      topForm.paid_at = dayjs();
    }
  },
);

function onPickSub(s: PlatformSubscription) {
  subForm.subscription_id = s.id;
  subForm.period_start = unixToBeijingWall(s.start_time);
  subForm.period_end =
    s.end_time != null ? unixToBeijingWall(s.end_time) : null;
  subForm.quota_granted = s.amount_total;
  subForm.quotaMode = "quota";
}

function onPickTop(t: PlatformTopup & { paid_at_iso: string }) {
  topForm.upstream_id = t.id;
  topForm.amount = t.amount;
  topForm.money = t.money;
  topForm.trade_no = t.trade_no ?? "";
  topForm.payment_method = t.payment_method ?? "";
  topForm.payment_provider = t.payment_provider ?? "";
  const sec = t.complete_time ?? t.create_time;
  topForm.paid_at =
    sec != null ? unixToBeijingWall(sec) : unixToBeijingWall(Date.now() / 1000);
}

function iso(v: Dayjs | null): string | null {
  // 北京墙钟进控件 → wallAsBeijingIso 无损回写（与旧登记表单一致）
  return v ? wallAsBeijingIso(v) : null;
}

async function onSubmit() {
  error.value = "";
  try {
    if (isSub.value) {
      if (!subForm.period_start) {
        error.value = "请填写期间起点";
        return;
      }
      if (subForm.subscription_id == null) {
        error.value = "请填写订阅编号";
        return;
      }
      const qpu = qpuQuery.data.value?.qpu ?? 500000;
      const quota =
        subForm.quotaMode === "quota"
          ? subForm.quota_granted
          : subForm.quota_usd != null
            ? Math.round(subForm.quota_usd * qpu)
            : null;
      if (quota == null) {
        error.value = "请填写套餐总额度";
        return;
      }
      if (subForm.paid_amount != null && subForm.paid_amount < 0) {
        error.value = "付款金额不能为负数";
        return;
      }
      const dup = (subsQuery.data.value ?? []).find(
        (p) =>
          p.subscription_id === subForm.subscription_id &&
          p.id !== props.editingSub?.id,
      );
      if (dup) {
        error.value = `订阅 #${subForm.subscription_id} 已有登记——请编辑原记录`;
        return;
      }
      const body = {
        subscription_id: subForm.subscription_id,
        period_start: iso(subForm.period_start)!,
        period_end: iso(subForm.period_end),
        quota_granted: quota,
        paid_amount: subForm.paid_amount,
        paid_at: iso(subForm.paid_at),
        billing_domain: subForm.billing_domain.trim() || null,
        remark: subForm.remark,
      };
      if (props.editingSub) {
        await updateSub.mutateAsync({ id: props.editingSub.id, body });
      } else {
        await createSub.mutateAsync(body);
      }
    } else {
      if (topForm.amount == null || topForm.amount <= 0) {
        error.value = "请填写充值金额 amount（须为正）";
        return;
      }
      if (topForm.money == null || topForm.money < 0) {
        error.value = "实付金额不能为负数";
        return;
      }
      if (!topForm.paid_at) {
        error.value = "请填写入账时间";
        return;
      }
      const body = {
        upstream_id: topForm.upstream_id,
        amount: topForm.amount,
        money: topForm.money,
        trade_no: topForm.trade_no || null,
        payment_method: topForm.payment_method || null,
        payment_provider: topForm.payment_provider || null,
        status: props.editingTop?.status ?? "success",
        paid_at: iso(topForm.paid_at)!,
        billing_domain: topForm.billing_domain.trim() || null,
        remark: topForm.remark,
      };
      if (props.editingTop) {
        await updateTop.mutateAsync({ id: props.editingTop.id, body });
      } else {
        await createTop.mutateAsync(body);
      }
    }
    message.success(props.editingSub || props.editingTop ? "已保存" : "已登记");
    emit("update:open", false);
  } catch (e) {
    const err = e as ApiError;
    if (err.fields) {
      error.value = Object.values(err.fields)[0] || "请检查表单";
    } else {
      error.value = err.message || "保存失败";
    }
  }
}
</script>

<template>
  <a-modal
    :open="open"
    :title="isSub ? (editingSub ? '编辑订阅' : '登记订阅') : editingTop ? '编辑充值' : '登记充值'"
    :confirm-loading="createSub.isPending.value || createTop.isPending.value || updateSub.isPending.value || updateTop.isPending.value"
    ok-text="保存"
    cancel-text="取消"
    width="560"
    centered
    :styles="{ body: { maxHeight: '70vh', overflowY: 'auto' } }"
    @ok="onSubmit"
    @update:open="emit('update:open', $event)"
  >
    <a-radio-group
      v-if="!editingSub && !editingTop"
      v-model:value="isSub"
      style="margin-bottom: 16px"
    >
      <a-radio :value="true">订阅</a-radio>
      <a-radio :value="false">充值</a-radio>
    </a-radio-group>

    <a-form v-if="isSub" layout="vertical">
      <a-form-item label="订阅 ID" required>
        <a-space>
          <a-input-number
            v-model:value="subForm.subscription_id"
            :min="1"
            :precision="0"
            style="width: 160px"
          />
          <a-button @click="pickerOpen = true">从平台选用</a-button>
        </a-space>
      </a-form-item>
      <a-form-item label="期间起止" required>
        <a-date-picker
          v-model:value="subForm.period_start"
          :format="TIME_FMT"
          :show-time="{ defaultValue: undefined }"
          style="width: 200px"
        />
        <span style="margin: 0 8px">~</span>
        <a-date-picker
          v-model:value="subForm.period_end"
          :format="TIME_FMT"
          :show-time="{ defaultValue: undefined }"
          placeholder="止（空=进行中）"
          style="width: 200px"
        />
      </a-form-item>
      <a-form-item label="套餐总额度" required>
        <a-radio-group v-model:value="subForm.quotaMode" style="margin-right: 8px">
          <a-radio-button value="quota">quota</a-radio-button>
          <a-radio-button value="usd">美元</a-radio-button>
        </a-radio-group>
        <a-input-number
          v-if="subForm.quotaMode === 'quota'"
          v-model:value="subForm.quota_granted"
          :min="0"
          :precision="0"
          style="width: 180px"
        />
        <a-input-number
          v-else
          v-model:value="subForm.quota_usd"
          :min="0"
          :precision="2"
          style="width: 180px"
        />
        <div v-if="quotaPreview" class="form-note">
          {{ quotaPreview }} · 落库为原始 quota
        </div>
      </a-form-item>
      <a-form-item label="付款金额 / 付款时间（可空）">
        <a-input-number
          v-model:value="subForm.paid_amount"
          :min="0"
          :precision="2"
          style="width: 140px"
          placeholder="金额"
        />
        <a-date-picker
          v-model:value="subForm.paid_at"
          :format="TIME_FMT"
          :show-time="{ defaultValue: undefined }"
          placeholder="钱出手时刻（可空）"
          style="width: 200px; margin-left: 8px"
        />
        <div class="form-note">
          社交层付款事实：金额数值、币种由你们约定；未知可留空。登记时刻由系统另记
        </div>
      </a-form-item>
      <a-form-item label="账本域">
        <a-auto-complete
          v-model:value="subForm.billing_domain"
          :options="domainOptions"
          allow-clear
        />
      </a-form-item>
      <a-form-item label="备注">
        <a-input v-model:value="subForm.remark" />
      </a-form-item>
    </a-form>

    <a-form v-else layout="vertical">
      <a-form-item label="充值金额 amount" required>
        <a-space>
          <a-input-number
            v-model:value="topForm.amount"
            :min="0"
            :precision="6"
            style="width: 180px"
          />
          <a-button @click="topPickerOpen = true">从平台选用</a-button>
        </a-space>
        <div class="form-note">
          平台计费侧充值额（不标币种）；与「实付」之间汇率由管理员约定。换得 quota ≈ amount × QPU
          <template v-if="quotaPreview"> · {{ quotaPreview }}</template>
        </div>
      </a-form-item>
      <a-form-item label="实付金额 money" required>
        <a-input-number
          v-model:value="topForm.money"
          :min="0"
          :precision="2"
          style="width: 180px"
        />
        <div class="form-note">实际支付金额（不预设币种）</div>
      </a-form-item>
      <a-form-item label="入账时间 paid_at" required>
        <a-date-picker
          v-model:value="topForm.paid_at"
          :format="TIME_FMT"
          :show-time="{ defaultValue: undefined }"
          style="width: 220px"
        />
      </a-form-item>
      <a-form-item label="交易号 / 渠道">
        <a-input v-model:value="topForm.trade_no" placeholder="trade_no" style="width: 220px" />
        <a-input
          v-model:value="topForm.payment_method"
          placeholder="method"
          style="width: 120px; margin-left: 8px"
        />
        <a-input
          v-model:value="topForm.payment_provider"
          placeholder="provider"
          style="width: 120px; margin-left: 8px"
        />
      </a-form-item>
      <a-form-item label="账本域">
        <a-auto-complete
          v-model:value="topForm.billing_domain"
          :options="domainOptions"
          allow-clear
        />
      </a-form-item>
      <a-form-item label="备注">
        <a-input v-model:value="topForm.remark" />
      </a-form-item>
    </a-form>

    <a-alert v-if="error" type="error" show-icon :message="error" />

    <PlatformSubscriptionPicker
      v-model:open="pickerOpen"
      :registered-ids="registeredSubIds"
      @select="onPickSub"
    />
    <PlatformTopupPicker
      v-model:open="topPickerOpen"
      :registered-ids="registeredTopIds"
      @select="onPickTop"
    />
  </a-modal>
</template>

<style scoped>
.form-note {
  margin-top: 4px;
  font-size: 12px;
  color: rgba(0, 0, 0, 0.45);
}
</style>
