// Integration harness: runs the real background.js + library-fs.js + options.js
// with mocked chrome APIs and simulates the content-script message flow.
// Usage: node scripts/test-message-flow.js

"use strict";

const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "src");

function read(file) {
  return fs.readFileSync(path.join(SRC, file), "utf8");
}

// ---------------------------------------------------------------------------
// Minimal in-memory IndexedDB good enough for library-fs.js
// ---------------------------------------------------------------------------
function makeIndexedDb(store) {
  function request(result) {
    const req = {};
    setImmediate(() => req.onsuccess && req.onsuccess({ target: req }));
    Object.defineProperty(req, "result", { get: () => result, configurable: true });
    return req;
  }
  return {
    open() {
      const db = {
        objectStoreNames: { contains: () => true },
        transaction() {
          const tx = {
            objectStore() {
              return {
                get: (key) => request(store.get(key)),
                put: (value, key) => {
                  store.set(key, value);
                  return request(undefined);
                },
                delete: (key) => {
                  store.delete(key);
                  return request(undefined);
                }
              };
            }
          };
          setImmediate(() => tx.oncomplete && tx.oncomplete());
          return tx;
        }
      };
      return request(db);
    }
  };
}

// ---------------------------------------------------------------------------
// Fake directory handle implementing enough File System Access API
// ---------------------------------------------------------------------------
function makeDirHandle(name, filesWritten, permissionState) {
  return {
    name,
    queryPermission: async () => permissionState.value,
    requestPermission: async () => permissionState.value,
    async getDirectoryHandle(dirName) {
      return makeDirHandle(`${name}/${dirName}`, filesWritten, permissionState);
    },
    async getFileHandle(fileName) {
      const full = `${name}/${fileName}`;
      return {
        async createWritable() {
          return {
            async write(data) {
              const len = data.byteLength != null ? data.byteLength : data.length;
              filesWritten.push({ path: full, bytes: len });
            },
            async close() {}
          };
        }
      };
    }
  };
}

// ---------------------------------------------------------------------------
// Chrome API mock shared by SW and options-page contexts
// ---------------------------------------------------------------------------
function makeWorld() {
  const world = {
    downloads: [], // downloads.download calls
    filesWritten: [], // FS writes in the options page
    optionsListeners: [], // options-page onMessage listeners
    swListeners: [], // SW onMessage listeners
    optionsTabOpen: false,
    createdTabs: [],
    log: []
  };

  const OPTIONS_URL = "chrome-extension://abc/src/options.html";

  function makeChrome(kind) {
    return {
      runtime: {
        id: "abc",
        lastError: null,
        getURL: (p) => `chrome-extension://abc/${p}`,
        getManifest: () => ({ version: "test" }),
        getContexts: async () =>
          world.optionsTabOpen ? [{ tabId: 42, documentUrl: OPTIONS_URL }] : [],
        onMessage: {
          addListener(fn) {
            (kind === "sw" ? world.swListeners : world.optionsListeners).push(fn);
          }
        },
        sendMessage: async () => undefined
      },
      tabs: {
        query: async () =>
          world.optionsTabOpen ? [{ id: 42, url: OPTIONS_URL, windowId: 1 }] : [],
        sendMessage: (tabId, msg) =>
          new Promise((resolve, reject) => {
            if (!world.optionsTabOpen || tabId !== 42) {
              reject(new Error("Could not establish connection."));
              return;
            }
            let responded = false;
            const sendResponse = (resp) => {
              responded = true;
              resolve(resp);
            };
            let keepAlive = false;
            for (const fn of world.optionsListeners) {
              const r = fn(msg, { tab: null }, sendResponse);
              if (r === true) keepAlive = true;
            }
            if (!keepAlive && !responded) resolve(undefined);
            setTimeout(() => {
              if (!responded) reject(new Error("The message port closed before a response was received."));
            }, 2000);
          }),
        create: async (props) => {
          world.createdTabs.push(props);
          world.optionsTabOpen = true;
          return { id: 42, url: props.url, windowId: 1 };
        },
        update: async (tabId, props) => ({ id: tabId, ...props })
      },
      downloads: {
        download: (options) =>
          new Promise((resolve) => {
            world.downloads.push(options);
            resolve(world.downloads.length);
          })
      },
      windows: { update: async () => ({}) }
    };
  }

  return { world, makeChrome, OPTIONS_URL };
}

// ---------------------------------------------------------------------------
// Load real sources into VM contexts
// ---------------------------------------------------------------------------
function loadServiceWorker(makeChrome, idb, extras) {
  const chrome = makeChrome("sw");
  const sandbox = {
    chrome,
    console,
    setTimeout,
    clearTimeout,
    setImmediate,
    TextEncoder,
    TextDecoder,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    indexedDB: idb,
    fetch: async () => {
      throw new Error("network disabled in test");
    },
    ...(extras || {})
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.importScripts = (file) => {
    vm.runInContext(read(file), ctx, { filename: file });
  };
  const ctx = vm.createContext(sandbox);
  vm.runInContext(read("background.js"), ctx, { filename: "background.js" });
  return sandbox;
}

function loadOptionsPage(makeChrome, idb, filesWritten, permissionState, handleStore) {
  const chrome = makeChrome("options");
  const noopEl = () => ({
    textContent: "",
    disabled: false,
    classList: { toggle() {}, add() {}, remove() {} },
    addEventListener() {},
    focus() {}
  });
  const sandbox = {
    chrome,
    console,
    setTimeout,
    clearTimeout,
    setImmediate,
    TextEncoder,
    TextDecoder,
    btoa: (s) => Buffer.from(s, "binary").toString("base64"),
    atob: (s) => Buffer.from(s, "base64").toString("binary"),
    indexedDB: idb,
    Blob: class Blob {
      constructor(parts, opts) {
        this.parts = parts;
        this.type = (opts && opts.type) || "";
        this.size = parts.reduce(
          (n, p) => n + (p.byteLength != null ? p.byteLength : p.length || 0),
          0
        );
      }
    },
    URL: {
      createObjectURL: (blob) => `blob:test/${blob.size}`,
      revokeObjectURL: () => {}
    },
    document: { getElementById: () => noopEl() },
    location: { hash: "", href: "" },
    window: {}
  };
  sandbox.globalThis = sandbox;
  sandbox.self = sandbox;
  sandbox.window = sandbox;
  sandbox.window.showDirectoryPicker = () => {};
  const ctx = vm.createContext(sandbox);
  vm.runInContext(read("library-fs.js"), ctx, { filename: "library-fs.js" });
  vm.runInContext(read("options.js"), ctx, { filename: "options.js" });
  return sandbox;
}

// ---------------------------------------------------------------------------
// Drive scenarios through the real SW listener
// ---------------------------------------------------------------------------
function sendToSw(world, msg) {
  return new Promise((resolve, reject) => {
    let responded = false;
    const sendResponse = (resp) => {
      responded = true;
      resolve(resp);
    };
    let keepAlive = false;
    for (const fn of world.swListeners) {
      const r = fn(msg, {}, sendResponse);
      if (r === true) keepAlive = true;
    }
    if (!keepAlive && !responded) resolve(undefined);
    setTimeout(() => {
      if (!responded) reject(new Error("SW never responded (hang)."));
    }, 15000);
  });
}

async function main() {
  let failures = 0;
  const check = (label, cond, extra) => {
    if (cond) console.log(`PASS  ${label}`);
    else {
      failures++;
      console.log(`FAIL  ${label}${extra ? " — " + extra : ""}`);
    }
  };

  // ---- Scenario 1: no library folder configured -> plain Downloads --------
  {
    const { world, makeChrome } = makeWorld();
    const store = new Map();
    const idb = makeIndexedDb(store);
    loadServiceWorker(makeChrome, idb);

    const resp = await sendToSw(world, {
      type: "uneasy-download",
      filename: "UnEasy-LCSC/UnEasy-LCSC.kicad_symdir/test.kicad_sym",
      mime: "application/x-kicad-symbol",
      text: "(kicad_symbol_lib ...)"
    });
    check(
      "S1 no-folder: responds ok via downloads",
      resp && resp.ok === true && resp.mode === "downloads",
      JSON.stringify(resp)
    );
    check(
      "S1 no-folder: data URL used",
      world.downloads.length === 1 && world.downloads[0].url.startsWith("data:"),
      JSON.stringify(world.downloads)
    );
    check("S1 no-folder: no options tab force-opened", world.createdTabs.length === 0);
  }

  // ---- Scenario 2: folder configured + granted -> library write -----------
  {
    const { world, makeChrome } = makeWorld();
    const store = new Map();
    const idb = makeIndexedDb(store);
    const permissionState = { value: "granted" };
    const handle = makeDirHandle("KICAD_LIB", [], permissionState);
    // reuse same array for assertions
    const filesWritten = [];
    const handle2 = makeDirHandle("KICAD_LIB", filesWritten, permissionState);
    store.set("kicadLibrary", handle2);

    loadServiceWorker(makeChrome, idb);
    world.optionsTabOpen = true;
    loadOptionsPage(makeChrome, idb, filesWritten, permissionState, store);

    const resp = await sendToSw(world, {
      type: "uneasy-download",
      filename: "UnEasy-LCSC/UnEasy-LCSC.kicad_symdir/test.kicad_sym",
      mime: "application/x-kicad-symbol",
      text: "(kicad_symbol_lib ...)"
    });
    check(
      "S2 granted: library write succeeds",
      resp && resp.ok === true && resp.mode === "library",
      JSON.stringify(resp)
    );
    check(
      "S2 granted: file written with bytes",
      filesWritten.length === 1 && filesWritten[0].bytes > 0,
      JSON.stringify(filesWritten)
    );
    check("S2 granted: nothing sent to Downloads", world.downloads.length === 0);
  }

  // ---- Scenario 3: folder configured, permission prompt -> Downloads fallback
  {
    const { world, makeChrome } = makeWorld();
    const store = new Map();
    const idb = makeIndexedDb(store);
    const permissionState = { value: "prompt" };
    const filesWritten = [];
    store.set("kicadLibrary", makeDirHandle("KICAD_LIB", filesWritten, permissionState));

    loadServiceWorker(makeChrome, idb);
    world.optionsTabOpen = true;
    loadOptionsPage(makeChrome, idb, filesWritten, permissionState, store);

    const resp = await sendToSw(world, {
      type: "uneasy-download",
      filename: "UnEasy-LCSC/UnEasy-LCSC.kicad_symdir/test.kicad_sym",
      mime: "application/x-kicad-symbol",
      text: "(kicad_symbol_lib ...)"
    });
    check(
      "S3 prompt: falls back to Downloads with ok:true",
      resp && resp.ok === true && resp.mode === "downloads",
      JSON.stringify(resp)
    );
    check(
      "S3 prompt: libraryError explains permission",
      resp && /allow access/i.test(resp.libraryError || ""),
      JSON.stringify(resp)
    );
    check("S3 prompt: no library file written", filesWritten.length === 0);
  }

  // ---- Scenario 4: folder configured but options tab CLOSED ---------------
  {
    const { world, makeChrome } = makeWorld();
    const store = new Map();
    const idb = makeIndexedDb(store);
    const permissionState = { value: "granted" };
    const filesWritten = [];
    store.set("kicadLibrary", makeDirHandle("KICAD_LIB", filesWritten, permissionState));

    loadServiceWorker(makeChrome, idb);
    world.optionsTabOpen = false; // no broker: tabs.create will "open" one, but
    // the harness never loads options.js in it, so pings fail -> fallback.
    // Patch tabs.create so the created tab stays unresponsive.
    const resp = await sendToSw(world, {
      type: "uneasy-download",
      filename: "UnEasy-LCSC/UnEasy-LCSC.kicad_symdir/test.kicad_sym",
      mime: "application/x-kicad-symbol",
      text: "(kicad_symbol_lib ...)"
    });
    check(
      "S4 broker dead: still ok via Downloads (no hang, no hard failure)",
      resp && resp.ok === true && resp.mode === "downloads",
      JSON.stringify(resp)
    );
  }

  // ---- Scenario 5: binary payload (blob->buffer path, e.g. SVG/JSON blob) --
  {
    const { world, makeChrome } = makeWorld();
    const store = new Map();
    const idb = makeIndexedDb(store);
    loadServiceWorker(makeChrome, idb);

    // Simulate Chrome's JSON-serialization of an ArrayBuffer from content script:
    // it arrives as a plain object {} — historically produced empty files.
    const resp = await sendToSw(world, {
      type: "uneasy-download",
      filename: "UnEasy-LCSC/easyeda/img.svg",
      mime: "image/svg+xml",
      buffer: {}
    }).catch((e) => ({ ok: false, error: e.message }));
    check(
      "S5 empty serialized buffer: fails loudly instead of writing empty file",
      resp && resp.ok === false && /payload|empty/i.test(resp.error || ""),
      JSON.stringify(resp)
    );
  }

  // ---- Scenario 6: Firefox background (blob: URLs, never data:) ------------
  {
    const { world, makeChrome } = makeWorld();
    // Simulate Firefox: downloads.download rejects data: URLs.
    const chromeApi = makeChrome("sw");
    const origDownload = chromeApi.downloads.download;
    chromeApi.downloads.download = (options) => {
      if (String(options.url || "").startsWith("data:")) {
        return Promise.reject(
          new Error(
            "Type error for parameter options (Error processing url: Error: Access denied for URL data:...)"
          )
        );
      }
      return origDownload(options);
    };
    // Wrap makeChrome so loadServiceWorker gets our patched downloads.
    const makeChromeFx = () => chromeApi;
    // But makeWorld's makeChrome is used for tab wiring — keep options listeners empty.
    world.swListeners.length = 0;

    const store = new Map();
    const idb = makeIndexedDb(store);
    loadServiceWorker(makeChromeFx, idb, {
      navigator: { userAgent: "Mozilla/5.0 Firefox/140.0" },
      Blob: class Blob {
        constructor(parts, opts) {
          this.parts = parts;
          this.type = (opts && opts.type) || "";
          this.size = parts.reduce(
            (n, p) => n + (p.byteLength != null ? p.byteLength : String(p).length || 0),
            0
          );
        }
      },
      URL: {
        createObjectURL: (blob) => `blob:moz-extension://test/${blob.size}`,
        revokeObjectURL: () => {}
      }
    });

    const resp = await sendToSw(world, {
      type: "uneasy-download",
      filename: "UnEasy-LCSC/UnEasy-LCSC.kicad_symdir/fx.kicad_sym",
      mime: "application/x-kicad-symbol",
      text: "(kicad_symbol_lib firefox)"
    });
    check(
      "S6 Firefox: download ok without data: URL",
      resp && resp.ok === true && resp.mode === "downloads",
      JSON.stringify(resp)
    );
    check(
      "S6 Firefox: used blob: URL (not data:)",
      world.downloads.length === 1 &&
        String(world.downloads[0].url).startsWith("blob:"),
      JSON.stringify(world.downloads)
    );
  }

  console.log(failures === 0 ? "\nALL PASS" : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("HARNESS ERROR:", err);
  process.exit(2);
});
