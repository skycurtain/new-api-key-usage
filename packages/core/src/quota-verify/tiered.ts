/**
 * 表达式计费（`billing_mode = "tiered_expr"`）的 quota 验算
 *
 * 来源：`service/tiered_settle.go` · `BuildTieredTokenParams`
 *       + `pkg/billingexpr` 求值 + `service/text_quota.go` 的折算。
 * 依据：`docs/references/NewAPI-用量计算链路.md` §5
 */

import {
  compileBillingExpr,
  decodeBase64Utf8,
  type CompileOutcome,
  type CompiledExpr,
} from "./expression.ts";
import { readNumber, readNumberOr, toQuota } from "./math.ts";
import type { QuotaCandidate, UsageLogLike, UsageSemantic } from "./types.ts";

/** `ClaudeCacheCreation1hMultiplier = 6 / 3.75`（types/price_data.go） */
const CLAUDE_CACHE_CREATION_1H_MULTIPLIER = 6 / 3.75;

/**
 * 解开并编译 `expr_b64`。
 *
 * 三种情况必须分开归因，否则会重演「表达式完好却报缺 expr_b64」：
 *   字段没有 / 解不开  → `no_billing_info`（确实没有可用的表达式）
 *   语法不对           → `expr_grammar`
 *   语法对了但不在范围内 → `fixed_expr` / `expr_unsupported` / `expr_var` …
 */
export function compileTieredExpr(o: Record<string, unknown>): CompileOutcome {
  const exprB64 = o["expr_b64"];
  if (typeof exprB64 !== "string" || exprB64 === "") {
    return {
      ok: false,
      rejection: { reason: "no_billing_info", detail: "tiered_expr 行缺少 expr_b64" },
    };
  }

  let text: string;
  try {
    text = decodeBase64Utf8(exprB64);
  } catch {
    return {
      ok: false,
      rejection: { reason: "no_billing_info", detail: "expr_b64 不是合法的 base64 文本" },
    };
  }

  return compileBillingExpr(text);
}

/**
 * 按需要验算 `tiered_expr` 行。
 *
 * 归一化方向在两种语义下**相反**，这是本函数最容易写错的地方：
 *   - OpenAI：`prompt_tokens` 含所有子类，表达式引用了某子类才从 `p` 里减掉
 *   - Anthropic：`input_tokens` 只含文本，表达式**没**引用某子类时才并回 `p`
 */
export function buildTieredCandidate(
  row: UsageLogLike,
  o: Record<string, unknown>,
  compiled: CompiledExpr,
  semantic: UsageSemantic,
  quotaPerUnit: number,
): QuotaCandidate {
  const isAnthropic = semantic === "anthropic";
  const used = compiled.vars;

  let p = row.prompt_tokens;
  const c = row.completion_tokens;
  const cr = readNumber(o, "cache_tokens");
  const ccTotal = readNumber(o, "cache_creation_tokens");

  let cc = 0;
  let cc1h = 0;
  if (isAnthropic) {
    // NormalizeCacheCreationSplit：未标注 1h 的余量按 5m 计
    const split1h = readNumber(o, "cache_creation_tokens_1h");
    cc = Math.max(ccTotal - split1h, 0);
    cc1h = split1h;
  } else {
    cc = ccTotal;
  }

  // len 在归一化**之前**取：OpenAI 语义就是原始 prompt_tokens
  const len = isAnthropic ? p + cr + cc + cc1h : p;

  if (isAnthropic) {
    if (!used.has("cr")) p += cr;
    if (!used.has("cc1h")) {
      cc += cc1h * CLAUDE_CACHE_CREATION_1H_MULTIPLIER;
      cc1h = 0;
    }
    if (!used.has("cc")) {
      p += cc;
      cc = 0;
    }
  } else {
    if (used.has("cr")) p -= cr;
    if (used.has("cc")) p -= cc;
  }
  if (p < 0) p = 0;

  // 求值环境需要全部 7 个变量（没给的按 0），但 trace 只保留表达式**引用到的**
  // ——「计算过程」只展示真正参与计算的那几个
  const evalVars: Record<string, number> = {
    p,
    c: Math.max(c, 0),
    len,
    cr,
    cc,
    cc1h,
    cc12h: readNumber(o, "cache_creation_tokens_12h"),
  };

  const { value: rawCost, matchedTier } = compiled.eval(evalVars);
  const groupRatio = readNumberOr(o, "group_ratio", 1);
  // 表达式系数单位是 $/1M tokens
  const afterGroup = (rawCost / 1_000_000) * quotaPerUnit * groupRatio;
  const expected = toQuota(afterGroup);

  const shownVars: Record<string, number> = {};
  for (const name of used) {
    const v = evalVars[name];
    if (v !== undefined) shownVars[name] = v;
  }

  return {
    branch: "tiered_expr",
    semantic,
    expected,
    delta: expected - row.quota,
    trace: {
      expr: compiled.source,
      matchedTier,
      vars: shownVars,
      rawCost,
      quotaPerUnit,
      groupRatio,
    },
  };
}
