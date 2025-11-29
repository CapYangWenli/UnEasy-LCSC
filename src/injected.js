// injected.js – runs in PAGE context (not extension sandbox)

(() => {
  console.log("%c[Extractor] injected.js loaded in page context", "color: orange");

  if (window.__easyedaHookInstalled) {
    console.log("[Extractor] WebGL hook already installed.");
    return;
  }
  window.__easyedaHookInstalled = true;

  function installHook(glp) {
    if (!glp) return;
    console.log("[Extractor] Installing WebGL hook on", glp === WebGL2RenderingContext?.prototype ? "WebGL2" : "WebGL1");

    const origBindBuffer = glp.bindBuffer;
    const origBufferData = glp.bufferData;
    const origVertexAttribPointer = glp.vertexAttribPointer;
    const origDrawArrays = glp.drawArrays;

    const bufferDataStore = new Map();
    const attribInfo = new Map();
    let currentArrayBuffer = null;

    if (!window.__easyedaMeshes) window.__easyedaMeshes = [];

    glp.bindBuffer = function (target, buffer) {
      if (target === this.ARRAY_BUFFER) currentArrayBuffer = buffer;
      return origBindBuffer.call(this, target, buffer);
    };

    glp.bufferData = function (target, data, usage) {
      if (target === this.ARRAY_BUFFER && data instanceof Float32Array && currentArrayBuffer) {
        bufferDataStore.set(currentArrayBuffer, new Float32Array(data));
      }
      return origBufferData.call(this, target, data, usage);
    };

    glp.vertexAttribPointer = function (index, size, type, normalized, stride, offset) {
      if (size === 3 && type === this.FLOAT && stride === 0 && offset === 0 && currentArrayBuffer) {
        attribInfo.set(index, { buffer: currentArrayBuffer, size, type, normalized, stride, offset });
      }
      return origVertexAttribPointer.call(this, index, size, type, normalized, stride, offset);
    };

    glp.drawArrays = function (mode, first, count) {
      if (mode === this.TRIANGLES) {
        // Debug: see if we ever get here
        console.log("[Extractor] drawArrays TRIANGLES first=", first, " count=", count);

        for (const info of attribInfo.values()) {
          const data = bufferDataStore.get(info.buffer);
          if (!data) continue;

          const start = first * info.size;
          const end = start + count * info.size;
          if (end > data.length) continue;

          const verts = [];
          for (let i = start; i < end; i += info.size) {
            verts.push({ x: data[i], y: data[i + 1], z: data[i + 2] });
          }

          window.__easyedaMeshes.push({ verts });
          break;
        }
      }
      return origDrawArrays.call(this, mode, first, count);
    };
  }

  try {
    if (window.WebGLRenderingContext) {
      installHook(WebGLRenderingContext.prototype);
      console.log("[Extractor] Hooked WebGLRenderingContext.");
    }
    if (window.WebGL2RenderingContext) {
      installHook(WebGL2RenderingContext.prototype);
      console.log("[Extractor] Hooked WebGL2RenderingContext.");
    }
  } catch (err) {
    console.error("[Extractor] Failed installing hook:", err);
  }

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (!data || data.type !== "EASYEDA_EXPORT_OBJ") return;

    console.log("[Extractor] Received EXPORT_OBJ request");
    const meshes = window.__easyedaMeshes || [];
    console.log("[Extractor] Mesh count:", meshes.length);

    if (!meshes.length) {
      alert("No mesh captured yet — rotate/zoom the 3D model and click Export again.");
      return;
    }

    let obj = "";
    let offset = 0;

    meshes.forEach((mesh, meshIndex) => {
      const verts = mesh.verts || [];
      if (!verts.length) return;

      obj += "o mesh_" + meshIndex + "\n";
      for (const v of verts) {
        obj += `v ${v.x} ${v.y} ${v.z}\n`;
      }

      for (let i = 0; i < verts.length; i += 3) {
        const a = offset + i + 1;
        const b = offset + i + 2;
        const c = offset + i + 3;
        obj += `f ${a} ${b} ${c}\n`;
      }

      offset += verts.length;
    });

    const blob = new Blob([obj], { type: "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "easyeda_model.obj";
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);

    console.log("[Extractor] OBJ export completed.");
  });
})();
