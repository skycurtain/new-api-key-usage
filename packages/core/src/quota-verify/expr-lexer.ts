/**
 * 计费表达式的词法分析
 *
 * 语法基线：expr-lang v1.17.8（见 `docs/references/计费表达式语法.md`）
 *
 * token 分五类：数字、字符串、标识符、运算符、结尾。
 * 关键字（`in` / `and` / `not` / `true` / `nil` …）不单独分类，一律当标识符产出，
 * 由 parser 按「出现在哪个位置」决定它是字面量、前缀运算符还是中缀运算符 ——
 * 这样 `not in` 这类复合写法不必在词法层做特判。
 *
 * 这里只负责「切得对」，不判断构造是否被支持；能否求值是 parser / 求值器的事。
 */

import { ExprSyntaxError } from "./expr-ast.ts";

export type Token =
  | { kind: "num"; text: string; pos: number; value: number }
  | { kind: "str"; text: string; pos: number; value: string }
  | { kind: "ident"; text: string; pos: number }
  | { kind: "op"; text: string; pos: number }
  | { kind: "eof"; text: ""; pos: number };

/** 双字符运算符：必须放在单字符之前匹配 */
const TWO_CHAR_OPS = ["**", "..", "?.", "<=", ">=", "==", "!=", "&&", "||", "??"] as const;

/**
 * 单字符运算符。
 *
 * `#` `$` `;` `=` 不是本模块要用的构造，但仍要能切出来：整串是先切完再解析的，
 * 若在这一步就报「无法识别的字符」，`let x = 1; x` 这类输入会得到一句笼统的词法错误，
 * 而不是「不认识 let 绑定」这种能指明方向的拒绝。
 * （`=` 只在这里兜底；`==` 已在双字符表里先行匹配。）
 */
const ONE_CHAR_OPS = "+-*/%^<>!?:,()[]{}|.#$;=";

/** `(` `)` `]` `[` `{` `}` 之流：出现在它们后面说明是取值位置，不是成员访问 */
const NOT_VALUE_PREFIX = new Set([")", "]", "}"]);

function isDigit(ch: string | undefined): boolean {
  return ch !== undefined && ch >= "0" && ch <= "9";
}

function isIdentStart(ch: string | undefined): boolean {
  return ch !== undefined && (ch === "_" || (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z"));
}

function isIdentPart(ch: string | undefined): boolean {
  return isIdentStart(ch) || isDigit(ch);
}

/** 该位置是否允许出现 `.5` 这种以小数点开头的数字字面量 */
function allowsLeadingDotNumber(prev: Token | undefined): boolean {
  if (prev === undefined) return true;
  if (prev.kind === "op") return !NOT_VALUE_PREFIX.has(prev.text);
  return false;
}

function decodeEscape(src: string, at: number): { text: string; next: number } {
  const ch = src[at];
  switch (ch) {
    case "n":
      return { text: "\n", next: at + 1 };
    case "t":
      return { text: "\t", next: at + 1 };
    case "r":
      return { text: "\r", next: at + 1 };
    case "0":
      return { text: "\0", next: at + 1 };
    case "\\":
      return { text: "\\", next: at + 1 };
    case "'":
      return { text: "'", next: at + 1 };
    case '"':
      return { text: '"', next: at + 1 };
    case "`":
      return { text: "`", next: at + 1 };
    case "u": {
      const hex = src.slice(at + 1, at + 5);
      if (!/^[0-9a-fA-F]{4}$/.test(hex)) {
        throw new ExprSyntaxError(`字符串里的 \\u 转义需要 4 位十六进制，实际是 \\u${hex}`, at);
      }
      return { text: String.fromCharCode(Number.parseInt(hex, 16)), next: at + 5 };
    }
    case "x": {
      const hex = src.slice(at + 1, at + 3);
      if (!/^[0-9a-fA-F]{2}$/.test(hex)) {
        throw new ExprSyntaxError(`字符串里的 \\x 转义需要 2 位十六进制，实际是 \\x${hex}`, at);
      }
      return { text: String.fromCharCode(Number.parseInt(hex, 16)), next: at + 3 };
    }
    default:
      // expr-lang 对未知转义原样保留
      return { text: ch ?? "", next: at + 1 };
  }
}

function readNumber(src: string, start: number): { token: Token; next: number } {
  const radixPrefix = src.slice(start, start + 2).toLowerCase();
  if (radixPrefix === "0x" || radixPrefix === "0o" || radixPrefix === "0b") {
    const radix = radixPrefix === "0x" ? 16 : radixPrefix === "0o" ? 8 : 2;
    const pattern = radix === 16 ? /[0-9a-fA-F]/ : radix === 8 ? /[0-7]/ : /[01]/;
    let j = start + 2;
    while (j < src.length && pattern.test(src[j] as string)) j += 1;
    if (j === start + 2) {
      throw new ExprSyntaxError(`数字字面量 ${radixPrefix} 后面没有数字`, start);
    }
    const text = src.slice(start, j);
    return { token: { kind: "num", text, pos: start, value: Number.parseInt(text.slice(2), radix) }, next: j };
  }

  let j = start;
  while (j < src.length && isDigit(src[j])) j += 1;
  // 小数点：只有后面紧跟数字才算小数（`1..3` 是区间，不能把 `1.` 吃掉）
  if (src[j] === "." && isDigit(src[j + 1])) {
    j += 1;
    while (j < src.length && isDigit(src[j])) j += 1;
  }
  // 指数
  if (src[j] === "e" || src[j] === "E") {
    let k = j + 1;
    if (src[k] === "+" || src[k] === "-") k += 1;
    if (isDigit(src[k])) {
      j = k;
      while (j < src.length && isDigit(src[j])) j += 1;
    }
  }
  const text = src.slice(start, j);
  const value = Number(text);
  if (!Number.isFinite(value)) {
    throw new ExprSyntaxError(`数字字面量 ${text} 无法解析`, start);
  }
  return { token: { kind: "num", text, pos: start, value }, next: j };
}

function readString(src: string, start: number): { token: Token; next: number } {
  const quote = src[start] as string;
  const raw = quote === "`";
  let j = start + 1;
  let out = "";
  while (j < src.length) {
    const ch = src[j] as string;
    if (ch === quote) {
      return {
        token: { kind: "str", text: src.slice(start, j + 1), pos: start, value: out },
        next: j + 1,
      };
    }
    if (ch === "\\" && !raw) {
      const decoded = decodeEscape(src, j + 1);
      out += decoded.text;
      j = decoded.next;
      continue;
    }
    out += ch;
    j += 1;
  }
  throw new ExprSyntaxError("字符串字面量没有闭合", start);
}

/** 把表达式切成 token 序列；末尾必定有一个 `eof` */
export function tokenize(src: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;

  const prev = (): Token | undefined => (tokens.length === 0 ? undefined : tokens[tokens.length - 1]);

  while (i < src.length) {
    const ch = src[i] as string;

    if (ch === " " || ch === "\t" || ch === "\n" || ch === "\r") {
      i += 1;
      continue;
    }

    // 注释：// 行注释、/* 块注释 */
    if (ch === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i + 2);
      i = nl === -1 ? src.length : nl + 1;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const close = src.indexOf("*/", i + 2);
      if (close === -1) throw new ExprSyntaxError("块注释没有闭合", i);
      i = close + 2;
      continue;
    }

    if (isDigit(ch) || (ch === "." && isDigit(src[i + 1]) && allowsLeadingDotNumber(prev()))) {
      const { token, next } = readNumber(src, i);
      tokens.push(token);
      i = next;
      continue;
    }

    if (ch === '"' || ch === "'" || ch === "`") {
      const { token, next } = readString(src, i);
      tokens.push(token);
      i = next;
      continue;
    }

    if (isIdentStart(ch)) {
      let j = i;
      while (j < src.length && isIdentPart(src[j])) j += 1;
      tokens.push({ kind: "ident", text: src.slice(i, j), pos: i });
      i = j;
      continue;
    }

    const two = src.slice(i, i + 2);
    if ((TWO_CHAR_OPS as readonly string[]).includes(two)) {
      tokens.push({ kind: "op", text: two, pos: i });
      i += 2;
      continue;
    }

    if (ONE_CHAR_OPS.includes(ch)) {
      tokens.push({ kind: "op", text: ch, pos: i });
      i += 1;
      continue;
    }

    throw new ExprSyntaxError(`表达式含无法识别的字符 ${JSON.stringify(ch)}`, i);
  }

  tokens.push({ kind: "eof", text: "", pos: src.length });
  return tokens;
}
