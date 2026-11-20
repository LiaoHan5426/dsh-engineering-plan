// Detects a block-scoped declaration whose initializer reads a binding that is declared later in
// the same function body — `const a = b; const b = 1;` is valid syntax, passes `node --check`, and
// throws `ReferenceError: Cannot access 'b' before initialization` only at render time, which
// unmounts the whole conversation.view slot. That exact defect shipped once (postMortem /
// selectedTask); this script exists so it cannot ship again.

const OPEN = "{";
const CLOSE = "}";
const RESERVED = new Set([
  "true", "false", "null", "undefined", "this", "new", "typeof", "instanceof", "in", "of", "return",
  "const", "let", "var", "function", "if", "else", "for", "while", "do", "switch", "case", "break",
  "continue", "try", "catch", "finally", "throw", "await", "async", "yield", "class", "extends",
  "super", "delete", "void", "default", "export", "import", "from", "as",
]);

function stripStringsAndComments(line) {
  let out = "";
  let quote = null;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    const prev = line[i - 1] ?? "";
    if (quote) {
      if (ch === quote && prev !== "\\") quote = null;
      out += " ";
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      out += " ";
      continue;
    }
    if (ch === "/" && line[i + 1] === "/") break;
    out += ch;
  }
  return out;
}

function stripPropertyKeys(text) {
  // `{ unsettled: false }` names a property, it does not read the binding `unsettled`.
  return text.replace(/([{,]\s*)([A-Za-z_$][\w$]*)\s*:/g, "$1 :");
}

function identifiers(text) {
  const found = new Set();
  for (const match of text.matchAll(/(^|[^\w$.])([A-Za-z_$][\w$]*)(?![\w$])/g)) {
    const name = match[2];
    if (!RESERVED.has(name)) found.add(name);
  }
  return found;
}

function bodyRanges(lines) {
  const ranges = [];
  for (let i = 0; i < lines.length; i++) {
    const header = stripStringsAndComments(lines[i]);
    if (!/^\s*(export\s+)?(async\s+)?function\s+[A-Za-z_$][\w$]*\s*\(/.test(header)) continue;
    let depth = 0;
    let started = false;
    for (let j = i; j < lines.length; j++) {
      for (const ch of stripStringsAndComments(lines[j])) {
        if (ch === OPEN) {
          depth += 1;
          started = true;
        } else if (ch === CLOSE) depth -= 1;
      }
      if (started && depth <= 0) {
        ranges.push({ name: (header.match(/function\s+([A-Za-z_$][\w$]*)/) || [])[1], start: i, end: j });
        break;
      }
    }
  }
  return ranges;
}

// The innermost function frame each line sits in, so a reference inside a nested arrow is not
// compared against a declaration in the outer body. Parameter names are collected per frame: a
// function body that reads its own parameter is not reading a later sibling declaration.
function frameMap(body) {
  const stack = [];
  const frames = [];
  const params = new Map();
  for (const line of body) {
    const clean = stripStringsAndComments(line);
    const opensFunction = /\bfunction\b|=>/.test(clean);
    const functions = stack.map((frame, index) => (frame.function ? index : -1)).filter((index) => index >= 0);
    frames.push(functions.length ? functions[functions.length - 1] : -1);
    if (opensFunction) {
      const header = clean.slice(0, clean.indexOf("{") === -1 ? clean.length : clean.indexOf("{"));
      const list = header.match(/\(([^)]*)\)/);
      const names = new Set();
      if (list) {
        for (const part of list[1].split(",")) {
          const name = part.trim().match(/^([A-Za-z_$][\w$]*)/);
          if (name) names.add(name[1]);
        }
      }
      params.set(stack.length, names);
    }
    for (const ch of clean) {
      if (ch === OPEN) stack.push({ function: opensFunction });
      else if (ch === CLOSE) stack.pop();
    }
  }
  return { frames, params };
}

export function checkSource(source) {
  const lines = source.split("\n");
  const problems = [];
  for (const range of bodyRanges(lines)) {
    const body = lines.slice(range.start + 1, range.end);
    const { frames, params } = frameMap(body);
    const bodyIndent = body.filter((line) => line.trim()).map((line) => (line.match(/^ */) || [''])[0].length).reduce((a, b) => Math.min(a, b), 99);
    const declarations = new Map();
    const order = [];
    body.forEach((line, index) => {
      const match = stripStringsAndComments(line).match(/^(\s*)(?:const|let)\s+([A-Za-z_$][\w$]*)\s*=\s*(.*)$/);
      if (!match || match[1].length !== bodyIndent) return;
      order.push({ index, name: match[2], initializer: stripPropertyKeys(match[3]), frame: frames[index] });
      if (!declarations.has(match[2])) declarations.set(match[2], index);
    });
    for (const declaration of order) {
      // A read inside a callback body happens later, after the whole body has been declared, so it
      // cannot hit the temporal dead zone. Only straight-line initializers can.
      if (/=>|\bfunction\b/.test(declaration.initializer)) continue;
      for (const name of identifiers(declaration.initializer)) {
        const declaredAt = declarations.get(name);
        if (declaredAt === undefined || declaredAt <= declaration.index) continue;
        if (frames[declaredAt] !== declaration.frame) continue;
        if (params.get(declaration.frame)?.has(name)) continue;
        problems.push({
          function: range.name,
          name,
          line: range.start + 2 + declaration.index,
          declarationLine: range.start + 2 + declaredAt,
        });
      }
    }
  }
  return problems;
}

async function main() {
  const { readFileSync } = await import("node:fs");
  const { fileURLToPath } = await import("node:url");
  const file = process.argv[2] ?? fileURLToPath(new URL("../client.js", import.meta.url));
  const problems = checkSource(readFileSync(file, "utf8"));
  if (problems.length) {
    for (const problem of problems) {
      console.error(
        `declaration order: ${problem.function} initializer at line ${problem.line} reads '${problem.name}', declared later at line ${problem.declarationLine}`,
      );
    }
    process.exit(1);
  }
  console.log("declaration order ok");
}

if (process.argv[1]?.endsWith("check-declaration-order.mjs")) await main();
