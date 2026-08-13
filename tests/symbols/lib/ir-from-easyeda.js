"use strict";

const {
  num,
  parsePin,
  parseRect,
  resolveOrigin,
  pinToMm,
  parsePolylinePoints,
  parsePathPoints,
  pathHasUnsupportedTokens,
  pxToMm,
  round2,
  sanitizeName
} = require("./units");

const HANDLED = new Set(["P", "R", "C", "E", "PL", "PG", "PT"]);

function normalizeComponent(component) {
  if (!component) return { dataStr: null, subparts: [] };
  if (component.dataStr) {
    return {
      dataStr: component.dataStr,
      subparts: Array.isArray(component.subparts) ? component.subparts : []
    };
  }
  // Bare dataStr object
  if (component.head || component.shape) {
    return { dataStr: component, subparts: [] };
  }
  return { dataStr: null, subparts: [] };
}

function unitDataStrs(component) {
  const { dataStr: parentDataStr, subparts } = normalizeComponent(component);
  if (!parentDataStr) return [];

  const fromSubparts = subparts
    .map((sp) => (sp && sp.dataStr ? sp.dataStr : null))
    .filter((ds) => ds && Array.isArray(ds.shape) && ds.shape.length > 0);

  return fromSubparts.length > 0 ? fromSubparts : [parentDataStr];
}

function buildUnitIr(dataStr, unitId, unitName) {
  const origin = resolveOrigin(dataStr, null);
  const shapes = Array.isArray(dataStr.shape) ? dataStr.shape : [];
  const pins = [];
  const graphics = [];
  const unhandled = {};
  const handledCounts = { R: 0, C: 0, E: 0, PL: 0, PG: 0, PT: 0, P: 0 };
  let visiblePinCount = 0;
  let hiddenPinCount = 0;
  let ptCurveCount = 0;

  const bumpUnhandled = (cmd) => {
    unhandled[cmd] = (unhandled[cmd] || 0) + 1;
  };

  for (const line of shapes) {
    if (typeof line !== "string") continue;
    const cmd = line.split("~")[0];

    if (cmd === "P") {
      handledCounts.P++;
      const pin = parsePin(line);
      if (!pin.visible) {
        hiddenPinCount++;
        pins.push({
          number: pin.number,
          name: pin.name,
          type: pin.type,
          easyedaType: pin.easyedaType,
          style: pin.style,
          visible: false,
          x_mm: 0,
          y_mm: 0,
          rotation_deg: 0,
          length_mm: 0
        });
        continue;
      }
      visiblePinCount++;
      const mm = pinToMm(pin, origin);
      pins.push({
        number: pin.number,
        name: pin.name,
        type: pin.type,
        easyedaType: pin.easyedaType,
        style: pin.style,
        visible: true,
        ...mm
      });
      continue;
    }

    if (cmd === "R") {
      handledCounts.R++;
      const r = parseRect(line);
      const x0 = round2(pxToMm(r.x - origin.x));
      const y0 = round2(-pxToMm(r.y - origin.y));
      const x1 = round2(x0 + pxToMm(r.w));
      const y1 = round2(y0 - pxToMm(r.h));
      graphics.push({
        kind: "rectangle",
        start: { x: x0, y: y0 },
        end: { x: x1, y: y1 },
        easyedaW: r.w,
        easyedaH: r.h
      });
      continue;
    }

    if (cmd === "C") {
      handledCounts.C++;
      const p = line.split("~");
      graphics.push({
        kind: "circle",
        center: {
          x: round2(pxToMm(num(p[1]) - origin.x)),
          y: round2(-pxToMm(num(p[2]) - origin.y))
        },
        radius: round2(pxToMm(num(p[3]))),
        fill: p[7] && p[7] !== "none" ? "background" : "none"
      });
      continue;
    }

    if (cmd === "E") {
      const p = line.split("~");
      const rx = num(p[3]);
      const ry = num(p[4]);
      if (Math.abs(rx - ry) > 0.01) {
        bumpUnhandled("E");
        continue;
      }
      handledCounts.E++;
      graphics.push({
        kind: "circle",
        center: {
          x: round2(pxToMm(num(p[1]) - origin.x)),
          y: round2(-pxToMm(num(p[2]) - origin.y))
        },
        radius: round2(pxToMm(rx)),
        fill: p[8] && p[8] !== "none" ? "background" : "none"
      });
      continue;
    }

    if (cmd === "PL" || cmd === "PG" || cmd === "PT") {
      const p = line.split("~");
      const hasCurves = cmd === "PT" && pathHasUnsupportedTokens(p[1]);
      const pts =
        cmd === "PT"
          ? parsePathPoints(p[1], origin.x, origin.y, true)
          : parsePolylinePoints(p[1], origin.x, origin.y, true);
      // Match convert.js: emit M/L/Z when ≥2 points; leftover curve ops are S3.
      if (pts.length < 2) {
        if (cmd === "PT") bumpUnhandled("PT");
        continue;
      }
      if (hasCurves) ptCurveCount++;
      handledCounts[cmd]++;
      const closed = cmd === "PG" || cmd === "PT";
      let fill = "none";
      if (cmd === "PG") fill = "background";
      else if (cmd === "PT") {
        const fillRaw = String(p[5] || "none").trim().toLowerCase();
        fill = fillRaw && fillRaw !== "none" ? "outline" : "none";
      }
      graphics.push({
        kind: "polyline",
        pts,
        closed,
        fill
      });
      continue;
    }

    if (cmd === "T") {
      bumpUnhandled("T");
      continue;
    }

    if (!HANDLED.has(cmd)) {
      bumpUnhandled(cmd || "UNKNOWN");
    }
  }

  return {
    id: unitId,
    name: unitName,
    pins,
    graphics,
    unhandled,
    handledCounts,
    visiblePinCount,
    hiddenPinCount,
    ptCurveCount
  };
}

/**
 * Parse EasyEDA symbol component into SymbolIR + unhandled accounting.
 */
function irFromEasyeda(component, meta = {}) {
  const { dataStr: parentDataStr } = normalizeComponent(component);
  if (!parentDataStr) {
    throw new Error("Symbol dataStr missing");
  }

  const head = parentDataStr.head || {};
  const para = (head && head.c_para) || {};
  const unitsDs = unitDataStrs(component);
  const multi = unitsDs.length > 1;

  const units = unitsDs.map((ds, i) => {
    const unitId = multi ? i + 1 : 0;
    const unitName = multi ? String.fromCharCode(65 + i) : "";
    return buildUnitIr(ds, unitId, unitName);
  });

  const unhandled = {};
  const handledCounts = { R: 0, C: 0, E: 0, PL: 0, PG: 0, PT: 0, P: 0 };
  let visiblePinCount = 0;
  let hiddenPinCount = 0;
  let ptCurveCount = 0;

  for (const u of units) {
    visiblePinCount += u.visiblePinCount;
    hiddenPinCount += u.hiddenPinCount;
    ptCurveCount += u.ptCurveCount || 0;
    for (const [k, v] of Object.entries(u.handledCounts)) {
      handledCounts[k] = (handledCounts[k] || 0) + v;
    }
    for (const [k, v] of Object.entries(u.unhandled)) {
      unhandled[k] = (unhandled[k] || 0) + v;
    }
  }

  const name =
    meta.name ||
    para.name ||
    para["Manufacturer Part"] ||
    meta.lcsc ||
    "SYMBOL";
  const prefix = String(para.pre || para.Reference || "U").replace("?", "") || "U";
  const packageName = sanitizeName(para.package || meta.package || name);
  const manufacturer = para.Manufacturer || para.BOM_Manufacturer || "";
  const mpn = para["Manufacturer Part"] || para["BOM_Manufacturer Part"] || "";
  const datasheet = para.Datasheet || "";

  const unhandledList = Object.entries(unhandled)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([cmd, count]) => ({ cmd, count }));
  const unhandledSummary = unhandledList.map(({ cmd, count }) => `${cmd}×${count}`).join(", ");

  const ir = {
    name: String(name),
    prefix,
    packageName: String(packageName),
    unitCount: units.length,
    properties: {
      lcsc: meta.lcsc || "",
      manufacturer,
      mpn,
      datasheet,
      footprint: `UnEasy-LCSC:${packageName}`
    },
    units: units.map((u) => ({
      id: u.id,
      name: u.name,
      pins: u.pins,
      graphics: u.graphics
    })),
    unhandled: unhandledList
  };

  return {
    ir,
    unhandled,
    unhandledSummary,
    handledCounts,
    visiblePinCount,
    hiddenPinCount,
    ptCurveCount,
    subpartCount: unitsDs.length
  };
}

module.exports = { irFromEasyeda, unitDataStrs, normalizeComponent, buildUnitIr };
