// Chromium offscreen document — File System Access library writes only.
// chrome.downloads is NOT available here (runtime API only for chrome.*).
// Downloads use data: URLs from the service worker instead.

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || msg.type !== "uneasy-offscreen-write") return undefined;

  (async () => {
    try {
      if (typeof UnEasyLibraryFs === "undefined") {
        throw new Error("Library helper not loaded in offscreen document.");
      }
      let data = msg.buffer;
      if (!data && typeof msg.text === "string") {
        data = new TextEncoder().encode(msg.text);
      }
      if (!data) throw new Error("No file data to write.");
      const result = await UnEasyLibraryFs.writeToLibrary(msg.filename, data);
      sendResponse({ ok: true, ...result });
    } catch (err) {
      sendResponse({
        ok: false,
        error: err && err.message ? err.message : String(err),
        code: err && err.code
      });
    }
  })();

  return true;
});
