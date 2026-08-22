# Agent prompt: implement symbol conversion e2e tests

Copy everything below the line into a new agent chat (this repo as workspace). Do not summarize or shorten the prompt.

---

You are implementing **v1 of automated end-to-end EasyEDA → KiCad symbol conversion tests** for UnEasy-LCSC.

## Source of truth

Read and obey **all** of:

1. `docs/symbol-e2e-trd.md` — requirements, IR, assertion IDs H1–H15 / S1–S6, corpus tiers, synthetics, CI, honesty rule.
2. The **existing footprint e2e suite** — copy its architecture; do not invent a parallel style.

Footprint reference (read before writing code):

- `scripts/test-footprint-e2e.js`
- `scripts/freeze-footprint-fixture.js`
- `tests/footprints/lib/*` (`load-converter.js`, `sexpr.js`, `compare.js`, `report.js`, `ir-from-easyeda.js`, `ir-from-kicad.js`)
- `tests/footprints/corpus-manifest.json` + one corpus folder (e.g. `tests/footprints/corpus/C98715/`)
- `.github/workflows/footprint-e2e.yml`
- `package.json` scripts `test:footprint-e2e` / `freeze:footprint`
- `docs/footprint-known-gaps.md` as the model for `docs/symbol-known-gaps.md`

## Goal

A frozen-fixture suite that:

- Converts EasyEDA **symbol components** (`dataStr` + `subparts`) via `UnEasyKicad.exportSymbolFromComponent`
- Parses DUT `.kicad_sym` and EasyEDA JSON into the same **SymbolIR**
- Asserts TRD hard checks (pins, units, handled body graphics, no degenerate `R~`, `PT~` triangles)
- Prints `UNHANDLED: …` for leftover EasyEDA commands
- Never live-fetches EasyEDA in CI
- Exits `0` if only WARN, `1` on BLOCKED/hard fail, `2` on missing fixtures/infra

**Do not change `src/kicad/convert.js` unless a new test proves a real converter bug and the fix is minimal.** This task is the test harness + fixtures + docs/CI wiring. The converter already handles `PT~` M/L/Z (C51933324). Tests must **lock that in**, not re-break it.

## Hard constraints

- Node-only, no KiCad CLI, no extra npm dependencies.
- Load `convert.js` the same way as footprints: `vm` + `globalThis.UnEasyKicad` (reuse `tests/footprints/lib/load-converter.js` or a thin re-export).
- Reuse `tests/footprints/lib/sexpr.js` for parsing `.kicad_sym` if it already tokenizes generic sexpr; extend only if needed.
- CI must not call EasyEDA. Freeze script may fetch (dev only).
- Keep `.web-ext-ignore` excluding `scripts/**` and `*.md` and `tests` is already not in the XPI source if ignored — **do not** ship test fixtures inside the Firefox XPI. Confirm `tests/` is not packed (`.web-ext-ignore` currently ignores scripts and md; **add `tests/**` and `docs/**` and `artifacts/**` to `.web-ext-ignore`** if they would otherwise be included).
- `artifacts/` is already gitignored.
- Do not commit unless the user asks.

## Files to create (mirror footprints)

```text
tests/symbols/lib/ir-from-easyeda.js
tests/symbols/lib/ir-from-kicad.js
tests/symbols/lib/compare.js
tests/symbols/lib/report.js          # may re-export/adapt footprint report.js
tests/symbols/corpus-manifest.json
tests/symbols/corpus/<C#####>/       # meta.json, easyeda-symbol.json, reference.ir.json, notes.md
tests/symbols/synthetic/<name>/      # same three JSON files (+ notes optional)
scripts/test-symbol-e2e.js
scripts/freeze-symbol-fixture.js
.github/workflows/symbol-e2e.yml
docs/symbol-known-gaps.md
```

Update:

- `package.json`: `"test:symbol-e2e"`, `"freeze:symbol"`
- `README.md`: short “Symbol testing” section next to Footprint testing, linking the TRD + known-gaps + npm script
- `.web-ext-ignore` if needed so tests/docs are not in the XPI

## SymbolIR (implement exactly)

Match `docs/symbol-e2e-trd.md` §6. EasyEDA IR must:

- Walk **parent `shape` plus each subpart `dataStr.shape`** as separate units when subparts have non-empty shapes (same rule as `exportSymbolFromComponent`).
- Count commands for honesty: handled vs unhandled.
- **Handled (must not appear in UNHANDLED if exported):** `P`, `R`, `C`, `E` when circular, `PL`, `PG`, `PT` (M/L/Z with ≥2 points).
- **Unhandled / partial (must appear in UNHANDLED or S2/S3):** `T`, non-circular `E`, `PT` tokens other than M/L/Z, unknown codes.
- Hidden pins (`P~hide~`) go into EasyEDA IR as `visible: false` and **must not** be in DUT IR (H8).

Pin coordinates for compare: apply the **same** origin + `pxToMmGrid` / Y-flip / orientation `(180+rot)%360` as `src/kicad/convert.js` (`resolveOrigin`, `buildUnitGraphics`). Duplicate those formulas in the EasyEDA IR helper (or share a tiny `tests/symbols/lib/units.js` copied from convert.js constants). Do **not** import convert.js internals (IIFE). Duplicating the snap math is OK; document “must stay in sync with convert.js”.

KiCad IR: parse `(pin …)`, `(rectangle …)`, `(circle …)`, `(polyline …)`, `(property …)`, unit symbols `NAME_N_1`.

## Assertions to implement (from TRD)

Hard: H1–H15, PARSE, IDEM (two converts → identical IR), H9 command-count for handled types, H10 degenerate rect, H11 closed PT/PG, H12 LCSC/MPN properties, H13 footprint property prefix `UnEasy-LCSC:`.

Soft: S1–S6 as specified.

Severity: BLOCKED on any H; WARN on S-only; if `risk=high` and the **only** body was unhandled PT-curves / noncircular E (S2/S3) → BLOCKED/QUARANTINE per TRD §7.3.

If UNHANDLED lists `PT`/`R`/`PL`/`PG`/`P`/`C` while the converter emits those types, that is an **H fail** (accounting bug).

## Corpus (P1 target — do not stop at P0)

Use `tests/symbols/corpus-manifest.json` and `scripts/freeze-symbol-fixture.js --manifest …`.

Freeze the **full EasyEDA component JSON** needed for `exportSymbolFromComponent` (at least `dataStr` + `subparts`). File name: `easyeda-symbol.json`.

Minimum tiers (TRD §8.1). Suggested LCSC IDs (skip + note in manifest if API has no symbol):

| Tier | IDs |
| --- | --- |
| A | C14284, plus 2 more 2-pin passives that have symbols |
| B | C98715, C9864, one more SOIC/SOT |
| C | **C51933324** (`pt-path`), C2286, C72038 (`pg-polygon`) |
| D | **C17702531** (CM4 multi-unit) |
| E | C2040, C8734 |
| F | C124356, C2765186 |
| G | covered by C9864 tags `empty-radius` / parser trap; add a dedicated synthetic |

If a listed part has no EasyEDA symbol (`原理图未绘制`), substitute another LCSC with the same tier tags and record why in `notes.md`.

Each corpus folder: `meta.json` (lcsc, mpn, package, risk, tier, tags, `reference: "tertiary-easyeda-ir"`, frozenAt, pin counts, unhandledAtFreeze), `easyeda-symbol.json`, `reference.ir.json` (EasyEDA IR at freeze), `notes.md`.

Compare DUT to **live EasyEDA IR from the frozen JSON** (like footprints), and treat stored `reference.ir.json` as fixture-integrity / optional drift check.

## Synthetics (TRD §8.2 — all required)

Handcraft tiny `easyeda-symbol.json` objects (valid `head` + `shape` / `subparts`) under `tests/symbols/synthetic/`:

- `rect-body` — `R~x~y~~~w~h` empty rx/ry (C9864 class); H10 must pass
- `pt-triangle` — `PT~M … L … L … Z`; H9/H11 must pass
- `pg-polygon` — `PG~` filled
- `pl-open` — `PL~` only
- `circle` — `C~`
- `ellipse-noncircular` — `E~` rx≠ry → S2 + UNHANDLED/skip, not H fail
- `hidden-pin` — one hidden `P~` → H8
- `multi-unit-empty-parent` — parent `shape=[]`, two subparts with pins → H4
- `pt-curves` — `PT~` with `C` or `A` → S3 WARN (not BLOCKED unless risk=high)
- `arc-semicircle` — `A~` SVG semicircle; H9 must emit a KiCad `(arc)`

Include `P~` pins on synthetics that need pin hard-checks.

## Freeze script

Clone `scripts/freeze-footprint-fixture.js`:

- Fetch `https://easyeda.com/api/products/${lcsc}/svgs`
- `docType === 2` → `https://easyeda.com/api/components/${uuid}`
- Save **full `component.result`** (or `{ dataStr, subparts }`) as `easyeda-symbol.json`
- Build IR via `irFromEasyeda` → `reference.ir.json`
- CLI: `node scripts/freeze-symbol-fixture.js C51933324 --tier C --risk high --tags pt-path,LED`
- Batch: `--manifest tests/symbols/corpus-manifest.json`

## Runner

Clone `scripts/test-footprint-e2e.js` structure, swap footprint APIs for symbol APIs, `exportSymbolFromComponent(component, { lcsc, name, package })`.

Reports: `artifacts/symbol-report.json` + `.md`. Console like footprint suite (`PASS` / `WARN` / `BLOCKED`).

Tier count summary must show A–G mins; fail infra (exit 2) if a tier is below TRD minimum after fixtures exist.

## CI

`.github/workflows/symbol-e2e.yml` copied from footprint workflow, paths:

- `src/kicad/convert.js`
- `tests/symbols/**`
- `scripts/test-symbol-e2e.js`
- `scripts/freeze-symbol-fixture.js`
- the workflow file itself

`timeout-minutes: 2`, Node 20, upload `artifacts/`.

## Docs

`docs/symbol-known-gaps.md`: `T~`, non-circular `E~`, curved `PT~`, EasyEDA pin type `0` → unspecified (H15 N/A). Point at the TRD.

README: npm script + honesty sentence (symbols are assisted; glance at the symbol for analog/LED bodies).

## Verification (you must run)

On Windows, Node may be missing from PATH; prepend nvm if needed:

```powershell
$env:Path = "C:\nvm4w\nodejs;$env:LOCALAPPDATA\nvm;$env:Path"
npm run test:symbol-e2e
```

**Done only when:**

1. Exit 0 (WARN allowed; **C51933324 must not be BLOCKED** — triangle present).
2. C17702531: `unitCount >= 2`, pins not all on unit 0.
3. C9864: non-degenerate rectangle (H10).
4. Synthetics: `pt-triangle` PASS; `hidden-pin` PASS; `multi-unit-empty-parent` PASS; `ellipse-noncircular` WARN or PASS with S2, not BLOCKED.
5. `npm run test:footprint-e2e` still exit 0 (no regressions).
6. `node scripts/test-kicad-convert.js` still OK if network allows (optional).

## Implementation order

1. Libs: load converter, EasyEDA IR, KiCad IR, compare, report.
2. Synthetics + runner so `pt-triangle` / `rect-body` / `hidden-pin` work with no network.
3. Freeze script + manifest + freeze corpus (network).
4. Wire corpus into runner; fix compare bugs (not convert.js) until hard fails are real.
5. CI + known-gaps + README.
6. Run both e2e suites.

## Anti-patterns (do not do)

- Live fetch inside `test-symbol-e2e.js`
- String-matching `.kicad_sym` instead of IR
- Treating missing `PT~` body as WARN
- Putting all CM4 pins on unit 0 in EasyEDA IR (must follow subparts)
- Editing convert.js “to make tests easier”
- Expanding scope to footprint IR or KiCad ERC
- Signing Firefox / version bump unless asked

If EasyEDA IR and DUT disagree because snap math drifted, **fix the test helper to match convert.js**, then add a comment pointing at the convert.js functions. Only patch convert.js if KiCad output is objectively wrong vs EasyEDA (missing PT/R/pins/units).
