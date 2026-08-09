# UnEasy-LCSC

**UnEasy-LCSC** is a browser extension that lets you download footprints, symbols, and 3d models right from LCSC and JLCPCB part pages:

- **Download KiCad** — converts EasyEDA data to KiCad v6+ `.kicad_sym` + `.kicad_mod` (and STEP when available)
- Saves straight into an `UnEasy-LCSC/` library tree under your browser Downloads folder
- Optionally still downloads raw EasyEDA **`.json`** / **SVG** previews
- Downloads the official EasyEDA **`.step`** 3D model
- Opens an internal **EasyEDA 3D viewer** and can export a captured **`.obj`** mesh

Everything runs **locally in your browser** — no EasyEDA account necessary.

---

## Install (Firefox)

Use the signed add-on in [`releases/`](releases/) — this is the recommended install path.

1. Download [`releases/uneasy-lcsc-0.6.2.xpi`](releases/uneasy-lcsc-0.6.2.xpi).
2. Open Firefox → `about:addons`.
3. Click the gear icon → **Install Add-on From File…**
4. Select the downloaded `.xpi`.

It stays installed across restarts.

---

## Install (Chromium browsers)

1. Clone or download this repo.
2. Open `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked** → select the `UnEasy-LCSC` folder.

The extension activates automatically on supported pages.

---

## Usage

### On LCSC / JLCPCB

1. Open a component page (`CXXXXX`), e.g. on lcsc.com or `jlcpcb.com/partdetail/.../C#####`.
2. Use the floating panel bottom-right:
   - `Download KiCad` — writes symbol + footprint (+ STEP) into `Downloads/UnEasy-LCSC/`
   - `More` → STEP / 3D viewer / EasyEDA JSON (+ optional SVG)

### KiCad library setup (once)

Downloads land here (under your browser Downloads folder):

```
UnEasy-LCSC/
  UnEasy-LCSC.kicad_symdir/   ← individual .kicad_sym files
  UnEasy-LCSC.pretty/         ← .kicad_mod files
  UnEasy-LCSC.3dshapes/       ← .step files
  easyeda/                    ← optional raw JSON/SVG
```

1. In KiCad → **Preferences → Configure Paths**, add:
   - Name: `UNEASY_LCSC`
   - Path: `C:\Users\<you>\Downloads\UnEasy-LCSC` (or your OS equivalent)
2. **Manage Symbol Libraries** → add nickname `UnEasy-LCSC` pointing at  
   `${UNEASY_LCSC}/UnEasy-LCSC.kicad_symdir`  
   (KiCad 10+ directory / `.kicad_symdir` libraries; on older KiCad add each `.kicad_sym` or pack them).
3. **Manage Footprint Libraries** → add nickname `UnEasy-LCSC` pointing at  
   `${UNEASY_LCSC}/UnEasy-LCSC.pretty`

After that, **Download KiCad** is enough — place the symbol from `UnEasy-LCSC`; footprint and STEP stay linked via `UnEasy-LCSC:<package>` and `${UNEASY_LCSC}/UnEasy-LCSC.3dshapes/...`.

Re-downloading the same part overwrites the previous files.

### In the 3D Viewer

1. Wait until the model renders.
2. Rotate or zoom it once (required to trigger WebGL buffers).
3. Click `Export 3D OBJ`.

If no mesh appears, move the model a bit and retry.

---

## Notes

- KiCad conversion covers the common EasyEDA primitives (pins, pads, tracks, silk, holes, etc.) and multi-unit symbols (e.g. Compute Module). Complex arcs/paths may be simplified vs `easyeda2kicad.py`.
- Extracted `.json` files match EasyEDA’s internal symbol/footprint schema.
- `.obj` export is geometry-only (no texture/material metadata).
- Not affiliated with LCSC, EasyEDA, or JLCPCB.
- Firefox ID: `uneasy-lcsc@local` (required for MV3 signing). Chromium ignores this.

---

## Maintainer: re-sign for Firefox

Only needed when shipping a new Firefox build.

1. Create / use a [Firefox Add-on Developer account](https://addons.mozilla.org/developers/).
2. Generate API credentials: [AMO API keys](https://addons.mozilla.org/developers/addon/api/key/).
3. Copy `.env.example` → `.env` and paste your keys:

```env
WEB_EXT_API_KEY=your-jwt-issuer
WEB_EXT_API_SECRET=your-jwt-secret
```

4. Sign as **unlisted**, then put the signed file at `releases/uneasy-lcsc-<version>.xpi` and update the Install (Firefox) link above.

```powershell
npm install
npm run firefox:sign
```

If `npm install` fails with `'node' is not recognized` (common with nvm-windows inside Cursor), either fully restart Cursor, or in that terminal run:

```powershell
$env:NVM_HOME = "$env:LOCALAPPDATA\nvm"
$env:NVM_SYMLINK = "C:\nvm4w\nodejs"
$env:Path = "$env:NVM_SYMLINK;$env:NVM_HOME;$env:Path"
npm install
```

Or use the wrapper: `npm run firefox:sign:win`

`.env` is gitignored — do not commit your keys.

---

## License

MIT.
