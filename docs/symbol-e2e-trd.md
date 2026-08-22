# TRD: Automated End-to-End Symbol Conversion Testing

Companion to [footprint-e2e-trd.md](./footprint-e2e-trd.md). Footprint mistakes scrap boards; symbol mistakes miswire schematics and hide missing graphics until a human notices (C51933324 LED triangle). This suite exists so **pins, units, and body geometry** cannot silently degrade.

## 1. Purpose

Prove that UnEasy-LCSC’s EasyEDA → KiCad **symbol** conversion is electrically and graphically faithful enough for schematic use, with failures detected **before** a human places the part.

Success is not “`.kicad_sym` parses.” Success is:

- every visible EasyEDA pin is present with the same **number** and **unit**;
- pin **positions / lengths / orientations** match a reference within grid tolerance;
- **body graphics** that EasyEDA actually drew (rectangles, polylines, `PT~` paths) are not dropped;
- multi-unit parts expose **one KiCad unit per EasyEDA subpart**, not a blank Unit B.

## 2. Scope

### In scope

- Symbol export path: EasyEDA component (`dataStr` + `subparts`) → `.kicad_sym`
- Pins: number, name, electrical type, style (line / inverted / clock), position, length, rotation, visibility
- Units / subparts (e.g. Compute Module)
- Body graphics: `R~`, `C~`, `E~` (circular), `A~` (SVG arc → KiCad `(arc)`), `PL~`, `PG~`, `PT~` (M/L/Z)
- Properties: Reference prefix, Value/MPN, Footprint nickname, `LCSC Part`, Manufacturer
- Frozen LCSC corpus + synthetic fixtures
- Unhandled-command accounting (the C51933324 failure mode)

### Out of scope (initially)

- Footprint pads / drills (see footprint TRD)
- KiCad ERC of a whole schematic
- Spice models, simulation pins
- Pixel-perfect EasyEDA canvas vs KiCad (grid snap is allowed)
- Full SVG path curves (`C`/`Q`/`A` in `PT~`) beyond M/L/Z in v1
- Schematic text `T~` parity in v1 (soft)

## 3. Definitions

| Term | Meaning |
| --- | --- |
| DUT | Device under test = converted `.kicad_sym` |
| Reference | Trusted geometry/electrical source (see §5) |
| Unit | One KiCad `(symbol NAME_N_1 …)` corresponding to one EasyEDA subpart (or the parent if no subparts) |
| Critical pin | Any pin with `visible ≠ hide` in EasyEDA |
| Body graphic | Non-pin drawing primitive (`R`, `C`, `E`, `A`, `PL`, `PG`, `PT`) |
| Hard fail | Missing/extra pin, wrong number, wrong unit, degenerate/missing **required** body, crash |
| Soft fail | Missing `T~` text, non-circular ellipse skipped, curved `PT~` simplified, pin type `unspecified` vs datasheet |

## 4. Goals & non-goals

### Goals

1. **Zero silent hard fails** on the golden corpus.
2. Detect dropped pins or unit splits (CM4-class) on every convert.js change.
3. Detect dropped body primitives of handled types (`R`/`PL`/`PG`/`PT` M/L/Z/`C`/`E` circle/`A` arc) — the LED-triangle / inductor-coil class.
4. Detect degenerate rectangles (zero width/height) from misparsed `R~` (C9864 class).
5. Run headlessly in CI; JSON + markdown report.
6. Print `UNHANDLED: …` for every EasyEDA symbol command the converter does not emit.

### Non-goals

- Bit-identical `.kicad_sym` vs EasyEDA JSON
- Matching EasyEDA’s exact pixel origin (KiCad pins snap to 1.27 mm grid by design)
- Replacing a glance at the schematic symbol for unusual analog parts

## 5. Reference strategy (priority order)

For each corpus part, at least one reference must exist:

1. **Preferred:** Hand-checked KiCad symbol (or `reference.ir.json`) captured after a human confirmed pins + body in the schematic editor. Required for `risk=high`.
2. **Secondary:** Independent conversion (`easyeda2kicad.py` or similar) as a **cross-check**, not sole truth.
3. **Tertiary (regression default):** Parse EasyEDA component JSON → **SymbolIR**, convert with `exportSymbolFromComponent`, parse `.kicad_sym` → **SymbolIR**, compare. Catches exporter regressions without live API.

**Requirement:** CI uses **frozen fixtures**, not live EasyEDA fetches.

## 6. Intermediate representation (IR)

EasyEDA input and KiCad output both normalize to:

```text
SymbolIR {
  name
  prefix                  // Reference, e.g. LED / U / R
  packageName             // footprint nickname without lib
  unitCount
  properties {
    lcsc, manufacturer, mpn, datasheet, footprint
  }
  units[] {
    id                    // 0 for single-unit, 1..N for multi
    name                  // "A" / "B" / ""
    pins[] {
      number              // string
      name
      type                // unspecified | input | output | bidirectional | power_in | …
      style               // line | inverted | clock | inverted_clock
      x_mm, y_mm          // after origin + Y flip; pin at() in KiCad
      rotation_deg        // KiCad pin rotation (0/90/180/270)
      length_mm
      visible
    }
    graphics[] {
      kind                // rectangle | circle | polyline | arc
      // rectangle: start{x,y} end{x,y}  (reject if |w|<ε or |h|<ε)
      // circle: center{x,y} radius
      // polyline: pts[{x,y}…] closed? fill  // none | background | outline
      // arc: start{x,y} mid{x,y} end{x,y} fill
    }
  }
  unhandled[] { cmd, count }
}
```

**Requirement:** Tests assert on IR, not raw S-expression equality. Pin coordinates compare **after** the same origin/grid policy the exporter uses (`pxToMmGrid` / 1.27 mm), or compare EasyEDA-space pins before snap and KiCad pins after snap with an explicit snap-aware matcher (document which).

Recommended matcher: convert EasyEDA pin (x,y,rot,len) with the **same functions** as `convert.js` (`resolveOrigin`, `pxToMmGrid`, orientation `(180+rot)%360`) and require exact match to DUT at 0.01 mm. That tests “exporter did what it claims,” plus a second check that body graphics exist and are non-degenerate.

## 7. Assertions (pass/fail rules)

### 7.1 Hard assertions (must pass)

| ID | Check | Tolerance (default) |
| --- | --- | --- |
| H1 | Visible EasyEDA pin count = KiCad pin count (sum over units) | exact |
| H2 | Pin number sets equal (per unit) | exact |
| H3 | No duplicate pin numbers **within a unit** | exact |
| H4 | Multi-unit: `unitCount` = count of EasyEDA subparts with non-empty `shape` (or 1 if none) | exact |
| H5 | Each pin `at(x,y)` matches reference IR | ≤ 0.01 mm after shared snap |
| H6 | Each pin rotation ∈ {0,90,180,270} and matches reference | exact |
| H7 | Each pin length matches reference | ≤ 0.05 mm |
| H8 | Hidden EasyEDA pins (`hide`) are **not** emitted | exact |
| H9 | Converter does not drop handled body commands: every `R~`, `PL~`, `PG~`, `PT~` (M/L/Z with ≥2 pts), `C~`, circular `E~`, `A~` (valid SVG arc) produces a graphic | exact counts (±0 for those types) |
| H10 | No degenerate rectangle: `|end.x-start.x| ≥ 0.2 mm` **and** `|end.y-start.y| ≥ 0.2 mm` when EasyEDA `R~` w,h are both ≥ 2 px | |
| H11 | Closed `PT~`/`PG~` with ≥3 unique vertices emit a polyline with ≥3 points and first≈last if closed | |
| H12 | Properties `LCSC Part` and `MPN` present when EasyEDA `c_para` has them | exact strings (escaped) |
| H13 | Footprint property is `UnEasy-LCSC:<package>` when package is known | exact |
| H14 | File is valid KiCad sexpr; `exportSymbolFromComponent` twice → identical IR | |

Pin **electrical type** is **not** H-hard when EasyEDA type is `0` (unspecified) — that is an upstream data limitation. If EasyEDA type is 1–4, DUT type must match `PIN_TYPES` (H15).

| ID | Check | Tolerance |
| --- | --- | --- |
| H15 | EasyEDA pin type 1–4 maps to input/output/bidirectional/power_in | exact |

### 7.2 Soft assertions (warn / quarantine)

| ID | Check |
| --- | --- |
| S1 | `T~` schematic text count vs emitted `(text …)` (v1: expect unhandled) |
| S2 | Non-circular `E~` (`|rx-ry| > 0.01`) — currently skipped; flag `UNCONVERTED_FEATURES` |
| S3 | `PT~` path tokens other than M/L/Z — flag remaining curve commands |
| S4 | Pin type all `unspecified` while pin count ≥ 3 — warn (EasyEDA data quality) |
| S5 | Pin names empty or equal to numbers only — warn |
| S6 | Body graphic bbox vs pin bbox: pins should not all sit in empty canvas (CM4 empty-parent case is OK if subparts carry graphics) |

### 7.3 Severity policy

- Any **H\*** fail → CI **red**, part `BLOCKED`
- Only **S\*** → `WARN` (CI green) unless `risk=high` **and** S2/S3 / unconverted `A~` indicate the **only** body of the symbol was dropped → `BLOCKED` / `QUARANTINE`
- Parse/crash → CI **red**
- `UNHANDLED` of types that H9 claims to handle → **H fail** (accounting bug)

## 8. Test corpus requirements

### 8.1 Composition

Minimum permanent corpus (≥ 16 parts), stratified:

| Tier | Coverage | Min | Anchor examples |
| --- | --- | --- | --- |
| A – 2-pin passives | R/C, simple `R~` body | 3 | C14284 |
| B – standard ICs | SOIC/SOT, rect body | 3 | C98715 |
| C – path-drawn bodies | LED/diode `PT~` / `PG~` triangles; inductor `A~` coils | 3 | **C51933324**, C2286, C72038, **C55315393** |
| D – multi-unit | EasyEDA `subparts`, graphics not on parent | 2 | **C17702531** (CM4) |
| E – dense pins | ≥ 40 pins, QFP/QFN-style symbols | 2 | C2040, C8734 |
| F – connectors / headers | many pins, mixed names | 2 | C124356, C2765186 |
| G – degenerate / parser traps | empty `R~` radius slots, hidden pins | 1 | **C9864** (body rect) |

Tags in `meta.json`: `pt-path`, `pg-polygon`, `symbol-arc`, `multi-unit`, `hidden-pins`, `empty-parent-shape`.

### 8.2 Fixture packaging

```text
tests/symbols/corpus/C51933324/
  meta.json                 # lcsc, mpn, risk, tags, tier, tolerance overrides
  easyeda-symbol.json       # frozen component (dataStr + subparts)
  reference.ir.json         # or reference.kicad_sym after human check
  notes.md                  # why this part is here
```

Synthetic fixtures under `tests/symbols/synthetic/`:

| Fixture | Intent |
| --- | --- |
| `rect-body` | `R~` with rx/ry empty (`R~x~y~~~w~h`) — C9864 class |
| `pt-triangle` | `PT~M x y L … Z` closed triangle |
| `pg-polygon` | `PG~` filled body |
| `pl-open` | open polyline only |
| `circle` | `C~` |
| `ellipse-noncircular` | `E~` rx≠ry — expect skip + UNHANDLED/S2 |
| `hidden-pin` | one `P~hide~` must not appear |
| `multi-unit-empty-parent` | parent `shape=[]`, two subparts with pins |
| `pt-curves` | `PT~` with `C`/`A` — v1 soft unless tagged required |
| `arc-semicircle` | `A~` SVG semicircle → KiCad `(arc start/mid/end)` |

## 9. End-to-end pipeline requirements

```text
frozen EasyEDA component JSON
        ↓
   UnEasyKicad.exportSymbolFromComponent()
        ↓
   parse .kicad_sym → SymbolIR
        ↓
   EasyEDA → SymbolIR  (and/or load reference.ir.json)
        ↓
   compare(IR, IR, tolerances)
        ↓
   artifacts/symbol-report.json + .md
```

Also required:

1. **Sexpr smoke:** DUT parses; no truncated tokens.
2. **Idempotency:** two conversions → identical IR.
3. **Negative:** missing `dataStr` throws; never emit a symbol with `pinCount === 0` when EasyEDA had visible pins.
4. **Live `scripts/test-kicad-convert.js`** may remain as a smoke against EasyEDA network; **CI e2e must not depend on it.**

## 10. Tooling requirements

| Component | Requirement |
| --- | --- |
| Runner | `node scripts/test-symbol-e2e.js` and `npm run test:symbol-e2e` |
| EasyEDA IR | `tests/symbols/lib/ir-from-easyeda.js` |
| KiCad IR | `tests/symbols/lib/ir-from-kicad.js` (sexpr for `pin` / `rectangle` / `circle` / `polyline` / `arc` / `property`) |
| Compare | `tests/symbols/lib/compare.js` |
| Reports | `artifacts/symbol-report.json` (gitignored) |
| Exit codes | 0 pass (WARN allowed), 1 hard fail, 2 infra/fixture error |

Reuse the footprint sexpr helper where practical; do not require KiCad installed.

## 11. CI requirements

1. Run on every PR touching `src/kicad/convert.js` or `tests/symbols/`.
2. Job &lt; 2 minutes on frozen corpus.
3. Fail the PR on any hard assertion.
4. Upload `artifacts/symbol-report.*` as CI artifacts.
5. Summary: `PASS / WARN / BLOCKED` and list of `BLOCKED` LCSC IDs.

May share a workflow with footprint e2e or a sibling `symbol-e2e.yml`.

## 12. Acceptance criteria (v1 complete)

- [ ] Tiers A–G minimum counts with frozen fixtures
- [ ] 100% hard assertions green
- [ ] Synthetic fixtures in §8.2 all present
- [ ] C51933324 (or frozen equivalent) **H9/H11** green — `PT~` triangle present
- [ ] C17702531 (or frozen equivalent) **H4** green — two units, pins not all on unit 0
- [ ] C9864 **H10** green — non-degenerate body rectangle
- [ ] C55315393 (or frozen equivalent) **H9** green — four `A~` inductor loops present as `(arc)`
- [ ] `docs/symbol-known-gaps.md` lists `T~`, non-circular `E~`, curved `PT~`
- [ ] README links this TRD + `npm run test:symbol-e2e`

## 13. Explicit honesty requirement

Every fixture must report leftover EasyEDA commands:

```text
UNHANDLED: T×2
```

If the converter claims to handle `PT~` but a fixture still lists `PT` as unhandled, that is an **H fail** (accounting or parser bug).

Commands currently expected as unhandled in v1 (soft unless they are the only body):

- `T~` text
- non-circular `E~`
- `PT~` curve ops beyond M/L/Z
- any future codes (`BEZIER`, …) until implemented

## 14. Phased delivery

| Phase | Deliverable |
| --- | --- |
| P0 | SymbolIR + H1–H8, H14 on ≥ 8 frozen parts + `pt-triangle` + `rect-body` synthetics |
| P1 | H9–H13, C51933324 / C9864 / C17702531 frozen, CI workflow |
| P2 | Full tier counts, known-gaps doc, high-risk quarantine for “body was only unhandled PT curves” |
| P3 | Optional `T~` → KiCad text; ellipse as polyline; Hausdorff on body outlines |

## 15. Relation to footprint testing

| | Symbols | Footprints |
| --- | --- | --- |
| Failure cost | Wrong net / unreadable schematic | Unmanufacturable PCB |
| IR focus | Pins + units + body graphics | Pads + drills + layers |
| Silent-drop example | `PT~` LED triangle / `A~` inductor coil | `SOLIDREGION` / `ARC` |
| Shared | Frozen fixtures, unhandled-command logs, convert.js CI trigger | |

Do **not** merge the two IRs. A part may PASS footprint e2e and BLOCK symbol e2e (or the reverse).

## 16. Success metric

> No schematic symbol from UnEasy-LCSC is missing pins, units, or a handled body primitive on corpus-equivalent parts without this suite having flagged `BLOCKED` (or `QUARANTINE` for high-risk unconverted-only-body) first.

---

## Philosophy

- Test **SymbolIR**, not “file exists.”
- Freeze fixtures; live LCSC is for freeze scripts only.
- **Pins and units are hard; cosmetics are soft** — except when the “cosmetic” *is* the symbol body (`PT~` / `R~` / `A~`).
- Make unknown EasyEDA commands **visible**. C51933324 was a silent `PT~` drop; C55315393 was a silent `A~` drop: pins exported, coil did not.
