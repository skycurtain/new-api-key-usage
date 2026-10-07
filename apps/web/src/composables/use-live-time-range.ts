import { computed, onUnmounted, ref } from "vue";
import { recentDaysRange } from "@/utils/time.ts";

export type RangeValue = { from: string; to: string };
export type RangeKind = "recent-7" | "recent-30" | "fixed";

/**
 * 可跟随「今天」推进的时间范围：
 * - 最近 7/30 天：定时重算窗口（页面挂过夜也不会陈旧）
 * - fixed：自定义/订阅期间等绝对区间，窗口不挪
 */
export function useLiveTimeRange(initial: Exclude<RangeKind, "fixed"> = "recent-30") {
  const kind = ref<RangeKind>(initial);
  const fixed = ref<RangeValue>(recentDaysRange(30));
  const nowTick = ref(Date.now());

  const timer = setInterval(() => {
    nowTick.value = Date.now();
  }, 60_000);
  onUnmounted(() => clearInterval(timer));

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

  return { range, setRange, kind };
}
