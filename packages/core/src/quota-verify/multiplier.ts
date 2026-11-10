/**
 * 倍率制（`model_ratio > 0`）的 quota 验算——**只处理纯 token 计费**
 *
 * 来源：`service/text_quota.go` · `calculateTextQuotaSummary` 的倍率制分支。
 * 依据：`docs/references/NewAPI-用量计算链路.md` §4
 *
 * 范围：缓存读、缓存写（含 5m / 1h / 12h 拆分）、输出 token、分组倍率。
 * 图片 token、音频输入、工具调用附加费**不在范围内**——`verifyQuota` 在进入本函数前就已拒绝。
 */

import { readNumber, readNumberOr, toQuota } from "./math.ts";
import type { QuotaCandidate, UsageLogLike, UsageSemantic } from "./types.ts";

/**
 * 验算一次倍率制结算。
 *
 * 顺序严格对齐源码：`baseTokens` 被缓存与缓存写**逐项扣减**，
 * 全部扣完后**才一次性夹零**；各子项在 `baseTokens` 之外独立累加。
 */
export function buildMultiplierCandidate(
  row: UsageLogLike,
  o: Record<string, unknown>,
  semantic: UsageSemantic,
  quotaPerUnit: number,
): QuotaCandidate {
  const groupRatio = readNumberOr(o, "group_ratio", 1);
  const modelRatio = readNumber(o, "model_ratio");
  const completionRatio = readNumberOr(o, "completion_ratio", 1);
  const cacheTokens = readNumber(o, "cache_tokens");
  const cacheRatio = readNumber(o, "cache_ratio");
  const ccTotal = readNumber(o, "cache_creation_tokens");
  const ccRatio = readNumber(o, "cache_creation_ratio");
  const cc5m = readNumber(o, "cache_creation_tokens_5m");
  const cc1h = readNumber(o, "cache_creation_tokens_1h");
  const cc12h = readNumber(o, "cache_creation_tokens_12h");

  const isAnthropic = semantic === "anthropic";
  // isLegacyClaudeDerivedOpenAIUsage 的日志侧近似：无语义标记但带 5m/1h 拆分
  const legacyClaudeDerived = !isAnthropic && (cc5m > 0 || cc1h > 0);

  let base = row.prompt_tokens;

  // ① 缓存读
  let cachedPart = 0;
  if (cacheTokens !== 0) {
    if (!isAnthropic && !legacyClaudeDerived) base -= cacheTokens;
    cachedPart = cacheTokens * cacheRatio;
  }

  // ② 缓存写
  let ccPart = 0;
  if (ccTotal > 0 || cc5m > 0 || cc1h > 0) {
    if (!isAnthropic && !legacyClaudeDerived) {
      // OpenAI：缓存写已含在 prompt 里，先扣整额再按各自的率加回
      base -= ccTotal;
      ccPart =
        (ccTotal - cc12h) * ccRatio + cc12h * readNumberOr(o, "cache_creation_ratio_12h", ccRatio);
    } else {
      // Anthropic：prompt 不含缓存写，按 5m/1h 拆分加入
      const rest = Math.max(ccTotal - cc5m - cc1h, 0);
      ccPart =
        rest * ccRatio +
        cc5m * readNumberOr(o, "cache_creation_ratio_5m", ccRatio) +
        cc1h * readNumberOr(o, "cache_creation_ratio_1h", ccRatio);
    }
  }

  // ③ 全部扣减完成后才夹零
  if (base < 0) base = 0;

  const promptPart = base + cachedPart + ccPart;
  const outputPart = row.completion_tokens * completionRatio;

  const ratio = modelRatio * groupRatio;
  let total = (promptPart + outputPart) * ratio;

  // ④ 取整前守卫（仅倍率制分支有）
  if (ratio !== 0 && total <= 0) total = 1;

  let expected = toQuota(total);

  // ⑤ hasBillableUsage：Claude 语义下"只有缓存"也算可计费
  const billable =
    row.prompt_tokens + row.completion_tokens > 0 ||
    (isAnthropic && (cacheTokens > 0 || ccTotal > 0 || cc5m > 0 || cc1h > 0));

  if (!billable) expected = 0;
  else if (ratio !== 0 && expected === 0) expected = 1;

  return {
    branch: "multiplier",
    semantic,
    expected,
    delta: expected - row.quota,
    trace: {
      base,
      cachedPart,
      cacheCreationPart: ccPart,
      outputPart,
      promptPart,
      modelRatio,
      completionRatio,
      total,
      quotaPerUnit,
      groupRatio,
    },
  };
}
