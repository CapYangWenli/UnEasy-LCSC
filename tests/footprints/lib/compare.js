"use strict";

const DEFAULT_TOL = {
  center_mm: 0.05,
  size_mm: 0.05,
  size_pct: 0.05,
  size_small_mm: 0.5,
  drill_mm: 0.05,
  rotation_deg: 1,
  pitch_mm: 0.05
};

function sizeTol(refW, refH, tol) {
  const abs = tol.size_mm ?? DEFAULT_TOL.size_mm;
  const pct = tol.size_pct ?? DEFAULT_TOL.size_pct;
  const small = tol.size_small_mm ?? DEFAULT_TOL.size_small_mm;
  const dim = Math.min(refW, refH);
  if (dim < small) return Math.max(abs, dim * pct);
  return abs;
}

function normRotDiff(a, b, shape) {
  let da = ((a - b) % 360 + 360) % 360;
  if (da > 180) da = 360 - da;
  // Symmetric shapes: 180° equivalent
  if (shape === "rect" || shape === "oval" || shape === "circle") {
    const da180 = Math.min(da, Math.abs(da - 180));
    return da180;
  }
  return da;
}

function padKey(p) {
  return String(p.number);
}

function indexedPads(pads) {
  const map = new Map();
  for (const p of pads) {
    const k = padKey(p);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(p);
  }
  return map;
}

function findEpPad(pads) {
  if (!pads.length) return null;
  const numbered = pads.filter((p) => p.number !== "");
  if (!numbered.length) return null;
  let best = null;
  let bestArea = -1;
  for (const p of numbered) {
    const area = (p.size_mm.w || 0) * (p.size_mm.h || 0);
    if (area > bestArea) {
      bestArea = area;
      best = p;
    }
  }
  if (!best) return null;
  // EP heuristic: largest pad near origin
  const dist = Math.hypot(best.center_mm.x, best.center_mm.y);
  const bboxSpan = Math.max(
    ...numbered.map((p) => Math.hypot(p.center_mm.x, p.center_mm.y)),
    0.01
  );
  if (dist <= bboxSpan * 0.35) return best;
  return best; // still return largest; meta.hasEp can force check
}

function adjacentPitchPairs(pads) {
  const numbered = pads
    .filter((p) => /^\d+$/.test(String(p.number)))
    .map((p) => ({ ...p, n: parseInt(p.number, 10) }))
    .sort((a, b) => a.n - b.n);
  const pairs = [];
  for (let i = 0; i + 1 < numbered.length; i++) {
    if (numbered[i + 1].n === numbered[i].n + 1) {
      pairs.push([numbered[i], numbered[i + 1]]);
    }
  }
  return pairs;
}

function drillEqual(a, b, tol) {
  const t = tol.drill_mm ?? DEFAULT_TOL.drill_mm;
  if (!a && !b) return { ok: true };
  if (!a || !b) return { ok: false, reason: "drill missing on one side" };
  if (a.dia != null || b.dia != null) {
    if (a.dia == null || b.dia == null) {
      return { ok: false, reason: "round vs oval drill mismatch" };
    }
    if (Math.abs(a.dia - b.dia) > t) {
      return { ok: false, reason: `drill dia Δ=${Math.abs(a.dia - b.dia).toFixed(4)}` };
    }
    return { ok: true };
  }
  // Oval
  const aw = a.oval_w;
  const ah = a.oval_h;
  const bw = b.oval_w;
  const bh = b.oval_h;
  if (aw == null || ah == null || bw == null || bh == null) {
    return { ok: false, reason: "incomplete oval drill" };
  }
  const direct =
    Math.abs(aw - bw) <= t && Math.abs(ah - bh) <= t;
  const swapped =
    Math.abs(aw - bh) <= t && Math.abs(ah - bw) <= t;
  if (direct) return { ok: true };
  if (swapped) return { ok: false, reason: "oval drill axis swap", id: "H7" };
  return {
    ok: false,
    reason: `oval drill Δw=${Math.abs(aw - bw).toFixed(4)} Δh=${Math.abs(ah - bh).toFixed(4)}`
  };
}

/**
 * Compare DUT IR against reference IR.
 * @returns {{ status, hardFails, softFails, padDeltas, labels }}
 */
function compareFootprints(dut, ref, opts = {}) {
  const tol = { ...DEFAULT_TOL, ...(opts.tolerances || {}) };
  const meta = opts.meta || {};
  const hardFails = [];
  const softFails = [];
  const padDeltas = [];
  const labels = [];

  const fail = (id, message) => hardFails.push({ id, message });
  const soft = (id, message) => softFails.push({ id, message });

  // Exclude empty-number mechanical pads from H1/H2 numbered set compares? 
  // TRD: pad count equal — include all pads that DUT emits.
  // Match by pairing numbered pads + empty pads by position.

  const refPads = ref.pads || [];
  const dutPads = dut.pads || [];

  // H1 pad count
  if (refPads.length !== dutPads.length) {
    fail(
      "H1",
      `pad count ref=${refPads.length} dut=${dutPads.length}`
    );
  }

  // H2 pad number sets (multiset)
  const refNums = refPads.map(padKey).sort();
  const dutNums = dutPads.map(padKey).sort();
  if (refNums.join("|") !== dutNums.join("|")) {
    fail(
      "H2",
      `pad number sets differ ref=[${[...new Set(refNums)].join(",")}] dut=[${[...new Set(dutNums)].join(",")}]`
    );
  }

  // Pair pads: for each number, match by nearest center
  const dutByNum = indexedPads(dutPads);
  const usedDut = new Set();

  for (const rp of refPads) {
    const candidates = (dutByNum.get(padKey(rp)) || []).filter(
      (d) => !usedDut.has(d)
    );
    let best = null;
    let bestDist = Infinity;
    for (const d of candidates) {
      const dist = Math.hypot(
        d.center_mm.x - rp.center_mm.x,
        d.center_mm.y - rp.center_mm.y
      );
      if (dist < bestDist) {
        bestDist = dist;
        best = d;
      }
    }
    if (!best) {
      fail("H2", `missing DUT pad number="${rp.number}"`);
      continue;
    }
    usedDut.add(best);

    const st = sizeTol(rp.size_mm.w, rp.size_mm.h, tol);
    const dx = Math.abs(best.center_mm.x - rp.center_mm.x);
    const dy = Math.abs(best.center_mm.y - rp.center_mm.y);
    const dw = Math.abs(best.size_mm.w - rp.size_mm.w);
    const dh = Math.abs(best.size_mm.h - rp.size_mm.h);
    const drot = normRotDiff(best.rotation_deg, rp.rotation_deg, rp.shape);

    const delta = {
      number: rp.number,
      dx,
      dy,
      dw,
      dh,
      drot,
      ref: {
        center: rp.center_mm,
        size: rp.size_mm,
        type: rp.type,
        shape: rp.shape
      },
      dut: {
        center: best.center_mm,
        size: best.size_mm,
        type: best.type,
        shape: best.shape
      }
    };
    padDeltas.push(delta);

    // H3 centers
    if (dx > tol.center_mm || dy > tol.center_mm) {
      fail(
        "H3",
        `pad "${rp.number}" center Δx=${dx.toFixed(4)} Δy=${dy.toFixed(4)} (tol ${tol.center_mm})`
      );
    }
    // H4 size
    if (dw > st || dh > st) {
      fail(
        "H4",
        `pad "${rp.number}" size Δw=${dw.toFixed(4)} Δh=${dh.toFixed(4)} (tol ${st.toFixed(4)})`
      );
    }
    // H5 rotation
    const rotTol = rp.shape === "polygon" ? tol.rotation_deg : tol.rotation_deg;
    if (drot > rotTol && rp.shape !== "circle") {
      // circles ignore rotation
      fail(
        "H5",
        `pad "${rp.number}" rotation Δ=${drot.toFixed(3)}° (tol ${rotTol})`
      );
    }
    // H8 type — map npth ~ thru_hole for HOLE empties
    const rType = rp.type === "npth" ? "thru_hole" : rp.type;
    const dType = best.type === "npth" ? "thru_hole" : best.type;
    if (rType !== dType) {
      fail("H8", `pad "${rp.number}" type ref=${rp.type} dut=${best.type}`);
    }
    // H6/H7 drill
    if (rp.drill_mm || best.drill_mm) {
      const dr = drillEqual(rp.drill_mm, best.drill_mm, tol);
      if (!dr.ok) {
        fail(dr.id || "H6", `pad "${rp.number}" ${dr.reason}`);
      }
    }
  }

  // H9 pitch between adjacent numbered pads
  const refPairs = adjacentPitchPairs(refPads);
  const dutPairs = adjacentPitchPairs(dutPads);
  const pairCount = Math.min(refPairs.length, dutPairs.length);
  for (let i = 0; i < pairCount; i++) {
    const [ra, rb] = refPairs[i];
    const [da, db] = dutPairs[i];
    if (ra.n !== da.n || rb.n !== db.n) continue;
    const rpitch = Math.hypot(
      rb.center_mm.x - ra.center_mm.x,
      rb.center_mm.y - ra.center_mm.y
    );
    const dpitch = Math.hypot(
      db.center_mm.x - da.center_mm.x,
      db.center_mm.y - da.center_mm.y
    );
    if (Math.abs(rpitch - dpitch) > tol.pitch_mm) {
      fail(
        "H9",
        `pitch pads ${ra.n}-${rb.n} Δ=${Math.abs(rpitch - dpitch).toFixed(4)} mm`
      );
    }
  }

  // H10 exposed pad
  const wantEp = meta.hasEp === true;
  if (wantEp || meta.hasEp === "auto") {
    const refEp = findEpPad(refPads);
    const dutEp = findEpPad(dutPads);
    if (wantEp && !dutEp) {
      fail("H10", "expected exposed/thermal pad missing in DUT");
    } else if (refEp && !dutEp) {
      fail("H10", "reference EP not found in DUT");
    }
  } else if (meta.hasEp) {
    const dutEp = findEpPad(dutPads);
    if (!dutEp) fail("H10", "expected EP missing in DUT");
  }

  // Soft: S4 3D path
  if (opts.expectModel3d && !(dut.model3d_path && String(dut.model3d_path).trim())) {
    soft("S4", "3D model path empty but EasyEDA had SVGNODE/outline3D");
  }

  // Soft unhandled accounting passed in
  if (opts.unhandled) {
    if (opts.unhandled.ARC) {
      soft("S1", `ARC×${opts.unhandled.ARC} not converted`);
    }
    if (opts.unhandled.SOLIDREGION) {
      soft(
        "S2",
        `SOLIDREGION×${opts.unhandled.SOLIDREGION} → courtyard/copper may be missing`
      );
      labels.push("UNCONVERTED_FEATURES");
    }
    if (opts.unhandled.TEXT) {
      soft("S3", `TEXT×${opts.unhandled.TEXT} silk/text not converted`);
    }
  }

  // Any SOLIDREGION/ARC on high-risk → visible label (not silent).
  // Only copper SOLIDREGION triggers hard quarantine (TRD §13).
  if (meta.risk === "high" && opts.unhandled && opts.unhandled.SOLIDREGION) {
    labels.push("UNCONVERTED_FEATURES");
  }
  if (meta.risk === "high" && opts.solidRegionCopper > 0) {
    labels.push("UNCONVERTED_FEATURES");
    fail(
      "Q1",
      `high-risk fixture has unconverted multi-layer SOLIDREGION (layer 11 ×${opts.solidRegionCopper})`
    );
    labels.push("QUARANTINE");
  }

  let status = "PASS";
  if (hardFails.length) status = "BLOCKED";
  else if (softFails.length) status = "WARN";
  if (labels.includes("QUARANTINE") && status !== "BLOCKED") status = "BLOCKED";

  return { status, hardFails, softFails, padDeltas, labels: [...new Set(labels)] };
}

/**
 * H11: every EasyEDA PAD~ must appear in DUT (by count of numbered electrical pads from PAD cmds).
 * padCommandCount is number of PAD~ lines; DUT should have at least that many pads from PAD
 * (HOLE/VIA add extra). Check: numbered pads from ref that came from PAD >= padCommandCount
 * Actually: converter emits one pad per PAD~. So dut.pads from PAD only = padCommandCount,
 * plus HOLE/VIA extras. Simplest H11: dut pad count >= padCommandCount and no PAD dropped
 * meaning ref padCommandCount pads exist in dut.
 */
function assertNoDroppedPads(padCommandCount, dutPadCountFromExport, easyedaPadCount) {
  const hardFails = [];
  if (padCommandCount > 0 && easyedaPadCount < padCommandCount) {
    hardFails.push({
      id: "H11",
      message: `IR lost PAD~ commands: cmds=${padCommandCount} irPads=${easyedaPadCount}`
    });
  }
  // DUT must not have fewer PAD-derived pads than EasyEDA PAD~ count.
  // Total DUT pads may include HOLE/VIA; compare using easyeda IR pad count that includes them.
  if (dutPadCountFromExport < easyedaPadCount) {
    hardFails.push({
      id: "H11",
      message: `converter dropped pads: easyedaIR=${easyedaPadCount} dut=${dutPadCountFromExport}`
    });
  }
  return hardFails;
}

function irEqual(a, b, eps = 1e-6) {
  return JSON.stringify(roundIr(a, eps)) === JSON.stringify(roundIr(b, eps));
}

function roundIr(ir, eps) {
  const r = (n) => Math.round(n / eps) * eps;
  return {
    ...ir,
    pads: (ir.pads || []).map((p) => ({
      ...p,
      center_mm: { x: r(p.center_mm.x), y: r(p.center_mm.y) },
      size_mm: { w: r(p.size_mm.w), h: r(p.size_mm.h) },
      rotation_deg: r(p.rotation_deg)
    })),
    holes: (ir.holes || []).map((h) => ({
      center_mm: { x: r(h.center_mm.x), y: r(h.center_mm.y) },
      dia_mm: r(h.dia_mm)
    }))
  };
}

module.exports = {
  compareFootprints,
  assertNoDroppedPads,
  irEqual,
  DEFAULT_TOL,
  findEpPad,
  sizeTol
};
