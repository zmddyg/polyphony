// Closed arithmetic grammar. Source text is never executed as JavaScript.
const functions = Object.freeze(Object.assign(Object.create(null), {
  sin: Math.sin, cos: Math.cos, tan: Math.tan, asin: Math.asin, acos: Math.acos,
  atan: Math.atan, exp: Math.exp, ln: Math.log, log: Math.log, log10: Math.log10,
  sqrt: Math.sqrt, abs: Math.abs, min: Math.min, max: Math.max,
  sinc: x => x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x),
}));
const constants = Object.freeze({ pi: Math.PI, PI: Math.PI, e: Math.E, E: Math.E });
const identifier = /^[A-Za-z][A-Za-z0-9_]*$/;
const prohibited = new Set(['constructor', 'prototype', '__proto__']);

export function compileExpression(exprString, allowedVariables = []) {
  if (typeof exprString !== 'string' || !exprString.trim()) throw new Error('表达式不能为空。');
  if (exprString.length > 240) throw new Error('表达式长度不能超过 240 字符。');
  if (!Array.isArray(allowedVariables) || allowedVariables.some(v => !identifier.test(v) || prohibited.has(v) || Object.hasOwn(functions, v) || Object.hasOwn(constants, v))) throw new Error('变量名称无效或使用了保留名称。');
  const allowed = new Set(allowedVariables), used = new Set();
  const tokens = [];
  let offset = 0, cursor = 0;
  while (offset < exprString.length) {
    const rest = exprString.slice(offset);
    const match = /^(\s+|(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?|[A-Za-z][A-Za-z0-9_]*|[+\-*/^(),])/.exec(rest);
    if (!match) throw new Error(`表达式第 ${offset + 1} 字符不允许：${rest[0]}`);
    if (!/^\s/.test(match[0])) tokens.push(match[0]);
    offset += match[0].length;
  }
  const peek = () => tokens[cursor];
  const take = token => peek() === token ? (cursor++, true) : false;
  const expect = token => { if (!take(token)) throw new Error(`表达式缺少「${token}」，位于标记 ${cursor + 1}。`); };
  function primary() {
    if (take('(')) { const node = sum(); expect(')'); return node; }
    const token = tokens[cursor++];
    if (token === undefined) throw new Error('表达式意外结束。');
    if (/^(?:\d|\.)/.test(token)) {
      const value = Number(token);
      if (!Number.isFinite(value)) throw new Error('数值超出有限范围。');
      return () => value;
    }
    if (!identifier.test(token) || prohibited.has(token)) throw new Error(`表达式标记无效：${token}`);
    if (Object.hasOwn(functions, token)) {
      expect('('); const args = [sum()];
      while (take(',')) args.push(sum());
      expect(')');
      if ((token !== 'min' && token !== 'max' && args.length !== 1) || args.length > 12) throw new Error(`函数 ${token} 参数数量无效。`);
      return vars => functions[token](...args.map(arg => arg(vars)));
    }
    if (Object.hasOwn(constants, token)) return () => constants[token];
    if (!allowed.has(token)) throw new Error(`未知变量或标识符：${token}`);
    used.add(token);
    return vars => {
      if (!vars || !Object.hasOwn(vars, token) || !Number.isFinite(vars[token])) throw new Error(`变量 ${token} 必须提供有限数值。`);
      return vars[token];
    };
  }
  function power() {
    const left = primary();
    if (!take('^')) return left;
    const right = unary(); return vars => left(vars) ** right(vars);
  }
  function unary() {
    if (take('+')) return unary();
    if (take('-')) { const right = unary(); return vars => -right(vars); }
    return power();
  }
  function product() {
    let left = unary();
    while (peek() === '*' || peek() === '/') {
      const op = tokens[cursor++], a = left, b = unary();
      left = vars => op === '*' ? a(vars) * b(vars) : a(vars) / b(vars);
    }
    return left;
  }
  function sum() {
    let left = product();
    while (peek() === '+' || peek() === '-') {
      const op = tokens[cursor++], a = left, b = product();
      left = vars => op === '+' ? a(vars) + b(vars) : a(vars) - b(vars);
    }
    return left;
  }
  const evaluate = sum();
  if (cursor !== tokens.length) throw new Error(`多余的表达式标记：${peek()}`);
  return { evaluate, variablesUsed: Object.freeze([...used]) };
}

export function sampleDeclarativeCurve({ expr, xVar = 'x', xMin = 0, xMax = 1, params = {}, samples = 96 }) {
  if (!Number.isFinite(xMin) || !Number.isFinite(xMax) || xMin >= xMax) throw new Error('曲线要求 xMin < xMax 且范围有限。');
  if (!Number.isSafeInteger(samples) || samples < 2 || samples > 2048) throw new Error('采样点数须为 2–2048 的整数。');
  if (!params || typeof params !== 'object' || Array.isArray(params) || Object.values(params).some(v => !Number.isFinite(v))) throw new Error('参数必须为有限数值。');
  const compiled = compileExpression(expr, [...new Set([xVar, ...Object.keys(params)])]);
  return Array.from({ length: samples }, (_, i) => {
    const x = xMin + (xMax - xMin) * i / (samples - 1);
    const y = compiled.evaluate({ ...params, [xVar]: x });
    if (!Number.isFinite(y)) throw new Error(`曲线在 ${xVar}=${x} 的结果不是有限数值。`);
    return { x, y };
  });
}
