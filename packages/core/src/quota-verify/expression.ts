/**
 * 计费表达式（`other.expr_b64`）的编译门面
 *
 * 词法 / 语法 / 求值分别落在 `expr-lexer.ts` · `expr-parser.ts` · `expr-eval.ts`。
 * 本文件只承担三件「不属于表达式语言本身」的事：
 *
 *   1. **版本前缀**：上游正式格式是 `v1:tier(...)`，无前缀即 v1。前缀要先剥掉再解析，
 *      否则会被当标识符 + 冒号，报一句莫名其妙的「末尾有多余记号」。
 *   2. **`|||` 请求条件倍率**：上游在编译前先按 `|||` 把「计费表达式」和「请求条件倍率」
 *      切开再拼成一条（见 `pkg/billingexpr/compile.go`）。这是 expr-lang 之外的拼接约定，
 *      解析器不该看到它。
 *   3. **失败归一**：把「读不懂」与「读懂了但不求值」压成同一种形状，让调用方能精确归因。
 *
 * 该字段**来自上游、不可信**，因此不交给任何外部解释器（禁止 `eval` / `new Function`）。
 *
 * Bun 纪律：只用 Web 标准 API（`atob` / `TextDecoder`）。
 */

import {
  ExprSyntaxError,
  ExprUnsupportedError,
  type ExprNode,
} from "./expr-ast.ts";
import { analyzeExpression, evaluateExpression, type ExprRejection } from "./expr-eval.ts";
import { parseExpression } from "./expr-parser.ts";

/** 编译成功的表达式 */
export interface CompiledExpr {
  /** 剥掉版本前缀后的表达式原文，供 trace 展示 */
  source: string;
  /** 表达式引用到的变量名（决定 `p` / `c` 的归一化方向） */
  vars: ReadonlySet<string>;
  eval: (vars: Record<string, number>) => number;
}

export type CompileOutcome =
  | { ok: true; compiled: CompiledExpr }
  | { ok: false; rejection: ExprRejection };

/** 版本前缀：`v1:` —— 本模块只实现 v1 */
const VERSION_PREFIX = /^([A-Za-z_][A-Za-z0-9_]*):/;

/** 计费表达式与请求条件倍率的分隔符 */
const REQUEST_RULE_SEPARATOR = "|||";

/** base64 → UTF-8 文本（Web 标准：atob + TextDecoder，无 Buffer） */
export function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function reject(rejection: ExprRejection): CompileOutcome {
  return { ok: false, rejection };
}

/**
 * 编译一段计费表达式。
 *
 * 成功时返回可直接求值的 `CompiledExpr`；失败时返回带 reason 的拒绝 —— 不再抛异常。
 * 调用方（`tiered.ts`）据此把「缺表达式」和「表达式不在范围内」分开报告。
 */
export function compileBillingExpr(raw: string): CompileOutcome {
  const separatorAt = raw.indexOf(REQUEST_RULE_SEPARATOR);
  if (separatorAt >= 0) {
    return reject({
      reason: "expr_unsupported",
      detail:
        "表达式带请求条件倍率（||| 之后的部分）：条件依赖请求头 / 时间等请求上下文，日志里没有，无法独立复算",
    });
  }

  let source = raw;
  const version = VERSION_PREFIX.exec(source);
  if (version !== null) {
    const tag = version[1] as string;
    if (tag !== "v1") {
      return reject({
        reason: "expr_unsupported",
        detail: `表达式的版本前缀是 ${tag}:，本模块只实现 v1 的语义`,
      });
    }
    source = source.slice(version[0].length);
  }

  let ast: ExprNode;
  try {
    ast = parseExpression(source);
  } catch (error) {
    if (error instanceof ExprUnsupportedError) {
      return reject({
        reason: "expr_unsupported",
        detail: `${error.construct} 不在本模块的求值范围内`,
      });
    }
    if (error instanceof ExprSyntaxError) {
      return reject({ reason: "expr_grammar", detail: `表达式无法解析：${error.message}` });
    }
    throw error;
  }

  const analysis = analyzeExpression(ast);
  if (!analysis.ok) return { ok: false, rejection: analysis.rejection };

  return {
    ok: true,
    compiled: {
      source,
      vars: new Set(analysis.analysis.vars),
      // 求值器只处理白名单内的节点，因此这里不再需要 try/catch
      eval: (values) => evaluateExpression(ast, values),
    },
  };
}
