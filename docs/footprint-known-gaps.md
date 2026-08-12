# Footprint conversion known gaps

UnEasy-LCSC footprint export is **assisted conversion**, not a guarantee of datasheet-perfect land patterns. Always verify critical pads against the vendor datasheet before production.

This document tracks EasyEDA commands the converter does **not** fully handle today. The e2e suite surfaces remaining gaps as soft failures / `UNCONVERTED_FEATURES` labels so silence is not mistaken for completeness.

## Unhandled / partial commands

| EasyEDA command | Current behavior | Risk |
| --- | --- | --- |
| `SOLIDREGION~` on layers 5/6 | Skipped intentionally — paste belongs on pad definitions. | Low (cosmetic process art) |
| `SOLIDREGION~` on layers 100/101 | Skipped — decorative lead/polarity fab/silk fills. | Soft cosmetics |
| `SOLIDREGION~` `cutout` regions | Skipped (only `solid` / `npth` imported). | Soft fab cosmetics |
| `SOLIDREGION~` layer 11 (multi) | Dropped — no single KiCad graphic copper layer. | Soft; quarantine if high-risk |
| Paste process simulation | Not attempted. | Out of scope |
| Courtyard Hausdorff / outline similarity | Not asserted in v1. | P3 |

## Handled electrical / graphic primitives

`PAD~`, `HOLE~`, `VIA~`, `TRACK~`, `RECT~`, `CIRCLE~`, `ARC~`, `TEXT~`, `SOLIDREGION~` (layers 1/2/3/4/13/14 filled poly; layer 99 courtyard outline), `SVGNODE~` (3D path metadata only).

## How the suite reports gaps

- Every fixture prints `UNHANDLED: …` when unknown commands remain.
- Soft-only gaps → status `WARN` (CI still green).
- High-risk fixtures with **unconverted multi-layer copper** `SOLIDREGION` (layer 11) → `BLOCKED` + `QUARANTINE` / `UNCONVERTED_FEATURES`.

See [footprint-e2e-trd.md](./footprint-e2e-trd.md) for assertion IDs and corpus policy.
