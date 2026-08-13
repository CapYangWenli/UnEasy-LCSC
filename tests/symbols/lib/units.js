"use strict";

/**
 * Symbol coordinate helpers — must stay in sync with src/kicad/convert.js
 * (num, eeToMm, pxToMm, pxToMmGrid, snapPx, resolveOrigin, parsePin, parseRect).
 */

function num(v, d = 0) {
  if (v === "" || v == null) return d;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : d;
}

function eeToMm(v) {
  return Math.round(num(v) * 10 * 0.0254 * 1e6) / 1e6;
}

function pxToMm(v) {
  return eeToMm(v);
}

function pxToMmGrid(v, grid = 1.27) {
  const mm = pxToMm(v);
  return Math.round(mm / grid) * grid;
}

function snapPx(v, grid = 5) {
  return Math.round(num(v) / grid) * grid;
}

function round2(n) {
  return Math.round(n * 100) / 100;
}

/** Must stay in sync with sanitizeName in src/kicad/convert.js */
function sanitizeName(s) {
  return (
    String(s || "part")
      .replace(/[\\/:*?"<>|\s]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "") || "part"
  );
}

const PIN_TYPES = {
  0: "unspecified",
  1: "input",
  2: "output",
  3: "bidirectional",
  4: "power_in"
};

function parsePin(line) {
  const segs = line.split("^^").map((s) => s.split("~"));
  const settings = segs[0] || [];
  const pinNum =
    segs[4] && segs[4][4] != null && segs[4][4] !== ""
      ? segs[4][4]
      : settings[3] || "";
  const name = (segs[3] && segs[3][4]) || pinNum || "PIN";
  const path = (segs[2] && segs[2][0]) || "";
  let lengthPx = 10;
  const hm = path.replace(/v/gi, "h").match(/h\s*(-?[\d.]+)/i);
  if (hm) lengthPx = Math.abs(num(hm[1], 10));

  const dotShown =
    segs[5] && ["1", "true", "show"].includes(String(segs[5][0]).toLowerCase());
  const clockShown =
    segs[6] && ["1", "true", "show"].includes(String(segs[6][0]).toLowerCase());
  let style = "line";
  if (dotShown && clockShown) style = "inverted_clock";
  else if (dotShown) style = "inverted";
  else if (clockShown) style = "clock";

  return {
    visible: String(settings[1] || "show").toLowerCase() !== "hide",
    type: PIN_TYPES[num(settings[2], 0)] || "unspecified",
    easyedaType: num(settings[2], 0),
    number: String(pinNum).replace(/\s+/g, ""),
    name: String(name).replace(/\s+/g, ""),
    x: num(settings[4]),
    y: num(settings[5]),
    rotation: num(settings[6]),
    lengthPx,
    style
  };
}

function parseRect(line) {
  const p = line.split("~");
  const isNumField = (s) => s !== "" && s != null && Number.isFinite(Number(s));
  if (isNumField(p[5]) && isNumField(p[6])) {
    return { x: num(p[1]), y: num(p[2]), w: num(p[5]), h: num(p[6]) };
  }
  if (p[3] === "" && isNumField(p[4]) && isNumField(p[5])) {
    return { x: num(p[1]), y: num(p[2]), w: num(p[4]), h: num(p[5]) };
  }
  if (isNumField(p[3]) && isNumField(p[4])) {
    return { x: num(p[1]), y: num(p[2]), w: num(p[3]), h: num(p[4]) };
  }
  return { x: num(p[1]), y: num(p[2]), w: num(p[5]), h: num(p[6]) };
}

function resolveOrigin(dataStr, sharedOrigin) {
  if (sharedOrigin) return sharedOrigin;
  const head = dataStr.head || {};
  const bbox = dataStr.BBox || {};
  const bw = num(bbox.width);
  const bh = num(bbox.height);
  let originX = num(head.x);
  let originY = num(head.y);
  if (bw > 0 || bh > 0) {
    originX = num(bbox.x) + bw / 2;
    originY = num(bbox.y) + bh / 2;
  }
  return { x: snapPx(originX), y: snapPx(originY) };
}

function pinToMm(pin, origin) {
  const orient = (180 + pin.rotation) % 360;
  return {
    x_mm: round2(pxToMmGrid(pin.x - origin.x)),
    y_mm: round2(-pxToMmGrid(pin.y - origin.y)),
    rotation_deg: orient,
    length_mm: round2(pxToMmGrid(pin.lengthPx))
  };
}

function parsePolylinePoints(pointsStr, ox, oy, flipY) {
  const vals = String(pointsStr || "")
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(num);
  const pts = [];
  for (let i = 0; i + 1 < vals.length; i += 2) {
    const x = round2(pxToMm(vals[i] - ox));
    const y = round2(flipY ? -pxToMm(vals[i + 1] - oy) : pxToMm(vals[i + 1] - oy));
    pts.push({ x, y });
  }
  return pts;
}

function parsePathPoints(pathStr, ox, oy, flipY) {
  const tokens = String(pathStr || "")
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  const pts = [];
  let i = 0;
  let cmd = null;
  const pushPt = (xPx, yPx) => {
    const x = round2(pxToMm(xPx - ox));
    const y = round2(flipY ? -pxToMm(yPx - oy) : pxToMm(yPx - oy));
    pts.push({ x, y });
  };
  while (i < tokens.length) {
    const t = tokens[i];
    if (/^[A-Za-z]$/.test(t)) {
      cmd = t.toUpperCase();
      i++;
      if (cmd === "Z") {
        if (pts.length) pts.push({ ...pts[0] });
      }
      continue;
    }
    if ((cmd === "M" || cmd === "L") && i + 1 < tokens.length) {
      pushPt(num(tokens[i]), num(tokens[i + 1]));
      i += 2;
      if (cmd === "M") cmd = "L";
      continue;
    }
    i++;
  }
  return pts;
}

function pathHasUnsupportedTokens(pathStr) {
  const tokens = String(pathStr || "")
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean);
  for (const t of tokens) {
    if (/^[A-Za-z]$/.test(t)) {
      const c = t.toUpperCase();
      if (c !== "M" && c !== "L" && c !== "Z") return true;
    }
  }
  return false;
}

module.exports = {
  num,
  eeToMm,
  pxToMm,
  pxToMmGrid,
  snapPx,
  round2,
  PIN_TYPES,
  parsePin,
  parseRect,
  resolveOrigin,
  pinToMm,
  parsePolylinePoints,
  parsePathPoints,
  pathHasUnsupportedTokens,
  sanitizeName
};
