import { computed, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import {
  useMemberRangeStore,
  type RangeKind,
  type RangeValue,
} from "@/stores/member-range.ts";

/**
 * 成员端共享时间范围 + 当前页 URL（from/to）双向同步。
 * 切页时布局菜单带上 from/to，状态从 store 读——对账窗口不打断。
 */
export function useMemberRange() {
  const store = useMemberRangeStore();
  const route = useRoute();
  const router = useRouter();

  const range = computed(() => store.range);

  function syncFromRoute() {
    const from = route.query.from;
    const to = route.query.to;
    if (typeof from === "string" && from && typeof to === "string" && to) {
      store.setRange({ from, to }, "fixed");
    }
  }

  /** 在当前路径上写入 from/to（可并入页内其它 query） */
  function pushRangeQuery(extra: Record<string, string> = {}) {
    void router.replace({
      path: route.path,
      query: {
        ...pickNonRangeQuery(route.query),
        ...extra,
        from: store.range.from,
        to: store.range.to,
      },
    });
  }

  function onRangeChange(v: RangeValue, k: RangeKind) {
    store.setRange(v, k);
    pushRangeQuery();
  }

  syncFromRoute();
  watch(() => route.query, () => syncFromRoute());

  return {
    range,
    setRange: store.setRange,
    onRangeChange,
    pushRangeQuery,
  };
}

function pickNonRangeQuery(q: Record<string, unknown>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(q)) {
    if (k === "from" || k === "to") continue;
    if (typeof v === "string" && v) out[k] = v;
  }
  return out;
}
