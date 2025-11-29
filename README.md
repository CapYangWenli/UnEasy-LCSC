# UnEasy-LCSC

**UnEasy-LCSC** is a browser extension that unlocks LCSC + EasyEDA data:

- Extracts **symbol JSON** and **footprint JSON** directly from LCSC part pages
- Optionally downloads **SVG previews**
- Opens the **EasyEDA 3D viewer** for the part
- Hooks the EasyEDA 3D viewer’s WebGL pipeline and exports the mesh as a **`.obj`** file

Everything runs **locally in your browser**. No external servers, no accounts.

---

## Features

- On **LCSC part pages**:
  - `Download EasyEDA JSON`  
    → `CXXXXX_<name>_symbol.json`  
    → `CXXXXX_<name>_footprint.json`
  - Optional: `Download SVG previews` (symbol + footprint)
  - `Open 3D Viewer`  
    → opens the correct EasyEDA 3D viewer URL for that part

- On the **EasyEDA 3D viewer page**:
  - Adds an `Export 3D OBJ` button
  - Hooks WebGL / WebGL2 and captures triangle meshes as they’re drawn
  - Exports `easyeda_model.obj` (triangle soup, no materials)

Works nicely with KiCad, FreeCAD, Blender, and other tools that can import `.obj`.

---

## Install (Chromium-based browsers)

1. Clone or download this repository.
2. Open `chrome://extensions/` (or `edge://extensions/` / `brave://extensions/`).
3. Enable **Developer mode**.
4. Click **“Load unpacked”** and select the `UnEasy-LCSC` folder.

The extension will add buttons automatically on matching LCSC and EasyEDA pages.

---

## Usage

### LCSC

1. Open any LCSC product page (e.g. `C48606318`).
2. Use the floating panel in the bottom-right:
   - `Download EasyEDA JSON` → saves symbol + footprint JSON (and SVGs if enabled)
   - `Open 3D Viewer` → opens the EasyEDA 3D viewer for that part

### EasyEDA 3D Viewer

1. Wait for the 3D model to load.
2. Rotate / zoom the model a bit.
3. Click `Export 3D OBJ` (bottom-right).
4. A file named `easyeda_model.obj` will be downloaded.

If you get a message like:

> No mesh captured yet — rotate/zoom the 3D model and click Export again.

…just move the model and try again.

---

## Notes

- Uses only public EasyEDA / LCSC endpoints and WebGL calls your browser already sees.
- Code is small and intended to be auditable.
- Not affiliated with LCSC, EasyEDA, or JLCPCB.

---

## License

MIT. See `LICENSE` for details.
