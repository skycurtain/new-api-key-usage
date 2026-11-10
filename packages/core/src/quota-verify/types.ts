/**
 * quota 验算的公共类型与常量
 *
 * 用途与全部依据见 `docs/references/NewAPI-用量计算链路.md`。
 */

/** `QuotaPerUnit` 的上游出厂默认值（真机由 `/api/status` 提供，**不得当作验算输入**） */
export const DEFAULT_QUOTA_PER_UNIT = 500_000;

/** 结算路径：表达式计费 / 倍率制 */
export type QuotaBranch = "tiered_expr" | "multiplier";

/** 上游 usage 的口径：Anthropic 的 input 不含缓存，OpenAI 的 prompt 含缓存 */
export type UsageSemantic = "anthropic" | "openai";

/** 已知存在、但本模块**不处理**的情形：调用形态 / 计价方式 / 计费构成 / 表达式变量 */
export type UnsupportedReason =
  /** `other` 缺失，或字段不足以判定任何一条已实现的分支 */
  | "no_billing_info"
  /** 不是 `PostTextConsumeQuota` 这一条路径：缺 `GenerateTextOtherInfo` 的签名键 */
  | "not_text_path"
  /** MJ / 异步任务：`LogTaskConsumption` / `taskBillingOther`（`other.is_task = true`） */
  | "task"
  /** 实时语音：`WssHelper` → `PostWssConsumeQuota` → `calculateAudioQuota` */
  | "realtime"
  /** 音频 TTS/STT：`AudioHelper` → `PostAudioConsumeQuota` → `calculateAudioQuota` */
  | "audio"
  /**
   * 按次固定价：`model_price > 0`，按次计费不在覆盖范围。两种子情形性质不同：
   *   - 纯文本：`quota = model_price × QPU × group_ratio`，日志字段本身够用，只是本模块不做
   *   - 带图片/视频倍数：`other_ratios`（如 `n`）不写公共层，**不可**验算
   */
  | "fixed_price"
  /** 图片 token 项（`image` / `image_output` 出现在文本路径日志里）—— 附加项不在范围内 */
  | "image_tokens"
  /** 音频 token 项（`audio_input_price` / `audio_input_token_count`）—— 附加项不在范围内 */
  | "audio_tokens"
  /** 工具调用附加费（`tool_surcharges`）—— 附加项不在范围内 */
  | "tool_surcharge"
  /** 表达式无法解析：词法 / 语法错误，表达式本身就是坏的 */
  | "expr_grammar"
  /** 表达式用了 `fixed()`：按次计费，不在覆盖范围 */
  | "fixed_expr"
  /**
   * 语法上认得，但构造 / 函数 / 运算符不在本模块的求值白名单里。
   * `detail` 一定带具体名字（如「时间函数 hour()」「数组字面量」），不让调用方自己猜。
   */
  | "expr_unsupported"
  /** 表达式引用了本模块不提供的变量（仅支持 `p` `c` `len` `cr` `cc` `cc1h` `cc12h`） */
  | "expr_var";

/** `usage_logs` 中参与验算的列（其余列与本计算无关） */
export interface UsageLogLike {
  prompt_tokens: number;
  completion_tokens: number;
  quota: number;
  other?: Record<string, unknown> | null;
}

export interface QuotaVerifyOptions {
  /**
   * 该行**写时**的 `quota_per_unit`（按 `created_at` 从 `qpu_history` 解析）。
   *
   * **必填、无默认值**：历史 `quota` 整数永不被上游回填，表达式计费路径把当时的 QPU
   * 乘进了这个整数里。用「当前值」重放，等于重放一次没发生过的结算——
   * QPU 一旦变过，整片历史都会假性不一致。详见 `docs/design/验算功能实现方案.md`。
   */
  quotaPerUnit: number;
}

/** 验算中间量，供人工核对与「计算过程」展示 */
export interface VerifyTrace {
  /** tiered：解出的表达式文本 */
  expr?: string;
  /** tiered：`tier()` 命中的档名 */
  matchedTier?: string | null;
  /** tiered：表达式变量最终取值（**仅表达式引用到的**） */
  vars?: Record<string, number>;
  /** tiered：表达式求值结果（$/1M × tokens 的中间量） */
  rawCost?: number;
  quotaPerUnit?: number;
  groupRatio?: number;
  /** 倍率制：夹零后的输入基底（已扣除缓存读 / 缓存写 token） */
  base?: number;
  /** 倍率制：缓存读贡献（已乘 `cache_ratio`） */
  cachedPart?: number;
  /** 倍率制：缓存写贡献（已乘各自的倍率） */
  cacheCreationPart?: number;
  /** 倍率制：输出贡献（已乘 `completion_ratio`） */
  outputPart?: number;
  /** 倍率制：输入侧合计（`base + 缓存读 + 缓存写`） */
  promptPart?: number;
  /** 倍率制：`model_ratio` */
  modelRatio?: number;
  /** 倍率制：`completion_ratio` */
  completionRatio?: number;
  /** 倍率制：乘完倍率、未取整的原始值 */
  total?: number;
}

/** 一次分支尝试的结果 */
export interface QuotaCandidate {
  branch: QuotaBranch;
  semantic: UsageSemantic;
  /** 验算得到的 quota（已四舍五入、已按 int32 饱和） */
  expected: number;
  /** `expected − 日志 quota`；为 0 即精确命中 */
  delta: number;
  trace: VerifyTrace;
}

export type QuotaVerify =
  | {
      status: "matched";
      actual: number;
      candidate: QuotaCandidate;
      candidates: QuotaCandidate[];
    }
  | { status: "unmatched"; actual: number; candidates: QuotaCandidate[] }
  | { status: "unsupported"; reason: UnsupportedReason; detail: string };
