// Real-Chrome test of the KiCad library-folder write path.
// Uses the OPFS root directory handle as the "library folder" (it is a real
// FileSystemDirectoryHandle with granted permission), stores it the same way
// the options page does, then drives uneasy-download and verifies the file
// is written INTO the library (not Downloads).
// Usage: set CHROME_PATH to a Chrome-for-Testing binary, then
//   node scripts/test-real-chrome-library.js

"use strict";

const { spawn } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");

const CHROME = process.env.CHROME_PATH;
const EXT_DIR = path.join(__dirname, "..");
const PORT = 9334;
const PROFILE = path.join(os.tmpdir(), "uneasy-lcsc-lib-profile");
const DL_DIR = path.join(os.tmpdir(), "uneasy-lcsc-lib-downloads");

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
      download: { default_directory: DL_DIR, prompt_for_download: false }
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
    for (let i = 0; i < 60; i++) {
      try {
        await httpJson(`http://127.0.0.1:${PORT}/json`);
        break;
      } catch (_) {
        await sleep(500);
      }
    }

    const extId = "phhmmomjagnhakepdmgdidpjfeeliaoe";
    const created = await httpJson(
      `http://127.0.0.1:${PORT}/json/new?chrome-extension://${extId}/src/options.html`,
      "PUT"
    );
    const page = await cdpClient(created.webSocketDebuggerUrl);
    await sleep(1500);

    // Install the OPFS root as the library handle (same IDB slot options.js uses).
    const installed = await evalInPage(
      page,
      `(async () => {
         const root = await navigator.storage.getDirectory();
         await UnEasyLibraryFs.setLibraryHandle(root);
         const status = await UnEasyLibraryFs.getStatus();
         return status;
       })()`
    );
    check(
      "OPFS handle installed as library folder",
      installed && installed.configured === true,
      JSON.stringify(installed)
    );

    // Text write (Download KiCad path).
    const dl1 = await evalInPage(
      page,
      `chrome.runtime.sendMessage({type:"uneasy-download",` +
        `filename:"UnEasy-LCSC/UnEasy-LCSC.kicad_symdir/lib-test.kicad_sym",` +
        `mime:"application/x-kicad-symbol",text:"(kicad_symbol_lib (version 20211014))"})`
    );
    check(
      "text file written to LIBRARY (mode=library)",
      dl1 && dl1.ok === true && dl1.mode === "library",
      JSON.stringify(dl1)
    );

    // STEP write (binary base64 path) with real remote fetch (~559KB).
    const dl2 = await evalInPage(
      page,
      `chrome.runtime.sendMessage({type:"uneasy-save-step",` +
        `filename:"UnEasy-LCSC/UnEasy-LCSC.3dshapes/lib-test.step",` +
        `uuid:"ec3b9f9b31a74655be3e55848dbee9c1"})`
    );
    check(
      "STEP written to LIBRARY (mode=library)",
      dl2 && dl2.ok === true && dl2.mode === "library",
      JSON.stringify(dl2)
    );

    // Read both back from OPFS and verify contents are non-empty and correct.
    const verify = await evalInPage(
      page,
      `(async () => {
         const root = await navigator.storage.getDirectory();
         async function readSize(pathParts) {
           let dir = root;
           for (let i = 0; i < pathParts.length - 1; i++) {
             dir = await dir.getDirectoryHandle(pathParts[i]);
           }
           const fh = await dir.getFileHandle(pathParts[pathParts.length - 1]);
           const f = await fh.getFile();
           const head = await f.slice(0, 32).text();
           return { size: f.size, head };
         }
         const sym = await readSize(["UnEasy-LCSC.kicad_symdir", "lib-test.kicad_sym"]);
         const step = await readSize(["UnEasy-LCSC.3dshapes", "lib-test.step"]);
         return { sym, step };
       })()`
    );
    check(
      "kicad_sym content correct in library",
      verify.sym.size > 10 && verify.sym.head.startsWith("(kicad_symbol_lib"),
      JSON.stringify(verify.sym)
    );
    check(
      "STEP content real in library (>100KB, ISO-10303)",
      verify.step.size > 100 * 1024 && verify.step.head.includes("ISO-10303"),
      JSON.stringify({ size: verify.step.size, head: verify.step.head.slice(0, 20) })
    );

    // Nothing should have leaked into Downloads.
    const dlLeak = fs.existsSync(path.join(DL_DIR, "UnEasy-LCSC"));
    check("no fallback files leaked into Downloads", !dlLeak);

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
