# UnEasy-LCSC

**UnEasy-LCSC** is a browser extension that lets you download footprints, symbols, and 3D models right from LCSC and JLCPCB part pages:

- **Download KiCad** — converts EasyEDA data to KiCad v6+ `.kicad_sym` + `.kicad_mod` (and STEP when available)
- Saves into an `UnEasy-LCSC/` library tree (Downloads, or a folder you choose on Chromium)
- Optionally still downloads raw EasyEDA **`.json`** / **SVG** previews
- Downloads the official EasyEDA **`.step`** 3D model
- Opens an internal **EasyEDA 3D viewer** and can export a captured **`.obj`** mesh

Everything runs **locally in your browser** — no EasyEDA account necessary.

---

## Install (Firefox)

Use the signed add-on in [`releases/`](releases/) — this is the recommended install path.

1. Download [`releases/uneasy-lcsc-0.6.17.xpi`](releases/uneasy-lcsc-0.6.17.xpi) (or the latest `.xpi` in that folder).
2. Open Firefox → `about:addons`.
3. Click the gear icon → **Install Add-on From File…**
4. Select the downloaded `.xpi`.

It stays installed across restarts.

---

## Install (Chromium browsers)

1. Clone or download this repo.
2. Open `chrome://extensions/` (or the equivalent in Edge / Brave).
3. Enable **Developer mode**.
4. Click **Load unpacked** → select the `UnEasy-LCSC` folder.

The extension activates automatically on supported pages.

After every **Reload** of the unpacked extension, refresh any open LCSC/JLCPCB tabs so the panel talks to the new background script.

---

## First-time KiCad library setup

Do this **once**. Afterward, **Download KiCad** keeps filling the same folders and KiCad keeps seeing new parts.

### 1. Decide where the library lives

The extension always writes this tree:

```
UnEasy-LCSC/
  UnEasy-LCSC.kicad_symdir/   ← individual .kicad_sym files
  UnEasy-LCSC.pretty/         ← .kicad_mod footprints
  UnEasy-LCSC.3dshapes/       ← .step 3D models
  easyeda/                    ← optional raw JSON/SVG
```

| Browser | Where files go |
| --- | --- |
| **Firefox** | Always `Downloads/UnEasy-LCSC/` (your browser Downloads folder). There is no folder picker. |
| **Chrome / Edge / Brave** | Either `Downloads/UnEasy-LCSC/` **or** a folder you pick (recommended if you keep KiCad libraries outside Downloads). |

**Firefox beginners:** skip the Chromium steps below. Download one part with **Download KiCad**, then confirm `Downloads/UnEasy-LCSC/` appeared. Use that folder as `UNEASY_LCSC` in KiCad.

**Chromium beginners (pick a permanent library folder):**

1. Create an empty folder somewhere stable, e.g.  
   `C:\KiCad\Libraries\UnEasy-LCSC` or `~/Documents/KiCad/UnEasy-LCSC`.  
   This folder **is** the library root (the thing named `UnEasy-LCSC` in the tree above).
2. On any LCSC/JLCPCB part page, open the floating panel → **More** → **KiCad library folder…**.
3. Click **Choose folder…** and select that folder.
4. Wait until the status says **Ready**.  
   If it says permission is needed, click **Allow access**.
5. **Keep that options tab open** while you download parts. Chrome only allows writes while that page holds permission.
6. After reloading the unpacked extension, open the options tab again and click **Allow access** (or **Choose folder…**) until it says **Ready**.

If the options tab is closed or not Ready, Chromium falls back to `Downloads/UnEasy-LCSC/` so you still get files.

### 2. Tell KiCad where that folder is (path variable)

1. Open KiCad.
2. **Preferences → Configure Paths…**
3. Click **+** and add:
   - **Name:** `UNEASY_LCSC`
   - **Path:** the library root from step 1, for example:
     - Firefox / default Chromium Downloads:  
       `C:\Users\<you>\Downloads\UnEasy-LCSC`  
       or on macOS/Linux: `/Users/<you>/Downloads/UnEasy-LCSC`
     - Chromium picked folder: the folder you chose (e.g. `C:\KiCad\Libraries\UnEasy-LCSC`)
4. Click **OK**.

Do **not** point `UNEASY_LCSC` at the `.pretty` or `.kicad_symdir` subfolder — point it at the parent `UnEasy-LCSC` root.

### 3. Add the symbol library

1. **Preferences → Manage Symbol Libraries…**
2. Open the **Global Libraries** tab (so every project sees it).
3. Click the folder / add button and add:

| Field | Value |
| --- | --- |
| Nickname | `UnEasy-LCSC` |
| Library Path | `${UNEASY_LCSC}/UnEasy-LCSC.kicad_symdir` |

4. Library type should be a **symbol directory** / `.kicad_symdir` (KiCad 9+ / 10+).  
   On older KiCad without directory libraries, add individual `.kicad_sym` files from that folder instead.

### 4. Add the footprint library

1. **Preferences → Manage Footprint Libraries…**
2. **Global Libraries** tab → add:

| Field | Value |
| --- | --- |
| Nickname | `UnEasy-LCSC` |
| Library Path | `${UNEASY_LCSC}/UnEasy-LCSC.pretty` |

KiCad resolves 3D models from `${UNEASY_LCSC}/UnEasy-LCSC.3dshapes/...` automatically when the STEP was downloaded with the part.

### 5. Quick check

1. On LCSC, click **Download KiCad** for a simple part (e.g. a resistor or SOIC-8 IC).
2. Confirm new files under `UnEasy-LCSC.kicad_symdir/`, `UnEasy-LCSC.pretty/`, and usually `UnEasy-LCSC.3dshapes/`.
3. In the schematic editor, place a symbol from library **UnEasy-LCSC**.
4. Footprint should already be linked as `UnEasy-LCSC:<package>`.
5. In PCB editor / 3D viewer, the STEP should appear if it was downloaded.

Re-downloading the same part overwrites the previous files.

---

## Everyday usage

### On LCSC / JLCPCB

1. Open a component page (`CXXXXX`), e.g. on lcsc.com or `jlcpcb.com/partdetail/.../C#####`.
2. Use the floating panel bottom-right:
   - **Download KiCad** — symbol + footprint (+ STEP) into your library tree
   - **More** → STEP only / 3D viewer / EasyEDA JSON (+ optional SVG)
   - **More** → **KiCad library folder…** (Chromium only)

On Chromium, leave the library options tab **Ready** in the background for the automatic folder workflow.

### In the EasyEDA 3D Viewer

1. Wait until the model renders.
2. Rotate or zoom it once (required to trigger WebGL buffers).
3. Click **Export 3D OBJ**.

If no mesh appears, move the model a bit and retry.

---

## Troubleshooting

| Symptom | What to try |
| --- | --- |
| Panel missing | Refresh the part page; confirm the extension is enabled. |
| “Extension context invalidated” | You reloaded the extension — refresh the LCSC/JLCPCB tab. |
| Chromium files go to Downloads instead of your folder | Open **KiCad library folder…**, get **Ready**, keep that tab open, download again. |
| KiCad can’t find symbols/footprints | Check `UNEASY_LCSC` points at the **root** folder that contains `.kicad_symdir` and `.pretty`. |
| 3D model missing in PCB | Confirm a `.step` exists under `UnEasy-LCSC.3dshapes/` and `UNEASY_LCSC` matches that root. |
| Firefox download error about `data:` / Access denied | Use **v0.6.17+** (blob downloads). Update the `.xpi` from Releases. |

---

## Footprint testing

Footprints from **Download KiCad** are **assisted conversions** — verify land patterns against the vendor datasheet before production PCBs.

Automated geometry checks (pad/drill IR compares on a frozen LCSC corpus) live under `tests/footprints/` and are documented in:

- [docs/footprint-e2e-trd.md](docs/footprint-e2e-trd.md) — requirements and assertion IDs
- [docs/footprint-known-gaps.md](docs/footprint-known-gaps.md) — intentional skips (paste/decorative fills, etc.)

```bash
npm run test:footprint-e2e
```

CI runs this suite when `src/kicad/convert.js` or footprint fixtures change. Reports are written to `artifacts/footprint-report.json` (gitignored).

To refresh a frozen corpus part (dev only, not used in CI):

```bash
npm run freeze:footprint -- C9864 --tier B --risk medium
# or batch:
npm run freeze:footprint -- --manifest tests/footprints/corpus-manifest.json
```

---

## Symbol testing

Symbols from **Download KiCad** are **assisted conversions** — verify pinout and body graphics (especially LEDs and analog parts) in the schematic editor.

Automated geometry/electrical checks (SymbolIR compares on a frozen LCSC corpus) live under `tests/symbols/` and are documented in:

- [docs/symbol-e2e-trd.md](docs/symbol-e2e-trd.md) — requirements and assertion IDs
- [docs/symbol-known-gaps.md](docs/symbol-known-gaps.md) — intentional skips (`T~`, curved `PT~`, non-circular `E~`, etc.)

```bash
npm run test:symbol-e2e
```

CI runs this suite when `src/kicad/convert.js` or symbol fixtures change. Reports are written to `artifacts/symbol-report.json` (gitignored).

To refresh a frozen corpus part (dev only, not used in CI):

```bash
npm run freeze:symbol -- C51933324 --tier C --risk high --tags pt-path,LED
# or batch:
npm run freeze:symbol -- --manifest tests/symbols/corpus-manifest.json
```

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
