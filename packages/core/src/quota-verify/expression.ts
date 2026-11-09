/**
 * 计费表达式（`other.expr_b64`）的受限求值器
 *
 * NewAPI 的 `tiered_expr` 计费把一段 DSL 存进日志。该字段**来自上游、不可信**，
 * 因此这里不交给任何外部解释器（禁止 `eval` / `new Function`），只做 AST 白名单求值。
 *
 * 覆盖 `pkg/billingexpr` 在本项目所需子集：
 *   三元 `?:` · 比较 · `&&` `||` · 加减乘除 · 一元负 · 数字 · 字符串 · `tier(name, expr)`
 *
 * Bun 纪律：只用 Web 标准 API（`atob` / `TextDecoder`）。
 */

type Token =
  | { t: "num"; v: number }
  | { t: "op"; v: string }
  | { t: "id"; v: string }
  | { t: "str"; v: string };

type Ast =
  | { k: "num"; v: number }
  | { k: "str"; v: string }
  | { k: "var"; name: string }
  | { k: "neg"; a: Ast }
  | { k: "tern"; c: Ast; then: Ast; otherwise: Ast }
  | { k: "call"; name: string; args: Ast[] }
  | { k: "bin"; op: string; l: Ast; r: Ast };

export interface CompiledExpr {
  /** 表达式引用到的变量名（决定 `p` 的归一化与 `len` 的口径） */
  vars: ReadonlySet<string>;
  eval: (vars: Record<string, number>) => number;
}

const COMPARE_OPS = ["<", "<=", ">", ">=", "==", "!="];

/** base64 → UTF-8 文本（Web 标准：atob + TextDecoder，无 Buffer） */
export function decodeBase64Utf8(b64: string): string {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder().decode(bytes);
}

function tokenize(src: string): Token[] {
  const out: Token[] = [];
  let i = 0;
  while (i < src.length) {
    const ch = src[i] as string;
    if (/\s/.test(ch)) {
      i += 1;
      continue;
    }
    if (/[0-9]/.test(ch)) {
      let j = i;
      while (j < src.length && /[0-9.]/.test(src[j] as string)) j += 1;
      out.push({ t: "num", v: Number(src.slice(i, j)) });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(ch)) {
      let j = i;
      while (j < src.length && /[A-Za-z0-9_]/.test(src[j] as string)) j += 1;
      out.push({ t: "id", v: src.slice(i, j) });
      i = j;
      continue;
    }
    if (ch === '"' || ch === "'") {
      let j = i + 1;
      while (j < src.length && src[j] !== ch) j += 1;
      if (j >= src.length) throw new Error("未闭合的字符串字面量");
      out.push({ t: "str", v: src.slice(i + 1, j) });
      i = j + 1;
      continue;
    }
    const two = src.slice(i, i + 2);
    if (["<=", ">=", "==", "!=", "&&", "||"].includes(two)) {
      out.push({ t: "op", v: two });
      i += 2;
      continue;
    }
    if ("+-*/<>?:(),!".includes(ch)) {
      out.push({ t: "op", v: ch });
      i += 1;
      continue;
    }
    throw new Error(`表达式含不支持的字符: ${ch}`);
  }
  return out;
}

/**
 * 编译计费表达式。
 *
 * 语法错误、未知函数、未知运算符一律抛错 —— 调用方据此返回「无法验算」，
 * 而不是拿一段没读懂的表达式的默认值去算钱。
 */
export function compileBillingExpr(src: string): CompiledExpr {
  const toks = tokenize(src);
  let pos = 0;

  const peek = (): Token | undefined => toks[pos];
  const isOp = (v: string): boolean => {
    const t = peek();
    return t !== undefined && t.t === "op" && t.v === v;
  };
  const eat = (v?: string): Token => {
    const t = toks[pos];
    if (t === undefined) throw new Error("表达式意外结束");
    if (v !== undefined && !(t.t === "op" && t.v === v)) {
      throw new Error(`期望 ${v}`);
    }
    pos += 1;
    return t;
  };

  function ternary(): Ast {
    const cond = orExpr();
    if (!isOp("?")) return cond;
    eat("?");
    const then = ternary();
    eat(":");
    const otherwise = ternary();
    return { k: "tern", c: cond, then, otherwise };
  }

  function orExpr(): Ast {
    let l = andExpr();
    while (isOp("||")) {
      eat("||");
      l = { k: "bin", op: "||", l, r: andExpr() };
    }
    return l;
  }

  function andExpr(): Ast {
    let l = cmpExpr();
    while (isOp("&&")) {
      eat("&&");
      l = { k: "bin", op: "&&", l, r: cmpExpr() };
    }
    return l;
  }

  function cmpExpr(): Ast {
    let l = addExpr();
    for (;;) {
      const t = peek();
      if (t === undefined || t.t !== "op" || !COMPARE_OPS.includes(t.v)) return l;
      const op = (t as { t: "op"; v: string }).v;
      eat();
      l = { k: "bin", op, l, r: addExpr() };
    }
  }

  function addExpr(): Ast {
    let l = mulExpr();
    for (;;) {
      if (isOp("+") || isOp("-")) {
        const op = (eat() as { t: "op"; v: string }).v;
        l = { k: "bin", op, l, r: mulExpr() };
        continue;
      }
      return l;
    }
  }

  function mulExpr(): Ast {
    let l = unaryExpr();
    for (;;) {
      if (isOp("*") || isOp("/")) {
        const op = (eat() as { t: "op"; v: string }).v;
        l = { k: "bin", op, l, r: unaryExpr() };
        continue;
      }
      return l;
    }
  }

  function unaryExpr(): Ast {
    if (isOp("-")) {
      eat("-");
      return { k: "neg", a: unaryExpr() };
    }
    return primary();
  }

  function primary(): Ast {
    const t = peek();
    if (t === undefined) throw new Error("表达式意外结束");
    if (t.t === "num") {
      eat();
      return { k: "num", v: t.v };
    }
    if (t.t === "str") {
      eat();
      return { k: "str", v: t.v };
    }
    if (t.t === "id") {
      eat();
      if (!isOp("(")) return { k: "var", name: t.v };
      eat("(");
      const args: Ast[] = [];
      if (!isOp(")")) {
        args.push(ternary());
        while (isOp(",")) {
          eat(",");
          args.push(ternary());
        }
      }
      eat(")");
      return { k: "call", name: t.v, args };
    }
    if (isOp("(")) {
      eat("(");
      const inner = ternary();
      eat(")");
      return inner;
    }
    throw new Error(`不支持的记号: ${JSON.stringify(t)}`);
  }

  const ast = ternary();
  if (pos !== toks.length) throw new Error("表达式末尾有多余记号");

  const vars = new Set<string>();
  const walk = (n: Ast): void => {
    switch (n.k) {
      case "var":
        vars.add(n.name);
        return;
      case "neg":
        walk(n.a);
        return;
      case "tern":
        walk(n.c);
        walk(n.then);
        walk(n.otherwise);
        return;
      case "call":
        if (n.name !== "tier") throw new Error(`不支持的函数: ${n.name}`);
        // 参数个数不足会在求值期抛 TypeError；在编译期就拒绝，才能保证
        // 调用方拿到的是「无法验算」而不是一个异常。
        if (n.args.length !== 2) {
          throw new Error(`tier() 需要 2 个参数，实际 ${n.args.length} 个`);
        }
        n.args.forEach(walk);
        return;
      case "bin":
        walk(n.l);
        walk(n.r);
        return;
      default:
        return;
    }
  };
  walk(ast);

  const evalNode = (n: Ast, v: Record<string, number>): number => {
    switch (n.k) {
      case "num":
        return n.v;
      case "str":
        return 0;
      case "var":
        return v[n.name] ?? 0;
      case "neg":
        return -evalNode(n.a, v);
      case "tern":
        return evalNode(n.c, v) === 0 ? evalNode(n.otherwise, v) : evalNode(n.then, v);
      case "call":
        // tier("name", expr) —— 档名只用于展示，计费取表达式值
        return evalNode(n.args[1] as Ast, v);
      case "bin": {
        const l = evalNode(n.l, v);
        const r = evalNode(n.r, v);
        switch (n.op) {
          case "+":
            return l + r;
          case "-":
            return l - r;
          case "*":
            return l * r;
          case "/":
            return l / r;
          case "<":
            return l < r ? 1 : 0;
          case "<=":
            return l <= r ? 1 : 0;
          case ">":
            return l > r ? 1 : 0;
          case ">=":
            return l >= r ? 1 : 0;
          case "==":
            return l === r ? 1 : 0;
          case "!=":
            return l !== r ? 1 : 0;
          case "&&":
            return l !== 0 && r !== 0 ? 1 : 0;
          case "||":
            return l !== 0 || r !== 0 ? 1 : 0;
          default:
            throw new Error(`不支持的运算符: ${n.op}`);
        }
      }
    }
  };

  return { vars, eval: (v) => evalNode(ast, v) };
}
