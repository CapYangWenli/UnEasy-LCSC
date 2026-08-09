#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");

const root = path.join(__dirname, "..");
const envPath = path.join(root, ".env");

function loadEnvFile(filePath) {
  if (!fs.existsSync(filePath)) return false;

  const text = fs.readFileSync(filePath, "utf8");
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;

    const eq = line.indexOf("=");
    if (eq <= 0) continue;

    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
  return true;
}

const loaded = loadEnvFile(envPath);
const apiKey = (process.env.WEB_EXT_API_KEY || "").trim();
const apiSecret = (process.env.WEB_EXT_API_SECRET || "").trim();

if (!apiKey || !apiSecret) {
  console.error(
    loaded
      ? "Missing WEB_EXT_API_KEY / WEB_EXT_API_SECRET in .env"
      : "No .env file found. Copy .env.example to .env and add your AMO API keys."
  );
  console.error("Get keys: https://addons.mozilla.org/developers/addon/api/key/");
  process.exit(1);
}

// web-ext's package "exports" block require.resolve() for bin files.
const webExtCandidates = [
  path.join(root, "node_modules", "web-ext", "bin", "web-ext.js"),
  path.join(root, "node_modules", "web-ext", "bin", "web-ext"),
];
const webExtBin = webExtCandidates.find((p) => fs.existsSync(p));
if (!webExtBin) {
  console.error("web-ext is not installed. Run: npm install");
  process.exit(1);
}

const args = [
  webExtBin,
  "sign",
  "--source-dir",
  ".",
  "--channel",
  "unlisted",
  "--artifacts-dir",
  "web-ext-artifacts",
  "--api-key",
  apiKey,
  "--api-secret",
  apiSecret,
];

const result = spawnSync(process.execPath, args, {
  cwd: root,
  stdio: "inherit",
  env: process.env,
  shell: false,
});

process.exit(result.status == null ? 1 : result.status);
