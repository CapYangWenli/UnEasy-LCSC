// Background helpers: privileged fetch + save under Downloads/UnEasy-LCSC/...
// Chromium can also write directly into a user-picked KiCad library folder.
//
// Browser constraints this file carefully avoids:
// - Chrome MV3 SW: URL.createObjectURL is unavailable → use data: URLs for small files
// - Firefox: downloads.download rejects data: URLs ("Access denied for URL") → use blob:
//   URLs from the background page (createObjectURL works there)
// - chrome.downloads is unavailable in offscreen documents
// - STEP / large binaries: never use data: (Chrome writes empty files above ~100–200KB)

if (typeof importScripts === "function" && typeof UnEasyLibraryFs === "undefined") {
  try {
    importScripts("library-fs.js");
  } catch (_) {}
}

const api = typeof browser !== "undefined" ? browser : chrome;

// chrome.downloads with data: URLs silently produces empty files above ~100–200KB.
// STEP models are typically 0.3–2MB+, so never use data: for them.
const DATA_URL_MAX_BYTES = 96 * 1024;

function isFirefoxBackground() {
  try {
    return (
      typeof navigator !== "undefined" && /firefox/i.test(navigator.userAgent || "")
    );
  } catch (_) {
    return false;
  }
}

function canCreateObjectUrl() {
  return (
    typeof URL !== "undefined" &&
    typeof URL.createObjectURL === "function" &&
    typeof Blob !== "undefined"
  );
}

function downloadsDownload(options) {
  if (!api.downloads || typeof api.downloads.download !== "function") {
    return Promise.reject(
      new Error("chrome.downloads API is unavailable in this context.")
    );
  }
  const result = api.downloads.download(options);
  if (result && typeof result.then === "function") return result;
  return new Promise((resolve, reject) => {
    api.downloads.download(options, (id) => {
      const err = api.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(id);
    });
  });
}

function stepUrlsForUuid(uuid) {
  const id = encodeURIComponent(String(uuid || "").trim());
  return [
    `https://modules.easyeda.com/qAxj6KHrDKw4blvCG8QJPs7Y/${id}`,
    `https://modules.lceda.cn/qAxj6KHrDKw4blvCG8QJPs7Y/${id}`
  ];
}

function looksLikeStep(buffer) {
  if (!buffer || !buffer.byteLength) return false;
  const head = new TextDecoder("utf-8", { fatal: false }).decode(
    buffer.byteLength > 64 ? buffer.slice(0, 64) : buffer
  );
  return head.includes("ISO-10303");
}

function toBytes(msg) {
  // Prefer non-empty text. An empty ArrayBuffer is truthy and used to win over text.
  if (typeof msg.text === "string" && msg.text.length > 0) {
    return new TextEncoder().encode(msg.text);
  }
  if (typeof msg.base64 === "string" && msg.base64.length > 0) {
    return UnEasyLibraryFs.base64ToBytes(msg.base64);
  }
  if (msg.buffer) {
    const arr = toUint8Array(msg.buffer);
    if (arr.byteLength > 0) return arr;
  }
  if (typeof msg.text === "string") {
    return new TextEncoder().encode(msg.text);
  }
  throw new Error("Download payload missing text/buffer.");
}

function toUint8Array(bytes) {
  if (bytes instanceof Uint8Array) return bytes;
  if (bytes instanceof ArrayBuffer) return new Uint8Array(bytes);
  return new Uint8Array(bytes);
}

function bytesToBase64(bytes) {
  if (typeof UnEasyLibraryFs !== "undefined" && UnEasyLibraryFs.bytesToBase64) {
    return UnEasyLibraryFs.bytesToBase64(bytes);
  }
  const arr = toUint8Array(bytes);
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < arr.length; i += chunk) {
    binary += String.fromCharCode.apply(null, arr.subarray(i, i + chunk));
  }
  return btoa(binary);
}

function bytesToDataUrl(bytes, mime) {
  return `data:${mime || "application/octet-stream"};base64,${bytesToBase64(bytes)}`;
}

function sendMessage(msg) {
  const result = api.runtime.sendMessage(msg);
  if (result && typeof result.then === "function") return result;
  return new Promise((resolve, reject) => {
    api.runtime.sendMessage(msg, (response) => {
      const err = api.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(response);
    });
  });
}

function tabsQuery(queryInfo) {
  const result = api.tabs.query(queryInfo);
  if (result && typeof result.then === "function") return result;
  return new Promise((resolve, reject) => {
    api.tabs.query(queryInfo, (tabs) => {
      const err = api.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(tabs || []);
    });
  });
}

function tabsSendMessage(tabId, msg) {
  const result = api.tabs.sendMessage(tabId, msg);
  if (result && typeof result.then === "function") return result;
  return new Promise((resolve, reject) => {
    api.tabs.sendMessage(tabId, msg, (response) => {
      const err = api.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(response);
    });
  });
}

function tabsCreate(createProperties) {
  const result = api.tabs.create(createProperties);
  if (result && typeof result.then === "function") return result;
  return new Promise((resolve, reject) => {
    api.tabs.create(createProperties, (tab) => {
      const err = api.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(tab);
    });
  });
}

function tabsUpdate(tabId, updateProperties) {
  const result = api.tabs.update(tabId, updateProperties);
  if (result && typeof result.then === "function") return result;
  return new Promise((resolve, reject) => {
    api.tabs.update(tabId, updateProperties, (tab) => {
      const err = api.runtime.lastError;
      if (err) reject(new Error(err.message));
      else resolve(tab);
    });
  });
}

function optionsPageUrl() {
  return api.runtime.getURL("src/options.html");
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function listOptionsTabs() {
  const url = optionsPageUrl();
  const found = [];

  // Preferred: getContexts sees extension pages reliably in MV3.
  if (api.runtime.getContexts) {
    try {
      const contexts = await api.runtime.getContexts({
        contextTypes: ["TAB"],
        documentUrls: [url]
      });
      for (const ctx of contexts || []) {
        if (ctx.tabId != null) {
          found.push({ id: ctx.tabId, url: ctx.documentUrl || url });
        }
      }
    } catch (_) {}
  }

  if (found.length) return found;

  try {
    const tabs = await tabsQuery({});
    return (tabs || []).filter((tab) => {
      const u = tab.url || tab.pendingUrl || "";
      return u === url || u.startsWith(url + "#") || u.startsWith(url + "?");
    });
  } catch (_) {
    return [];
  }
}

async function pingOptionsTab(tabId) {
  try {
    const response = await tabsSendMessage(tabId, { type: "uneasy-page-status" });
    return !!(response && response.ok);
  } catch (_) {
    return false;
  }
}

async function ensureOptionsBroker() {
  const existing = await listOptionsTabs();
  for (const tab of existing) {
    if (await pingOptionsTab(tab.id)) return tab;
  }

  // Tab open but dead (common after extension reload) — reload in place.
  // Do not steal focus; user may be on LCSC.
  if (existing.length) {
    const tab = existing[0];
    try {
      await tabsUpdate(tab.id, { url: optionsPageUrl() });
      for (let i = 0; i < 15; i++) {
        await sleep(150);
        if (await pingOptionsTab(tab.id)) return tab;
      }
    } catch (_) {}
  }

  const created = await tabsCreate({ url: optionsPageUrl(), active: false });
  for (let i = 0; i < 20; i++) {
    await sleep(150);
    if (created && created.id != null && (await pingOptionsTab(created.id))) {
      return created;
    }
  }
  return created || null;
}

async function openLibraryPage() {
  const url = optionsPageUrl();
  const existing = await listOptionsTabs();
  if (existing.length) {
    const tab = existing[0];
    // If dead after reload, refresh; otherwise just focus.
    if (!(await pingOptionsTab(tab.id))) {
      await tabsUpdate(tab.id, { active: true, url });
      for (let i = 0; i < 15; i++) {
        await sleep(150);
        if (await pingOptionsTab(tab.id)) break;
      }
    } else {
      await tabsUpdate(tab.id, { active: true });
    }
    if (tab.windowId != null && api.windows && api.windows.update) {
      try {
        await api.windows.update(tab.windowId, { focused: true });
      } catch (_) {}
    }
    return { ok: true, reused: true };
  }
  await tabsCreate({ url, active: true });
  return { ok: true, reused: false };
}

function buildWritePayload(filename, bytes, text) {
  const payload = { type: "uneasy-page-write", filename };
  // Prefer text for .kicad_sym / .kicad_mod. For binary (STEP), use base64 —
  // raw ArrayBuffer via tabs.sendMessage from the SW can arrive with byteLength 0.
  if (typeof text === "string" && text.length > 0) {
    payload.text = text;
    return payload;
  }
  const arr = toUint8Array(bytes);
  if (!arr.byteLength) {
    throw new Error("Refusing to send an empty library payload.");
  }
  payload.base64 = bytesToBase64(arr);
  return payload;
}

async function writeViaExtensionPages(filename, bytes, text) {
  const payload = buildWritePayload(filename, bytes, text);
  const targets = await listOptionsTabs();

  let lastError = null;
  for (const tab of targets) {
    try {
      const response = await tabsSendMessage(tab.id, payload);
      if (response && response.ok && response.wrote) return response;
      if (response && response.error) lastError = response;
    } catch (err) {
      lastError = {
        error: err && err.message ? err.message : String(err),
        code: "broker-unreachable"
      };
    }
  }
  return lastError
    ? {
        wrote: false,
        error: lastError.error,
        code: lastError.code || "need-permission",
        reason: lastError.reason || lastError.code || "need-permission"
      }
    : null;
}

async function libraryHandlePresent() {
  if (typeof UnEasyLibraryFs === "undefined") return false;
  try {
    const handle = await UnEasyLibraryFs.getLibraryHandle();
    return !!handle;
  } catch (_) {
    return false;
  }
}

async function tryWriteLibrary(filename, bytes, text) {
  // File System Access writes must run in the options tab (user-gesture permission).
  // Never call requestPermission from the SW — that returns "denied" and poisons access.
  // Never treat SW queryPermission failure as "no folder configured".
  if (typeof UnEasyLibraryFs === "undefined") {
    return { wrote: false, reason: "no-fs-helper" };
  }
  if (!(await libraryHandlePresent())) {
    return { wrote: false, reason: "no-handle" };
  }

  // Make sure the options broker is alive, then write.
  try {
    await ensureOptionsBroker();
  } catch (err) {
    console.warn("[UnEasy-LCSC] ensure options broker failed:", err);
  }

  try {
    let viaPage = await writeViaExtensionPages(filename, bytes, text);
    if (viaPage && viaPage.wrote) return viaPage;

    // One retry after re-ensuring broker (first message can race tab load).
    if (!viaPage || viaPage.code === "broker-unreachable") {
      await sleep(250);
      await ensureOptionsBroker();
      viaPage = await writeViaExtensionPages(filename, bytes, text);
      if (viaPage && viaPage.wrote) return viaPage;
    }

    if (viaPage && viaPage.error) return viaPage;
  } catch (err) {
    console.warn("[UnEasy-LCSC] page library write failed:", err);
    return {
      wrote: false,
      error: err && err.message ? err.message : String(err),
      code: "write-failed"
    };
  }

  return {
    wrote: false,
    error:
      "KiCad library folder needs Allow access in the library tab. Open More → KiCad library folder…, click Allow access (or Choose folder…), keep that tab open, then re-download.",
    code: "need-permission",
    reason: "need-permission"
  };
}

async function saveRemoteViaDownloads(filename, url) {
  const id = await downloadsDownload({
    url,
    filename,
    conflictAction: "overwrite",
    saveAs: false
  });
  return { id, mode: "direct", url };
}

async function saveBytesViaOptionsDownload(filename, bytes, mime) {
  const targets = await listOptionsTabs();
  if (!targets.length) return null;

  const arr = toUint8Array(bytes);
  if (!arr.byteLength) return null;
  const payload = {
    type: "uneasy-page-download",
    filename,
    mime: mime || "application/octet-stream",
    base64: bytesToBase64(arr)
  };

  for (const tab of targets) {
    try {
      const response = await tabsSendMessage(tab.id, payload);
      if (response && response.ok) return response;
    } catch (_) {}
  }
  return null;
}

async function saveBytesViaDownloads(filename, bytes, mime) {
  const arr = toUint8Array(bytes);
  if (!arr.byteLength) {
    throw new Error("Refusing to save an empty file.");
  }
  const type = mime || "application/octet-stream";

  // Firefox rejects data: URLs in downloads.download. Its background page supports
  // createObjectURL — prefer blob: there. Chrome MV3 SWs lack createObjectURL.
  if (canCreateObjectUrl()) {
    const blob = new Blob([arr], { type });
    const url = URL.createObjectURL(blob);
    try {
      const id = await downloadsDownload({
        url,
        filename,
        conflictAction: "overwrite",
        saveAs: false
      });
      setTimeout(() => {
        try {
          URL.revokeObjectURL(url);
        } catch (_) {}
      }, 60_000);
      return { id, mode: "downloads" };
    } catch (err) {
      try {
        URL.revokeObjectURL(url);
      } catch (_) {}
      // On Firefox, data: is also denied — do not fall through.
      if (isFirefoxBackground()) throw err;
    }
  }

  // Large binaries on Chrome SW: options-page blob download, else fail clearly.
  if (arr.byteLength > DATA_URL_MAX_BYTES) {
    const viaPage = await saveBytesViaOptionsDownload(filename, arr, type);
    if (viaPage && viaPage.ok) return viaPage;
    throw new Error(
      `File is ${arr.byteLength} bytes — too large for a data-URL download. ` +
        "Open More → KiCad library folder… (keep it open) or use Download STEP so the remote URL can be saved."
    );
  }

  // Chrome SW path for small text/binary: data: URLs.
  const url = bytesToDataUrl(arr, type);
  const id = await downloadsDownload({
    url,
    filename,
    conflictAction: "overwrite",
    saveAs: false
  });
  return { id, mode: "downloads" };
}

async function handleDownload(msg) {
  const bytes = toBytes(msg);
  const text =
    typeof msg.text === "string" && msg.text.length > 0 ? msg.text : undefined;
  const library = await tryWriteLibrary(msg.filename, bytes, text);
  if (library && library.wrote) {
    return {
      ok: true,
      mode: "library",
      path: library.path,
      root: library.root
    };
  }

  const saved = await saveBytesViaDownloads(
    msg.filename,
    bytes,
    msg.mime || "application/octet-stream"
  );
  return {
    ok: true,
    id: saved.id,
    mode: "downloads",
    libraryError: library && library.error ? library.error : undefined,
    libraryReason: library && library.reason ? library.reason : undefined
  };
}

async function handleFetch(msg) {
  const resp = await fetch(msg.url, {
    method: msg.method || "GET",
    headers: msg.headers || {
      Accept: "*/*",
      Referer: "https://easyeda.com/"
    },
    redirect: "follow",
    credentials: "omit"
  });

  const buffer = await resp.arrayBuffer();
  return {
    ok: true,
    status: resp.status,
    contentType: resp.headers.get("content-type") || "",
    buffer
  };
}

async function fetchStepBuffer(urls, errors) {
  for (const url of urls) {
    try {
      const resp = await fetch(url, {
        headers: {
          Accept: "*/*",
          Referer: "https://easyeda.com/"
        },
        redirect: "follow",
        credentials: "omit"
      });
      if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
      const buffer = await resp.arrayBuffer();
      if (!looksLikeStep(buffer)) {
        throw new Error("Response was not a STEP file.");
      }
      return { buffer, url };
    } catch (err) {
      errors.push(`${url}: ${err && err.message ? err.message : err}`);
    }
  }
  return null;
}

async function handleSaveStep(msg) {
  const filename = msg.filename;
  if (!filename) throw new Error("STEP filename missing.");
  const urls = stepUrlsForUuid(msg.uuid);
  const errors = [];

  let libraryError;
  let fetched = null;
  const wantLibrary = await libraryHandlePresent();

  // Library folder: need bytes in-process. Downloads path must NOT use data: URLs
  // (Chrome writes empty files for large STEP payloads).
  if (wantLibrary) {
    fetched = await fetchStepBuffer(urls, errors);
    if (fetched) {
      if (!fetched.buffer || !fetched.buffer.byteLength) {
        errors.push("Fetched STEP was empty.");
      } else {
        const library = await tryWriteLibrary(filename, fetched.buffer);
        if (library && library.wrote) {
          return {
            ok: true,
            mode: "library",
            path: library.path,
            root: library.root,
            url: fetched.url,
            bytes: fetched.buffer.byteLength
          };
        }
        if (library && library.error) {
          libraryError = library.error;
          errors.push(library.error);
        }
      }
    }
  }

  for (const url of urls) {
    try {
      const saved = await saveRemoteViaDownloads(filename, url);
      return {
        ok: true,
        id: saved.id,
        url,
        mode: "direct",
        libraryError
      };
    } catch (err) {
      errors.push(`${url}: ${err && err.message ? err.message : err}`);
    }
  }

  // Last resort: fetch + blob download via open options tab (no data: URL).
  if (!fetched) fetched = await fetchStepBuffer(urls, errors);
  if (fetched && fetched.buffer && fetched.buffer.byteLength) {
    const viaPage = await saveBytesViaOptionsDownload(
      filename,
      fetched.buffer,
      "application/step"
    );
    if (viaPage && viaPage.ok) {
      return {
        ok: true,
        id: viaPage.id,
        url: fetched.url,
        mode: "blob-download",
        libraryError
      };
    }
    errors.push(
      "Blob download failed — open More → KiCad library folder… and keep that tab open, then retry."
    );
  }

  throw new Error(errors.join(" | ") || "STEP download failed.");
}

async function queryPageLibraryStatus() {
  const targets = await listOptionsTabs();
  for (const tab of targets) {
    try {
      const response = await tabsSendMessage(tab.id, {
        type: "uneasy-page-status"
      });
      if (response && response.ok) return response;
    } catch (_) {}
  }
  return null;
}

async function handleLibraryStatus() {
  if (typeof UnEasyLibraryFs === "undefined") {
    return { ok: true, configured: false, supported: false };
  }
  // Permission is per document — ask the open options tab when present.
  const fromPage = await queryPageLibraryStatus();
  if (fromPage) return { ok: true, supported: true, ...fromPage };
  const status = await UnEasyLibraryFs.getStatus();
  return { ok: true, supported: true, ...status };
}

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return undefined;
  // Writer/options pages own these.
  if (
    msg.type === "uneasy-page-write" ||
    msg.type === "uneasy-page-status" ||
    msg.type === "uneasy-page-download" ||
    msg.type === "uneasy-offscreen-write"
  ) {
    return undefined;
  }

  (async () => {
    try {
      if (msg.type === "uneasy-download") {
        sendResponse(await handleDownload(msg));
        return;
      }
      if (msg.type === "uneasy-fetch") {
        sendResponse(await handleFetch(msg));
        return;
      }
      if (msg.type === "uneasy-save-step") {
        sendResponse(await handleSaveStep(msg));
        return;
      }
      if (msg.type === "uneasy-library-status") {
        sendResponse(await handleLibraryStatus());
        return;
      }
      if (msg.type === "uneasy-open-options" || msg.type === "uneasy-open-writer") {
        sendResponse(await openLibraryPage());
        return;
      }
      sendResponse({ ok: false, error: `Unknown message type: ${msg.type}` });
    } catch (err) {
      sendResponse({
        ok: false,
        error: err && err.message ? err.message : String(err)
      });
    }
  })();

  return true;
});
