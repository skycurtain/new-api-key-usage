/**
 * 计费表达式的 Pratt 解析器
 *
 * 目标不是「能算就行」，而是**读得懂上游写过的一切**：读不懂时给出带位置的具体错误，
 * 读得懂但不在范围内时给出带名字的拒绝（如「管道运算符 |」）。
 *
 * 优先级表照抄 expr-lang v1.17.8，出处与逐条对照见 `docs/references/计费表达式语法.md`。
 * 表是数据不是代码分支——将来对齐上游只需改这一处。
 *
 * 已覆盖的语法（能被解析成 AST）：
 *   字面量 · 变量 · 括号 · 一元 · 二元算术/比较/逻辑 · 三元 · `??` · 调用
 *   成员访问 `.` `?.` · 索引 / 切片 `[]` · 数组 `[]` · 映射 `{}` · 区间 `..` · `in` / `matches` 家族
 *
 * 明确不解析、但会**指名拒绝**的构造：
 *   `let` 绑定 · `if {} else {}` · 管道 `|` · 谓词 `#` · `$env`
 */

import {
  ExprSyntaxError,
  ExprUnsupportedError,
  type BinaryOp,
  type ExprNode,
  type MapEntry,
} from "./expr-ast.ts";
import { tokenize, type Token } from "./expr-lexer.ts";

/**
 * 绑定力：数值越大，结合越紧。
 *
 * **数值照搬 expr-lang v1.17.8 `parser/operator/operator.go` 的 `var Binary` / `var Unary`
 * 字面量，不做「看起来更整齐」的重排** —— 上游语义正是由这些数值定义的，重排会悄悄改变结合性。
 * 几处与常见语言直觉相反、必须照抄的地方：
 *   - 所有比较（`==` `!=` `<` `>` `>=` `<=` `in` `matches` `contains` …）同属 20 一层
 *   - `**` / `^` 是 100，**高于**一元 `-` `+` 的 90 —— 故 `-2 ** 2` 是 `-(2 ** 2)`
 *   - 一元 `not` / `!` 是 50，低于乘除的 60 —— 故 `not a * b` 是 `not (a * b)`
 *   - `??` 是 500，反而最高（上游另有一道「`??` 不得与其它运算符混写」的检查）
 *   - 三元不在数值表里，比所有二元都松、右结合
 */
export const BINDING_POWER = {
  ternary: 0,
  or: 10,
  and: 15,
  comparison: 20,
  range: 25,
  additive: 30,
  notUnary: 50,
  multiplicative: 60,
  symbolUnary: 90,
  power: 100,
  coalesce: 500,
} as const;

/**
 * 会「成链」的比较运算符。
 *
 * expr-lang 只对这四个做链式展开：`a < b < c` == `(a < b) && (b < c)`。
 * `==` `!=` `in` `matches` 等不链，仍是普通左结合二元。
 */
const CHAINABLE_COMPARISONS = new Set([">", "<", ">=", "<="]);

/**
 * 中缀位置可能出现的运算符。
 *
 * `??` 与 `..` 有自己的节点形态（`coalesce` / `range`），不并入 `BinaryOp`。
 */
type InfixOp = BinaryOp | "??" | "..";

/** 一个中缀运算符的解析信息 */
interface Infix {
  op: InfixOp;
  bp: number;
  rightAssoc: boolean;
  /** 占用几个 token（`not in` 这类复合运算符是 2） */
  width: 1 | 2;
}

/** 符号写法与关键字写法的中缀运算符，`has` 是上游给 `contains` 起的别名 */
const SYMBOL_INFIX: Record<string, Infix> = {
  "||": { op: "||", bp: BINDING_POWER.or, rightAssoc: false, width: 1 },
  "&&": { op: "&&", bp: BINDING_POWER.and, rightAssoc: false, width: 1 },
  "==": { op: "==", bp: BINDING_POWER.comparison, rightAssoc: false, width: 1 },
  "!=": { op: "!=", bp: BINDING_POWER.comparison, rightAssoc: false, width: 1 },
  "<": { op: "<", bp: BINDING_POWER.comparison, rightAssoc: false, width: 1 },
  "<=": { op: "<=", bp: BINDING_POWER.comparison, rightAssoc: false, width: 1 },
  ">": { op: ">", bp: BINDING_POWER.comparison, rightAssoc: false, width: 1 },
  ">=": { op: ">=", bp: BINDING_POWER.comparison, rightAssoc: false, width: 1 },
  "..": { op: "..", bp: BINDING_POWER.range, rightAssoc: false, width: 1 },
  "+": { op: "+", bp: BINDING_POWER.additive, rightAssoc: false, width: 1 },
  "-": { op: "-", bp: BINDING_POWER.additive, rightAssoc: false, width: 1 },
  "*": { op: "*", bp: BINDING_POWER.multiplicative, rightAssoc: false, width: 1 },
  "/": { op: "/", bp: BINDING_POWER.multiplicative, rightAssoc: false, width: 1 },
  "%": { op: "%", bp: BINDING_POWER.multiplicative, rightAssoc: false, width: 1 },
  "**": { op: "**", bp: BINDING_POWER.power, rightAssoc: true, width: 1 },
  "^": { op: "**", bp: BINDING_POWER.power, rightAssoc: true, width: 1 },
  "??": { op: "??", bp: BINDING_POWER.coalesce, rightAssoc: false, width: 1 },
};

const KEYWORD_INFIX: Record<string, Infix> = {
  or: { op: "||", bp: BINDING_POWER.or, rightAssoc: false, width: 1 },
  and: { op: "&&", bp: BINDING_POWER.and, rightAssoc: false, width: 1 },
  in: { op: "in", bp: BINDING_POWER.comparison, rightAssoc: false, width: 1 },
  matches: { op: "matches", bp: BINDING_POWER.comparison, rightAssoc: false, width: 1 },
  contains: { op: "contains", bp: BINDING_POWER.comparison, rightAssoc: false, width: 1 },
  has: { op: "contains", bp: BINDING_POWER.comparison, rightAssoc: false, width: 1 },
  startsWith: { op: "startsWith", bp: BINDING_POWER.comparison, rightAssoc: false, width: 1 },
  endsWith: { op: "endsWith", bp: BINDING_POWER.comparison, rightAssoc: false, width: 1 },
};

/** 前缀运算符（`not` 交给 parseUnary 单独判断，避免 `a not in b` 被当成前缀） */
const SYMBOL_PREFIX = new Set(["-", "+", "!"]);

class Parser {
  private pos = 0;
  private readonly tokens: Token[];

  constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  private cur(): Token {
    const t = this.tokens[this.pos];
    // tokenize 必定以 eof 收尾，理论上取不到 undefined
    if (t === undefined) throw new ExprSyntaxError("表达式意外结束");
    return t;
  }

  private peek(offset: number): Token {
    const t = this.tokens[this.pos + offset];
    return t ?? (this.tokens[this.tokens.length - 1] as Token);
  }

  private advance(): Token {
    const t = this.cur();
    if (t.kind !== "eof") this.pos += 1;
    return t;
  }

  private atOp(text: string): boolean {
    const t = this.cur();
    return t.kind === "op" && t.text === text;
  }

  private atIdent(text: string): boolean {
    const t = this.cur();
    return t.kind === "ident" && t.text === text;
  }

  private expectOp(text: string): Token {
    const t = this.cur();
    if (t.kind !== "op" || t.text !== text) {
      throw new ExprSyntaxError(`期望 ${text}，实际是 ${describe(t)}（位置 ${t.pos}）`, t.pos);
    }
    return this.advance();
  }

  private expectIdentLike(what: string): Token {
    const t = this.cur();
    if (t.kind !== "ident") {
      throw new ExprSyntaxError(`期望${what}，实际是 ${describe(t)}（位置 ${t.pos}）`, t.pos);
    }
    return this.advance();
  }

  /** 解析整串表达式，必须刚好耗尽 token */
  parseProgram(): ExprNode {
    const node = this.parseExpr(0);
    const rest = this.cur();
    if (rest.kind !== "eof") {
      throw new ExprSyntaxError(`表达式末尾有多余记号 ${describe(rest)}（位置 ${rest.pos}）`, rest.pos);
    }
    return node;
  }

  /** 中缀循环：`minBp` 以下的中缀运算符不再由本层消费 */
  private parseExpr(minBp: number): ExprNode {
    let lhs = this.parseUnary();
    // 比较链的「上一个右操作数」：`a < b < c` 展开成 `(a < b) && (b < c)`，
    // 中间那个 b 要被复用两次，靠这个变量记住它。
    let chainTail: ExprNode | null = null;

    for (;;) {
      const t = this.cur();

      // 三元：优先级最低（0），右结合 → `a ? b : c ? d : e` == `a ? b : (c ? d : e)`
      if (t.kind === "op" && t.text === "?") {
        if (BINDING_POWER.ternary < minBp) break;
        this.advance();
        // Elvis：`a ?: b` 等价于 `a ? a : b`
        const then = this.atOp(":") ? lhs : this.parseExpr(0);
        this.expectOp(":");
        const otherwise = this.parseExpr(0);
        lhs = { k: "ternary", cond: lhs, then, otherwise };
        chainTail = null;
        continue;
      }

      // 管道运算符：语法上认得，但不求值（它的语义是「把左边塞进右边函数」）
      if (t.kind === "op" && t.text === "|") {
        throw new ExprUnsupportedError("管道运算符 |");
      }

      const infix = this.infixAt();
      if (infix === undefined || infix.info.bp < minBp) break;

      for (let i = 0; i < infix.info.width; i += 1) this.advance();
      const rhs = this.parseExpr(infix.info.rightAssoc ? infix.info.bp : infix.info.bp + 1);

      if (infix.info.op === "??") {
        lhs = { k: "coalesce", left: lhs, right: rhs };
        chainTail = null;
        continue;
      }

      if (infix.info.op === "..") {
        lhs = { k: "range", low: lhs, high: rhs };
        chainTail = null;
        continue;
      }

      if (CHAINABLE_COMPARISONS.has(infix.info.op)) {
        const compare: ExprNode = {
          k: "binary",
          op: infix.info.op,
          left: chainTail ?? lhs,
          right: rhs,
        };
        lhs =
          chainTail === null
            ? compare
            : { k: "binary", op: "&&", left: lhs, right: compare };
        chainTail = rhs;
        continue;
      }

      lhs = { k: "binary", op: infix.info.op, left: lhs, right: rhs };
      chainTail = null;
    }

    return lhs;
  }

  /** 当前位置是否是一个中缀运算符；`not in` / `not matches` 合并成一条 */
  private infixAt(): { info: Infix } | undefined {
    const t = this.cur();

    if (t.kind === "op") {
      const info = SYMBOL_INFIX[t.text];
      return info === undefined ? undefined : { info };
    }

    if (t.kind !== "ident") return undefined;

    if (t.text === "not") {
      const next = this.peek(1);
      if (next.kind !== "ident") return undefined;
      if (next.text === "in") {
        return { info: { op: "not in", bp: BINDING_POWER.comparison, rightAssoc: false, width: 2 } };
      }
      if (next.text === "matches") {
        return {
          info: { op: "not matches", bp: BINDING_POWER.comparison, rightAssoc: false, width: 2 },
        };
      }
      return undefined;
    }

    const info = KEYWORD_INFIX[t.text];
    return info === undefined ? undefined : { info };
  }

  /**
   * 前缀运算符。
   *
   * 两种一元运算符的绑定力**不同**，不能合并处理：
   *   `-` `+` 是 90（高于乘除 60、低于幂 100）→ `-2 ** 2` 是 `-(2 ** 2)`、`-a * b` 是 `(-a) * b`
   *   `not` `!` 是 50（低于乘除 60）→ `not a * b` 是 `not (a * b)`
   */
  private parseUnary(): ExprNode {
    const t = this.cur();

    if (t.kind === "op" && SYMBOL_PREFIX.has(t.text)) {
      this.advance();
      const operand = this.parseExpr(BINDING_POWER.symbolUnary);
      return { k: "unary", op: t.text as "-" | "+" | "!", operand };
    }

    if (t.kind === "ident" && t.text === "not") {
      // 中缀位置上的 `not`（`a not in b`）由 infixAt 处理，这里只剩真正的前缀用法
      this.advance();
      const operand = this.parseExpr(BINDING_POWER.notUnary);
      return { k: "unary", op: "!", operand };
    }

    return this.parsePostfix();
  }

  /** 后缀链：成员访问 / 索引 / 切片 */
  private parsePostfix(): ExprNode {
    let node = this.parsePrimary();

    for (;;) {
      const t = this.cur();

      if (t.kind === "op" && (t.text === "." || t.text === "?.")) {
        const optional = t.text === "?.";
        this.advance();
        const property = this.expectIdentLike("成员名");
        node = { k: "member", object: node, property: property.text, optional };
        continue;
      }

      if (t.kind === "op" && t.text === "[") {
        this.advance();
        // `[:]` `[1:]` `[:3]`
        if (this.atOp(":")) {
          this.advance();
          const to = this.atOp("]") ? null : this.parseExpr(0);
          this.expectOp("]");
          node = { k: "slice", object: node, from: null, to };
          continue;
        }
        if (this.atOp("]")) {
          throw new ExprSyntaxError(`下标为空 ${describe(t)}（位置 ${t.pos}）`, t.pos);
        }
        const first = this.parseExpr(0);
        if (this.atOp(":")) {
          this.advance();
          const to = this.atOp("]") ? null : this.parseExpr(0);
          this.expectOp("]");
          node = { k: "slice", object: node, from: first, to };
          continue;
        }
        this.expectOp("]");
        node = { k: "index", object: node, index: first };
        continue;
      }

      return node;
    }
  }

  private parsePrimary(): ExprNode {
    const t = this.cur();

    if (t.kind === "num") {
      this.advance();
      return { k: "num", v: t.value };
    }

    if (t.kind === "str") {
      this.advance();
      return { k: "str", v: t.value };
    }

    if (t.kind === "op") {
      if (t.text === "(") {
        this.advance();
        const inner = this.parseExpr(0);
        this.expectOp(")");
        return inner;
      }
      if (t.text === "[") {
        this.advance();
        const items: ExprNode[] = [];
        if (!this.atOp("]")) {
          items.push(this.parseExpr(0));
          while (this.atOp(",")) {
            this.advance();
            if (this.atOp("]")) break; // 容忍尾随逗号
            items.push(this.parseExpr(0));
          }
        }
        this.expectOp("]");
        return { k: "array", items };
      }
      if (t.text === "{") {
        return this.parseBrace();
      }
      if (t.text === "#") {
        throw new ExprUnsupportedError("谓词占位符 #");
      }
      if (t.text === "$") {
        throw new ExprUnsupportedError("$env 变量表");
      }
      throw new ExprSyntaxError(`这里不该出现运算符 ${describe(t)}（位置 ${t.pos}）`, t.pos);
    }

    if (t.kind === "ident") {
      return this.parseIdentPrimary(t);
    }

    throw new ExprSyntaxError(`表达式意外结束（位置 ${t.pos}）`, t.pos);
  }

  private parseIdentPrimary(t: Token): ExprNode {
    if (t.text === "true" || t.text === "false") {
      this.advance();
      return { k: "bool", v: t.text === "true" };
    }
    if (t.text === "nil") {
      this.advance();
      return { k: "nil" };
    }
    if (t.text === "let") {
      throw new ExprUnsupportedError("let 变量绑定");
    }
    if (t.text === "if") {
      throw new ExprUnsupportedError("if / else 块");
    }

    this.advance();

    if (this.atOp("(")) {
      this.advance();
      const args: ExprNode[] = [];
      if (!this.atOp(")")) {
        args.push(this.parseExpr(0));
        while (this.atOp(",")) {
          this.advance();
          if (this.atOp(")")) break;
          args.push(this.parseExpr(0));
        }
      }
      this.expectOp(")");
      return { k: "call", name: t.text, args };
    }

    return { k: "ident", name: t.text };
  }

  /**
   * 花括号有两种含义：映射字面量 `{a: 1}`，或谓词块 `{.Age > 18}`（集合函数的实参）。
   * 用「第一个 token 能不能当键」来区分：映射的键是标识符或字符串。
   */
  private parseBrace(): ExprNode {
    const open = this.expectOp("{");
    const first = this.cur();
    const looksLikePredicate =
      (first.kind === "op" && (first.text === "#" || first.text === ".")) ||
      (first.kind === "ident" && (first.text === "let" || first.text === "if"));

    if (looksLikePredicate) {
      throw new ExprUnsupportedError("谓词块 {…}");
    }

    const entries: MapEntry[] = [];
    if (!this.atOp("}")) {
      for (;;) {
        if (this.cur().kind !== "ident" && this.cur().kind !== "str") {
          throw new ExprSyntaxError(
            `映射的键必须是标识符或字符串，实际是 ${describe(this.cur())}（位置 ${this.cur().pos}）`,
            this.cur().pos,
          );
        }
        const keyTok = this.advance();
        const key: ExprNode =
          keyTok.kind === "str" ? { k: "str", v: keyTok.value } : { k: "ident", name: keyTok.text };
        this.expectOp(":");
        entries.push({ key, value: this.parseExpr(0) });
        if (this.atOp(",")) {
          this.advance();
          if (this.atOp("}")) break; // 容忍尾随逗号
          continue;
        }
        break;
      }
    }
    this.expectOp("}");
    if (entries.length === 0) {
      throw new ExprSyntaxError(`不接受空的映射字面量 ${describe(open)}（位置 ${open.pos}）`, open.pos);
    }
    return { k: "map", entries };
  }
}

/** 给报错用的 token 展示形式 */
function describe(t: Token): string {
  switch (t.kind) {
    case "num":
      return `数字 ${t.text}`;
    case "str":
      return `字符串 ${t.text}`;
    case "ident":
      return `标识符 ${t.text}`;
    case "op":
      return `运算符 ${t.text}`;
    case "eof":
      return "表达式结束";
  }
}

/** 解析一段计费表达式；失败时抛 `ExprSyntaxError` 或 `ExprUnsupportedError` */
export function parseExpression(source: string): ExprNode {
  return new Parser(tokenize(source)).parseProgram();
}
