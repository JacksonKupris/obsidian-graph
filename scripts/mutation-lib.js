// mutation-lib.js - the pure part of mutation testing: which small breaks to try in a source file.
// mutants(source) -> [{ id, start, end, from, to, line, col, kind }]; apply(source, m) puts one of them in.
// One kind of break per spot (an operator flipped, a condition negated, a number moved by one ...), each a change a slip of the
// hand could make. scripts/mutate.js runs the tests against each; a break the tests don't notice is a test that can't fail.
const acorn = require("acorn");

const SWAP = { "+": "-", "-": "+", "*": "/", "/": "*", "<": "<=", "<=": "<", ">": ">=", ">=": ">", "===": "!==", "!==": "===", "==": "!=", "!=": "==", "&&": "||", "||": "&&" };

function walk(node, visit, parent, key) {
  if (!node || typeof node.type !== "string") return;
  visit(node, parent, key);
  for (const k of Object.keys(node)) {
    const v = node[k];
    if (Array.isArray(v)) v.forEach(c => walk(c, visit, node, k));
    else if (v && typeof v.type === "string") walk(v, visit, node, k);
  }
}

// the operator's own text, between the two sides (a comment or bracket between them never holds an operator character)
function operatorAt(source, node) {
  const at = source.indexOf(node.operator, node.left.end);
  return at >= 0 && at < node.right.start ? at : -1;
}

function mutants(source) {
  const ast = acorn.parse(source, { ecmaVersion: "latest", sourceType: "script", allowReturnOutsideFunction: true, locations: true });
  const out = [];
  const add = (kind, start, end, to, loc) => out.push({ kind, start, end, from: source.slice(start, end), to, line: loc.line, col: loc.column + 1 });
  walk(ast, (n, parent, key) => {
    if ((n.type === "BinaryExpression" || n.type === "LogicalExpression") && SWAP[n.operator]) {
      const at = operatorAt(source, n);
      if (at >= 0) add("operator", at, at + n.operator.length, SWAP[n.operator], n.loc.start);
    } else if (n.type === "UnaryExpression" && n.operator === "!") {
      add("not", n.start, n.start + 1, "", n.loc.start);   // !x -> x
    } else if (n.type === "Literal") {
      if (n.regex || n.bigint != null) return;
      if (typeof n.value === "boolean") add("boolean", n.start, n.end, String(!n.value), n.loc.start);
      else if (typeof n.value === "number") add("number", n.start, n.end, String(n.value === 0 ? 1 : n.value + 1), n.loc.start);
      else if (typeof n.value === "string" && n.value !== "" && !(parent.type === "Property" && key === "key") && !(parent.type === "ExpressionStatement") && !(parent.type === "MethodDefinition")) add("string", n.start, n.end, '""', n.loc.start);
    } else if (n.type === "IfStatement" || (n.type === "ConditionalExpression")) {
      add("condition", n.test.start, n.test.end, "false", n.test.loc.start);   // the branch never taken
    } else if (n.type === "ReturnStatement" && n.argument) {
      add("return", n.argument.start, n.argument.end, "undefined", n.argument.loc.start);
    }
  });
  // numbering by position so a rerun names the same break the same way
  out.sort((a, b) => a.start - b.start || a.kind.localeCompare(b.kind));
  out.forEach((m, i) => { m.id = i + 1; });
  return out;
}

const apply = (source, m) => source.slice(0, m.start) + m.to + source.slice(m.end);

module.exports = { mutants, apply };
