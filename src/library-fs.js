// Chromium-only: persist a KiCad library folder handle and write files into it.
// Loaded by the service worker (importScripts), writer/options pages, and offscreen.

(function (root) {
  "use strict";

  const DB_NAME = "uneasy-lcsc-fs";
  const DB_VERSION = 1;
  const STORE = "handles";
  const KEY = "kicadLibrary";

  function openDb() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB open failed"));
    });
  }

  function idbRequest(req) {
    return new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error || new Error("IndexedDB request failed"));
    });
  }

  async function idbGet(key) {
    const db = await openDb();
    return idbRequest(db.transaction(STORE, "readonly").objectStore(STORE).get(key));
  }

  async function idbSet(key, value) {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB write failed"));
    });
  }

  async function idbDelete(key) {
    const db = await openDb();
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(key);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error || new Error("IndexedDB delete failed"));
    });
  }

  async function getLibraryHandle() {
    try {
      return (await idbGet(KEY)) || null;
    } catch {
      return null;
    }
  }

  async function setLibraryHandle(handle) {
    await idbSet(KEY, handle);
  }

  async function clearLibraryHandle() {
    await idbDelete(KEY);
  }

  /**
   * Check / request readwrite permission for a directory handle.
   *
   * IMPORTANT: requestPermission() without a user gesture returns "denied" and
   * can poison the grant for the whole extension. Only pass allowRequest:true
   * from a click handler on a visible extension page (options / writer).
   */
  async function ensureReadWrite(handle, options) {
    const allowRequest = !!(options && options.allowRequest);
    if (!handle || typeof handle.queryPermission !== "function") return false;
    const opts = { mode: "readwrite" };
    let state = "prompt";
    try {
      state = await handle.queryPermission(opts);
    } catch (err) {
      // Stale handles after extension reload throw here.
      const error = new Error(
        "KiCad library folder handle expired. Open Options and choose the folder again."
      );
      error.code = "handle-expired";
      throw error;
    }
    if (state === "granted") return true;
    if (state === "denied") return false;
    if (!allowRequest || typeof handle.requestPermission !== "function") {
      return false;
    }
    try {
      state = await handle.requestPermission(opts);
    } catch (_) {
      return false;
    }
    return state === "granted";
  }

  function normalizeLibraryRelPath(filename) {
    return String(filename || "")
      .replace(/^[/\\]+/, "")
      .replace(/^UnEasy-LCSC[/\\]/, "");
  }

  async function writeToLibrary(filename, data, options) {
    const handle = await getLibraryHandle();
    if (!handle) return { wrote: false, reason: "no-handle" };

    let allowed = false;
    try {
      allowed = await ensureReadWrite(handle, options);
    } catch (err) {
      if (err && err.code === "handle-expired") {
        try {
          await clearLibraryHandle();
        } catch (_) {}
      }
      throw err;
    }

    if (!allowed) {
      const error = new Error(
        "KiCad library folder needs Allow access. Open More → KiCad library folder…, click Allow access, keep that tab open, then re-download."
      );
      error.code = "need-permission";
      throw error;
    }

    const rel = normalizeLibraryRelPath(filename);
    const parts = rel.split(/[/\\]/).filter(Boolean);
    if (!parts.length) throw new Error("Invalid library path.");

    let dir = handle;
    try {
      for (let i = 0; i < parts.length - 1; i++) {
        dir = await dir.getDirectoryHandle(parts[i], { create: true });
      }

      const fileHandle = await dir.getFileHandle(parts[parts.length - 1], {
        create: true
      });
      const writable = await fileHandle.createWritable();
      try {
        await writable.write(data);
      } finally {
        await writable.close();
      }
    } catch (err) {
      // Directory/file ops also fail when the persisted handle is dead.
      const msg = err && err.message ? err.message : String(err);
      if (/not found|invalid|permission|allow/i.test(msg)) {
        try {
          await clearLibraryHandle();
        } catch (_) {}
        const error = new Error(
          "KiCad library folder is no longer writable. Open Options and choose the folder again."
        );
        error.code = "handle-expired";
        throw error;
      }
      throw err;
    }

    return { wrote: true, path: rel, root: handle.name || "library" };
  }

  async function getStatus() {
    const handle = await getLibraryHandle();
    if (!handle) return { configured: false };
    let permission = "unknown";
    try {
      permission = await handle.queryPermission({ mode: "readwrite" });
    } catch (_) {
      // Service workers and some contexts cannot query FS permission.
      // The handle is still configured — only a page with a user gesture can write.
      return {
        configured: true,
        name: handle.name || "library",
        permission: "unknown",
        queryFailed: true
      };
    }
    return {
      configured: true,
      name: handle.name || "library",
      permission
    };
  }

  function bytesToBase64(bytes) {
    const arr =
      bytes instanceof Uint8Array
        ? bytes
        : bytes instanceof ArrayBuffer
          ? new Uint8Array(bytes)
          : new Uint8Array(bytes || []);
    let binary = "";
    const chunk = 0x8000;
    for (let i = 0; i < arr.length; i += chunk) {
      binary += String.fromCharCode.apply(null, arr.subarray(i, i + chunk));
    }
    return btoa(binary);
  }

  function base64ToBytes(base64) {
    const binary = atob(String(base64 || ""));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  }

  /**
   * Decode a write/download message payload.
   * Prefer text / base64 — raw ArrayBuffer over extension messaging can arrive empty.
   */
  function decodeMessagePayload(msg) {
    if (!msg) throw new Error("No file data to write.");
    if (typeof msg.text === "string" && msg.text.length > 0) {
      return new TextEncoder().encode(msg.text);
    }
    if (typeof msg.base64 === "string" && msg.base64.length > 0) {
      return base64ToBytes(msg.base64);
    }
    if (msg.buffer) {
      const arr =
        msg.buffer instanceof Uint8Array
          ? msg.buffer
          : new Uint8Array(
              msg.buffer instanceof ArrayBuffer ? msg.buffer : msg.buffer
            );
      if (arr.byteLength > 0) return arr;
    }
    if (typeof msg.text === "string") {
      return new TextEncoder().encode(msg.text);
    }
    throw new Error("No file data to write.");
  }

  root.UnEasyLibraryFs = {
    getLibraryHandle,
    setLibraryHandle,
    clearLibraryHandle,
    ensureReadWrite,
    writeToLibrary,
    getStatus,
    normalizeLibraryRelPath,
    bytesToBase64,
    base64ToBytes,
    decodeMessagePayload
  };
})(typeof globalThis !== "undefined" ? globalThis : self);
