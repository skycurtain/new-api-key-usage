/**
 * 计费表达式的求值器与能力白名单
 *
 * 分工：
 *   - `analyzeExpression` —— 编译期。走一遍 AST，判掉本模块不求值的构造 / 函数 / 变量，
 *     并收集表达式**引用了哪些变量**（决定 `p` / `c` 的归一化方向）。
 *   - `evaluateExpression` —— 求值期。只处理白名单内的节点，因此不会有"算到一半发现不会算"。
 *
 * 白名单的依据是**数据可得性**，不是难度：
 *   `p` `c` `len` `cr` `cc` `cc1h` `cc12h` 与 token 量一一对应，日志里有；
 *   `param()` / `header()` / `hour()` / `u()` 依赖请求上下文或任务用量，**日志里没有**，
 *   无论实现得多完整都不可能独立复算 —— 这类必须拒绝，而不是猜一个值。
 *
 * 环境与类型来自 `pkg/billingexpr/run.go`：所有变量与函数都在 float64 上运算，
 * 因此 JavaScript 的 number 语义与上游逐位一致（`/` 是浮点除、`%` 取余符号随被除数）。
 */

import type { BinaryOp, ExprNode, UnaryOp } from "./expr-ast.ts";
import type { UnsupportedReason } from "./types.ts";

/** 求值期的值域：与上游环境一致，只可能出现这四种 */
export type ExprValue = number | string | boolean | null;

/** 本模块提供取值的变量（其余一律拒绝） */
export const SUPPORTED_VARS = ["p", "c", "len", "cr", "cc", "cc1h", "cc12h"] as const;

/** 引用了即属图片类附加项 */
const IMAGE_VARS = new Set(["img", "img_cr", "img_o", "image_count"]);

/** 引用了即属音频类附加项 */
const AUDIO_VARS = new Set(["ai", "ao"]);

/**
 * 可求值的函数。
 *
 * `max` / `min` / `abs` / `ceil` / `floor` 在上游直接绑定到 `math.*`（`run.go`），
 * 与 `Math.*` 逐位一致，且只吃 token 数，不引入任何外部语境。
 */
const SUPPORTED_FUNCS = new Set(["tier", "max", "min", "abs", "ceil", "floor"]);

/** 白名单函数的参数个数：编译期就查死，避免求值期静默补 0 或丢参 */
const FUNC_ARITY: Record<string, number> = {
  tier: 2,
  max: 2,
  min: 2,
  abs: 1,
  ceil: 1,
  floor: 1,
};

/** 上游有、但会切换到按次计费的函数 */
const FIXED_FUNC = "fixed";

/**
 * 上游有、但无法从日志独立复算的函数 —— 拒绝时要能说出是哪一个。
 */
const CONTEXT_FUNCS: Record<string, string> = {
  param: "读取请求体的 param()",
  header: "读取请求头的 header()",
  has: "子串判断 has()",
  u: "任务用量 u()",
  hour: "时间函数 hour()",
  minute: "时间函数 minute()",
  weekday: "时间函数 weekday()",
  month: "时间函数 month()",
  day: "时间函数 day()",
  _trace: "内部追踪函数",
};

/** 中缀运算符 → 拒绝时展示的名字（这些运算符的语义依赖集合 / 字符串 / 正则） */
const OPERATOR_LABELS: Partial<Record<BinaryOp, string>> = {
  in: "运算符 in",
  "not in": "运算符 not in",
  matches: "正则匹配 matches",
  "not matches": "正则匹配 not matches",
  contains: "字符串运算符 contains",
  startsWith: "字符串运算符 startsWith",
  endsWith: "字符串运算符 endsWith",
};

/** 求值期可能出现的内部错误；正常的上游日志不会触发 */
export class ExprEvalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExprEvalError";
  }
}

/** 编译期判定的拒绝结果 */
export interface ExprRejection {
  reason: UnsupportedReason;
  detail: string;
}

export interface ExprAnalysis {
  /** 表达式引用到的变量名，按首次出现顺序去重 */
  vars: string[];
}

type AnalysisOutcome =
  | { ok: true; analysis: ExprAnalysis }
  | { ok: false; rejection: ExprRejection };

/** 收集过程中攒下的问题，最后按固定优先级挑一个报出去 */
interface Issues {
  fixed: boolean;
  /** 参数个数不对的白名单函数（形如 `tier() 需要 2 个参数，实际 1 个`） */
  arity: string[];
  /** 上游有、但依赖请求上下文 / 按次价格的函数（已翻译成中文标签） */
  calls: string[];
  /** 上游函数表里根本没有的名字 */
  unknown: string[];
  forms: string[];
  vars: string[];
}

function collect(node: ExprNode, issues: Issues): void {
  switch (node.k) {
    case "num":
    case "str":
    case "bool":
    case "nil":
      return;

    case "ident":
      if (!issues.vars.includes(node.name)) issues.vars.push(node.name);
      return;

    case "unary":
      collect(node.operand, issues);
      return;

    case "binary": {
      const label = OPERATOR_LABELS[node.op];
      if (label !== undefined && !issues.forms.includes(label)) issues.forms.push(label);
      collect(node.left, issues);
      collect(node.right, issues);
      return;
    }

    case "ternary":
      collect(node.cond, issues);
      collect(node.then, issues);
      collect(node.otherwise, issues);
      return;

    case "coalesce":
      collect(node.left, issues);
      collect(node.right, issues);
      return;

    case "call": {
      if (node.name === FIXED_FUNC) {
        issues.fixed = true;
      } else if (!SUPPORTED_FUNCS.has(node.name)) {
        const known = CONTEXT_FUNCS[node.name];
        if (known !== undefined) {
          if (!issues.calls.includes(known)) issues.calls.push(known);
        } else if (!issues.unknown.includes(node.name)) {
          issues.unknown.push(node.name);
        }
      } else {
        // 参数个数在编译期就查死：留到求值期只会在少参时静默补 0、多参时静默丢弃
        const expected = FUNC_ARITY[node.name];
        if (expected !== undefined && node.args.length !== expected) {
          const message = `${node.name}() 需要 ${expected} 个参数，实际 ${node.args.length} 个`;
          if (!issues.arity.includes(message)) issues.arity.push(message);
        }
      }
      for (const arg of node.args) collect(arg, issues);
      return;
    }

    case "member":
    case "index":
    case "slice":
    case "array":
    case "map":
    case "range": {
      const label =
        node.k === "member"
          ? "成员访问 . / ?."
          : node.k === "index"
            ? "下标访问 []"
            : node.k === "slice"
              ? "切片 [:]"
              : node.k === "array"
                ? "数组字面量"
                : node.k === "map"
                  ? "映射字面量"
                  : "区间 ..";
      if (!issues.forms.includes(label)) issues.forms.push(label);
      walkChildren(node, issues);
      return;
    }
  }
}

/** 有子节点的构造继续往下走，避免漏掉嵌套的问题 */
function walkChildren(node: ExprNode, issues: Issues): void {
  switch (node.k) {
    case "member":
      collect(node.object, issues);
      return;
    case "index":
      collect(node.object, issues);
      collect(node.index, issues);
      return;
    case "slice":
      collect(node.object, issues);
      if (node.from !== null) collect(node.from, issues);
      if (node.to !== null) collect(node.to, issues);
      return;
    case "array":
      for (const item of node.items) collect(item, issues);
      return;
    case "map":
      for (const entry of node.entries) {
        collect(entry.key, issues);
        collect(entry.value, issues);
      }
      return;
    case "range":
      collect(node.low, issues);
      collect(node.high, issues);
      return;
    default:
      return;
  }
}

/**
 * 编译期判定：这个表达式能否在本模块求值。
 *
 * 拒绝优先级固定为 参数个数 → 按次 → 语境相关 → 未知函数 → 未支持构造 → 变量，
 * 与 `verifyQuota` 文档里的顺序一致；同一类里报第一处出现的位置，
 * 保证同一个表达式永远得到同一个原因（不会因为遍历顺序变化而漂移）。
 */
export function analyzeExpression(ast: ExprNode): AnalysisOutcome {
  const issues: Issues = {
    fixed: false,
    arity: [],
    calls: [],
    unknown: [],
    forms: [],
    vars: [],
  };
  collect(ast, issues);

  const arityError = issues.arity[0];
  if (arityError !== undefined) {
    return {
      ok: false,
      rejection: { reason: "expr_grammar", detail: arityError },
    };
  }

  if (issues.fixed) {
    return {
      ok: false,
      rejection: {
        reason: "fixed_expr",
        detail: "表达式用了 fixed()：这是按次计费的档位，本模块只验算 token 计费",
      },
    };
  }

  const firstCall = issues.calls[0];
  if (firstCall !== undefined) {
    return {
      ok: false,
      rejection: {
        reason: "expr_unsupported",
        detail: `${firstCall} 依赖请求上下文或按次价格，日志里没有，无法独立复算`,
      },
    };
  }

  const firstUnknown = issues.unknown[0];
  if (firstUnknown !== undefined) {
    return {
      ok: false,
      rejection: {
        reason: "expr_unsupported",
        detail: `函数 ${firstUnknown}() 不在上游 billingexpr 的已知函数表里，本模块无从复算`,
      },
    };
  }

  const firstForm = issues.forms[0];
  if (firstForm !== undefined) {
    return {
      ok: false,
      rejection: {
        reason: "expr_unsupported",
        detail: `${firstForm} 不在本模块的求值白名单里`,
      },
    };
  }

  const supported: readonly string[] = SUPPORTED_VARS;
  const offending = issues.vars.filter((v) => !supported.includes(v));
  if (offending.length > 0) {
    const sorted = [...offending].sort();
    const image = sorted.filter((v) => IMAGE_VARS.has(v));
    if (image.length > 0) {
      return {
        ok: false,
        rejection: {
          reason: "image_tokens",
          detail: `表达式引用了图片 token 变量 ${image.join(", ")}，而图片类附加项不在覆盖范围`,
        },
      };
    }
    const audio = sorted.filter((v) => AUDIO_VARS.has(v));
    if (audio.length > 0) {
      return {
        ok: false,
        rejection: {
          reason: "audio_tokens",
          detail: `表达式引用了音频 token 变量 ${audio.join(", ")}，而音频类附加项不在覆盖范围`,
        },
      };
    }
    return {
      ok: false,
      rejection: {
        reason: "expr_var",
        detail: `表达式引用了本模块不提供的变量：${sorted.join(", ")}`,
      },
    };
  }

  return { ok: true, analysis: { vars: issues.vars } };
}

/* ------------------------------------------------------------------ */
/* 求值                                                                */
/* ------------------------------------------------------------------ */

function toNumber(v: ExprValue): number {
  if (typeof v === "number") return v;
  if (typeof v === "boolean") return v ? 1 : 0;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

/** expr-lang 是强类型的：只有布尔 `true` 才算真，`1` / `"x"` 都不会被当成真 */
function truthy(v: ExprValue): boolean {
  return v === true;
}

function applyUnary(op: UnaryOp, v: ExprValue): ExprValue {
  switch (op) {
    case "-":
      return -toNumber(v);
    case "+":
      return toNumber(v);
    case "!":
      return !truthy(v);
  }
}

function compareStrings(op: BinaryOp, l: string, r: string): boolean | undefined {
  switch (op) {
    case "==":
      return l === r;
    case "!=":
      return l !== r;
    case "<":
      return l < r;
    case "<=":
      return l <= r;
    case ">":
      return l > r;
    case ">=":
      return l >= r;
    default:
      return undefined;
  }
}

function applyBinary(op: BinaryOp, l: ExprValue, r: ExprValue): ExprValue {
  // 字符串拼接：上游 `+` 对字符串是连接
  if (op === "+" && typeof l === "string" && typeof r === "string") return l + r;

  switch (op) {
    case "&&":
      return truthy(l) && truthy(r);
    case "||":
      return truthy(l) || truthy(r);
    case "==":
    case "!=": {
      // 强类型比较：`1 == "1"` 在上游是编译期就通不过的，这里按类型不同直接判不等
      let equal: boolean;
      if (typeof l === "string" || typeof r === "string") {
        equal = typeof l === "string" && typeof r === "string" ? l === r : false;
      } else if (typeof l === "boolean" || typeof r === "boolean") {
        equal = typeof l === "boolean" && typeof r === "boolean" ? l === r : false;
      } else {
        equal = toNumber(l) === toNumber(r);
      }
      return op === "==" ? equal : !equal;
    }
    default:
      break;
  }

  if (typeof l === "string" && typeof r === "string") {
    const result = compareStrings(op, l, r);
    if (result !== undefined) return result;
  }

  const a = toNumber(l);
  const b = toNumber(r);
  switch (op) {
    case "+":
      return a + b;
    case "-":
      return a - b;
    case "*":
      return a * b;
    case "/":
      // 与 Go float64 一致：除零得到 ±Infinity，0/0 得到 NaN
      return a / b;
    case "%":
      // 与 Go math.Mod / JS 一致：结果符号随被除数
      return a % b;
    case "**":
      return a ** b;
    case "<":
      return a < b;
    case "<=":
      return a <= b;
    case ">":
      return a > b;
    case ">=":
      return a >= b;
    default:
      // in / matches / contains 等已在 analyzeExpression 阶段拒绝，走不到这里
      throw new ExprEvalError(`未实现的运算符：${String(op)}`);
  }
}

/** 一次求值的结果：数值 + 旁路信息 */
export interface EvalResult {
  value: number;
  /** `tier()` 命中的档名；表达式没有 tier 包裹时为 null */
  matchedTier: string | null;
}

/** 求值期旁路：目前只收 `tier()` 的档名（供「计算过程」展示命中档位） */
interface EvalState {
  matchedTier: string | null;
}

function evalNode(
  node: ExprNode,
  vars: Record<string, number>,
  state: EvalState,
): ExprValue {
  switch (node.k) {
    case "num":
      return node.v;
    case "str":
      return node.v;
    case "bool":
      return node.v;
    case "nil":
      return null;
    case "ident": {
      // 上游的 env 永远把 13 个变量填满（没有的补 0，见 run.go），
      // 所以「没给」必须按 0 处理，不能当成错误
      return vars[node.name] ?? 0;
    }
    case "unary":
      return applyUnary(node.op, evalNode(node.operand, vars, state));
    case "binary":
      return applyBinary(
        node.op,
        evalNode(node.left, vars, state),
        evalNode(node.right, vars, state),
      );
    case "ternary":
      return truthy(evalNode(node.cond, vars, state))
        ? evalNode(node.then, vars, state)
        : evalNode(node.otherwise, vars, state);
    case "coalesce": {
      const left = evalNode(node.left, vars, state);
      return left === null ? evalNode(node.right, vars, state) : left;
    }
    case "call": {
      // tier(name, value)：计费取第二个参数；档名只记进旁路，不参与计算
      if (node.name === "tier") {
        if (node.args.length !== 2) {
          throw new ExprEvalError(`tier() 需要 2 个参数，实际 ${node.args.length} 个`);
        }
        const nameArg = node.args[0];
        // 三元只有一个分支会被求值，所以「最后命中的档名」就是真正跑的那一支
        if (nameArg !== undefined && nameArg.k === "str") state.matchedTier = nameArg.v;
        return evalNode(node.args[1] as ExprNode, vars, state);
      }
      const args = node.args.map((a) => toNumber(evalNode(a, vars, state)));
      const [first, second] = args;
      switch (node.name) {
        case "max":
          return Math.max(first ?? 0, second ?? 0);
        case "min":
          return Math.min(first ?? 0, second ?? 0);
        case "abs":
          return Math.abs(first ?? 0);
        case "ceil":
          return Math.ceil(first ?? 0);
        case "floor":
          return Math.floor(first ?? 0);
        default:
          throw new ExprEvalError(`未实现的函数：${node.name}`);
      }
    }
    default:
      throw new ExprEvalError(`未实现的表达式节点：${node.k}`);
  }
}

/**
 * 求值。调用前必须已通过 `analyzeExpression` —— 这里假定所有构造都在白名单内。
 *
 * 数值语义刻意贴着 Go 的 float64 走，不做任何取整或钳制：
 * 取整与 int32 饱和是结算层（`math.ts` 的 `toQuota`）的事。
 */
export function evaluateExpression(
  node: ExprNode,
  vars: Record<string, number>,
): EvalResult {
  const state: EvalState = { matchedTier: null };
  const value = toNumber(evalNode(node, vars, state));
  return { value, matchedTier: state.matchedTier };
}
