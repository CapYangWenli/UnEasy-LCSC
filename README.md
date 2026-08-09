# UnEasy-LCSC

**UnEasy-LCSC** is a browser extension that lets you download footprints, symbols, and 3d models right from LCSC's website:

- Extracts **symbol** and **footprint** in native **EasyEDA `.json` format that you can import in KiCAD**
- Optionally downloads **SVG previews** (symbol + footprint)
- Opens an internal **EasyEDA 3D viewer**
- Captures the WebGL model and exports it as a **`.obj`** mesh

Everything runs **locally in your browser** — no EasyEDA account necessary.

---

## Install (Firefox)

Use the signed add-on in [`releases/`](releases/) — this is the recommended install path.

1. Download [`releases/uneasy-lcsc-0.4.1.xpi`](releases/uneasy-lcsc-0.4.1.xpi).
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
