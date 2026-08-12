"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

let cached = null;

function loadConverter() {
  if (cached) return cached;
  const convertPath = path.join(__dirname, "..", "..", "..", "src", "kicad", "convert.js");
  const code = fs.readFileSync(convertPath, "utf8");
  const ctx = { globalThis: {} };
  vm.createContext(ctx);
  vm.runInContext(code, ctx);
  if (!ctx.globalThis.UnEasyKicad) {
    throw new Error("Failed to load UnEasyKicad from convert.js");
  }
  cached = ctx.globalThis.UnEasyKicad;
  return cached;
}

module.exports = { loadConverter };
