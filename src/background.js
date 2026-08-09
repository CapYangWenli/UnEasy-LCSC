// Background helpers: privileged fetch + save under Downloads/UnEasy-LCSC/...

const api = typeof browser !== "undefined" ? browser : chrome;

function downloadsDownload(options) {
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

async function handleDownload(msg) {
  let objectUrl = null;
  try {
    let bytes;
    if (msg.buffer) {
      bytes = msg.buffer instanceof ArrayBuffer ? msg.buffer : msg.buffer;
    } else if (typeof msg.text === "string") {
      bytes = new TextEncoder().encode(msg.text);
    } else {
      throw new Error("Download payload missing text/buffer.");
    }

    const blob = new Blob([bytes], {
      type: msg.mime || "application/octet-stream"
    });
    objectUrl = URL.createObjectURL(blob);

    const id = await downloadsDownload({
      url: objectUrl,
      filename: msg.filename,
      conflictAction: "overwrite",
      saveAs: false
    });

    return { ok: true, id };
  } finally {
    if (objectUrl) {
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
    }
  }
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

async function handleSaveStep(msg) {
  const filename = msg.filename;
  if (!filename) throw new Error("STEP filename missing.");
  const urls = stepUrlsForUuid(msg.uuid);
  const errors = [];

  // 1) Let the browser download manager pull the remote URL directly.
  //    Avoids shipping a ~1.5MB ArrayBuffer through runtime messaging.
  for (const url of urls) {
    try {
      const id = await downloadsDownload({
        url,
        filename,
        conflictAction: "overwrite",
        saveAs: false
      });
      return { ok: true, id, url, mode: "direct" };
    } catch (err) {
      errors.push(`${url}: ${err && err.message ? err.message : err}`);
    }
  }

  // 2) Fetch in background, validate STEP header, then save via blob URL.
  for (const url of urls) {
    let objectUrl = null;
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
      objectUrl = URL.createObjectURL(
        new Blob([buffer], { type: "application/step" })
      );
      const id = await downloadsDownload({
        url: objectUrl,
        filename,
        conflictAction: "overwrite",
        saveAs: false
      });
      setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
      objectUrl = null;
      return { ok: true, id, url, mode: "fetched" };
    } catch (err) {
      errors.push(`${url}: ${err && err.message ? err.message : err}`);
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    }
  }

  throw new Error(errors.join(" | ") || "STEP download failed.");
}

api.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return undefined;

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
