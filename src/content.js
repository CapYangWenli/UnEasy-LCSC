// content.js

(function () {
  const host = location.hostname;

  // ===========================
  // BRANCH 1: LCSC / JLCPCB PART PAGE
  // ===========================
  // JLCPCB uses the same C##### part numbers and EasyEDA library as LCSC
  // (e.g. https://jlcpcb.com/partdetail/.../C70589).
  if (/(?:^|\.)(?:lcsc|jlcpcb)\.com$/i.test(host)) {
    // Avoid injecting into ads/chat iframes on JLCPCB.
    if (window !== window.top) return;

    const PANEL_ID = "uneasy-lcsc-panel";

    function getPartCodeFromUrl() {
      // JLCPCB: /partdetail/<slug>/C70589  — use the last path segment only so
      // manufacturer PNs that contain "C…" cannot steal the match.
      const segments = location.pathname.split("/").filter(Boolean);
      for (let i = segments.length - 1; i >= 0; i--) {
        if (/^C\d{4,}$/i.test(segments[i])) return segments[i].toUpperCase();
      }

      // LCSC product URLs often embed C##### elsewhere in the path/query.
      const any = location.href.match(/(?:^|[^\w])(C\d{4,})(?:[^\d]|$)/i);
      return any ? any[1].toUpperCase() : null;
    }

    function getPartCodeFromPage() {
      const text = document.body ? document.body.innerText : "";
      const labeled = text.match(
        /(?:JLCPCB\s*Part\s*#|LCSC\s*Part\s*#|LCSC\s*#)\s*[:：]?\s*(C\d{4,})/i
      );
      if (labeled) return labeled[1].toUpperCase();
      return null;
    }

    function getPartCode() {
      return getPartCodeFromUrl() || getPartCodeFromPage();
    }

    function sanitizeFilenamePart(s) {
      return (s || "")
        .toString()
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/\s+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "")
        .trim() || "part";
    }

    function extractModelNameFromSvg(svgText) {
      if (!svgText) return null;
      const m = svgText.match(/c_para="([^"]*)"/);
      if (!m) return null;

      const parts = m[1].split("`");
      let name = null, mp = null, val = null;

      for (let i = 0; i < parts.length - 1; i += 2) {
        const key = parts[i];
        const v = parts[i + 1];
        if (key === "Manufacturer Part") mp = v;
        if (key === "name") name = v;
        if (key === "Value") val = v;
      }

      return mp || name || val || null;
    }

    async function downloadFile(filename, text, mime = "application/octet-stream") {
      const blob = new Blob([text], { type: mime });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    }

    async function fetchSvgsMeta(lcscCode) {
      const svgsUrl = `https://easyeda.com/api/products/${lcscCode}/svgs`;
      const svgsResp = await fetch(svgsUrl);
      if (!svgsResp.ok) throw new Error(`SVGS HTTP ${svgsResp.status}`);
      const svgsData = await svgsResp.json();

      if (!svgsData.success) throw new Error("SVGS API invalid");

      const results = svgsData.result || [];
      const symbolEntry = results.find(r => r.docType === 2);
      const footprintEntry = results.find(r => r.docType === 4);
      return { symbolEntry, footprintEntry };
    }

    async function fetchDataStr(uuid) {
      const compUrl = `https://easyeda.com/api/components/${uuid}`;
      const compResp = await fetch(compUrl);
      if (!compResp.ok) throw new Error(`Component HTTP ${compResp.status}`);
      const compData = await compResp.json();
      return compData?.result?.dataStr;
    }

    function extract3DInfoFromDataStr(dataStr) {
      if (!dataStr || !Array.isArray(dataStr.shape)) return null;

      for (const entry of dataStr.shape) {
        if (typeof entry !== "string") continue;
        if (!entry.startsWith("SVGNODE~")) continue;

        const jsonPart = entry.slice("SVGNODE~".length);
        try {
          const node = JSON.parse(jsonPart);
          const attrs = node && node.attrs;
          if (!attrs) continue;

          if (attrs.c_etype === "outline3D" && attrs.uuid) {
            const uuid3d = attrs.uuid;
            const title =
              attrs.title ||
              (dataStr.head &&
                dataStr.head.c_para &&
                (dataStr.head.c_para["3DModel"] || dataStr.head.c_para["package"])) ||
              "model";
            return { uuid3d, modelName3d: title };
          }
        } catch (e) {
          continue;
        }
      }
      return null;
    }

    function mountPanel(lcscCode) {
      const existing = document.getElementById(PANEL_ID);
      if (existing) {
        if (existing.dataset.lcscCode === lcscCode) return;
        existing.remove();
      }

      if (!document.body) return;

      const container = document.createElement("div");
      container.id = PANEL_ID;
      container.dataset.lcscCode = lcscCode;
      Object.assign(container.style, {
        position: "fixed",
        right: "20px",
        bottom: "20px",
        zIndex: "999999",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
        alignItems: "flex-end",
        fontFamily: "sans-serif",
        fontSize: "12px"
      });

      const btn = document.createElement("button");
      btn.id = "lcsc-footprint-btn";
      btn.textContent = "Download EasyEDA JSON";
      Object.assign(btn.style, {
        padding: "8px 12px",
        background: "#1976d2",
        color: "#fff",
        border: "none",
        borderRadius: "4px",
        cursor: "pointer",
        fontSize: "12px",
        boxShadow: "0 2px 4px rgba(0,0,0,0.3)"
      });

      const svgLabel = document.createElement("label");
      svgLabel.style.display = "flex";
      svgLabel.style.alignItems = "center";
      svgLabel.style.gap = "4px";
      svgLabel.style.cursor = "pointer";

      const svgCheckbox = document.createElement("input");
      svgCheckbox.type = "checkbox";
      svgCheckbox.id = "lcsc-download-svg";

      const svgText = document.createElement("span");
      svgText.textContent = "Download SVG previews too";

      svgLabel.appendChild(svgCheckbox);
      svgLabel.appendChild(svgText);

      const btn3d = document.createElement("button");
      btn3d.id = "lcsc-open-3d";
      btn3d.textContent = "Open 3D Viewer";
      Object.assign(btn3d.style, {
        padding: "6px 10px",
        background: "#388e3c",
        color: "#fff",
        border: "none",
        borderRadius: "4px",
        cursor: "pointer",
        fontSize: "11px",
        boxShadow: "0 2px 4px rgba(0,0,0,0.3)"
      });

      const versionLabel = document.createElement("div");
      let extVersion = "?";
      try {
        const runtime = (typeof browser !== "undefined" && browser.runtime) || chrome.runtime;
        extVersion = runtime.getManifest().version;
      } catch (_) {}
      versionLabel.textContent = `UnEasy-LCSC v${extVersion}`;
      Object.assign(versionLabel.style, {
        color: "#666",
        fontSize: "10px",
        background: "rgba(255,255,255,0.9)",
        padding: "2px 6px",
        borderRadius: "3px"
      });

      container.appendChild(btn);
      container.appendChild(svgLabel);
      container.appendChild(btn3d);
      container.appendChild(versionLabel);
      document.body.appendChild(container);

      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Fetching...";

        try {
          const { symbolEntry, footprintEntry } = await fetchSvgsMeta(lcscCode);

          let modelName = lcscCode;
          if (symbolEntry?.svg) {
            const extracted = extractModelNameFromSvg(symbolEntry.svg);
            if (extracted) modelName = extracted;
          }
          modelName = sanitizeFilenamePart(modelName);

          if (symbolEntry?.component_uuid) {
            const sym = await fetchDataStr(symbolEntry.component_uuid);
            if (sym) {
              await downloadFile(
                `${lcscCode}_${modelName}_symbol.json`,
                JSON.stringify(sym, null, 2),
                "application/json"
              );
            }
          }

          if (footprintEntry?.component_uuid) {
            const fp = await fetchDataStr(footprintEntry.component_uuid);
            if (fp) {
              await downloadFile(
                `${lcscCode}_${modelName}_footprint.json`,
                JSON.stringify(fp, null, 2),
                "application/json"
              );
            }
          }

          if (svgCheckbox.checked) {
            if (symbolEntry?.svg) {
              await downloadFile(
                `${lcscCode}_${modelName}_symbol.svg`,
                symbolEntry.svg,
                "image/svg+xml"
              );
            }
            if (footprintEntry?.svg) {
              await downloadFile(
                `${lcscCode}_${modelName}_footprint.svg`,
                footprintEntry.svg,
                "image/svg+xml"
              );
            }
          }

          btn.textContent = "Done!";
        } catch (err) {
          console.error("[UnEasy-LCSC]", err);
          alert("Failed: " + err.message);
          btn.textContent = "Download EasyEDA JSON";
        } finally {
          btn.disabled = false;
        }
      });

      btn3d.addEventListener("click", async () => {
        btn3d.disabled = true;
        const oldText = btn3d.textContent;
        btn3d.textContent = "Opening...";

        try {
          const { footprintEntry } = await fetchSvgsMeta(lcscCode);
          if (!footprintEntry?.component_uuid) {
            throw new Error("No footprint component UUID found for this part.");
          }

          const fpDataStr = await fetchDataStr(footprintEntry.component_uuid);
          if (!fpDataStr) {
            throw new Error("Footprint dataStr missing.");
          }

          const info3d = extract3DInfoFromDataStr(fpDataStr);
          if (!info3d) {
            throw new Error("No outline3D SVGNODE / 3D info found in footprint.");
          }

          const { uuid3d, modelName3d } = info3d;
          const modelUUID = uuid3d;
          const modelName = modelName3d || "model";

          const baseUrl = "https://easyeda.com/editor/6.5.51/htm/editorpage15.html";
          const modelPath = `/analyzer/api/3dmodel/${modelUUID}/${encodeURIComponent(modelName)}.obj`;

          const viewerUrl =
            `${baseUrl}?version=6.5.51` +
            `&url=${encodeURIComponent(modelPath)}` +
            `&ue_lcsc=${encodeURIComponent(lcscCode)}` +
            `&ue_name=${encodeURIComponent(modelName)}` +
            `&ue_uuid=${encodeURIComponent(modelUUID)}`;

          window.open(viewerUrl, "_blank");
          btn3d.textContent = "Opened 3D Viewer";
        } catch (err) {
          console.error("[UnEasy-LCSC 3D]", err);
          alert("Failed to open 3D viewer: " + err.message);
          btn3d.textContent = oldText;
        } finally {
          btn3d.disabled = false;
        }
      });
    }

    function syncPanelToUrl() {
      const code = getPartCode();
      if (!code) {
        document.getElementById(PANEL_ID)?.remove();
        return;
      }
      mountPanel(code);
    }

    function whenBodyReady(fn) {
      if (document.body) {
        fn();
        return;
      }
      const obs = new MutationObserver(() => {
        if (!document.body) return;
        obs.disconnect();
        fn();
      });
      obs.observe(document.documentElement, { childList: true, subtree: true });
    }

    whenBodyReady(syncPanelToUrl);

    // JLCPCB is a SPA — hook history + poll so client-side navigations remount.
    let lastKey = location.href + "|" + (getPartCode() || "");
    const onNav = () => {
      const code = getPartCode();
      const key = location.href + "|" + (code || "");
      if (key === lastKey) return;
      lastKey = key;
      syncPanelToUrl();
    };

    window.addEventListener("popstate", onNav);
    window.addEventListener("hashchange", onNav);

    const wrapHistory = (method) => {
      const orig = history[method];
      if (typeof orig !== "function") return;
      history[method] = function (...args) {
        const ret = orig.apply(this, args);
        queueMicrotask(onNav);
        return ret;
      };
    };
    wrapHistory("pushState");
    wrapHistory("replaceState");

    setInterval(onNav, 500);

    return;
  }

  // ===========================
  // BRANCH 2: EASYEDA 3D VIEWER
  // ===========================
    if (host.includes("easyeda.com") && location.href.includes("/editor/")) {
    if (window.__easyedaObjExporterInjected) {
        console.log("[Extractor] EasyEDA viewer branch already injected.");
        return;
    }
    window.__easyedaObjExporterInjected = true;

    console.log("%c[Extractor] Loaded on EasyEDA Viewer (content.js).", "color:#4af");

    // Inject external script (injected.js) into the page
    try {
        const script = document.createElement("script");
        // chrome.* and browser.* both work in Firefox; Chromium uses chrome.*
        const runtime = (typeof browser !== "undefined" && browser.runtime) || chrome.runtime;
        script.src = runtime.getURL("src/injected.js");
        script.onload = () => {
        console.log("[Extractor] injected.js loaded into page.");
        script.remove();
        };
        (document.head || document.documentElement).appendChild(script);
    } catch (e) {
        console.error("[Extractor] Failed to inject injected.js:", e);
    }

    // Add "Export 3D OBJ" button
    const btn = document.createElement("button");
    btn.textContent = "Export 3D OBJ";
    Object.assign(btn.style, {
        position: "fixed",
        right: "20px",
        bottom: "20px",
        zIndex: "999999",
        padding: "8px",
        background: "#ff9800",
        color: "#000",
        border: "none",
        borderRadius: "4px",
        cursor: "pointer",
        fontSize: "11px",
        boxShadow: "0 2px 4px rgba(0,0,0,0.3)"
    });

    function setExportBusy(busy) {
      btn.disabled = busy;
      btn.textContent = busy ? "Exporting…" : "Export 3D OBJ";
      btn.style.opacity = busy ? "0.7" : "1";
      btn.style.cursor = busy ? "wait" : "pointer";
    }

    window.addEventListener("message", (event) => {
      if (event.source !== window || !event.data) return;
      if (event.data.type === "EASYEDA_EXPORT_OBJ_BUSY") setExportBusy(true);
      if (event.data.type === "EASYEDA_EXPORT_OBJ_DONE") setExportBusy(false);
    });

    // Prevent EasyEDA's jsapi from grabbing our mouse events
    btn.addEventListener("mousedown", e => e.stopPropagation());
    btn.addEventListener("mouseup", e => e.stopPropagation());
    btn.addEventListener("click", e => {
        e.stopPropagation();
        if (btn.disabled) return;
        window.postMessage({ type: "EASYEDA_EXPORT_OBJ" }, "*");
    });

    document.body.appendChild(btn);
    }
        // Other hosts: do nothing
})();
