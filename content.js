// content.js

(function () {
  const host = location.hostname;

  // ===========================
  // BRANCH 1: LCSC PRODUCT PAGE
  // ===========================
  if (/lcsc\.com$/.test(host)) {
    // Detect LCSC code in URL, e.g. C48606318
    const match = window.location.href.match(/C\d{5,}/i);
    if (!match) return;

    const lcscCode = match[0].toUpperCase();

    if (document.getElementById("lcsc-footprint-btn")) return;

    // ---------- UI CONTAINER ----------
    const container = document.createElement("div");
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

    // Main download button (JSON)
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

    // Checkbox: SVG previews
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

    // Button: open 3D viewer
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

    container.appendChild(btn);
    container.appendChild(svgLabel);
    container.appendChild(btn3d);
    document.body.appendChild(container);

    // ---------- HELPERS (LCSC SIDE) ----------

    function sanitizeFilenamePart(s) {
      return (s || "")
        .toString()
        .replace(/[\\/:*?"<>|]/g, "_")
        .replace(/\s+/g, "_")
        .replace(/_+/g, "_")
        .replace(/^_+|_+$/g, "")
        .trim() || "part";
    }

    // Extract model name / manufacturer part from symbol SVG's c_para attribute
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

    async function fetchSvgsMeta() {
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

    // Parse 3D info out of footprint dataStr.shape (SVGNODE outline3D)
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

    // ---------- MAIN DOWNLOAD (JSON / SVG) ----------

    btn.addEventListener("click", async () => {
      btn.disabled = true;
      btn.textContent = "Fetching...";

      try {
        const { symbolEntry, footprintEntry } = await fetchSvgsMeta();

        // Determine model name for filenames
        let modelName = lcscCode;
        if (symbolEntry?.svg) {
          const extracted = extractModelNameFromSvg(symbolEntry.svg);
          if (extracted) modelName = extracted;
        }
        modelName = sanitizeFilenamePart(modelName);

        // JSON downloads
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

        // Optional SVG downloads
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
        console.error("[LCSC JSON Extractor]", err);
        alert("Failed: " + err.message);
        btn.textContent = "Download EasyEDA JSON";
      } finally {
        btn.disabled = false;
      }
    });

    // ---------- "OPEN 3D VIEWER" BUTTON ----------

    btn3d.addEventListener("click", async () => {
      btn3d.disabled = true;
      const oldText = btn3d.textContent;
      btn3d.textContent = "Opening...";

      try {
        const { footprintEntry } = await fetchSvgsMeta();
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
        const encodedName = encodeURIComponent(modelName3d);

        const viewerUrl =
          `https://easyeda.com/editor/6.5.51/htm/editorpage15.html` +
          `?version=6.5.51` +
          `&url=/analyzer/api/3dmodel/${uuid3d}/${encodedName}.obj`;

        window.open(viewerUrl, "_blank");
        btn3d.textContent = "Opened 3D Viewer";
      } catch (err) {
        console.error("[LCSC 3D Viewer]", err);
        alert("Failed to open 3D viewer: " + err.message);
        btn3d.textContent = oldText;
      } finally {
        btn3d.disabled = false;
      }
    });

    // End LCSC branch
    return;
  }

    // ======================
    // BRANCH 2: EASYEDA VIEWER
    // ======================
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
        // chrome.runtime.getURL works in Chromium; Firefox also supports it
        script.src = chrome.runtime.getURL("injected.js");
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

    // Prevent EasyEDA's jsapi from grabbing our mouse events
    btn.addEventListener("mousedown", e => e.stopPropagation());
    btn.addEventListener("mouseup", e => e.stopPropagation());
    btn.addEventListener("click", e => {
        e.stopPropagation();
        console.log("[Extractor] Export button clicked → sending EASYEDA_EXPORT_OBJ");
        window.postMessage({ type: "EASYEDA_EXPORT_OBJ" }, "*");
    });

    document.body.appendChild(btn);
    console.log("%c[Extractor] Export button added.", "color:lime");
    }
        // Other hosts: do nothing
})();
