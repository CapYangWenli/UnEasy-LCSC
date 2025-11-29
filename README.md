# UnEasy-LCSC

**UnEasy-LCSC** is a browser extension that unlocks LCSC + EasyEDA part data:

- Extracts **symbol** and **footprint** in native **EasyEDA `.json` format**
- Optionally downloads **SVG previews** (symbol + footprint)
- Opens the correct **EasyEDA 3D viewer**
- Captures the WebGL model and exports it as a **`.obj`** mesh

Everything runs **locally in your browser** — no servers or accounts.

---

## Features

- On **LCSC product pages**:
  - `Download EasyEDA JSON`  
    → Saves:  
    `CXXXXX_<name>_symbol.json` (EasyEDA symbol format)  
    `CXXXXX_<name>_footprint.json` (EasyEDA footprint format)
  - Optional: `Download SVG previews`
  - `Open 3D Viewer` → jumps directly to the EasyEDA 3D model

- On the **EasyEDA 3D viewer**:
  - `Export 3D OBJ` button captures WebGL geometry and exports a mesh as:
    `easyeda_model.obj`

Useful for KiCad, FreeCAD, Blender, or converting to STEP.

---

## Install (Chromium browsers)

1. Clone or download this repo.
2. Open `chrome://extensions/` (or `edge://extensions/`, `brave://extensions/`).
3. Enable **Developer mode**.
4. Click **Load unpacked** → select the `UnEasy-LCSC` folder.

The extension activates automatically on supported pages.

---

## Usage

### On LCSC

1. Open a component page (`CXXXXX`).
2. Use the floating panel bottom-right:
   - `Download EasyEDA JSON`
   - (Optional) `Download SVG`
   - `Open 3D Viewer`

### In the 3D Viewer

1. Wait until the model renders.
2. Rotate or zoom it once (required to trigger WebGL buffers).
3. Click `Export 3D OBJ`.

If no mesh appears, move the model a bit and retry.

---

## Notes

- Extracted `.json` files match EasyEDA’s internal symbol/footprint schema.
- `.obj` export is geometry-only (no texture/material metadata).
- Not affiliated with LCSC, EasyEDA, or JLCPCB.

---

## License

MIT.
