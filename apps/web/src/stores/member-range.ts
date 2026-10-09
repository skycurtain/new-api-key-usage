import { defineStore } from "pinia";
import { computed, ref } from "vue";
import { recentDaysRange } from "@/utils/time.ts";

export type RangeValue = { from: string; to: string };
export type RangeKind = "recent-7" | "recent-30" | "fixed";

/**
 * 成员端全局时间范围——总览 / 调用日志 / 支付参数共用（对账窗口不因切页打断）。
 */
export const useMemberRangeStore = defineStore("member-range", () => {
  const kind = ref<RangeKind>("recent-30");
  const fixed = ref<RangeValue>(recentDaysRange(30));
  const nowTick = ref(Date.now());

  setInterval(() => {
    nowTick.value = Date.now();
  }, 60_000);

  const range = computed<RangeValue>(() => {
    void nowTick.value;
    if (kind.value === "recent-7") return recentDaysRange(7);
    if (kind.value === "recent-30") return recentDaysRange(30);
    return fixed.value;
  });

  function setRange(value: RangeValue, nextKind: RangeKind) {
    kind.value = nextKind;
    if (nextKind === "fixed") fixed.value = value;
  }

  return { kind, fixed, range, setRange };
});
