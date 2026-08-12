// EasyEDA dataStr → KiCad v6+ symbol/footprint exporters.
// Conversion rules follow the public EasyEDA command formats and the
// well-known EasyEDA↔KiCad unit/coordinate conventions used by easyeda2kicad.

(function (root) {
  "use strict";

  // Drop downloads into this tree under the browser Downloads folder, then
  // point KiCad path variable UNEASY_LCSC at that UnEasy-LCSC directory.
  const LIBRARY = {
    root: "UnEasy-LCSC",
    pathVar: "UNEASY_LCSC",
    symdir: "UnEasy-LCSC.kicad_symdir",
    pretty: "UnEasy-LCSC.pretty",
    shapes3d: "UnEasy-LCSC.3dshapes",
    easyeda: "easyeda"
  };

  const PIN_TYPES = {
    0: "unspecified",
    1: "input",
    2: "output",
    3: "bidirectional",
    4: "power_in"
  };

  const PAD_SHAPE = {
    ELLIPSE: "circle",
    RECT: "rect",
    OVAL: "oval",
    POLYGON: "custom"
  };

  const PAD_LAYER_SMD = {
    1: "F.Cu F.Paste F.Mask",
    2: "B.Cu B.Paste B.Mask",
    11: "*.Cu *.Paste *.Mask"
  };

  const PAD_LAYER_THT = {
    1: "F.Cu F.Mask",
    2: "B.Cu B.Mask",
    11: "*.Cu *.Mask"
  };

  const FP_LAYERS = {
    1: "F.Cu",
    2: "B.Cu",
    3: "F.SilkS",
    4: "B.SilkS",
    5: "F.Paste",
    6: "B.Paste",
    7: "F.Mask",
    8: "B.Mask",
    10: "Edge.Cuts",
    12: "Cmts.User",
    13: "F.Fab",
    14: "B.Fab",
    15: "Dwgs.User",
    99: "F.CrtYd",
    100: "F.Fab",
    101: "F.SilkS"
  };

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

  function esc(s) {
    return String(s ?? "")
      .replace(/\\/g, "\\\\")
      .replace(/"/g, '\\"');
  }

  function sanitizeName(s) {
    return String(s || "part")
      .replace(/[\\/:*?"<>|\s]+/g, "_")
      .replace(/_+/g, "_")
      .replace(/^_|_$/g, "") || "part";
  }

  function cPara(head) {
    return (head && head.c_para) || {};
  }

  function parsePin(line) {
    const segs = line.split("^^").map((s) => s.split("~"));
    const settings = segs[0] || [];
    // settings: P~vis~type~spice~x~y~rot~id~locked
    const pinNum =
      segs[4] && segs[4][4] != null && segs[4][4] !== ""
        ? segs[4][4]
        : settings[3] || "";
    const name = (segs[3] && segs[3][4]) || pinNum || "PIN";
    const path = (segs[2] && segs[2][0]) || "";
    let lengthPx = 10;
    const hm = path.replace(/v/gi, "h").match(/h\s*(-?[\d.]+)/i);
    if (hm) lengthPx = Math.abs(num(hm[1], 10));

    const dotShown = segs[5] && ["1", "true", "show"].includes(String(segs[5][0]).toLowerCase());
    const clockShown = segs[6] && ["1", "true", "show"].includes(String(segs[6][0]).toLowerCase());
    let style = "line";
    if (dotShown && clockShown) style = "inverted_clock";
    else if (dotShown) style = "inverted";
    else if (clockShown) style = "clock";

    return {
      visible: String(settings[1] || "show").toLowerCase() !== "hide",
      type: PIN_TYPES[num(settings[2], 0)] || "unspecified",
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
    // EasyEDA rectangle forms (symbol/footprint):
    //   R~x~y~rx~ry~w~h~...     (rx/ry may be "" for sharp corners → "~~~")
    //   R~x~y~~w~h~...          (single empty slot, older docs)
    //   R~x~y~w~h~color~...     (no radius slots)
    const p = line.split("~");
    const isNumField = (s) => s !== "" && s != null && Number.isFinite(Number(s));

    // Prefer w/h in the rx/ry layout when those slots parse as numbers.
    if (isNumField(p[5]) && isNumField(p[6])) {
      return { x: num(p[1]), y: num(p[2]), w: num(p[5]), h: num(p[6]) };
    }
    // R~x~y~~w~h~color...
    if (p[3] === "" && isNumField(p[4]) && isNumField(p[5])) {
      return { x: num(p[1]), y: num(p[2]), w: num(p[4]), h: num(p[5]) };
    }
    // R~x~y~w~h~color...
    if (isNumField(p[3]) && isNumField(p[4])) {
      return { x: num(p[1]), y: num(p[2]), w: num(p[3]), h: num(p[4]) };
    }
    return { x: num(p[1]), y: num(p[2]), w: num(p[5]), h: num(p[6]) };
  }

  function parsePolylinePoints(pointsStr, ox, oy, flipY) {
    const vals = String(pointsStr || "")
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(num);
    const pts = [];
    for (let i = 0; i + 1 < vals.length; i += 2) {
      const x = pxToMm(vals[i] - ox);
      const y = flipY ? -pxToMm(vals[i + 1] - oy) : pxToMm(vals[i + 1] - oy);
      pts.push([x, y]);
    }
    return pts;
  }

  // EasyEDA PT~ uses SVG-like path data, e.g. "M 405 283 L 395 290 L 405 297 Z"
  // (diode/LED triangles, arrow heads). M/L/Z cover the common schematic cases.
  function parsePathPoints(pathStr, ox, oy, flipY) {
    const tokens = String(pathStr || "")
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean);
    const pts = [];
    let i = 0;
    let cmd = null;
    const pushPt = (xPx, yPx) => {
      const x = pxToMm(xPx - ox);
      const y = flipY ? -pxToMm(yPx - oy) : pxToMm(yPx - oy);
      pts.push([x, y]);
    };
    while (i < tokens.length) {
      const t = tokens[i];
      if (/^[A-Za-z]$/.test(t)) {
        cmd = t.toUpperCase();
        i++;
        if (cmd === "Z") {
          if (pts.length) pts.push(pts[0]);
        }
        continue;
      }
      if ((cmd === "M" || cmd === "L") && i + 1 < tokens.length) {
        pushPt(num(tokens[i]), num(tokens[i + 1]));
        i += 2;
        // SVG: extra coordinate pairs after M are implicit LineTos.
        if (cmd === "M") cmd = "L";
        continue;
      }
      // Skip unsupported absolute commands' leftovers conservatively.
      i++;
    }
    return pts;
  }

  function normalizeDataStr(dataStr) {
    if (!dataStr) return null;
    if (typeof dataStr === "string") {
      try {
        return JSON.parse(dataStr);
      } catch {
        return null;
      }
    }
    return dataStr;
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

  function buildUnitGraphics(dataStr, origin) {
    const shapes = Array.isArray(dataStr.shape) ? dataStr.shape : [];
    const pins = [];
    const graphics = [];
    const originX = origin.x;
    const originY = origin.y;

    for (const line of shapes) {
      if (typeof line !== "string") continue;
      const cmd = line.split("~")[0];

      if (cmd === "P") {
        const pin = parsePin(line);
        if (!pin.visible) continue;
        pins.push(pin);
        const orient = (180 + pin.rotation) % 360;
        graphics.push(`            (pin ${pin.type} ${pin.style}
              (at ${pxToMmGrid(pin.x - originX).toFixed(2)} ${(-pxToMmGrid(pin.y - originY)).toFixed(2)} ${orient})
              (length ${pxToMmGrid(pin.lengthPx).toFixed(2)})
              (name "${esc(pin.name)}" (effects (font (size 1.27 1.27))))
              (number "${esc(pin.number)}" (effects (font (size 1.27 1.27))))
            )`);
      } else if (cmd === "R") {
        const r = parseRect(line);
        const x0 = pxToMm(r.x - originX);
        const y0 = -pxToMm(r.y - originY);
        const x1 = x0 + pxToMm(r.w);
        const y1 = y0 - pxToMm(r.h);
        graphics.push(`            (rectangle
              (start ${x0.toFixed(2)} ${y0.toFixed(2)})
              (end ${x1.toFixed(2)} ${y1.toFixed(2)})
              (stroke (width 0.254) (type default))
              (fill (type background))
            )`);
      } else if (cmd === "C") {
        const p = line.split("~");
        const cx = pxToMm(num(p[1]) - originX);
        const cy = -pxToMm(num(p[2]) - originY);
        const rad = pxToMm(num(p[3]));
        const fill = p[7] && p[7] !== "none" ? "background" : "none";
        graphics.push(`            (circle
              (center ${cx.toFixed(2)} ${cy.toFixed(2)})
              (radius ${rad.toFixed(2)})
              (stroke (width 0.254) (type default))
              (fill (type ${fill}))
            )`);
      } else if (cmd === "E") {
        const p = line.split("~");
        const rx = num(p[3]);
        const ry = num(p[4]);
        if (Math.abs(rx - ry) > 0.01) continue;
        const cx = pxToMm(num(p[1]) - originX);
        const cy = -pxToMm(num(p[2]) - originY);
        const rad = pxToMm(rx);
        const fill = p[8] && p[8] !== "none" ? "background" : "none";
        graphics.push(`            (circle
              (center ${cx.toFixed(2)} ${cy.toFixed(2)})
              (radius ${rad.toFixed(2)})
              (stroke (width 0.254) (type default))
              (fill (type ${fill}))
            )`);
      } else if (cmd === "PL" || cmd === "PG" || cmd === "PT") {
        const p = line.split("~");
        // PL/PG: space-separated points. PT: SVG path in field 1 (LED/diode bodies).
        const pts =
          cmd === "PT"
            ? parsePathPoints(p[1], originX, originY, true)
            : parsePolylinePoints(p[1], originX, originY, true);
        if (pts.length < 2) continue;
        const closed = cmd === "PG" || cmd === "PT";
        if (closed && pts.length) {
          const a = pts[0];
          const b = pts[pts.length - 1];
          if (a[0] !== b[0] || a[1] !== b[1]) pts.push(a);
        }
        let fill = "none";
        if (cmd === "PG") {
          fill = "background";
        } else if (cmd === "PT") {
          // PT~path~stroke~width~?~fill~id~
          const fillRaw = String(p[5] || "none").trim().toLowerCase();
          fill = fillRaw && fillRaw !== "none" ? "outline" : "none";
        }
        graphics.push(`            (polyline
              (pts
                ${pts.map(([x, y]) => `(xy ${x.toFixed(2)} ${y.toFixed(2)})`).join(" ")}
              )
              (stroke (width 0.254) (type default))
              (fill (type ${fill}))
            )`);
      }
    }

    return { pins, graphics };
  }

  function exportSymbol(dataStr, meta = {}) {
    return exportSymbolFromComponent({ dataStr, subparts: meta.subparts || [] }, meta);
  }

  function exportSymbolFromComponent(component, meta = {}) {
    const parentDataStr = normalizeDataStr(component && component.dataStr);
    if (!parentDataStr) {
      throw new Error("Symbol dataStr missing.");
    }

    const rawSubparts = Array.isArray(component.subparts) ? component.subparts : [];
    const unitDataStrs = rawSubparts
      .map((sp) => normalizeDataStr(sp && sp.dataStr))
      .filter((ds) => ds && Array.isArray(ds.shape) && ds.shape.length > 0);

    // Multi-unit EasyEDA symbols keep graphics in subparts; parent shape is often empty.
    const units =
      unitDataStrs.length > 0
        ? unitDataStrs
        : [parentDataStr];

    const multi = units.length > 1;

    const head = parentDataStr.head || {};
    const para = cPara(head);
    const name = sanitizeName(
      meta.name || para.name || para["Manufacturer Part"] || meta.lcsc || "SYMBOL"
    );
    const prefix = String(para.pre || para.Reference || "U").replace("?", "") || "U";
    const packageName = sanitizeName(para.package || meta.package || name);
    const manufacturer = para.Manufacturer || para.BOM_Manufacturer || "";
    const mpn = para["Manufacturer Part"] || para["BOM_Manufacturer Part"] || "";
    const datasheet = para.Datasheet || "";

    // Each KiCad unit is placed independently, so each subpart must be centered
    // on its own origin. A shared EasyEDA canvas origin leaves unit B far off
    // to the side and looks "empty" when selected.
    const builtUnits = units.map((unitDs) => {
      const origin = resolveOrigin(unitDs, null);
      return { ...buildUnitGraphics(unitDs, origin), origin };
    });

    const allPins = builtUnits.flatMap((u) => u.pins);
    const yLow = allPins.length
      ? Math.min(
          ...builtUnits.flatMap((u) =>
            u.pins.map((p) => -pxToMmGrid(p.y - u.origin.y))
          )
        )
      : 0;

    const props = [
      `      (property "Reference" "${esc(prefix)}" (at 0 ${(yLow - 1.27).toFixed(2)} 0)`,
      `        (effects (font (size 1.27 1.27))))`,
      `      (property "Value" "${esc(name)}" (at 0 ${(yLow - 2.54).toFixed(2)} 0)`,
      `        (effects (font (size 1.27 1.27))))`,
      `      (property "Footprint" "${esc("UnEasy-LCSC:" + packageName)}" (at 0 ${(yLow - 3.81).toFixed(2)} 0)`,
      `        (effects (font (size 1.27 1.27)) hide))`,
      `      (property "Datasheet" "${esc(datasheet)}" (at 0 ${(yLow - 5.08).toFixed(2)} 0)`,
      `        (effects (font (size 1.27 1.27)) hide))`,
      `      (property "LCSC Part" "${esc(meta.lcsc || "")}" (at 0 ${(yLow - 6.35).toFixed(2)} 0)`,
      `        (effects (font (size 1.27 1.27)) hide))`,
      `      (property "Manufacturer" "${esc(manufacturer)}" (at 0 ${(yLow - 7.62).toFixed(2)} 0)`,
      `        (effects (font (size 1.27 1.27)) hide))`,
      `      (property "MPN" "${esc(mpn)}" (at 0 ${(yLow - 8.89).toFixed(2)} 0)`,
      `        (effects (font (size 1.27 1.27)) hide))`
    ].join("\n");

    const unitBlocks = builtUnits
      .map((unit, i) => {
        const unitId = multi ? i + 1 : 0;
        // KiCad unit display names are letters (Unit A / Unit B), not EasyEDA's ".1"/".2".
        const unitName = multi ? String.fromCharCode(65 + i) : "";
        const unitNameTok =
          multi && unitName
            ? `\n      (unit_name "${esc(unitName)}")`
            : "";
        return `    (symbol "${esc(name)}_${unitId}_1"${unitNameTok}
${unit.graphics.join("\n")}
    )`;
      })
      .join("\n");

    const body = `  (symbol "${esc(name)}"
    (in_bom yes)
    (on_board yes)
${props}
${unitBlocks}
  )`;

    const file =
      `(kicad_symbol_lib (version 20211014) (generator UnEasy-LCSC)\n` +
      `${body}\n)\n`;

    return {
      filename: `${name}.kicad_sym`,
      content: file,
      symbolName: name,
      packageName,
      unitCount: units.length,
      pinCount: allPins.length
    };
  }

  function angleToKi(rotation) {
    const r = num(rotation);
    if (!Number.isFinite(r)) return 0;
    return r > 180 ? -(360 - r) : r;
  }

  function drillStr(holeRadius, holeLength, padH, padW) {
    if (holeRadius > 0 && holeLength) {
      const maxHole = Math.max(holeRadius * 2, holeLength);
      const pos0 = padH - maxHole;
      const pos90 = padW - maxHole;
      if (pos0 >= pos90) return ` (drill oval ${(holeRadius * 2).toFixed(3)} ${holeLength.toFixed(3)})`;
      return ` (drill oval ${holeLength.toFixed(3)} ${(holeRadius * 2).toFixed(3)})`;
    }
    if (holeRadius > 0) return ` (drill ${(2 * holeRadius).toFixed(3)})`;
    return "";
  }

  function exportFootprint(dataStr, meta = {}) {
    const head = dataStr.head || {};
    const para = cPara(head);
    const shapes = Array.isArray(dataStr.shape) ? dataStr.shape : [];

    const bboxX = eeToMm(num(head.x));
    const bboxY = eeToMm(num(head.y));
    const name = sanitizeName(para.package || meta.package || meta.name || meta.lcsc || "FOOTPRINT");
    // Footprint packages rarely carry MPN; prefer values passed from the symbol.
    const manufacturer =
      meta.manufacturer || para.Manufacturer || para.BOM_Manufacturer || "";
    const mpn =
      meta.mpn ||
      para["Manufacturer Part"] ||
      para["BOM_Manufacturer Part"] ||
      "";
    const isSmd =
      meta.isSmd != null
        ? !!meta.isSmd
        : !String(para.package || name).includes("-TH_");

    const lines = [];
    lines.push(`(module UnEasy-LCSC:${name} (layer F.Cu) (tedit 5DC5F6A4)`);
    if (meta.lcsc || manufacturer || mpn) {
      const descr = [meta.lcsc, manufacturer, mpn].filter(Boolean).join(", ");
      lines.push(`\t(descr "${esc(descr)}, generated with UnEasy-LCSC")`);
    }
    lines.push(`\t(attr ${isSmd ? "smd" : "through_hole"})`);

    const padsY = [];
    const padBlocks = [];
    const graphicBlocks = [];
    let model3d = null;

    for (const line of shapes) {
      if (typeof line !== "string") continue;
      const p = line.split("~");
      const cmd = p[0];

      if (cmd === "PAD") {
        const shape = PAD_SHAPE[p[1]] || "custom";
        const cx = eeToMm(p[2]) - bboxX;
        const cy = eeToMm(p[3]) - bboxY;
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
        const layers = (tht ? PAD_LAYER_THT : PAD_LAYER_SMD)[layerId] || (tht ? "*.Cu *.Mask" : "F.Cu F.Paste F.Mask");
        let polygon = "";
        let orientation = rot;
        let outShape = shape;

        if (shape === "custom") {
          const pts = String(p[10] || "")
            .trim()
            .split(/[\s,]+/)
            .filter(Boolean)
            .map(eeToMm);
          if (pts.length >= 6) {
            w = 0.005;
            h = 0.005;
            orientation = 0;
            let path = "";
            for (let i = 0; i + 1 < pts.length; i += 2) {
              path += `(xy ${(pts[i] - bboxX - cx).toFixed(6)} ${(pts[i + 1] - bboxY - cy).toFixed(6)}) `;
            }
            polygon =
              "\n\t\t(primitives \n\t\t\t(gr_poly \n\t\t\t\t(pts " +
              path +
              "\n\t\t\t\t) \n\t\t\t\t(width 0.1) \n\t\t\t)\n\t\t)\n\t";
          } else {
            outShape = "rect";
          }
        }

        padsY.push(cy);
        padBlocks.push(
          `\t(pad ${esc(number) || '""'} ${tht ? "thru_hole" : "smd"} ${outShape} (at ${cx.toFixed(2)} ${cy.toFixed(2)} ${orientation.toFixed(2)}) (size ${w.toFixed(3)} ${h.toFixed(3)}) (layers ${layers})${drillStr(holeR, holeLen, h, w)}${polygon})`
        );
      } else if (cmd === "TRACK") {
        const width = Math.max(eeToMm(p[1]), 0.01);
        const layer = FP_LAYERS[num(p[2])] || "F.Fab";
        const pts = String(p[4] || "")
          .trim()
          .split(/[\s,]+/)
          .filter(Boolean)
          .map(eeToMm);
        for (let i = 0; i + 3 < pts.length; i += 2) {
          graphicBlocks.push(
            `\t(fp_line (start ${(pts[i] - bboxX).toFixed(2)} ${(pts[i + 1] - bboxY).toFixed(2)}) (end ${(pts[i + 2] - bboxX).toFixed(2)} ${(pts[i + 3] - bboxY).toFixed(2)}) (layer ${layer}) (width ${width.toFixed(2)}))`
          );
        }
      } else if (cmd === "RECT") {
        const x = eeToMm(p[1]) - bboxX;
        const y = eeToMm(p[2]) - bboxY;
        const w = eeToMm(p[3]);
        const h = eeToMm(p[4]);
        const layer = FP_LAYERS[num(p[5])] || "F.SilkS";
        const width = Math.max(eeToMm(p[8] || 1), 0.01);
        const x2 = x + w;
        const y2 = y + h;
        graphicBlocks.push(
          `\t(fp_line (start ${x.toFixed(2)} ${y.toFixed(2)}) (end ${x2.toFixed(2)} ${y.toFixed(2)}) (layer ${layer}) (width ${width.toFixed(2)}))`
        );
        graphicBlocks.push(
          `\t(fp_line (start ${x2.toFixed(2)} ${y.toFixed(2)}) (end ${x2.toFixed(2)} ${y2.toFixed(2)}) (layer ${layer}) (width ${width.toFixed(2)}))`
        );
        graphicBlocks.push(
          `\t(fp_line (start ${x2.toFixed(2)} ${y2.toFixed(2)}) (end ${x.toFixed(2)} ${y2.toFixed(2)}) (layer ${layer}) (width ${width.toFixed(2)}))`
        );
        graphicBlocks.push(
          `\t(fp_line (start ${x.toFixed(2)} ${y2.toFixed(2)}) (end ${x.toFixed(2)} ${y.toFixed(2)}) (layer ${layer}) (width ${width.toFixed(2)}))`
        );
      } else if (cmd === "CIRCLE") {
        const cx = eeToMm(p[1]) - bboxX;
        const cy = eeToMm(p[2]) - bboxY;
        const r = eeToMm(p[3]);
        const width = Math.max(eeToMm(p[4]), 0.01);
        const layer = FP_LAYERS[num(p[5])] || "F.Fab";
        graphicBlocks.push(
          `\t(fp_circle (center ${cx.toFixed(2)} ${cy.toFixed(2)}) (end ${(cx + r).toFixed(2)} ${cy.toFixed(2)}) (layer ${layer}) (width ${width.toFixed(2)}))`
        );
      } else if (cmd === "HOLE") {
        const cx = eeToMm(p[1]) - bboxX;
        const cy = eeToMm(p[2]) - bboxY;
        const size = eeToMm(p[3]) * 2;
        graphicBlocks.push(
          `\t(pad "" thru_hole circle (at ${cx.toFixed(2)} ${cy.toFixed(2)}) (size ${size.toFixed(2)} ${size.toFixed(2)}) (drill ${size.toFixed(2)}) (layers *.Cu *.Mask))`
        );
      } else if (cmd === "VIA") {
        const cx = eeToMm(p[1]) - bboxX;
        const cy = eeToMm(p[2]) - bboxY;
        const diameter = eeToMm(p[3]);
        const size = eeToMm(p[5]) * 2;
        graphicBlocks.push(
          `\t(pad "" thru_hole circle (at ${cx.toFixed(2)} ${cy.toFixed(2)}) (size ${diameter.toFixed(2)} ${diameter.toFixed(2)}) (drill ${size.toFixed(2)}) (layers *.Cu *.Paste *.Mask))`
        );
      } else if (cmd === "SVGNODE") {
        try {
          const node = JSON.parse(line.slice("SVGNODE~".length));
          const attrs = node && node.attrs;
          if (attrs && attrs.uuid) {
            const title = sanitizeName(attrs.title || para["3DModel"] || name);
            const rot = String(attrs.c_rotation || "0,0,0").split(",");
            model3d = {
              title,
              uuid: attrs.uuid,
              rx: (360 - num(rot[0])) % 360,
              ry: (360 - num(rot[1])) % 360,
              rz: (360 - num(rot[2])) % 360
            };
          }
        } catch (_) {}
      }
    }

    const yLow = padsY.length ? Math.min(...padsY) : 0;
    const yHigh = padsY.length ? Math.max(...padsY) : 0;
    lines.push(
      `\t(fp_text reference REF** (at 0.000 ${(yLow - 4).toFixed(3)}) (layer F.SilkS)\n\t\t(effects (font (size 1 1) (thickness 0.15)))\n\t)`
    );
    lines.push(
      `\t(fp_text value ${name} (at 0.000 ${(yHigh + 4).toFixed(3)}) (layer F.Fab)\n\t\t(effects (font (size 1 1) (thickness 0.15)))\n\t)`
    );
    lines.push(
      `\t(fp_text user %R (at 0 0) (layer F.Fab)\n\t\t(effects (font (size 1 1) (thickness 0.15)))\n\t)`
    );
    if (meta.lcsc) lines.push(`\t(property "LCSC Part" "${esc(meta.lcsc)}")`);
    if (manufacturer) lines.push(`\t(property "Manufacturer" "${esc(manufacturer)}")`);
    if (mpn) lines.push(`\t(property "MPN" "${esc(mpn)}")`);

    lines.push(...graphicBlocks);
    lines.push(...padBlocks);

    let stepFilename = null;
    let stepModelPath = null;
    if (model3d) {
      const rawStep =
        meta.stepFilename || `${meta.lcsc || "part"}_${model3d.title}.step`;
      stepFilename = String(rawStep).split(/[/\\]/).pop();
      stepModelPath = `\${${LIBRARY.pathVar}}/${LIBRARY.shapes3d}/${stepFilename}`;
      lines.push(
        `\t(model "${esc(stepModelPath)}"\n\t\t(offset (xyz 0.000 0.000 0.000))\n\t\t(scale (xyz 1 1 1))\n\t\t(rotate (xyz ${model3d.rx.toFixed(0)} ${model3d.ry.toFixed(0)} ${model3d.rz.toFixed(0)}))\n\t)`
      );
    }

    lines.push(")");
    return {
      filename: `${name}.kicad_mod`,
      content: lines.join("\n") + "\n",
      packageName: name,
      model3d,
      stepFilename,
      stepModelPath
    };
  }

  function manufacturerMpnFromSymbol(symbolSource) {
    if (!symbolSource) return { manufacturer: "", mpn: "" };
    const ds = normalizeDataStr(symbolSource.dataStr) || {};
    const para = cPara(ds.head || {});
    return {
      manufacturer: para.Manufacturer || para.BOM_Manufacturer || "",
      mpn: para["Manufacturer Part"] || para["BOM_Manufacturer Part"] || ""
    };
  }

  function convertEasyedaToKicad({
    symbolDataStr,
    symbolComponent,
    footprintDataStr,
    lcsc,
    name
  }) {
    const result = { symbol: null, footprint: null };
    let packageName = null;

    const symbolSource =
      symbolComponent ||
      (symbolDataStr ? { dataStr: symbolDataStr, subparts: [] } : null);
    const fromSym = manufacturerMpnFromSymbol(symbolSource);

    if (footprintDataStr) {
      result.footprint = exportFootprint(footprintDataStr, {
        lcsc,
        name,
        package: name,
        manufacturer: fromSym.manufacturer,
        mpn: fromSym.mpn
      });
      packageName = result.footprint.packageName;
    }

    if (symbolSource) {
      result.symbol = exportSymbolFromComponent(symbolSource, {
        lcsc,
        name,
        package: packageName || name
      });
      if (result.footprint && result.symbol.packageName) {
        const pkg = result.symbol.packageName;
        if (pkg && result.footprint.packageName !== pkg) {
          result.footprint = exportFootprint(footprintDataStr, {
            lcsc,
            name: pkg,
            package: pkg,
            manufacturer: fromSym.manufacturer,
            mpn: fromSym.mpn,
            stepFilename: result.footprint.stepFilename || undefined
          });
        }
      }
    }

    return result;
  }

  function libraryPath(kind, filename) {
    const base = String(filename || "").split(/[/\\]/).pop();
    if (kind === "symbol") return `${LIBRARY.root}/${LIBRARY.symdir}/${base}`;
    if (kind === "footprint") return `${LIBRARY.root}/${LIBRARY.pretty}/${base}`;
    if (kind === "step") return `${LIBRARY.root}/${LIBRARY.shapes3d}/${base}`;
    if (kind === "easyeda") return `${LIBRARY.root}/${LIBRARY.easyeda}/${base}`;
    return `${LIBRARY.root}/${base}`;
  }

  root.UnEasyKicad = {
    LIBRARY,
    libraryPath,
    convertEasyedaToKicad,
    exportSymbol,
    exportSymbolFromComponent,
    exportFootprint,
    sanitizeName
  };
})(typeof globalThis !== "undefined" ? globalThis : window);
