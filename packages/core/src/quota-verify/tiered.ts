/**
 * 表达式计费（`billing_mode = "tiered_expr"`）的 quota 验算
 *
 * 来源：`service/tiered_settle.go` · `BuildTieredTokenParams`
 *       + `pkg/billingexpr` 求值 + `service/text_quota.go` 的折算。
 * 依据：`docs/references/NewAPI-用量计算链路.md` §5
 */

import { compileBillingExpr, decodeBase64Utf8 } from "./expression.ts";
import { readNumber, readNumberOr, toQuota } from "./math.ts";
import type { QuotaCandidate, UsageLogLike, UsageSemantic } from "./types.ts";

/** `ClaudeCacheCreation1hMultiplier = 6 / 3.75`（types/price_data.go） */
const CLAUDE_CACHE_CREATION_1H_MULTIPLIER = 6 / 3.75;

/**
 * 本模块支持的表达式变量。
 *
 * 其余变量（`img` / `img_cr` / `img_o` / `ai` / `ao` 等）一律由 `verifyQuota` 在进入本文件前拒绝
 * —— 因为图片 / 音频类附加项不在覆盖范围内。
 */
export const SUPPORTED_EXPR_VARS = ["p", "c", "len", "cr", "cc", "cc1h", "cc12h"] as const;

/** 解开 `expr_b64` 并返回表达式引用的变量名；无法解码或解析时返回 `null` */
export function billingExprVars(o: Record<string, unknown>): string[] | null {
  const exprB64 = o["expr_b64"];
  if (typeof exprB64 !== "string" || exprB64 === "") return null;
  try {
    return [...compileBillingExpr(decodeBase64Utf8(exprB64)).vars];
  } catch {
    return null;
  }
}

/**
 * 按需要验算 `tiered_expr` 行；无法解析表达式时返回 `null`。
 *
 * 归一化方向在两种语义下**相反**，这是本函数最容易写错的地方：
 *   - OpenAI：`prompt_tokens` 含所有子类，表达式引用了某子类才从 `p` 里减掉
 *   - Anthropic：`input_tokens` 只含文本，表达式**没**引用某子类时才并回 `p`
 */
export function buildTieredCandidate(
  row: UsageLogLike,
  o: Record<string, unknown>,
  semantic: UsageSemantic,
  quotaPerUnit: number,
): QuotaCandidate | null {
  const exprB64 = o["expr_b64"];
  if (typeof exprB64 !== "string" || exprB64 === "") return null;

  let expr: string;
  let compiled;
  try {
    expr = decodeBase64Utf8(exprB64);
    compiled = compileBillingExpr(expr);
  } catch {
    return null;
  }

  const isAnthropic = semantic === "anthropic";
  const used = compiled.vars;

  let p = row.prompt_tokens;
  let c = row.completion_tokens;
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
  if (c < 0) c = 0;

  // 变量集合已由 billingExprVars 校验：只有 SUPPORTED_EXPR_VARS 里的变量能到达这里
  const vars: Record<string, number> = {
    p,
    c,
    len,
    cr,
    cc,
    cc1h,
    cc12h: readNumber(o, "cache_creation_tokens_12h"),
  };

  let rawCost: number;
  try {
    rawCost = compiled.eval(vars);
  } catch {
    // 求值期异常同样归为「无法验算」，不向调用方抛
    return null;
  }
  const groupRatio = readNumberOr(o, "group_ratio", 1);
  // 表达式系数单位是 $/1M tokens
  const afterGroup = (rawCost / 1_000_000) * quotaPerUnit * groupRatio;
  const expected = toQuota(afterGroup);

  return {
    branch: "tiered_expr",
    semantic,
    expected,
    delta: expected - row.quota,
    trace: { expr, vars, rawCost, quotaPerUnit, groupRatio },
  };
}
