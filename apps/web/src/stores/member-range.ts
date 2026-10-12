import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { recentDaysRange } from "@/utils/time.ts";

export type RangeValue = { from: string; to: string };
export type RangeKind = "today" | "recent-7" | "recent-30" | "fixed";

/**
 * 成员端全局时间范围——总览 / 调用日志 / 支付参数共用。
 * 相对窗口在 setRange 时定格，避免每分钟改 key 打穿缓存；
 * 「看板自动刷新」只属于总览页（refetchInterval），其余页按需请求。
 */
export const useMemberRangeStore = defineStore("member-range", () => {
  const kind = ref<RangeKind>("recent-30");
  const windowRange = ref<RangeValue>(recentDaysRange(30));
  const fixed = ref<RangeValue>(recentDaysRange(30));

  const range = computed<RangeValue>(() =>
    kind.value === "fixed" ? fixed.value : windowRange.value,
  );

  function setRange(value: RangeValue, nextKind: RangeKind) {
    kind.value = nextKind;
    if (nextKind === "fixed") fixed.value = value;
    else windowRange.value = value;
  }

  return { kind, range, setRange };
});
