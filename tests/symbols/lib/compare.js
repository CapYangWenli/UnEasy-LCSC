"use strict";

const DEFAULT_TOL = {
  pin_xy_mm: 0.01,
  pin_length_mm: 0.05
};

function visiblePins(ir) {
  return (ir.units || []).flatMap((u) => (u.pins || []).filter((p) => p.visible !== false));
}

function allPins(ir) {
  return (ir.units || []).flatMap((u) => u.pins || []);
}

function pinsByUnit(ir) {
  const map = new Map();
  for (const u of ir.units || []) {
    map.set(u.id, (u.pins || []).filter((p) => p.visible !== false));
  }
  return map;
}

function graphicsByKind(ir) {
  const counts = { rectangle: 0, circle: 0, polyline: 0 };
  for (const u of ir.units || []) {
    for (const g of u.graphics || []) {
      if (counts[g.kind] != null) counts[g.kind]++;
    }
  }
  return counts;
}

function countEasyedaHandledBodies(eeParsed) {
  const hc = eeParsed.handledCounts || {};
  return {
    R: hc.R || 0,
    C: (hc.C || 0) + (hc.E || 0),
    PL: hc.PL || 0,
    PG: hc.PG || 0,
    PT: hc.PT || 0
  };
}

function pinKey(p) {
  return `${p.number}@${p.x_mm},${p.y_mm}`;
}

function compareSymbols(dut, ref, opts = {}) {
  const tol = { ...DEFAULT_TOL, ...(opts.tolerances || {}) };
  const meta = opts.meta || {};
  const eeParsed = opts.eeParsed || {};
  const hardFails = [];
  const softFails = [];
  const labels = [];

  const fail = (id, message) => hardFails.push({ id, message });
  const soft = (id, message) => softFails.push({ id, message });

  const refVisible = visiblePins(ref);
  const dutVisible = visiblePins(dut);

  // H1 visible pin count
  if (refVisible.length !== dutVisible.length) {
    fail("H1", `visible pin count ref=${refVisible.length} dut=${dutVisible.length}`);
  }

  // H4 unit count
  if ((ref.unitCount || 0) !== (dut.unitCount || 0)) {
    fail("H4", `unitCount ref=${ref.unitCount} dut=${dut.unitCount}`);
  }

  // Per-unit pin compares (H2, H3, H5-H8, H15)
  const refByUnit = pinsByUnit(ref);
  const dutByUnit = pinsByUnit(dut);

  for (const [unitId, refPins] of refByUnit) {
    const dutPins = dutByUnit.get(unitId) || [];

    // H2 pin number sets per unit
    const refNums = refPins.map((p) => p.number).sort();
    const dutNums = dutPins.map((p) => p.number).sort();
    if (refNums.join("|") !== dutNums.join("|")) {
      fail(
        "H2",
        `unit ${unitId} pin numbers differ ref=[${refNums.join(",")}] dut=[${dutNums.join(",")}]`
      );
    }

    // H3 no duplicate pin numbers within unit
    const seen = new Set();
    for (const n of dutNums) {
      if (seen.has(n)) {
        fail("H3", `unit ${unitId} duplicate pin number "${n}"`);
      }
      seen.add(n);
    }

    const usedDut = new Set();
    for (const rp of refPins) {
      const candidates = dutPins.filter(
        (d) => d.number === rp.number && !usedDut.has(pinKey(d))
      );
      let best = null;
      let bestDist = Infinity;
      for (const d of candidates) {
        const dist = Math.hypot(d.x_mm - rp.x_mm, d.y_mm - rp.y_mm);
        if (dist < bestDist) {
          bestDist = dist;
          best = d;
        }
      }
      if (!best) {
        fail("H2", `unit ${unitId} missing DUT pin "${rp.number}"`);
        continue;
      }
      usedDut.add(pinKey(best));

      const dx = Math.abs(best.x_mm - rp.x_mm);
      const dy = Math.abs(best.y_mm - rp.y_mm);
      if (dx > tol.pin_xy_mm || dy > tol.pin_xy_mm) {
        fail(
          "H5",
          `unit ${unitId} pin "${rp.number}" position Δx=${dx.toFixed(4)} Δy=${dy.toFixed(4)}`
        );
      }

      if (![0, 90, 180, 270].includes(best.rotation_deg)) {
        fail(
          "H6",
          `unit ${unitId} pin "${rp.number}" rotation ${best.rotation_deg} not in {0,90,180,270}`
        );
      } else if (best.rotation_deg !== rp.rotation_deg) {
        fail(
          "H6",
          `unit ${unitId} pin "${rp.number}" rotation ref=${rp.rotation_deg} dut=${best.rotation_deg}`
        );
      }

      const dlen = Math.abs(best.length_mm - rp.length_mm);
      if (dlen > tol.pin_length_mm) {
        fail(
          "H7",
          `unit ${unitId} pin "${rp.number}" length Δ=${dlen.toFixed(4)} mm`
        );
      }

      if (best.style !== rp.style) {
        soft("S5", `unit ${unitId} pin "${rp.number}" style ref=${rp.style} dut=${best.style}`);
      }

      // H15 pin type when EasyEDA type 1-4
      if (rp.easyedaType >= 1 && rp.easyedaType <= 4 && best.type !== rp.type) {
        fail(
          "H15",
          `unit ${unitId} pin "${rp.number}" type ref=${rp.type} dut=${best.type}`
        );
      }
    }
  }

  // H8 hidden pins not in DUT
  const refHidden = allPins(ref).filter((p) => p.visible === false);
  for (const hp of refHidden) {
    const found = dutVisible.find((d) => d.number === hp.number);
    if (found) {
      fail("H8", `hidden EasyEDA pin "${hp.number}" emitted in DUT`);
    }
  }

  // H9 handled body commands not dropped (per kind — extras cannot hide a drop)
  const expected = countEasyedaHandledBodies(eeParsed);
  const dutBodies = graphicsByKind(dut);
  const expectedPolys = expected.PL + expected.PG + expected.PT;
  if (dutBodies.rectangle < expected.R) {
    fail("H9", `rectangles dropped: expected=${expected.R} dut=${dutBodies.rectangle}`);
  }
  if (dutBodies.circle < expected.C) {
    fail("H9", `circles dropped: expected=${expected.C} dut=${dutBodies.circle}`);
  }
  if (dutBodies.polyline < expectedPolys) {
    fail(
      "H9",
      `polylines dropped: expected=${expectedPolys} (PL=${expected.PL} PG=${expected.PG} PT=${expected.PT}) dut=${dutBodies.polyline}`
    );
  }

  const totalExpected = expected.R + expected.C + expectedPolys;

  // Accounting bug: UNHANDLED lists a type H9 claims to handle
  const unhandled = opts.unhandled || {};
  for (const cmd of ["P", "R", "C", "PL", "PG"]) {
    if (unhandled[cmd]) {
      fail("H9", `accounting bug: ${cmd} listed UNHANDLED but converter handles ${cmd}~`);
    }
  }
  if (unhandled.PT && (eeParsed.handledCounts?.PT || 0) > 0) {
    fail("H9", "accounting bug: PT in UNHANDLED while M/L/Z path was also counted handled");
  }

  // H10 degenerate rectangles
  for (const u of dut.units || []) {
    for (const g of u.graphics || []) {
      if (g.kind !== "rectangle") continue;
      const w = Math.abs(g.end.x - g.start.x);
      const h = Math.abs(g.end.y - g.start.y);
      // Find matching easyeda rect with w,h >= 2px
      const eeRects = (ref.units || [])
        .flatMap((ru) => ru.graphics || [])
        .filter((x) => x.kind === "rectangle");
      const needsCheck = eeRects.some(
        (er) => (er.easyedaW || 0) >= 2 && (er.easyedaH || 0) >= 2
      );
      if (needsCheck && (w < 0.2 || h < 0.2)) {
        fail("H10", `degenerate rectangle w=${w.toFixed(4)} h=${h.toFixed(4)} mm`);
      }
    }
  }

  // H11 closed PT/PG polylines
  const refClosed = (ref.units || [])
    .flatMap((u) => u.graphics || [])
    .filter((g) => g.kind === "polyline" && g.closed);
  const dutClosed = (dut.units || [])
    .flatMap((u) => u.graphics || [])
    .filter((g) => {
      if (g.kind !== "polyline" || (g.pts || []).length < 3) return false;
      const a = g.pts[0];
      const b = g.pts[g.pts.length - 1];
      return Math.abs(a.x - b.x) < 0.02 && Math.abs(a.y - b.y) < 0.02;
    });
  const refClosedQualified = refClosed.filter((g) => {
    const unique = new Set((g.pts || []).map((p) => `${p.x},${p.y}`));
    return unique.size >= 3;
  });
  if (dutClosed.length < refClosedQualified.length) {
    fail(
      "H11",
      `closed polylines with ≥3 vertices: ref=${refClosedQualified.length} dut=${dutClosed.length}`
    );
  }

  // H12 properties (only when fixture has a real LCSC id)
  const refLcsc = ref.properties?.lcsc || "";
  if (refLcsc && /^C\d+/.test(refLcsc)) {
    if (dut.properties?.lcsc !== refLcsc) {
      fail("H12", `LCSC Part ref="${refLcsc}" dut="${dut.properties?.lcsc || ""}"`);
    }
  }
  if (ref.properties?.mpn && dut.properties?.mpn !== ref.properties.mpn) {
    fail("H12", `MPN ref="${ref.properties.mpn}" dut="${dut.properties.mpn || ""}"`);
  }

  // H13 footprint property
  if (ref.properties?.footprint && ref.properties.footprint.startsWith("UnEasy-LCSC:")) {
    if (dut.properties?.footprint !== ref.properties.footprint) {
      fail(
        "H13",
        `Footprint ref="${ref.properties.footprint}" dut="${dut.properties.footprint || ""}"`
      );
    }
  }

  // Soft assertions
  if (unhandled.T) {
    soft("S1", `T×${unhandled.T} schematic text not converted`);
  }
  if (unhandled.E) {
    soft("S2", `non-circular E×${unhandled.E} skipped`);
    labels.push("UNCONVERTED_FEATURES");
  }
  if (unhandled.PT || eeParsed.ptCurveCount) {
    const n = unhandled.PT || eeParsed.ptCurveCount;
    soft("S3", `PT curve/other×${n} not fully converted`);
    labels.push("UNCONVERTED_FEATURES");
  }

  const typedPins = refVisible.filter((p) => p.easyedaType >= 1 && p.easyedaType <= 4);
  if (!typedPins.length && refVisible.length >= 3) {
    soft("S4", "all pins have EasyEDA type 0 (unspecified)");
  }

  const emptyNames = refVisible.filter((p) => !p.name || p.name === p.number);
  if (emptyNames.length === refVisible.length && refVisible.length > 0) {
    soft("S5", "pin names empty or equal to numbers only");
  }

  // S6 body vs pin bbox
  const allGfx = (ref.units || []).flatMap((u) => u.graphics || []);
  if (!allGfx.length && refVisible.length >= 3) {
    soft("S6", "no body graphics in reference IR but many pins");
  }

  // High-risk quarantine: only body was unhandled PT curves / noncircular E
  if (meta.risk === "high") {
    const onlyUnconvertedBody =
      totalExpected === 0 &&
      (unhandled.PT || unhandled.E) &&
      refVisible.length > 0;
    if (onlyUnconvertedBody) {
      labels.push("UNCONVERTED_FEATURES");
      labels.push("QUARANTINE");
      fail(
        "Q1",
        `high-risk: only symbol body was unhandled PT/E curves (PT=${unhandled.PT || 0} E=${unhandled.E || 0})`
      );
    }
  }

  let status = "PASS";
  if (hardFails.length) status = "BLOCKED";
  else if (softFails.length) status = "WARN";

  return { status, hardFails, softFails, labels: [...new Set(labels)] };
}

function irEqual(a, b, eps = 1e-4) {
  return JSON.stringify(roundIr(a, eps)) === JSON.stringify(roundIr(b, eps));
}

function roundIr(ir, eps) {
  const r = (n) => Math.round(n / eps) * eps;
  const roundPin = (p) => ({
    ...p,
    x_mm: r(p.x_mm),
    y_mm: r(p.y_mm),
    length_mm: r(p.length_mm)
  });
  return {
    ...ir,
    units: (ir.units || []).map((u) => ({
      ...u,
      pins: (u.pins || []).map(roundPin),
      graphics: (u.graphics || []).map((g) => {
        if (g.kind === "rectangle") {
          return {
            ...g,
            start: { x: r(g.start.x), y: r(g.start.y) },
            end: { x: r(g.end.x), y: r(g.end.y) }
          };
        }
        if (g.kind === "circle") {
          return {
            ...g,
            center: { x: r(g.center.x), y: r(g.center.y) },
            radius: r(g.radius)
          };
        }
        if (g.kind === "polyline") {
          return {
            ...g,
            pts: (g.pts || []).map((p) => ({ x: r(p.x), y: r(p.y) }))
          };
        }
        return g;
      })
    }))
  };
}

module.exports = {
  compareSymbols,
  irEqual,
  visiblePins,
  graphicsByKind,
  DEFAULT_TOL
};
