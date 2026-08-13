# Symbol conversion known gaps

UnEasy-LCSC symbol export is **assisted conversion**, not a guarantee of datasheet-perfect schematic graphics. Always glance at unusual analog/LED bodies before relying on the symbol.

This document tracks EasyEDA commands the converter does **not** fully handle today. The e2e suite surfaces remaining gaps as soft failures / `UNCONVERTED_FEATURES` labels so silence is not mistaken for completeness.

## Unhandled / partial commands

| EasyEDA command | Current behavior | Risk |
| --- | --- | --- |
| `T~` schematic text | Not exported in v1; listed in `UNHANDLED`. | Soft (S1) |
| `E~` non-circular (`\|rx−ry\| > 0.01`) | Skipped; counted as unhandled. | Soft (S2) unless high-risk and only body |
| `PT~` curve ops (`C`, `A`, `Q`, …) | Only `M`/`L`/`Z` segments converted; curves flagged. | Soft (S3) unless high-risk and only body |
| EasyEDA pin type `0` | Maps to KiCad `unspecified` — H15 N/A. | Data quality (S4) |

## Handled electrical / graphic primitives

`P~` (visible pins), `R~`, `C~`, circular `E~`, `PL~`, `PG~`, `PT~` (`M`/`L`/`Z` with ≥2 points), multi-unit `subparts`, properties (`LCSC Part`, `MPN`, `Footprint`).

## How the suite reports gaps

- Every fixture prints `UNHANDLED: …` when unknown commands remain.
- Soft-only gaps → status `WARN` (CI still green).
- High-risk fixtures where the **only** body was unhandled `PT~` curves or non-circular `E~` → `BLOCKED` / `QUARANTINE`.

See [symbol-e2e-trd.md](./symbol-e2e-trd.md) for assertion IDs and corpus policy.
