// injected.js – runs in PAGE context (not extension sandbox)

(() => {
  window.__uneasy = window.__uneasy || {};
  window.__uneasy.meta = window.__uneasy.meta || {};

  try {
    const params = new URLSearchParams(window.location.search);
    const lcscId = params.get("ue_lcsc");
    const name = params.get("ue_name");
    const uuid = params.get("ue_uuid");

    if (lcscId) window.__uneasy.meta.lcsc = lcscId;
    if (name) window.__uneasy.meta.name = name;
    if (uuid) window.__uneasy.meta.model_uuid = uuid;
  } catch (e) {
    console.warn("[Extractor] Failed to parse metadata from URL:", e);
  }

  if (window.__easyedaHookInstalled) return;
  window.__easyedaHookInstalled = true;

  // Idle while viewing. Only copy mesh data after Export is clicked.
  let captureArmed = false;
  let frameMeshes = [];
  let latestMeshes = [];
  let flushScheduled = false;
  let exporting = false;
  let exportWaiters = [];

  function resolveCapture(meshes) {
    captureArmed = false;
    const waiters = exportWaiters.splice(0);
    waiters.forEach((resolve) => resolve(meshes));
  }

  function finishFrameCapture() {
    flushScheduled = false;
    if (!frameMeshes.length) return;

    latestMeshes = frameMeshes;
    window.__easyedaMeshes = latestMeshes;
    frameMeshes = [];
    resolveCapture(latestMeshes);
  }

  function scheduleFrameFlush() {
    if (flushScheduled) return;
    flushScheduled = true;
    requestAnimationFrame(finishFrameCapture);
  }

  function capturePositions(positions) {
    if (!captureArmed || !positions || positions.length < 9) return;
    frameMeshes.push({ positions: new Float32Array(positions) });
    scheduleFrameFlush();
  }

  function installHook(glp) {
    if (!glp) return;

    const origBindBuffer = glp.bindBuffer;
    const origBufferData = glp.bufferData;
    const origVertexAttribPointer = glp.vertexAttribPointer;
    const origDrawArrays = glp.drawArrays;
    const origDrawElements = glp.drawElements;

    const bufferDataStore = new Map();
    const attribInfo = new Map();
    let currentArrayBuffer = null;

    glp.bindBuffer = function (target, buffer) {
      if (target === this.ARRAY_BUFFER) currentArrayBuffer = buffer;
      return origBindBuffer.call(this, target, buffer);
    };

    glp.bufferData = function (target, data, usage) {
      // Keep a copy of ARRAY_BUFFER uploads so we can read them later on export.
      if (target === this.ARRAY_BUFFER && currentArrayBuffer && data instanceof Float32Array) {
        bufferDataStore.set(currentArrayBuffer, new Float32Array(data));
      }
      return origBufferData.call(this, target, data, usage);
    };

    glp.vertexAttribPointer = function (index, size, type, normalized, stride, offset) {
      if (size === 3 && type === this.FLOAT && currentArrayBuffer) {
        attribInfo.set(index, {
          buffer: currentArrayBuffer,
          size,
          stride: stride || 0,
          offset: offset || 0
        });
      }
      return origVertexAttribPointer.call(this, index, size, type, normalized, stride, offset);
    };

    glp.drawArrays = function (mode, first, count) {
      if (captureArmed && mode === this.TRIANGLES && count >= 3) {
        for (const info of attribInfo.values()) {
          const data = bufferDataStore.get(info.buffer);
          if (!data) continue;
          const start = first * info.size;
          const end = start + count * info.size;
          if (end > data.length) continue;
          capturePositions(data.subarray(start, end));
          break;
        }
      }
      return origDrawArrays.call(this, mode, first, count);
    };

    if (typeof origDrawElements === "function") {
      glp.drawElements = function (mode, count, type, offset) {
        if (captureArmed && mode === this.TRIANGLES && count >= 3) {
          for (const info of attribInfo.values()) {
            if (info.stride !== 0 || info.offset !== 0) continue;
            const data = bufferDataStore.get(info.buffer);
            if (!data || data.length < count * 3) continue;
            capturePositions(data.subarray(0, count * 3));
            break;
          }
        }
        return origDrawElements.call(this, mode, count, type, offset);
      };
    }
  }

  try {
    if (window.WebGLRenderingContext) installHook(WebGLRenderingContext.prototype);
    if (window.WebGL2RenderingContext) installHook(WebGL2RenderingContext.prototype);
  } catch (err) {
    console.error("[Extractor] Failed installing hook:", err);
  }

  function armCapture() {
    captureArmed = true;
    frameMeshes = [];
    return new Promise((resolve) => {
      exportWaiters.push(resolve);
      // Fallback if the model is idle and no draws happen.
      setTimeout(() => {
        if (!exportWaiters.includes(resolve)) return;
        const idx = exportWaiters.indexOf(resolve);
        if (idx >= 0) exportWaiters.splice(idx, 1);
        captureArmed = false;
        resolve(latestMeshes);
      }, 2000);
    });
  }

  function yieldToBrowser() {
    return new Promise((resolve) => setTimeout(resolve, 0));
  }

  async function buildObjParts(meshes) {
    const parts = [];
    let vertexOffset = 0;
    const CHUNK = 4000;

    for (let meshIndex = 0; meshIndex < meshes.length; meshIndex++) {
      const positions = meshes[meshIndex].positions;
      if (!positions || positions.length < 9) continue;

      parts.push("o mesh_" + meshIndex + "\n");

      let line = "";
      for (let i = 0; i < positions.length; i += 3) {
        line += `v ${positions[i]} ${positions[i + 1]} ${positions[i + 2]}\n`;
        if ((i / 3) % CHUNK === CHUNK - 1) {
          parts.push(line);
          line = "";
          await yieldToBrowser();
        }
      }
      if (line) parts.push(line);

      line = "";
      const vertCount = (positions.length / 3) | 0;
      for (let i = 0; i + 2 < vertCount; i += 3) {
        const a = vertexOffset + i + 1;
        const b = vertexOffset + i + 2;
        const c = vertexOffset + i + 3;
        line += `f ${a} ${b} ${c}\n`;
        if ((i / 3) % CHUNK === CHUNK - 1) {
          parts.push(line);
          line = "";
          await yieldToBrowser();
        }
      }
      if (line) parts.push(line);

      vertexOffset += vertCount;
    }

    return parts;
  }

  function downloadBlob(filename, blob) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  window.addEventListener("message", async (event) => {
    const data = event.data;
    if (!data || data.type !== "EASYEDA_EXPORT_OBJ") return;
    if (event.source !== window) return;
    if (exporting) return;

    exporting = true;
    window.postMessage({ type: "EASYEDA_EXPORT_OBJ_BUSY" }, "*");

    try {
      // Nudge a redraw so armed capture sees triangle draws.
      window.dispatchEvent(new Event("resize"));

      let meshes = await armCapture();
      if (!meshes.length) meshes = latestMeshes;
      if (!meshes.length) {
        window.postMessage({ type: "EASYEDA_EXPORT_OBJ_DONE", ok: false, reason: "empty" }, "*");
        alert("No mesh captured — rotate/zoom the 3D model, then click Export again.");
        return;
      }

      const parts = await buildObjParts(meshes);
      if (!parts.length) throw new Error("Captured mesh data was empty.");

      const meta = data.meta || window.__uneasy.meta || {};
      const modelName = meta.name || "model";
      const lcscId = meta.lcsc || "UnknownLCSC";
      const safeName = String(modelName).replace(/[^a-z0-9_\-()+\[\] ]+/gi, "_");

      downloadBlob(`${lcscId} - ${safeName}.obj`, new Blob(parts, { type: "text/plain" }));
      window.postMessage({ type: "EASYEDA_EXPORT_OBJ_DONE", ok: true }, "*");
    } catch (err) {
      console.error("[Extractor] OBJ export failed:", err);
      window.postMessage({
        type: "EASYEDA_EXPORT_OBJ_DONE",
        ok: false,
        reason: String(err && err.message ? err.message : err)
      }, "*");
      alert("Export failed: " + (err && err.message ? err.message : err));
    } finally {
      exporting = false;
      captureArmed = false;
    }
  });
})();
