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

    function getRuntime() {
      return (typeof browser !== "undefined" && browser.runtime) || chrome.runtime;
    }

    function extensionAlive() {
      try {
        return !!(getRuntime() && getRuntime().id);
      } catch (_) {
        return false;
      }
    }

    function friendlyRuntimeError(err) {
      const msg = err && err.message ? err.message : String(err || "");
      if (/extension context invalidated/i.test(msg) || !extensionAlive()) {
        return "Extension was reloaded. Refresh this page, then try again.";
      }
      return msg || "Unknown error.";
    }

    async function runtimeSend(message) {
      if (!extensionAlive()) {
        throw new Error("Extension was reloaded. Refresh this page, then try again.");
      }
      try {
        const response = await getRuntime().sendMessage(message);
        return response;
      } catch (err) {
        throw new Error(friendlyRuntimeError(err));
      }
    }

    // Chromium-only library folder writing (File System Access API). Firefox stays on Downloads/.
    function isChromiumBrowser() {
      return !/firefox/i.test(navigator.userAgent || "");
    }

    function libraryPath(kind, filename) {
      if (typeof UnEasyKicad !== "undefined" && UnEasyKicad.libraryPath) {
        return UnEasyKicad.libraryPath(kind, filename);
      }
      const base = String(filename || "file").split(/[/\\]/).pop();
      if (kind === "symbol") return `UnEasy-LCSC/UnEasy-LCSC.kicad_symdir/${base}`;
      if (kind === "footprint") return `UnEasy-LCSC/UnEasy-LCSC.pretty/${base}`;
      if (kind === "step") return `UnEasy-LCSC/UnEasy-LCSC.3dshapes/${base}`;
      if (kind === "easyeda") return `UnEasy-LCSC/easyeda/${base}`;
      return `UnEasy-LCSC/${base}`;
    }

    async function downloadViaBackground(filename, payload) {
      const response = await runtimeSend({
        type: "uneasy-download",
        filename,
        mime: payload.mime || "application/octet-stream",
        text: payload.text,
        buffer: payload.buffer
      });
      if (!response || !response.ok) {
        throw new Error((response && response.error) || "Download failed.");
      }
      return response;
    }

    function noteLibraryFallback(responses) {
      if (!isChromiumBrowser()) return;
      const failed = (responses || []).find(
        (r) =>
          r &&
          (r.mode === "downloads" || r.mode === "direct" || r.mode === "blob-download") &&
          (r.libraryError ||
            (r.libraryReason &&
              r.libraryReason !== "no-handle" &&
              r.libraryReason !== "no-fs-helper"))
      );
      if (!failed) return;
      const detail =
        failed.libraryError ||
        "Folder permission missing — click Allow access in the library tab.";
      console.warn("[UnEasy-LCSC] library folder write failed:", detail);
      runtimeSend({ type: "uneasy-open-options" }).catch(() => {});
      alert(
        "KiCad library folder write failed — files went to Downloads instead.\n\n" +
          detail +
          "\n\nIn the library tab, status must say Ready (Allow access / Choose folder…). Keep that tab open, then re-download."
      );
    }

    async function fetchViaBackground(url) {
      const response = await runtimeSend({
        type: "uneasy-fetch",
        url
      });
      if (!response || !response.ok) {
        throw new Error((response && response.error) || "Background fetch failed.");
      }
      return response;
    }

    async function saveStepViaBackground(filename, uuid3d) {
      const response = await runtimeSend({
        type: "uneasy-save-step",
        filename,
        uuid: uuid3d
      });
      if (!response || !response.ok) {
        throw new Error((response && response.error) || "STEP download failed.");
      }
      return response;
    }

    function downloadBlobFallback(filename, blob) {
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = String(filename).split(/[/\\]/).pop();
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    async function downloadBlob(filename, blob, mime) {
      try {
        const buffer = await blob.arrayBuffer();
        await downloadViaBackground(filename, {
          buffer,
          mime: mime || blob.type || "application/octet-stream"
        });
      } catch (err) {
        // Fallback: <a download> usually cannot create subfolders.
        console.warn("[UnEasy-LCSC] background download failed, falling back:", err);
        downloadBlobFallback(filename, blob);
      }
    }

    async function downloadFile(filename, text, mime = "application/octet-stream") {
      try {
        await downloadViaBackground(filename, { text, mime });
      } catch (err) {
        console.warn("[UnEasy-LCSC] background download failed, falling back:", err);
        downloadBlobFallback(filename, new Blob([text], { type: mime }));
      }
    }

    async function resolveFootprint3D(lcscCode) {
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

      return info3d;
    }

    async function fetchJson(url, label) {
      let text;
      let status;
      try {
        const resp = await fetchViaBackground(url);
        status = resp.status;
        text = new TextDecoder("utf-8").decode(resp.buffer);
      } catch (_) {
        const resp = await fetch(url);
        status = resp.status;
        text = await resp.text();
      }
      if (status < 200 || status >= 300) {
        throw new Error(`${label} HTTP ${status}`);
      }
      try {
        return JSON.parse(text);
      } catch {
        throw new Error(`${label} returned non-JSON (HTTP ${status}).`);
      }
    }

    async function fetchSvgsMeta(lcscCode) {
      const svgsUrl = `https://easyeda.com/api/products/${lcscCode}/svgs`;
      const svgsData = await fetchJson(svgsUrl, "SVGS");

      if (!svgsData.success) {
        const detail = svgsData.message || svgsData.code || "unknown";
        throw new Error(
          `No EasyEDA CAD data for ${lcscCode} (${detail}). Check the LCSC code.`
        );
      }

      const results = svgsData.result || [];
      const symbolEntry = results.find(r => r.docType === 2);
      const footprintEntry = results.find(r => r.docType === 4);
      return { symbolEntry, footprintEntry };
    }

    async function fetchComponent(uuid) {
      const compUrl = `https://easyeda.com/api/components/${uuid}`;
      const compData = await fetchJson(compUrl, "Component");
      return compData?.result || null;
    }

    async function fetchDataStr(uuid) {
      const result = await fetchComponent(uuid);
      return result?.dataStr || null;
    }

    function extract3DInfoFromDataStr(dataStr) {
      if (!dataStr || !Array.isArray(dataStr.shape)) return null;

      let fallback = null;
      for (const entry of dataStr.shape) {
        if (typeof entry !== "string") continue;
        if (!entry.startsWith("SVGNODE~")) continue;

        const jsonPart = entry.slice("SVGNODE~".length);
        try {
          const node = JSON.parse(jsonPart);
          const attrs = node && node.attrs;
          if (!attrs || !attrs.uuid) continue;

          const title =
            attrs.title ||
            (dataStr.head &&
              dataStr.head.c_para &&
              (dataStr.head.c_para["3DModel"] || dataStr.head.c_para["package"])) ||
            "model";
          const info = { uuid3d: attrs.uuid, modelName3d: title };

          if (attrs.c_etype === "outline3D") return info;
          if (!fallback) fallback = info;
        } catch (e) {
          continue;
        }
      }
      return fallback;
    }

    function mountPanel(lcscCode) {
      const existing = document.getElementById(PANEL_ID);
      if (existing) {
        if (existing.dataset.lcscCode === lcscCode) return;
        if (typeof existing._uneasyCleanup === "function") existing._uneasyCleanup();
        existing.remove();
      }

      if (!document.body) return;

      let extVersion = "?";
      try {
        const runtime = (typeof browser !== "undefined" && browser.runtime) || chrome.runtime;
        extVersion = runtime.getManifest().version;
      } catch (_) {}

      const container = document.createElement("div");
      container.id = PANEL_ID;
      container.dataset.lcscCode = lcscCode;
      Object.assign(container.style, {
        position: "fixed",
        right: "20px",
        bottom: "20px",
        zIndex: "999999",
        fontFamily: "system-ui, Segoe UI, sans-serif",
        fontSize: "12px"
      });

      const bar = document.createElement("div");
      Object.assign(bar.style, {
        display: "flex",
        alignItems: "stretch",
        gap: "0",
        boxShadow: "0 2px 8px rgba(0,0,0,0.28)",
        borderRadius: "6px",
        overflow: "hidden"
      });

      const btnKicad = document.createElement("button");
      btnKicad.id = "lcsc-download-kicad";
      btnKicad.type = "button";
      btnKicad.textContent = "Download KiCad";
      Object.assign(btnKicad.style, {
        padding: "9px 14px",
        background: "#e65100",
        color: "#fff",
        border: "none",
        cursor: "pointer",
        fontSize: "12px",
        fontWeight: "600",
        lineHeight: "1.2"
      });

      const btnMore = document.createElement("button");
      btnMore.id = "lcsc-more-btn";
      btnMore.type = "button";
      btnMore.setAttribute("aria-haspopup", "true");
      btnMore.setAttribute("aria-expanded", "false");
      btnMore.title = "More options";
      btnMore.textContent = "More ▾";
      Object.assign(btnMore.style, {
        padding: "9px 10px",
        background: "#bf360c",
        color: "#fff",
        border: "none",
        borderLeft: "1px solid rgba(255,255,255,0.25)",
        cursor: "pointer",
        fontSize: "12px",
        lineHeight: "1.2",
        whiteSpace: "nowrap"
      });

      const menu = document.createElement("div");
      menu.id = "lcsc-more-menu";
      menu.hidden = true;
      Object.assign(menu.style, {
        position: "absolute",
        right: "0",
        bottom: "calc(100% + 6px)",
        minWidth: "220px",
        background: "#fff",
        color: "#222",
        border: "1px solid #ddd",
        borderRadius: "6px",
        boxShadow: "0 4px 16px rgba(0,0,0,0.18)",
        padding: "4px",
        display: "flex",
        flexDirection: "column",
        gap: "2px"
      });

      function styleMenuItem(el) {
        Object.assign(el.style, {
          display: "block",
          width: "100%",
          textAlign: "left",
          padding: "8px 10px",
          background: "transparent",
          color: "#222",
          border: "none",
          borderRadius: "4px",
          cursor: "pointer",
          fontSize: "12px",
          lineHeight: "1.3",
          boxSizing: "border-box"
        });
        el.addEventListener("mouseenter", () => {
          if (!el.disabled) el.style.background = "#f3f3f3";
        });
        el.addEventListener("mouseleave", () => {
          el.style.background = "transparent";
        });
      }

      const btnStep = document.createElement("button");
      btnStep.id = "lcsc-download-step";
      btnStep.type = "button";
      btnStep.textContent = "Download STEP";
      styleMenuItem(btnStep);

      const btn3d = document.createElement("button");
      btn3d.id = "lcsc-open-3d";
      btn3d.type = "button";
      btn3d.textContent = "Open 3D Viewer";
      styleMenuItem(btn3d);

      const btn = document.createElement("button");
      btn.id = "lcsc-footprint-btn";
      btn.type = "button";
      btn.textContent = "Download EasyEDA JSON";
      styleMenuItem(btn);

      const svgLabel = document.createElement("label");
      svgLabel.htmlFor = "lcsc-download-svg";
      Object.assign(svgLabel.style, {
        display: "flex",
        alignItems: "center",
        gap: "8px",
        padding: "8px 10px",
        borderRadius: "4px",
        cursor: "pointer",
        fontSize: "12px",
        color: "#222",
        userSelect: "none"
      });
      svgLabel.addEventListener("mouseenter", () => {
        svgLabel.style.background = "#f3f3f3";
      });
      svgLabel.addEventListener("mouseleave", () => {
        svgLabel.style.background = "transparent";
      });

      const svgCheckbox = document.createElement("input");
      svgCheckbox.type = "checkbox";
      svgCheckbox.id = "lcsc-download-svg";

      const svgText = document.createElement("span");
      svgText.textContent = "Include SVG previews";

      svgLabel.appendChild(svgCheckbox);
      svgLabel.appendChild(svgText);

      const menuDivider = document.createElement("div");
      Object.assign(menuDivider.style, {
        height: "1px",
        background: "#eee",
        margin: "4px 6px"
      });

      const versionLabel = document.createElement("div");
      versionLabel.textContent = `UnEasy-LCSC v${extVersion}`;
      Object.assign(versionLabel.style, {
        color: "#888",
        fontSize: "10px",
        padding: "4px 10px 6px"
      });

      menu.appendChild(btnStep);
      menu.appendChild(btn3d);
      menu.appendChild(btn);
      menu.appendChild(svgLabel);
      menu.appendChild(menuDivider);
      menu.appendChild(versionLabel);

      bar.appendChild(btnKicad);
      bar.appendChild(btnMore);
      container.appendChild(bar);
      container.appendChild(menu);
      document.body.appendChild(container);

      let menuIdleTimer = null;
      const MENU_IDLE_MS = 8000;

      function clearMenuIdleTimer() {
        if (menuIdleTimer != null) {
          clearTimeout(menuIdleTimer);
          menuIdleTimer = null;
        }
      }

      function armMenuIdleTimer() {
        clearMenuIdleTimer();
        if (menu.hidden) return;
        menuIdleTimer = setTimeout(() => setMenuOpen(false), MENU_IDLE_MS);
      }

      function setMenuOpen(open) {
        menu.hidden = !open;
        btnMore.setAttribute("aria-expanded", open ? "true" : "false");
        btnMore.textContent = open ? "More ▴" : "More ▾";
        if (open) armMenuIdleTimer();
        else clearMenuIdleTimer();
      }

      if (isChromiumBrowser()) {
        const btnLib = document.createElement("button");
        btnLib.id = "lcsc-set-library-folder";
        btnLib.type = "button";
        btnLib.textContent = "KiCad library folder…";
        styleMenuItem(btnLib);
        btnLib.addEventListener("click", () => {
          setMenuOpen(false);
          // Content scripts cannot open chrome-extension:// pages directly.
          runtimeSend({ type: "uneasy-open-options" }).catch((err) => {
            console.warn("[UnEasy-LCSC] open options failed:", err);
            alert(friendlyRuntimeError(err));
          });
        });
        menu.insertBefore(btnLib, menuDivider);

        runtimeSend({ type: "uneasy-library-status" })
          .then((status) => {
            if (status && status.configured && status.name) {
              const perm =
                status.permission === "granted" ? "ready" : "needs Allow";
              versionLabel.textContent = `UnEasy-LCSC v${extVersion} · ${status.name} (${perm})`;
            }
          })
          .catch(() => {});
      }

      btnMore.addEventListener("click", (e) => {
        e.preventDefault();
        e.stopPropagation();
        setMenuOpen(menu.hidden);
      });

      // LCSC/JLCPCB pages often swallow bubble-phase clicks; use capture +
      // pointerdown/keydown/scroll so the menu cannot stay stuck open.
      const onOutsidePointer = (e) => {
        if (!menu.hidden && !container.contains(e.target)) setMenuOpen(false);
      };
      const onKeyDown = (e) => {
        if (e.key === "Escape") setMenuOpen(false);
      };
      const onScrollClose = () => {
        if (!menu.hidden) setMenuOpen(false);
      };
      const onMenuInteract = () => {
        if (!menu.hidden) armMenuIdleTimer();
      };

      document.addEventListener("pointerdown", onOutsidePointer, true);
      document.addEventListener("keydown", onKeyDown, true);
      window.addEventListener("scroll", onScrollClose, true);
      menu.addEventListener("pointerdown", onMenuInteract, true);
      menu.addEventListener("mousemove", onMenuInteract, true);

      container._uneasyCleanup = () => {
        clearMenuIdleTimer();
        document.removeEventListener("pointerdown", onOutsidePointer, true);
        document.removeEventListener("keydown", onKeyDown, true);
        window.removeEventListener("scroll", onScrollClose, true);
        menu.removeEventListener("pointerdown", onMenuInteract, true);
        menu.removeEventListener("mousemove", onMenuInteract, true);
      };

      btnKicad.addEventListener("click", async () => {
        setMenuOpen(false);
        if (typeof UnEasyKicad === "undefined") {
          alert("KiCad converter failed to load. Reload the extension.");
          return;
        }

        btnKicad.disabled = true;
        const oldText = btnKicad.textContent;
        btnKicad.textContent = "Converting...";

        try {
          const { symbolEntry, footprintEntry } = await fetchSvgsMeta(lcscCode);

          let modelName = lcscCode;
          if (symbolEntry?.svg) {
            const extracted = extractModelNameFromSvg(symbolEntry.svg);
            if (extracted) modelName = extracted;
          }
          modelName = sanitizeFilenamePart(modelName);

          const symbolComponent = symbolEntry?.component_uuid
            ? await fetchComponent(symbolEntry.component_uuid)
            : null;
          const footprintDataStr = footprintEntry?.component_uuid
            ? await fetchDataStr(footprintEntry.component_uuid)
            : null;

          if (!symbolComponent && !footprintDataStr) {
            throw new Error("No symbol/footprint data found for this part.");
          }

          const converted = UnEasyKicad.convertEasyedaToKicad({
            symbolComponent,
            footprintDataStr,
            lcsc: lcscCode,
            name: modelName
          });

          if (converted.symbol && converted.symbol.pinCount === 0) {
            throw new Error(
              "Converted symbol has no pins (unsupported or empty EasyEDA symbol data)."
            );
          }

          const saveResults = [];
          if (converted.symbol) {
            saveResults.push(
              await downloadViaBackground(
                libraryPath("symbol", converted.symbol.filename),
                {
                  text: converted.symbol.content,
                  mime: "application/x-kicad-symbol"
                }
              )
            );
          }
          if (converted.footprint) {
            saveResults.push(
              await downloadViaBackground(
                libraryPath("footprint", converted.footprint.filename),
                {
                  text: converted.footprint.content,
                  mime: "application/x-kicad-footprint"
                }
              )
            );
          }

          // Prefer official STEP into UnEasy-LCSC.3dshapes when available.
          try {
            const info3d = footprintDataStr
              ? extract3DInfoFromDataStr(footprintDataStr)
              : null;
            if (info3d?.uuid3d) {
              const stepName =
                converted.footprint?.stepFilename ||
                `${lcscCode}_${sanitizeFilenamePart(info3d.modelName3d || "model")}.step`;
              saveResults.push(
                await saveStepViaBackground(
                  libraryPath("step", stepName),
                  info3d.uuid3d
                )
              );
            }
          } catch (stepErr) {
            console.warn("[UnEasy-LCSC] STEP optional download failed:", stepErr);
          }

          noteLibraryFallback(saveResults);
          btnKicad.textContent = "KiCad done!";
        } catch (err) {
          console.error("[UnEasy-LCSC KiCad]", err);
          alert("Failed to convert to KiCad: " + friendlyRuntimeError(err));
          btnKicad.textContent = oldText;
        } finally {
          btnKicad.disabled = false;
        }
      });

      btn.addEventListener("click", async () => {
        setMenuOpen(false);
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
                libraryPath("easyeda", `${lcscCode}_${modelName}_symbol.json`),
                JSON.stringify(sym, null, 2),
                "application/json"
              );
            }
          }

          if (footprintEntry?.component_uuid) {
            const fp = await fetchDataStr(footprintEntry.component_uuid);
            if (fp) {
              await downloadFile(
                libraryPath("easyeda", `${lcscCode}_${modelName}_footprint.json`),
                JSON.stringify(fp, null, 2),
                "application/json"
              );
            }
          }

          if (svgCheckbox.checked) {
            if (symbolEntry?.svg) {
              await downloadFile(
                libraryPath("easyeda", `${lcscCode}_${modelName}_symbol.svg`),
                symbolEntry.svg,
                "image/svg+xml"
              );
            }
            if (footprintEntry?.svg) {
              await downloadFile(
                libraryPath("easyeda", `${lcscCode}_${modelName}_footprint.svg`),
                footprintEntry.svg,
                "image/svg+xml"
              );
            }
          }

          btn.textContent = "Done!";
        } catch (err) {
          console.error("[UnEasy-LCSC]", err);
          alert("Failed: " + friendlyRuntimeError(err));
          btn.textContent = "Download EasyEDA JSON";
        } finally {
          btn.disabled = false;
        }
      });

      btnStep.addEventListener("click", async () => {
        setMenuOpen(false);
        btnStep.disabled = true;
        const oldText = btnStep.textContent;
        btnStep.textContent = "Fetching STEP...";

        try {
          const { uuid3d, modelName3d } = await resolveFootprint3D(lcscCode);
          const modelName = sanitizeFilenamePart(modelName3d || "model");
          await saveStepViaBackground(
            libraryPath("step", `${lcscCode}_${modelName}.step`),
            uuid3d
          );
          btnStep.textContent = "STEP downloaded!";
        } catch (err) {
          console.error("[UnEasy-LCSC STEP]", err);
          alert("Failed to download STEP: " + friendlyRuntimeError(err));
          btnStep.textContent = oldText;
        } finally {
          btnStep.disabled = false;
        }
      });

      btn3d.addEventListener("click", async () => {
        setMenuOpen(false);
        btn3d.disabled = true;
        const oldText = btn3d.textContent;
        btn3d.textContent = "Opening...";

        try {
          const { uuid3d, modelName3d } = await resolveFootprint3D(lcscCode);
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
          alert("Failed to open 3D viewer: " + friendlyRuntimeError(err));
          btn3d.textContent = oldText;
        } finally {
          btn3d.disabled = false;
        }
      });
    }

    function syncPanelToUrl() {
      const code = getPartCode();
      if (!code) {
        const panel = document.getElementById(PANEL_ID);
        if (panel) {
          if (typeof panel._uneasyCleanup === "function") panel._uneasyCleanup();
          panel.remove();
        }
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
