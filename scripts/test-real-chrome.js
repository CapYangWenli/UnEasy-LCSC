// Real-Chrome end-to-end test: loads the unpacked extension in Chrome for
// Testing, opens the extension options page, and sends the same runtime
// messages the content script sends. Verifies files actually land on disk.
// Usage: set CHROME_PATH to a Chrome-for-Testing binary, then
//   node scripts/test-real-chrome.js

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = process.env.CHROME_PATH;
const EXT_DIR = path.join(__dirname, "..");
const PORT = 9333;

const PROFILE = path.join(os.tmpdir(), "uneasy-lcsc-test-profile");
const DL_DIR = path.join(os.tmpdir(), "uneasy-lcsc-test-downloads");

function rmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch (_) {}
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function httpJson(url, method) {
  const resp = await fetch(url, { method: method || "GET" });
  return resp.json();
}

async function waitForEndpoint() {
  for (let i = 0; i < 60; i++) {
    try {
      return await httpJson(`http://127.0.0.1:${PORT}/json`);
    } catch (_) {
      await sleep(500);
    }
  }
  throw new Error("Chrome DevTools endpoint never came up.");
}

function cdpClient(wsUrl) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(wsUrl);
    let nextId = 1;
    const pending = new Map();
    ws.onopen = () =>
      resolve({
        send(method, params) {
          return new Promise((res, rej) => {
            const id = nextId++;
            pending.set(id, { res, rej });
            ws.send(JSON.stringify({ id, method, params: params || {} }));
          });
        },
        close: () => ws.close()
      });
    ws.onerror = () => reject(new Error("WebSocket connect failed"));
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { res, rej } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) rej(new Error(msg.error.message));
        else res(msg.result);
      }
    };
  });
}

async function evalInPage(cdp, expression) {
  const result = await cdp.send("Runtime.evaluate", {
    expression,
    awaitPromise: true,
    returnByValue: true
  });
  if (result.exceptionDetails) {
    const d = result.exceptionDetails;
    throw new Error(
      "page eval threw: " +
        (d.exception && (d.exception.description || d.exception.value)
          ? d.exception.description || d.exception.value
          : d.text)
    );
  }
  return result.result.value;
}

async function main() {
  if (!CHROME || !fs.existsSync(CHROME)) {
    throw new Error("Set CHROME_PATH to a Chrome-for-Testing chrome.exe");
  }
  rmrf(PROFILE);
  rmrf(DL_DIR);
  fs.mkdirSync(DL_DIR, { recursive: true });
  fs.mkdirSync(path.join(PROFILE, "Default"), { recursive: true });
  fs.writeFileSync(
    path.join(PROFILE, "Default", "Preferences"),
    JSON.stringify({
      download: {
        default_directory: DL_DIR,
        prompt_for_download: false,
        directory_upgrade: true
      },
      savefile: { default_directory: DL_DIR }
    })
  );

  const chrome = spawn(
    CHROME,
    [
      `--remote-debugging-port=${PORT}`,
      `--user-data-dir=${PROFILE}`,
      `--load-extension=${EXT_DIR}`,
      "--headless=new",
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-sync",
      "about:blank"
    ],
    { stdio: "ignore" }
  );

  let failures = 0;
  const check = (label, cond, extra) => {
    if (cond) console.log(`PASS  ${label}`);
    else {
      failures++;
      console.log(`FAIL  ${label}${extra ? " — " + extra : ""}`);
    }
  };

  try {
    await waitForEndpoint();

    // Discover the extension ID: look for our SW target first; if the SW is
    // idle, fall back to the well-known unpacked ID derived from the path.
    let extId = null;
    for (let i = 0; i < 20 && !extId; i++) {
      const targets = await httpJson(`http://127.0.0.1:${PORT}/json`);
      const sw = targets.find(
        (t) =>
          t.type === "service_worker" && /\/src\/background\.js$/.test(t.url)
      );
      if (sw) extId = new URL(sw.url).host;
      else await sleep(500);
    }

    if (!extId) {
      // SW idle or registration failed — try opening the options page with the
      // path-derived ID observed from Chrome logs for this checkout.
      extId = "phhmmomjagnhakepdmgdidpjfeeliaoe";
      console.log("SW not listed; assuming unpacked id", extId);
    } else {
      console.log("extension id:", extId);
    }

    // Open the options page (real extension page, same context the broker uses).
    const created = await httpJson(
      `http://127.0.0.1:${PORT}/json/new?chrome-extension://${extId}/src/options.html`,
      "PUT"
    );
    check("options page opened", !!created.webSocketDebuggerUrl, JSON.stringify(created));
    const page = await cdpClient(created.webSocketDebuggerUrl);
    await sleep(1500);

    const pageUrl = await evalInPage(page, "location.href");
    check(
      "options page really loaded (extension alive)",
      pageUrl === `chrome-extension://${extId}/src/options.html`,
      pageUrl
    );

    // 1. The exact message the content script sends for Download KiCad.
    const dl1 = await evalInPage(
      page,
      `chrome.runtime.sendMessage({type:"uneasy-download",` +
        `filename:"UnEasy-LCSC/UnEasy-LCSC.kicad_symdir/harness.kicad_sym",` +
        `mime:"application/x-kicad-symbol",text:"(kicad_symbol_lib (version 20211014))"})`
    );
    check(
      "uneasy-download responds ok",
      dl1 && dl1.ok === true,
      JSON.stringify(dl1)
    );

    // 2. STEP via real remote URL (C98715 -> SOIC-8 model, ~559KB).
    const dl2 = await evalInPage(
      page,
      `chrome.runtime.sendMessage({type:"uneasy-save-step",` +
        `filename:"UnEasy-LCSC/UnEasy-LCSC.3dshapes/harness.step",` +
        `uuid:"ec3b9f9b31a74655be3e55848dbee9c1"})`
    );
    check("uneasy-save-step responds ok", dl2 && dl2.ok === true, JSON.stringify(dl2));

    // 3. Library status round-trip.
    const st = await evalInPage(
      page,
      `chrome.runtime.sendMessage({type:"uneasy-library-status"})`
    );
    check("uneasy-library-status responds ok", st && st.ok === true, JSON.stringify(st));

    // Verify files really landed on disk with content.
    const symPath = path.join(
      DL_DIR,
      "UnEasy-LCSC",
      "UnEasy-LCSC.kicad_symdir",
      "harness.kicad_sym"
    );
    const stepPath = path.join(
      DL_DIR,
      "UnEasy-LCSC",
      "UnEasy-LCSC.3dshapes",
      "harness.step"
    );
    for (let i = 0; i < 20; i++) {
      if (fs.existsSync(symPath) && fs.existsSync(stepPath)) break;
      await sleep(1000);
    }
    check(
      "kicad_sym on disk with content",
      fs.existsSync(symPath) && fs.statSync(symPath).size > 10,
      fs.existsSync(symPath) ? `size=${fs.statSync(symPath).size}` : "missing"
    );
    check(
      "step on disk with real content (>100KB)",
      fs.existsSync(stepPath) && fs.statSync(stepPath).size > 100 * 1024,
      fs.existsSync(stepPath) ? `size=${fs.statSync(stepPath).size}` : "missing"
    );

    page.close();
  } finally {
    try {
      chrome.kill();
    } catch (_) {}
    await sleep(500);
    rmrf(PROFILE);
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("HARNESS ERROR:", err.message);
  process.exit(2);
});
