/**
 * 计费表达式的抽象语法树，以及编译期的两类拒绝
 *
 * 语法基线：`pkg/billingexpr/expr.md`（NewAPI 对这套 DSL 的正式承诺）
 * 语义基线：`pkg/billingexpr/run.go` 暴露的求值环境
 * 依据：`docs/references/计费表达式语法.md`
 *
 * 设计原则：**语法全量、语义白名单**。
 * 解析器尽量认识 expr-lang 的构造（这样拒绝时能说出「是什么」），
 * 求值只覆盖与 token 量直接相关的那一部分；其余在编译期就给出带名字的原因，
 * 不允许走到求值期再抛一个笼统的"算不出来"。
 *
 * 两类拒绝必须分开，否则会重演「表达式完好却说缺 expr_b64」的错误归因：
 *   - `ExprSyntaxError`      —— 真的读不懂（词法 / 语法）
 *   - `ExprUnsupportedError` —— 读懂了，但这个构造不在本模块的求值范围内
 */

/** 一元运算符 */
export type UnaryOp = "-" | "+" | "!";

/**
 * 二元运算符。
 *
 * 词法关键字的写法（`and` / `in` …）与符号写法（`&&` …）在这里已归一为同一种 op，
 * 求值期不必再区分。
 */
export type BinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "**"
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "&&"
  | "||"
  | "in"
  | "not in"
  | "matches"
  | "not matches"
  | "contains"
  | "startsWith"
  | "endsWith";

export interface MapEntry {
  key: ExprNode;
  value: ExprNode;
}

/** 表达式节点 */
export type ExprNode =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "bool"; v: boolean }
  | { k: "nil" }
  | { k: "ident"; name: string }
  | { k: "unary"; op: UnaryOp; operand: ExprNode }
  | { k: "binary"; op: BinaryOp; left: ExprNode; right: ExprNode }
  | { k: "ternary"; cond: ExprNode; then: ExprNode; otherwise: ExprNode }
  | { k: "coalesce"; left: ExprNode; right: ExprNode }
  | { k: "call"; name: string; args: ExprNode[] }
  | { k: "member"; object: ExprNode; property: string; optional: boolean }
  | { k: "index"; object: ExprNode; index: ExprNode }
  | { k: "slice"; object: ExprNode; from: ExprNode | null; to: ExprNode | null }
  | { k: "array"; items: ExprNode[] }
  | { k: "map"; entries: MapEntry[] }
  | { k: "range"; low: ExprNode; high: ExprNode };

/** 词法 / 语法错误：表达式本身不合法 */
export class ExprSyntaxError extends Error {
  /** 出错位置在表达式原文中的下标（-1 表示无法定位） */
  readonly pos: number;

  constructor(message: string, pos = -1) {
    super(message);
    this.name = "ExprSyntaxError";
    this.pos = pos;
  }
}

/**
 * 语法上认得、但本模块不求值的构造。
 *
 * `construct` 是给人看的中文名字（如「管道运算符 |」），会被原样写进拒绝文案。
 */
export class ExprUnsupportedError extends Error {
  readonly construct: string;

  constructor(construct: string) {
    super(construct);
    this.name = "ExprUnsupportedError";
    this.construct = construct;
  }
}
