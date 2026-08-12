"use strict";

/** Shared EasyEDA unit helpers mirrored from convert.js */

function num(v, d = 0) {
  if (v === "" || v == null) return d;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
}

function eeToMm(v) {
  return Math.round(num(v) * 10 * 0.0254 * 1e6) / 1e6;
}

function angleToKi(rotation) {
  const r = num(rotation);
  if (!Number.isFinite(r)) return 0;
  return r > 180 ? -(360 - r) : r;
}

const PAD_SHAPE = {
  ELLIPSE: "circle",
  RECT: "rect",
  OVAL: "oval",
  POLYGON: "polygon"
};

const PAD_LAYER_SMD = {
  1: ["F.Cu", "F.Paste", "F.Mask"],
  2: ["B.Cu", "B.Paste", "B.Mask"],
  11: ["*.Cu", "*.Paste", "*.Mask"]
};

const PAD_LAYER_THT = {
  1: ["F.Cu", "F.Mask"],
  2: ["B.Cu", "B.Mask"],
  11: ["*.Cu", "*.Mask"]
};

function normalizeLayers(arr) {
  return (arr || []).map(String).sort();
}

function electricalBbox(pads, holes) {
  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  const expand = (cx, cy, w, h) => {
    const hw = (w || 0) / 2;
    const hh = (h || 0) / 2;
    minx = Math.min(minx, cx - hw);
    miny = Math.min(miny, cy - hh);
    maxx = Math.max(maxx, cx + hw);
    maxy = Math.max(maxy, cy + hh);
  };
  for (const p of pads || []) {
    expand(p.center_mm.x, p.center_mm.y, p.size_mm.w, p.size_mm.h);
  }
  for (const h of holes || []) {
    expand(h.center_mm.x, h.center_mm.y, h.dia_mm, h.dia_mm);
  }
  if (!Number.isFinite(minx)) {
    return { minx: 0, miny: 0, maxx: 0, maxy: 0 };
  }
  return { minx, miny, maxx, maxy };
}

function round6(n) {
  return Math.round(n * 1e6) / 1e6;
}

module.exports = {
  num,
  eeToMm,
  angleToKi,
  PAD_SHAPE,
  PAD_LAYER_SMD,
  PAD_LAYER_THT,
  normalizeLayers,
  electricalBbox,
  round6
};
