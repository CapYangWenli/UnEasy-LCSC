(async function () {
  const statusEl = document.getElementById("status");
  const pickBtn = document.getElementById("pick");
  const allowBtn = document.getElementById("allow");
  const clearBtn = document.getElementById("clear");
  const fs = globalThis.UnEasyLibraryFs;

  function setStatus(text, ready) {
    statusEl.textContent = text;
    statusEl.classList.toggle("ready", !!ready);
  }

  function setPrimary(which) {
    pickBtn.classList.toggle("primary", which === "pick");
    pickBtn.classList.toggle("secondary", which !== "pick");
    allowBtn.classList.toggle("primary", which === "allow");
    allowBtn.classList.toggle("secondary", which !== "allow");
  }

  async function refresh() {
    if (!fs) {
      setStatus("Library helper failed to load.");
      pickBtn.disabled = true;
      allowBtn.disabled = true;
      return;
    }
    if (typeof window.showDirectoryPicker !== "function") {
      setStatus(
        "This browser does not support choosing a library folder (Chromium required)."
      );
      pickBtn.disabled = true;
      allowBtn.disabled = true;
      return;
    }

    const status = await fs.getStatus();
    if (!status.configured) {
      setPrimary("pick");
      allowBtn.disabled = true;
      setStatus(
        "No library folder selected.\nFiles will go to Downloads/UnEasy-LCSC/ until you choose one."
      );
      return;
    }

    allowBtn.disabled = false;
    if (status.permission === "granted") {
      setPrimary("pick");
      allowBtn.textContent = "Access granted";
      setStatus(
        `Ready — saving into: ${status.name}\n\nKeep this tab open. Download parts on LCSC/JLCPCB; files write here.\n\nPoint KiCad path UNEASY_LCSC at this same folder.`,
        true
      );
      return;
    }

    setPrimary("allow");
    allowBtn.textContent = "Allow access";
    setStatus(
      `Folder: ${status.name}\nPermission: ${status.permission}\n\nClick Allow access (Chrome requires a click in this tab), then download again.`
    );
  }

  async function decodePayload(msg) {
    if (fs && typeof fs.decodeMessagePayload === "function") {
      return fs.decodeMessagePayload(msg);
    }
    if (typeof msg.text === "string" && msg.text.length > 0) {
      return new TextEncoder().encode(msg.text);
    }
    if (typeof msg.base64 === "string" && msg.base64.length > 0) {
      return fs.base64ToBytes(msg.base64);
    }
    if (msg.buffer) {
      const arr =
        msg.buffer instanceof ArrayBuffer
          ? new Uint8Array(msg.buffer)
          : new Uint8Array(msg.buffer);
      if (arr.byteLength > 0) return arr;
    }
    throw new Error("No file data to write.");
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (
      !msg ||
      (msg.type !== "uneasy-page-write" &&
        msg.type !== "uneasy-page-status" &&
        msg.type !== "uneasy-page-download")
    ) {
      return undefined;
    }
    (async () => {
      try {
        if (!fs) throw new Error("Library helper not loaded.");
        if (msg.type === "uneasy-page-status") {
          sendResponse({ ok: true, ...(await fs.getStatus()) });
          return;
        }
        if (msg.type === "uneasy-page-download") {
          const data = await decodePayload(msg);
          if (!data.byteLength) throw new Error("Refusing to save an empty file.");
          const blob = new Blob([data], {
            type: msg.mime || "application/octet-stream"
          });
          const url = URL.createObjectURL(blob);
          try {
            const id = await new Promise((resolve, reject) => {
              chrome.downloads.download(
                {
                  url,
                  filename: msg.filename,
                  conflictAction: "overwrite",
                  saveAs: false
                },
                (downloadId) => {
                  const err = chrome.runtime.lastError;
                  if (err) reject(new Error(err.message));
                  else resolve(downloadId);
                }
              );
            });
            sendResponse({ ok: true, id, mode: "blob-download", bytes: data.byteLength });
          } finally {
            setTimeout(() => URL.revokeObjectURL(url), 60_000);
          }
          return;
        }
        const data = await decodePayload(msg);
        if (!data.byteLength) throw new Error("Refusing to write an empty file.");
        const result = await fs.writeToLibrary(msg.filename, data, {
          allowRequest: false
        });
        sendResponse({ ok: true, ...result, bytes: data.byteLength });
      } catch (err) {
        sendResponse({
          ok: false,
          wrote: false,
          error: err && err.message ? err.message : String(err),
          code: err && err.code,
          reason: err && err.code === "need-permission" ? "need-permission" : undefined
        });
      }
    })();
    return true;
  });

  pickBtn.addEventListener("click", async () => {
    try {
      const handle = await window.showDirectoryPicker({
        id: "uneasy-lcsc-library",
        mode: "readwrite",
        startIn: "documents"
      });
      const ok = await fs.ensureReadWrite(handle, { allowRequest: true });
      if (!ok) {
        throw new Error("Read/write permission was not granted for that folder.");
      }
      await fs.setLibraryHandle(handle);
      await refresh();
    } catch (err) {
      if (err && err.name === "AbortError") return;
      setStatus(`Failed: ${err && err.message ? err.message : err}`);
    }
  });

  allowBtn.addEventListener("click", async () => {
    try {
      const handle = await fs.getLibraryHandle();
      if (!handle) {
        setStatus("No folder selected. Press Choose folder… first.");
        return;
      }
      const ok = await fs.ensureReadWrite(handle, { allowRequest: true });
      if (!ok) {
        setStatus(
          "Permission was not granted.\nIf Chrome previously denied access, press Choose folder… again."
        );
        return;
      }
      await refresh();
    } catch (err) {
      setStatus(`Failed: ${err && err.message ? err.message : err}`);
    }
  });

  clearBtn.addEventListener("click", async () => {
    try {
      await fs.clearLibraryHandle();
      allowBtn.textContent = "Allow access";
      await refresh();
    } catch (err) {
      setStatus(`Failed to clear: ${err && err.message ? err.message : err}`);
    }
  });

  await refresh();

  if (/#grant/i.test(location.hash) && !allowBtn.disabled) {
    allowBtn.focus();
  }
})();
