<script setup lang="ts">
/**
 * 计算过程——把一次调用的 quota 摊开（《交互设计-总览与共性》§3.9）
 *
 * 两条数据通路刻意分开：
 *   表达式原文：从 `raw.other.expr_b64` **本地解码**，挂载即可见
 *   推导与结论：按需请求 `logs/:id/verify`，异步填充
 * 这样验算请求失败时，最有信息量的那一块仍然在。
 *
 * 管理面与成员视图共用本组件；取数函数由调用方注入，两边的端点与鉴权不同。
 */
import { computed, onMounted, ref } from "vue";
import type { LogItem, LogVerify } from "@new-api-key-usage/core";
import { formatInt } from "@/utils/format.ts";

const props = defineProps<{
  record: LogItem;
  fetchVerify: (id: number) => Promise<LogVerify>;
}>();

const verify = ref<LogVerify | null>(null);
const loading = ref(true);
const failed = ref(false);

onMounted(async () => {
  try {
    verify.value = await props.fetchVerify(props.record.id);
  } catch {
    failed.value = true;
  } finally {
    loading.value = false;
  }
});

/** 该行的 `other`（落库原文）；缺省为 undefined */
function otherOf(record: LogItem): Record<string, unknown> | undefined {
  const other = record.raw?.other;
  return other !== null && typeof other === "object"
    ? (other as Record<string, unknown>)
    : undefined;
}

/** base64 → UTF-8（Web 标准两行；与 core 的 decodeBase64Utf8 同实现，此处只为免引 core 运行时） */
function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

/** 表达式原文；无 `expr_b64` 或解码失败时为 null */
const expression = computed<string | null>(() => {
  const b64 = otherOf(props.record)?.["expr_b64"];
  if (typeof b64 !== "string" || b64 === "") return null;
  try {
    return decodeBase64Utf8(b64).trim();
  } catch {
    return null;
  }
});

/** 中间浮点：最多 4 位小数、去尾零；被截断时前置 ≈（避免读者加起来对不上整数） */
function formatDecimal(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  const rounded = Math.round(value * 1e4) / 1e4;
  const text = rounded.toLocaleString("en-US", { maximumFractionDigits: 4 });
  return Math.abs(rounded - value) > 1e-9 ? `≈${text}` : text;
}

/** `p` 的来历注解：只并排给出输入数字，不解释加减方向 */
function promptSource(p: number): string | undefined {
  if (props.record.prompt_tokens === p) return undefined;
  const raw = otherOf(props.record)?.["cache_tokens"];
  const cacheRead = typeof raw === "number" && Number.isFinite(raw) ? raw : 0;
  return `prompt ${formatInt(props.record.prompt_tokens)} · 缓存读 ${formatInt(cacheRead)}`;
}

interface Row {
  label: string;
  value: string;
  note?: string;
}

const rows = computed<Row[]>(() => {
  const v = verify.value;
  if (v === null || v.status === "unsupported") return [];

  if (v.branch === "tiered_expr" && v.tiered_expr !== null) {
    const t = v.tiered_expr;
    const list: Row[] = [];
    if (t.matched_tier !== null) list.push({ label: "命中", value: t.matched_tier });
    for (const [name, value] of Object.entries(t.vars)) {
      list.push({
        label: name,
        value: formatInt(value),
        note: name === "p" ? promptSource(value) : undefined,
      });
    }
    list.push({ label: "算式值", value: formatDecimal(t.expr_value) });
    const beforeRound = (t.expr_value / 1_000_000) * v.quota_per_unit * v.group_ratio;
    list.push({
      label: "换算",
      value: formatDecimal(beforeRound),
      note: `÷ 1,000,000 × ${formatInt(v.quota_per_unit)} × ${v.group_ratio}`,
    });
    list.push({ label: "取整", value: formatInt(v.computed), note: "四舍五入" });
    return list;
  }

  if (v.branch === "multiplier" && v.multiplier !== null) {
    const m = v.multiplier;
    return [
      { label: "输入基数", value: formatInt(m.base) },
      { label: "缓存读", value: formatDecimal(m.cached) },
      { label: "缓存创建", value: formatDecimal(m.cache_creation) },
      { label: "输出", value: formatDecimal(m.output) },
      { label: "输入侧合计", value: formatDecimal(m.prompt_part) },
      { label: "乘倍率", value: formatDecimal(m.total), note: `× ${m.model_ratio} × ${v.group_ratio}` },
      { label: "取整", value: formatInt(v.computed), note: "四舍五入" },
    ];
  }

  return [];
});

/** 对照条结论：措辞中性，不上红、不出现「不符」「异常」字样 */
const conclusion = computed<string>(() => {
  const v = verify.value;
  if (v === null || v.status === "unsupported") return "";
  return v.delta === 0 ? "两者一致" : `两者相差 ${formatInt(v.delta)}`;
});

const formulaText =
  "(输入基数 + 缓存读×倍率 + 缓存创建×倍率 + 输出×completion_ratio) × model_ratio × group_ratio";
</script>

<template>
  <div class="verify-steps">
    <div class="verify-steps__title">计算过程</div>

    <pre v-if="expression" class="verify-steps__expr">{{ expression }}</pre>

    <div v-if="loading" class="verify-steps__hint">计算中…</div>
    <div v-else-if="failed" class="verify-steps__hint">计算过程暂不可用</div>

    <template v-else-if="verify">
      <p v-if="verify.status === 'unsupported'" class="verify-steps__reason">
        {{ verify.detail }}
      </p>

      <template v-else>
        <p v-if="verify.branch === 'multiplier'" class="verify-steps__formula">
          <span class="verify-steps__label">计价公式</span>
          <span class="verify-steps__formula-text">{{ formulaText }}</span>
        </p>

        <div class="verify-steps__grid">
          <template v-for="row in rows" :key="row.label">
            <span class="verify-steps__label">{{ row.label }}</span>
            <span class="verify-steps__value">
              <span class="verify-steps__num">{{ row.value }}</span>
              <span v-if="row.note" class="verify-steps__note">{{ row.note }}</span>
            </span>
          </template>
        </div>

        <div class="verify-steps__grid verify-steps__result">
          <span class="verify-steps__label">日志 quota</span>
          <span class="verify-steps__value">
            <span class="verify-steps__num">{{ formatInt(verify.logged) }}</span>
          </span>
          <span class="verify-steps__label">重算结果</span>
          <span class="verify-steps__value">
            <span class="verify-steps__num">{{ formatInt(verify.computed) }}</span>
          </span>
          <span class="verify-steps__label">对照</span>
          <span class="verify-steps__value">{{ conclusion }}</span>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.verify-steps {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
  user-select: text;
}

.verify-steps__title {
  margin-bottom: 8px;
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
}

.verify-steps__expr {
  margin: 0 0 10px;
  padding: 8px 10px;
  border: 1px solid rgba(0, 0, 0, 0.08);
  border-radius: 6px;
  background: rgba(0, 0, 0, 0.03);
  color: rgba(0, 0, 0, 0.88);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12.5px;
  line-height: 1.6;
  white-space: pre-wrap;
  word-break: break-word;
}

.verify-steps__grid {
  display: grid;
  grid-template-columns: 6em 1fr;
  row-gap: 6px;
  align-items: baseline;
}

.verify-steps__label {
  color: rgba(0, 0, 0, 0.45);
  font-size: 12px;
  white-space: nowrap;
}

.verify-steps__value {
  color: rgba(0, 0, 0, 0.88);
  font-size: 13px;
  word-break: break-word;
}

.verify-steps__num {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-variant-numeric: tabular-nums;
}

.verify-steps__note {
  margin-left: 8px;
  color: rgba(0, 0, 0, 0.35);
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 12px;
}

.verify-steps__result {
  margin-top: 12px;
  padding-top: 12px;
  border-top: 1px solid rgba(0, 0, 0, 0.06);
}

.verify-steps__hint {
  color: rgba(0, 0, 0, 0.35);
  font-size: 12px;
}

.verify-steps__reason {
  margin: 0;
  color: rgba(0, 0, 0, 0.65);
  font-size: 13px;
  line-height: 1.6;
}

.verify-steps__formula {
  display: grid;
  grid-template-columns: 6em 1fr;
  margin: 0 0 10px;
  align-items: baseline;
}

.verify-steps__formula-text {
  color: rgba(0, 0, 0, 0.65);
  font-size: 12.5px;
  line-height: 1.6;
  word-break: break-word;
}
</style>
