"use strict";

/**
 * Minimal S-expression tokenizer/parser for KiCad footprint pads/drills/models.
 * Not a full KiCad sexpr implementation — only what FootprintIR needs.
 */

function tokenize(src) {
  const tokens = [];
  let i = 0;
  const s = String(src);
  while (i < s.length) {
    const c = s[i];
    if (c === "(" || c === ")") {
      tokens.push(c);
      i++;
      continue;
    }
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let out = "";
      while (j < s.length) {
        if (s[j] === "\\" && j + 1 < s.length) {
          out += s[j + 1];
          j += 2;
          continue;
        }
        if (s[j] === '"') break;
        out += s[j];
        j++;
      }
      tokens.push({ type: "string", value: out });
      i = j + 1;
      continue;
    }
    let j = i;
    while (j < s.length && !/[\s()]/.test(s[j])) j++;
    tokens.push({ type: "atom", value: s.slice(i, j) });
    i = j;
  }
  return tokens;
}

function parseTokens(tokens) {
  let i = 0;
  function parseOne() {
    if (i >= tokens.length) throw new Error("Unexpected end of sexpr");
    const t = tokens[i++];
    if (t === "(") {
      const list = [];
      while (i < tokens.length && tokens[i] !== ")") {
        list.push(parseOne());
      }
      if (tokens[i] !== ")") throw new Error("Unclosed sexpr list");
      i++;
      return list;
    }
    if (t === ")") throw new Error("Unexpected )");
    if (t && typeof t === "object") return t.value;
    return t;
  }
  const forms = [];
  while (i < tokens.length) forms.push(parseOne());
  return forms;
}

function parseSexpr(src) {
  return parseTokens(tokenize(src));
}

function isList(x) {
  return Array.isArray(x);
}

function head(list) {
  return isList(list) && list.length ? list[0] : null;
}

function findAll(forms, name) {
  const out = [];
  function walk(node) {
    if (!isList(node)) return;
    if (head(node) === name) out.push(node);
    for (const child of node) walk(child);
  }
  for (const f of forms) walk(f);
  return out;
}

function findOne(forms, name) {
  const all = findAll(forms, name);
  return all[0] || null;
}

function atomNum(v, d = 0) {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
}

module.exports = {
  tokenize,
  parseSexpr,
  isList,
  head,
  findAll,
  findOne,
  atomNum
};
