# UnEasy-LCSC

**UnEasy-LCSC** is a browser extension that unlocks the LCSC + EasyEDA ecosystem.

It adds small floating buttons on:

- **LCSC part pages** – to download:
  - EasyEDA symbol JSON
  - EasyEDA footprint JSON
  - Optional SVG previews
  - A direct link to the EasyEDA 3D viewer

- **EasyEDA 3D viewer pages** – to:
  - Hook into the WebGL pipeline
  - Capture the rendered mesh
  - Export it as a `.obj` file with one click

All extraction happens **entirely in your browser**.  
No backend, no login, no external API.

---

## Features

- 🔹 Extract **footprint JSON** directly from LCSC
- 🔹 Extract **symbol JSON** and **SVG previews**
- 🔹 Auto-detect part / model names from EasyEDA metadata
- 🔹 One-click **“Open 3D Viewer”** from LCSC
- 🔹 On the EasyEDA 3D page:
  - Hook WebGL / WebGL2
  - Capture triangle meshes as they’re drawn
  - Export as `easyeda_model.obj`

Works great for importing into:
- KiCad (via 3D model configs)
- FreeCAD / Blender
- STEP converters / mechanical workflows

---

## How it works (high level)

- On LCSC pages, UnEasy-LCSC calls EasyEDA’s public APIs:
  - `https://easyeda.com/api/products/{LCSC}/svgs`
  - `https://easyeda.com/api/components/{uuid}`
- It grabs:
  - Symbol JSON (`dataStr`)
  - Footprint JSON (`dataStr`)
  - SVG previews (optional)
  - 3D model metadata hidden in a `SVGNODE` outline

- For 3D:
  - It opens the standard EasyEDA 3D viewer with the correct 3D URL.
  - In that viewer tab, it injects `injected.js` (allowed by CSP).
  - `injected.js` hooks `WebGLRenderingContext` and `WebGL2RenderingContext`:
    - intercepts `bufferData`, `vertexAttribPointer`, `drawArrays`
    - records triangle vertex data into `window.__easyedaMeshes`
  - When you click **Export 3D OBJ**, it:
    - walks those meshes
    - writes a minimal `.obj` (vertices + faces)
    - triggers a download

---

## Installation (Chrome / Edge / Brave / Chromium)

1. Clone this repository:

   ```bash
   git clone https://github.com/<your-username>/UnEasy-LCSC.git
   cd UnEasy-LCSC
2. Open chrome://extensions/ (or edge://extensions/).

3. Enable Developer mode (toggle in top right).

4. Click “Load unpacked” and select the UnEasy-LCSC folder.

The extension should now be active.
