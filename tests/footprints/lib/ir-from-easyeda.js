"use strict";

const {
  num,
  eeToMm,
  angleToKi,
  PAD_SHAPE,
  PAD_LAYER_SMD,
  PAD_LAYER_THT,
  normalizeLayers,
  electricalBbox,
  round6
} = require("./units");

const HANDLED = new Set([
  "PAD",
  "TRACK",
  "RECT",
  "CIRCLE",
  "HOLE",
  "VIA",
  "SVGNODE",
  "ARC",
  "SOLIDREGION",
  "TEXT"
]);

/**
 * Parse EasyEDA footprint dataStr into FootprintIR + unhandled command accounting.
 * Coordinate rules mirror exportFootprint in convert.js (origin = head.x/y, no Y-flip).
 */
function irFromEasyeda(dataStr, meta = {}) {
  const head = (dataStr && dataStr.head) || {};
  const para = (head && head.c_para) || {};
  const shapes = Array.isArray(dataStr && dataStr.shape) ? dataStr.shape : [];
  const bboxX = eeToMm(num(head.x));
  const bboxY = eeToMm(num(head.y));
  const name =
    para.package || meta.package || meta.name || meta.lcsc || "FOOTPRINT";

  const isSmd =
    meta.isSmd != null
      ? !!meta.isSmd
      : !String(para.package || name).includes("-TH_");

  const pads = [];
  const holes = [];
  const unhandled = {};
  let padCommandCount = 0;
  let hasSvgNode = false;
  let model3dPath = null;
  let solidRegionCopper = 0;

  for (const line of shapes) {
    if (typeof line !== "string") continue;
    const p = line.split("~");
    const cmd = p[0];

    if (cmd === "PAD") {
      padCommandCount++;
      const shapeRaw = p[1];
      let shape = PAD_SHAPE[shapeRaw] || "polygon";
      const cx = round6(eeToMm(p[2]) - bboxX);
      const cy = round6(eeToMm(p[3]) - bboxY);
      let w = Math.max(eeToMm(p[4]), 0.01);
      let h = Math.max(eeToMm(p[5]), 0.01);
      const layerId = num(p[6], 1);
      let number = p[8] || "";
      if (number.includes("(") && number.includes(")")) {
        number = number.split("(")[1].split(")")[0];
      }
      const holeR = eeToMm(p[9]);
      const rot = angleToKi(p[11]);
      const holeLen = eeToMm(p[13]);
      const tht = holeR > 0;
      const layerMap = tht ? PAD_LAYER_THT : PAD_LAYER_SMD;
      const layers = normalizeLayers(
        layerMap[layerId] || (tht ? ["*.Cu", "*.Mask"] : ["F.Cu", "F.Paste", "F.Mask"])
      );

      let polygon_mm = null;
      let orientation = rot;
      if (shape === "polygon") {
        const pts = String(p[10] || "")
          .trim()
          .split(/[\s,]+/)
          .filter(Boolean)
          .map(eeToMm);
        if (pts.length >= 6) {
          w = 0.005;
          h = 0.005;
          orientation = 0;
          polygon_mm = [];
          for (let i = 0; i + 1 < pts.length; i += 2) {
            polygon_mm.push({
              x: round6(pts[i] - bboxX),
              y: round6(pts[i + 1] - bboxY)
            });
          }
        } else {
          shape = "rect";
        }
      }

      const pad = {
        number: String(number),
        type: tht ? "thru_hole" : "smd",
        shape,
        center_mm: { x: cx, y: cy },
        size_mm: { w: round6(w), h: round6(h) },
        rotation_deg: round6(orientation),
        layers,
        polygon_mm
      };

      if (tht) {
        if (holeLen > 0) {
          // Match convert.js drillStr oval axis assignment
          const maxHole = Math.max(holeR * 2, holeLen);
          const pos0 = h - maxHole;
          const pos90 = w - maxHole;
          if (pos0 >= pos90) {
            pad.drill_mm = {
              oval_w: round6(holeR * 2),
              oval_h: round6(holeLen),
              orientation: 0
            };
          } else {
            pad.drill_mm = {
              oval_w: round6(holeLen),
              oval_h: round6(holeR * 2),
              orientation: 0
            };
          }
        } else {
          pad.drill_mm = { dia: round6(holeR * 2) };
        }
      }

      pads.push(pad);
      continue;
    }

    if (cmd === "HOLE") {
      const cx = round6(eeToMm(p[1]) - bboxX);
      const cy = round6(eeToMm(p[2]) - bboxY);
      const dia = round6(eeToMm(p[3]) * 2);
      holes.push({ center_mm: { x: cx, y: cy }, dia_mm: dia });
      // Exporter also emits an unnamed thru_hole pad for HOLE
      pads.push({
        number: "",
        type: "npth",
        shape: "circle",
        center_mm: { x: cx, y: cy },
        size_mm: { w: dia, h: dia },
        rotation_deg: 0,
        drill_mm: { dia },
        layers: normalizeLayers(["*.Cu", "*.Mask"]),
        polygon_mm: null,
        _fromHole: true
      });
      continue;
    }

    if (cmd === "VIA") {
      const cx = round6(eeToMm(p[1]) - bboxX);
      const cy = round6(eeToMm(p[2]) - bboxY);
      const diameter = round6(eeToMm(p[3]));
      const drill = round6(eeToMm(p[5]) * 2);
      pads.push({
        number: "",
        type: "thru_hole",
        shape: "circle",
        center_mm: { x: cx, y: cy },
        size_mm: { w: diameter, h: diameter },
        rotation_deg: 0,
        drill_mm: { dia: drill },
        layers: normalizeLayers(["*.Cu", "*.Paste", "*.Mask"]),
        polygon_mm: null,
        _fromVia: true
      });
      continue;
    }

    if (cmd === "SVGNODE") {
      hasSvgNode = true;
      try {
        const node = JSON.parse(line.slice("SVGNODE~".length));
        const attrs = node && node.attrs;
        if (attrs && attrs.uuid) {
          model3dPath = attrs.title || para["3DModel"] || name;
        }
      } catch (_) {
        /* ignore */
      }
      continue;
    }

    if (
      cmd === "TRACK" ||
      cmd === "RECT" ||
      cmd === "CIRCLE" ||
      cmd === "ARC" ||
      cmd === "TEXT" ||
      cmd === "SOLIDREGION"
    ) {
      // Handled by exporter as graphics (SOLIDREGION may intentionally skip
      // paste/decorative layers 5/6/100/101; layer 11 multi-layer fill is not emitted).
      if (cmd === "SOLIDREGION") {
        const layerId = num(p[1], -1);
        // Layer 11 has no valid single graphic copper layer in KiCad footprints.
        if (layerId === 11) solidRegionCopper++;
      }
      continue;
    }

    // Unhandled
    unhandled[cmd] = (unhandled[cmd] || 0) + 1;
  }

  // For H1 pad-count compares: reference counts electrical pads the same way DUT does.
  // DUT emits HOLE/VIA as pads; EasyEDA IR includes them above. Numbered PAD~ only for H11.
  const electricalPads = pads.filter((p) => !p._fromHole || true);

  const ir = {
    name: String(name),
    pads: electricalPads.map((p) => {
      const { _fromHole, _fromVia, ...rest } = p;
      // Normalize HOLE pads to thru_hole to match KiCad exporter (which uses thru_hole not npth)
      if (_fromHole) {
        rest.type = "thru_hole";
      }
      return rest;
    }),
    holes: holes.map((h) => ({ ...h })),
    bbox_mm: electricalBbox(
      electricalPads.map((p) => {
        const { _fromHole, _fromVia, ...rest } = p;
        return rest;
      }),
      holes
    ),
    attributes: { smd: isSmd, through_hole: !isSmd },
    model3d_path: model3dPath
  };

  return {
    ir,
    padCommandCount,
    unhandled,
    hasSvgNode,
    solidRegionCopper,
    unhandledSummary: formatUnhandled(unhandled)
  };
}

function formatUnhandled(unhandled) {
  const keys = Object.keys(unhandled).sort();
  if (!keys.length) return "";
  return keys.map((k) => `${k}×${unhandled[k]}`).join(", ");
}

module.exports = { irFromEasyeda, formatUnhandled, HANDLED };
