# UnEasy-LCSC

**UnEasy-LCSC** is a browser extension that lets you download footprints, symbols, and 3d models right from LCSC's website:

- Extracts **symbol** and **footprint** in native **EasyEDA `.json` format that you can import in KiCAD**
- Optionally downloads **SVG previews** (symbol + footprint)
- Opens an internal **EasyEDA 3D viewer**
- Captures the WebGL model and exports it as a **`.obj`** mesh

Everything runs **locally in your browser** — no EasyEDA account necessary.

---

## Install (Chromium browsers)

1. Clone or download this repo.
2. Open `chrome://extensions/`.
3. Enable **Developer mode**.
4. Click **Load unpacked** → select the `UnEasy-LCSC` folder.

The extension activates automatically on supported pages.

---

## Install (Firefox — permanent)

Temporary add-ons from `about:debugging` disappear when Firefox restarts. For a permanent install, Mozilla must sign a `.xpi` (unlisted / self-distributed is fine — it does not need to be published on AMO).

### 1. One-time setup

1. Create a [Firefox Add-on Developer account](https://addons.mozilla.org/developers/).
2. Generate API credentials: [AMO API keys](https://addons.mozilla.org/developers/addon/api/key/).
3. In this repo:

```bash
npm install
```

### 2. Sign (unlisted)

Set your credentials (PowerShell):

```powershell
$env:WEB_EXT_API_KEY = "your-jwt-issuer"
$env:WEB_EXT_API_SECRET = "your-jwt-secret"
npm run firefox:sign
```

Or pass them directly:

```bash
npx web-ext sign --source-dir . --channel unlisted --api-key YOUR_KEY --api-secret YOUR_SECRET
```

This uploads the extension for signing and downloads a signed `.xpi` into `web-ext-artifacts/`.

### 3. Install the signed XPI

1. Open `about:addons` → gear icon → **Install Add-on From File…**
2. Choose the `.xpi` from `web-ext-artifacts/`.

It stays installed across restarts. There is no auto-update URL, so Firefox will not nag you to update — only re-sign if you change the code yourself.

### Dev / temporary load (optional)

```bash
npm run firefox:run
```

Or: `about:debugging` → **This Firefox** → **Load Temporary Add-on…** → pick `manifest.json`.

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

## License

MIT.
