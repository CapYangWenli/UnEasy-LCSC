# TRD: Automated End-to-End Footprint Conversion Testing

## 1. Purpose

Prove that UnEasy-LCSC’s EasyEDA → KiCad footprint conversion is **geometrically and electrically faithful enough for PCB use**, with failures detected **before** a human places the part on a board.

Success is not “file parses.” Success is: **pads, drills, pitch, EP, and critical outlines match a trusted reference within stated tolerances.**

## 2. Scope

### In scope

- Footprint export path: EasyEDA footprint `dataStr` → `.kicad_mod`
- Pad geometry, drill, layers (Cu / mask / paste as represented)
- Origin, rotation, pad numbering
- STEP path property when present (link correctness, not mesh QA)
- Regression suite on a fixed corpus of LCSC parts + synthetic fixtures

### Out of scope (initially)

- Full solder-paste process simulation
- Electrical DRC of a whole board
- Guaranteeing JLCPCB assembly yield
- Symbol / `PT~` graphics (separate suite)

## 3. Definitions

| Term | Meaning |
| --- | --- |
| DUT | Device under test = converted `.kicad_mod` |
| Reference | Trusted geometry source (see §5) |
| Critical pad | Any pad with net connectivity or EP/thermal pad |
| Soft feature | Silk text, non-electrical ARC/SOLIDREGION cosmetics |
| Hard fail | Any critical-pad mismatch beyond tolerance |
| Soft fail | Missing non-electrical graphics only |

## 4. Goals & non-goals

### Goals

1. **Zero silent hard fails** on the golden corpus.
2. Detect pitch/body errors ≥ **0.05 mm** (configurable) on SMD parts.
3. Detect wrong drill diameter ≥ **0.05 mm** and oval axis swaps.
4. Detect missing/extra pads or renumbered pads.
5. Run headlessly in CI on every `convert.js` change.
6. Produce machine-readable reports (JSON) + human diff summary.

### Non-goals

- Bit-identical EasyEDA ↔ KiCad files
- Perfect courtyard/silk parity in v1
- Replacing datasheet review for production

## 5. Reference strategy (choose in priority order)

For each corpus part, at least one reference must exist:

1. **Preferred:** KiCad footprint derived from **vendor datasheet land pattern** (hand-verified once, stored as golden `.kicad_mod` or IPC calculator JSON).
2. **Secondary:** Independent conversion via `easyeda2kicad.py` (or similar) — used as **cross-check**, not sole truth.
3. **Tertiary:** EasyEDA footprint parsed to a **canonical geometry IR** (pads as polygons + drills) and compared to DUT IR — catches exporter regressions even without external goldens.

**Requirement:** Corpus entries tagged `risk=high` **must** use (1). Medium may use (1) or (2)+(3). Low may use (3) only.

## 6. Intermediate representation (IR)

Both EasyEDA input and KiCad output must normalize to the same IR:

```text
FootprintIR {
  name
  pads[] {
    number            // string
    type              // smd | thru_hole | npth
    shape             // rect | oval | circle | polygon
    center_mm {x,y}   // footprint origin frame
    size_mm {w,h}
    rotation_deg
    drill_mm {dia} | {oval_w, oval_h, orientation}
    layers[]          // normalized: F.Cu, B.Cu, F.Paste, F.Mask, *.Cu, ...
    polygon_mm[]      // if custom
  }
  holes[] { center_mm, dia_mm }   // mechanical NPTH
  bbox_mm {minx,miny,maxx,maxy}   // from pads+holes only (electrical bbox)
  attributes { smd | through_hole }
  model3d_path?                   // string as emitted
}
```

**Requirement:** Conversion tests assert on IR, not raw S-expression string equality.

## 7. Assertions (pass/fail rules)

### 7.1 Hard assertions (must pass)

| ID | Check | Tolerance (default) |
| --- | --- | --- |
| H1 | Pad count equal | exact |
| H2 | Pad number sets equal | exact |
| H3 | Each pad center Δx, Δy | ≤ 0.05 mm |
| H4 | Each pad size Δw, Δh | ≤ 0.05 mm (or ≤ 5% for pads &lt; 0.5 mm, whichever larger — document choice) |
| H5 | Pad rotation modulo 180° for symmetric shapes; else ≤ 1° | |
| H6 | THT drill dia | ≤ 0.05 mm |
| H7 | Oval drill major/minor assignment matches (no axis swap) | |
| H8 | Pad type smd vs thru_hole matches | exact |
| H9 | Electrical bbox pitch between adjacent numbered pads (where applicable) | ≤ 0.05 mm |
| H10 | Exposed pad present if reference has EP (heuristic: largest central pad or datasheet flag) | |
| H11 | Converter does not drop pads whose EasyEDA command is `PAD~` | exact |

### 7.2 Soft assertions (warn / quarantine)

| ID | Check |
| --- | --- |
| S1 | `ARC~` count vs emitted arcs (may be 0 today → quarantine high-risk) |
| S2 | `SOLIDREGION~` presence → flag “courtyard/copper not converted” |
| S3 | Silk/fab outline similarity (Hausdorff distance optional v2) |
| S4 | 3D model path non-empty when EasyEDA has `outline3D` |

### 7.3 Severity policy

- Any **H\*** fail → CI **red**, part marked `BLOCKED`
- Only **S\*** fails → CI **yellow** (or red if `risk=high` and policy says so)
- Parse/crash → CI **red**

## 8. Test corpus requirements

### 8.1 Composition

Minimum permanent corpus (≥ 20 parts), stratified:

| Tier | Examples of coverage | Min count |
| --- | --- | --- |
| A – simple SMD | 0402/0603 R/C, SOT-23 | 4 |
| B – IC standard | SOIC-8, SSOP, LQFP | 4 |
| C – EP / Power | ESOP-EP, PowerPAK, QFN-EP | 3 |
| D – fine pitch | ≤ 0.4 mm pitch QFN/LQFN | 2 |
| E – connectors | USB-C hybrid SMD+THT, Micro-USB, JST | 3 |
| F – THT dense | headers with oval drills | 2 |
| G – modules | ESP/CM4-like large pad arrays | 2 |

Known local anchors already useful: C98715, C9864, C2040, C2765186, C124356, C17702531, C2934560, C2838512.

### 8.2 Fixture packaging

Each corpus entry is a folder:

```text
tests/footprints/corpus/C9864/
  meta.json                  # lcsc, mpn, risk, tags, tolerances overrides
  easyeda-footprint.json     # frozen dataStr (do not live-fetch in CI)
  reference.kicad_mod        # or reference.ir.json
  notes.md                   # why this part is in the corpus
```

**Requirement:** CI uses **frozen fixtures**, not live EasyEDA API (flaky + silent upstream edits). A separate scheduled job may refresh fixtures and open a PR.

## 9. End-to-end pipeline requirements

```text
frozen EasyEDA footprint JSON
        ↓
   UnEasyKicad.exportFootprint()
        ↓
   parse .kicad_mod → FootprintIR
        ↓
   load reference → FootprintIR
        ↓
   compare(IR, IR, tolerances)
        ↓
   report.json + markdown summary
```

Also required:

1. **Round-trip smoke:** emitted file parses as valid KiCad sexpr (no truncated tokens).
2. **Idempotency:** converting the same fixture twice yields identical IR.
3. **Negative tests:** malformed PAD lines → explicit error or skipped with log; never emit zero-size pads for valid input.
4. **Synthetic unit fixtures:** handcrafted EasyEDA PAD strings for:
   - rect SMD
   - circle THT
   - oval THT horizontal vs vertical
   - CUSTOM polygon (≥ 3 points)
   - missing radius / empty fields (like the C9864 rect bug class)

## 10. Tooling requirements

| Component | Requirement |
| --- | --- |
| Runner | `node scripts/test-footprint-e2e.js` (or vitest/jest) |
| KiCad parse | Dedicated sexpr parser for `(pad …)` / `(drill …)` only; no full KiCad install required in CI |
| Optional | If KiCad CLI available, `kicad-cli pcb export` / footprint check as extra job |
| Reports | `artifacts/footprint-report.json` with per-pad deltas |
| Exit codes | 0 pass, 1 hard fail, 2 infra/fixture error |

## 11. CI requirements

1. Run on every PR touching `src/kicad/convert.js` or footprint fixtures.
2. Job time budget &lt; 2 minutes for frozen corpus.
3. Fail the PR on any hard assertion.
4. Publish report as CI artifact.
5. Badge or summary comment listing `BLOCKED` LCSC IDs.

## 12. Acceptance criteria (for declaring “v1 complete”)

- [ ] All Tier A–G minimum counts present with frozen fixtures
- [ ] 100% hard assertions green on corpus
- [ ] At least 5 synthetic PAD unit tests
- [ ] Documented known gaps: `SOLIDREGION`, `ARC`, silk text
- [ ] High-risk parts with soft gaps are labeled `UNCONVERTED_FEATURES` in report (not silent)
- [ ] README links to “footprints are assisted, verify datasheet for production”

## 13. Explicit honesty requirement

The suite must **surface unhandled EasyEDA commands** found in the input fixture:

```text
UNHANDLED: ARC×1, SOLIDREGION×18
```

If a high-risk fixture contains unhandled **electrical** cues (e.g. copper `SOLIDREGION` tagged as copper in EasyEDA), v1 policy is **fail or quarantine**, not silent pass.

## 14. Phased delivery

| Phase | Deliverable |
| --- | --- |
| P0 | IR + hard pad/drill compares on 10 frozen parts |
| P1 | Full stratified corpus + CI artifact |
| P2 | Unhandled-command accounting + high-risk quarantine |
| P3 | Optional courtyard Hausdorff / KiCad-cli job |

## 15. Success metric

> No footprint-related board failure attributable to UnEasy-LCSC conversion occurs on corpus-equivalent parts without the suite having flagged a hard or quarantine failure first.

---

## Philosophy

- Test **geometry IR**, not “file exists.”
- Freeze fixtures; don’t trust live LCSC in CI.
- Separate **hard electrical** vs **soft cosmetic** failures.
- Make **unknown EasyEDA commands visible** — silent drop is how symbol `PT~` bugs happen; on footprints that silence is dangerous.
