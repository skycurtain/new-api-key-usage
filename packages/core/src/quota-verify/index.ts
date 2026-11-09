/**
 * NewAPI quota 验算（诊断用）
 *
 * 覆盖范围 = **纯 token 计费**的文本调用：`PostTextConsumeQuota` 这一条结算路径
 * （chat / embeddings / responses / responses-compact 都汇入它）× 两种计费制 × 两种语义：
 *   - 计费制：`tiered_expr`（表达式计费）/ 倍率制（`model_ratio > 0`）
 *   - 语义：`anthropic`（`input_tokens` 不含缓存）/ `openai`（`prompt_tokens` 含缓存）
 *   - 计入的量：输入 / 输出 token、缓存读、缓存写（含 5m / 1h / 12h 拆分）、分组倍率
 *
 * 不覆盖 —— 一律返回 `unsupported`，不猜测、不"尽力而为"：
 *   附加项           `image_tokens` 图片 token · `audio_tokens` 音频输入 · `tool_surcharge` 工具附加费
 *   其它调用形态     `task` MJ/异步任务 · `realtime` 实时语音 · `audio` 音频 TTS/STT
 *   其它计价方式     `fixed_price` 按次固定价
 *   认不出来         `not_text_path` 缺文本日志签名键 · `no_billing_info` 字段缺失
 *   表达式           `expr_grammar` 语法坏 · `fixed_expr` 用 fixed() 按次
 *                    `expr_unsupported` 构造/函数不在白名单（detail 带名字）· `expr_var` 变量不支持
 *
 * 已知结构性盲区（日志侧不可得，后果是「对不上」而非「算错」）：
 *   OpenRouter-Claude 归一化需 `ChannelType`；估算路径 / 金额饱和 / 实际渠道在 `admin_info`。
 *   详见文档 §7.3。
 *
 * 依据：`docs/references/NewAPI-用量计算链路.md`
 *   NewAPI v1.0.0-rc.49 源码 + 真机日志逐行验算核对（偏差为 0）
 *
 * 设计原则：**宁可返回未覆盖，也不静默给出一个错的数。**
 *
 * 消费契约：只有 `status === "matched"` 才可向用户展示数字；
 * `unmatched` / `unsupported` 只展示原因，**不得把候选值当结果**。
 *
 * 模块划分（`packages/core/src/quota-verify/`）：
 *   expr-lexer.ts    词法（numbers / strings / idents / operators）
 *   expr-ast.ts      AST 节点与两类编译期拒绝
 *   expr-parser.ts   Pratt 解析器，优先级照抄 expr-lang v1.17.8
 *   expr-eval.ts     能力白名单 + 解释器
 *   expression.ts    `expr_b64` 的编译门面（版本前缀 / `|||` / 失败归一）
 *   math.ts          取整 / 饱和 / 字段读取
 *   types.ts         公共类型与常量
 *   tiered.ts        表达式计费分支
 *   multiplier.ts    倍率制分支
 *   index.ts         本文件：路径判定 + 分派
 *
 * Bun 纪律：只用 TypeScript 标准库与 Web 标准 API，不引 `Bun.*` / `node:*`。
 */

import { readNumber } from "./math.ts";
import { buildMultiplierCandidate } from "./multiplier.ts";
import { buildTieredCandidate, compileTieredExpr } from "./tiered.ts";
import {
  DEFAULT_QUOTA_PER_UNIT,
  type QuotaCandidate,
  type QuotaVerify,
  type QuotaVerifyOptions,
  type UnsupportedReason,
  type UsageLogLike,
  type UsageSemantic,
} from "./types.ts";

export * from "./types.ts";

/**
 * 文本日志构建器（`GenerateTextOtherInfo` / `GenerateClaudeOtherInfo`）无条件写入的键。
 *
 * 它只是「这条日志出自 `GenerateTextOtherInfo`」的**指纹**，不是「文本对话」的充分条件：
 *   - WS / 音频也先经同一个构建器 —— 靠前面 `ws` / `audio` 标记拦掉
 *   - **按次的文本请求也会写这四个键** —— 由后面的 `model_price > 0` 拦掉，不是靠签名
 *   - 真正不写这组键的是 `GenerateMjOtherInfo` 与 `taskBillingOther`
 */
const TEXT_LOG_KEYS = [
  "cache_tokens",
  "cache_ratio",
  "completion_ratio",
  "user_group_ratio",
] as const;

function hasTextLogSignature(o: Record<string, unknown>): boolean {
  return TEXT_LOG_KEYS.every((k) => k in o);
}

/**
 * 判定这次调用被 NewAPI 按哪套口径结算。
 *
 * `usage_semantic` 是 rc49 的权威标记（仅 Anthropic 语义写）；`claude` 次之。
 * 两者都没有时同时尝试两种语义 —— 让 `quota` 自己去选，
 * 而不是拿"键是否存在"这种不健全的启发式去赌。
 */
function candidateSemantics(o: Record<string, unknown>): UsageSemantic[] {
  const tagged = o["usage_semantic"];
  if (tagged === "anthropic") return ["anthropic"];
  if (tagged === "openai") return ["openai"];
  if (o["claude"] === true) return ["anthropic"];
  return ["openai", "anthropic"];
}

function dedupeCandidates(candidates: QuotaCandidate[]): QuotaCandidate[] {
  const seen = new Set<string>();
  const out: QuotaCandidate[] = [];
  for (const c of candidates) {
    const key = `${c.branch}|${c.expected}|${JSON.stringify(c.trace.vars ?? c.trace.promptPart ?? null)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(c);
  }
  return out;
}

function unsupported(reason: UnsupportedReason, detail: string): QuotaVerify {
  return { status: "unsupported", reason, detail };
}

/**
 * 验算一条 `type=2` 消费日志的 `quota`。
 *
 * 只实现文本对话的两条路径（倍率制 / 表达式计费）× 两种语义。
 * 其余调用形态一律返回 `unsupported` 并说明原因，不做估算。
 */
export function verifyQuota(row: UsageLogLike, options: QuotaVerifyOptions = {}): QuotaVerify {
  const raw = row.other;
  if (raw === null || raw === undefined || typeof raw !== "object") {
    return unsupported("no_billing_info", "other 缺失或不是对象");
  }
  const o = raw as Record<string, unknown>;

  // MJ / 异步任务：service/task_billing.go 的 LogTaskConsumption / taskBillingOther 写 is_task。
  // 这类日志按「预扣 + 差额结算」记两笔，单行无法还原，且其 tiered 走 RequestInput 而非 P/C/CR/CC。
  if (o["is_task"] === true) {
    return unsupported(
      "task",
      "MJ / 异步任务日志（other.is_task），按预扣与差额结算两次记账，单行不可验算",
    );
  }

  // 实时语音：relay/websocket.go WssHelper → service.PostWssConsumeQuota → calculateAudioQuota
  if (o["ws"] === true) {
    return unsupported("realtime", "实时语音（other.ws），走 calculateAudioQuota，本模块未实现");
  }

  // 音频 TTS/STT：relay/audio_handler.go AudioHelper → service.PostAudioConsumeQuota
  if (o["audio"] === true) {
    return unsupported("audio", "音频 TTS/STT（other.audio），走 calculateAudioQuota，本模块未实现");
  }

  // 非文本路径兜底：文本日志构建器无条件写 TEXT_LOG_KEYS，缺失即不是文本对话行。
  if (!hasTextLogSignature(o)) {
    const missing = TEXT_LOG_KEYS.filter((k) => !(k in o));
    return unsupported(
      "not_text_path",
      `缺少文本日志构建器的签名键（${missing.join(", ")}），判定为非文本对话路径`,
    );
  }

  // 按次固定价：model_price > 0。按次计费不在覆盖范围，且两种子情形性质不同：
  //   - 纯文本：quota = model_price × QPU × group_ratio，日志字段本身够用，只是本模块不做
  //   - 带图片/视频倍数：other_ratios（如 n）不写公共层 → 不可验算
  if (readNumber(o, "model_price") > 0) {
    const path = typeof o["request_path"] === "string" ? o["request_path"] : "";
    // 只能识别图片入口；视频秒数等其它请求级倍数无标记，故非图片时不敢断言公式一定成立
    if (path.startsWith("/v1/images/")) {
      return unsupported(
        "fixed_price",
        "按次固定价 + 图片请求：other_ratios（如 n）不写日志，不可验算",
      );
    }
    return unsupported(
      "fixed_price",
      "按次固定价（model_price > 0）不在覆盖范围；纯文本情形公式本身可算",
    );
  }

  // 附加项一律不在覆盖范围：图片 token / 音频 token / 工具附加费，命中即拒
  if ("image_output" in o || o["image"] === true) {
    return unsupported(
      "image_tokens",
      "含图片 token 项（image / image_output），而图片类附加项不在覆盖范围",
    );
  }
  if ("audio_input_price" in o || "audio_input_token_count" in o) {
    return unsupported(
      "audio_tokens",
      "含音频输入 token 项（audio_input_price / audio_input_token_count），而音频类附加项不在覆盖范围",
    );
  }
  if ("tool_surcharges" in o) {
    return unsupported(
      "tool_surcharge",
      "含工具调用附加费（tool_surcharges），而工具类附加费不在覆盖范围",
    );
  }

  const quotaPerUnit = options.quotaPerUnit ?? DEFAULT_QUOTA_PER_UNIT;
  const semantics = candidateSemantics(o);
  const candidates: QuotaCandidate[] = [];

  if (o["billing_mode"] === "tiered_expr") {
    // 表达式只编译一次：变量白名单、语法、能力判定都在编译期一次做完，
    // 失败原因也随之精确到「哪一类不支持」，不再笼统归到「缺 expr_b64」。
    const outcome = compileTieredExpr(o);
    if (!outcome.ok) {
      return unsupported(outcome.rejection.reason, outcome.rejection.detail);
    }
    for (const semantic of semantics) {
      candidates.push(buildTieredCandidate(row, o, outcome.compiled, semantic, quotaPerUnit));
    }
  } else if (readNumber(o, "model_ratio") > 0) {
    // 倍率制：model_price 的哨兵值为 -1（无固定单价），不是 0
    for (const semantic of semantics) {
      candidates.push(buildMultiplierCandidate(row, o, semantic, quotaPerUnit));
    }
  } else {
    return unsupported(
      "no_billing_info",
      "既无 model_ratio、无 model_price，也非 tiered_expr（免费模型或字段缺失）",
    );
  }

  const deduped = dedupeCandidates(candidates);
  const hit = deduped.find((c) => c.delta === 0);
  if (hit !== undefined) {
    return { status: "matched", actual: row.quota, candidate: hit, candidates: deduped };
  }
  return { status: "unmatched", actual: row.quota, candidates: deduped };
}
