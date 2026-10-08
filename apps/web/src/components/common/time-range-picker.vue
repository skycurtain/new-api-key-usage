<script setup lang="ts">
import type { Dayjs } from "dayjs";
import dayjs from "dayjs";
import { computed } from "vue";
import {
  recentDaysRange,
  wallAsBeijingIso,
  type RangeValue,
} from "@/utils/time.ts";
import type { RangeKind } from "@/composables/use-live-time-range.ts";

const props = defineProps<{
  modelValue: RangeValue;
  /** 外部预置（如「本订阅期间」）；空则只保留内建快捷项 */
  extraPresets?: Array<{ label: string; from: string; to: string }>;
}>();

const emit = defineEmits<{
  (e: "update:modelValue", value: RangeValue): void;
  /** 相对区间可自动跟日历推进；fixed 为绝对窗口 */
  (e: "change", value: RangeValue, kind: RangeKind): void;
}>();

const pickerValue = computed<[Dayjs, Dayjs] | null>(() => {
  if (!props.modelValue.from || !props.modelValue.to) return null;
  return [dayjs(props.modelValue.from), dayjs(props.modelValue.to)];
});

const presets = computed(() => {
  const builtIn = [
    {
      label: "最近 7 天",
      value: rangeToDayjs(recentDaysRange(7)),
    },
    {
      label: "最近 30 天",
      value: rangeToDayjs(recentDaysRange(30)),
    },
  ];
  const extra = (props.extraPresets ?? []).map((p) => ({
    label: p.label,
    value: rangeToDayjs({ from: p.from, to: p.to }),
  }));
  return [...builtIn, ...extra];
});

function rangeToDayjs(range: RangeValue): [Dayjs, Dayjs] {
  return [dayjs(range.from), dayjs(range.to)];
}

function detectKind(value: RangeValue): RangeKind {
  const fromD = dayjs(value.from).format("YYYY-MM-DD");
  const toD = dayjs(value.to).format("YYYY-MM-DD");
  for (const days of [7, 30] as const) {
    const r = recentDaysRange(days);
    if (
      dayjs(r.from).format("YYYY-MM-DD") === fromD &&
      dayjs(r.to).format("YYYY-MM-DD") === toD
    ) {
      return days === 7 ? "recent-7" : "recent-30";
    }
  }
  return "fixed";
}

function onChange(dates: Dayjs[] | null) {
  if (!dates || dates.length !== 2 || !dates[0] || !dates[1]) return;
  const value = {
    from: wallAsBeijingIso(dates[0]),
    to: wallAsBeijingIso(dates[1]),
  };
  emit("update:modelValue", value);
  emit("change", value, detectKind(value));
}
</script>

<template>
  <a-range-picker
    :value="pickerValue"
    :presets="presets"
    format="YYYY-MM-DD HH:mm:ss"
    :placeholder="['开始时间', '结束时间']"
    show-time
    @change="onChange"
  />
</template>
