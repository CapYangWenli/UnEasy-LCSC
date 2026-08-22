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

  function flag01(v) {
    return v === true || v === 1 || v === "1";
  }

  // EasyEDA A~ path: "M sx sy A rx ry rot large sweep ex ey"
  function parseSymbolArcPath(pathStr) {
    const tokens = String(pathStr || "")
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean);
    let i = 0;
    let sx;
    let sy;
    while (i < tokens.length) {
      const t = tokens[i];
      if (/^[A-Za-z]$/.test(t)) {
        const cmdA = t.toUpperCase();
        i++;
        if (cmdA === "M" && i + 1 < tokens.length) {
          sx = num(tokens[i]);
          sy = num(tokens[i + 1]);
          i += 2;
          continue;
        }
        if (cmdA === "A" && sx != null && i + 6 < tokens.length) {
          return {
            sx,
            sy,
            rx: num(tokens[i]),
            ry: num(tokens[i + 1]),
            rot: num(tokens[i + 2]),
            large: tokens[i + 3],
            sweep: tokens[i + 4],
            ex: num(tokens[i + 5]),
            ey: num(tokens[i + 6])
          };
        }
        continue;
      }
      i++;
    }
    return null;
  }

  // SVG elliptical-arc midpoint in EasyEDA pixel space (W3C SVG 1.1 §F.6).
  function svgArcMidPoint(sx, sy, ex, ey, rx, ry, xRotationDeg, largeArcFlag, sweepFlag) {
    const large = flag01(largeArcFlag);
    const sweep = flag01(sweepFlag);
    let rxAbs = Math.abs(rx);
    let ryAbs = Math.abs(ry);
    if (!rxAbs || !ryAbs) return null;
    if (sx === ex && sy === ey) return null;

    const phi = ((xRotationDeg % 360) * Math.PI) / 180;
    const cosPhi = Math.cos(phi);
    const sinPhi = Math.sin(phi);
    const dx2 = (sx - ex) / 2;
    const dy2 = (sy - ey) / 2;
    const x1 = cosPhi * dx2 + sinPhi * dy2;
    const y1 = -sinPhi * dx2 + cosPhi * dy2;

    let rxSq = rxAbs * rxAbs;
    let rySq = ryAbs * ryAbs;
    const x1Sq = x1 * x1;
    const y1Sq = y1 * y1;
    const radiiScale = rxSq && rySq ? x1Sq / rxSq + y1Sq / rySq : 0;
    if (radiiScale > 1) {
      const scale = Math.sqrt(radiiScale);
      rxAbs *= scale;
      ryAbs *= scale;
      rxSq = rxAbs * rxAbs;
      rySq = ryAbs * ryAbs;
    }

    const sign = large === sweep ? -1 : 1;
    const numer = Math.max(0, rxSq * rySq - rxSq * y1Sq - rySq * x1Sq);
    const den = rxSq * y1Sq + rySq * x1Sq;
    const coef = den > 0 ? sign * Math.sqrt(numer / den) : 0;
    const cx1 = coef * ((rxAbs * y1) / ryAbs);
    const cy1 = rxAbs !== 0 ? coef * -((ryAbs * x1) / rxAbs) : 0;
    const cx = cosPhi * cx1 - sinPhi * cy1 + (sx + ex) / 2;
    const cy = sinPhi * cx1 + cosPhi * cy1 + (sy + ey) / 2;

    const angleBetween = (ux, uy, vx, vy) => {
      const n = Math.hypot(ux, uy) * Math.hypot(vx, vy);
      if (n === 0) return 0;
      const cosVal = Math.max(-1, Math.min(1, (ux * vx + uy * vy) / n));
      let a = Math.acos(cosVal);
      if (ux * vy - uy * vx < 0) a = -a;
      return a;
    };

    const ux = rxAbs ? (x1 - cx1) / rxAbs : 0;
    const uy = ryAbs ? (y1 - cy1) / ryAbs : 0;
    const vx = rxAbs ? (-x1 - cx1) / rxAbs : 0;
    const vy = ryAbs ? (-y1 - cy1) / ryAbs : 0;
    const theta1 = angleBetween(1, 0, ux, uy);
    let dTheta = angleBetween(ux, uy, vx, vy);
    if (!sweep && dTheta > 0) dTheta -= 2 * Math.PI;
    else if (sweep && dTheta < 0) dTheta += 2 * Math.PI;

    const thetaMid = theta1 + dTheta / 2;
    const lx = rxAbs * Math.cos(thetaMid);
    const ly = ryAbs * Math.sin(thetaMid);
    return {
      x: cosPhi * lx - sinPhi * ly + cx,
      y: sinPhi * lx + cosPhi * ly + cy
    };
  }

  // KiCad (arc start/mid/end) in mm, Y-flipped. Start/end swapped so the mid
  // stays on the correct side of the chord after the Y-flip.
  function symbolArcToKiCad(pathStr, ox, oy) {
    const parsed = parseSymbolArcPath(pathStr);
    if (!parsed) return null;
    if (Math.abs(parsed.rx) < 1e-9 || Math.abs(parsed.ry) < 1e-9) return null;
    const mid = svgArcMidPoint(
      parsed.sx,
      parsed.sy,
      parsed.ex,
      parsed.ey,
      parsed.rx,
      parsed.ry,
      parsed.rot,
      parsed.large,
      parsed.sweep
    );
    if (!mid) return null;
    const toKi = (xPx, yPx) => [pxToMm(xPx - ox), -pxToMm(yPx - oy)];
    const [endX, endY] = toKi(parsed.sx, parsed.sy);
    const [startX, startY] = toKi(parsed.ex, parsed.ey);
    const [midX, midY] = toKi(mid.x, mid.y);
    return { start: [startX, startY], mid: [midX, midY], end: [endX, endY] };
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
      } else if (cmd === "A") {
        const p = line.split("~");
        const ki = symbolArcToKiCad(p[1], originX, originY);
        if (!ki) continue;
        const fillRaw = String(p[6] || "none").trim().toLowerCase();
        const fill = fillRaw && fillRaw !== "none" ? "outline" : "none";
        graphics.push(`            (arc
              (start ${ki.start[0].toFixed(2)} ${ki.start[1].toFixed(2)})
              (mid ${ki.mid[0].toFixed(2)} ${ki.mid[1].toFixed(2)})
              (end ${ki.end[0].toFixed(2)} ${ki.end[1].toFixed(2)})
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

  function toRadians(n) {
    return (n / 180) * Math.PI;
  }

  function toDegrees(n) {
    return (n / Math.PI) * 180;
  }

  // SVG elliptical-arc endpoint → center form (W3C SVG 1.1 §F.6).
  // Returns [cx, cy, angleExtentDeg] for KiCad legacy fp_arc (start=center).
  function computeArc(startX, startY, radiusX, radiusY, angle, largeArcFlag, sweepFlag, endX, endY) {
    let rx = Math.abs(radiusX);
    let ry = Math.abs(radiusY);
    const dx2 = (startX - endX) / 2;
    const dy2 = (startY - endY) / 2;
    const ang = toRadians(angle % 360);
    const cosA = Math.cos(ang);
    const sinA = Math.sin(ang);
    const x1 = cosA * dx2 + sinA * dy2;
    const y1 = -sinA * dx2 + cosA * dy2;
    let rxSq = rx * rx;
    let rySq = ry * ry;
    const x1Sq = x1 * x1;
    const y1Sq = y1 * y1;
    const radiiCheck = rxSq && rySq ? x1Sq / rxSq + y1Sq / rySq : 0;
    if (radiiCheck > 1) {
      const s = Math.sqrt(radiiCheck);
      rx *= s;
      ry *= s;
      rxSq = rx * rx;
      rySq = ry * ry;
    }
    let sign = largeArcFlag === sweepFlag ? -1 : 1;
    let sq = 0;
    if (rxSq * y1Sq + rySq * x1Sq > 0) {
      sq = (rxSq * rySq - rxSq * y1Sq - rySq * x1Sq) / (rxSq * y1Sq + rySq * x1Sq);
      sq = Math.max(sq, 0);
    }
    const coef = sign * Math.sqrt(sq);
    const cx1 = coef * ((rx * y1) / ry);
    const cy1 = rx !== 0 ? coef * -((ry * x1) / rx) : 0;
    const sx2 = (startX + endX) / 2;
    const sy2 = (startY + endY) / 2;
    const cx = sx2 + (cosA * cx1 - sinA * cy1);
    const cy = sy2 + (sinA * cx1 + cosA * cy1);
    const ux = rx !== 0 ? (x1 - cx1) / rx : 0;
    const uy = ry !== 0 ? (y1 - cy1) / ry : 0;
    const vx = rx !== 0 ? (-x1 - cx1) / rx : 0;
    const vy = ry !== 0 ? (-y1 - cy1) / ry : 0;
    const n = Math.sqrt((ux * ux + uy * uy) * (vx * vx + vy * vy));
    const p = ux * vx + uy * vy;
    sign = ux * vy - uy * vx < 0 ? -1 : 1;
    let angleExtent =
      n !== 0 ? toDegrees(sign * Math.acos(Math.max(-1, Math.min(1, p / n)))) : 719;
    if (!sweepFlag && angleExtent > 0) angleExtent -= 360;
    else if (sweepFlag && angleExtent < 0) angleExtent += 360;
    const extentSign = angleExtent < 0 ? 1 : -1;
    angleExtent = (Math.abs(angleExtent) % 360) * extentSign;
    return [cx, cy, angleExtent];
  }

  // Footprint SVG path → mm points relative to footprint origin (no Y flip).
  // Supports M/L/H/V/Z; A advances to endpoint only (polygon approximation).
  function parseFpSvgPath(pathStr, bboxX, bboxY) {
    const parts = String(pathStr || "")
      .trim()
      .split(/(?=[MLHVAZmlhvaz])/);
    const pts = [];
    let curX = 0;
    let curY = 0;
    const append = () => {
      const pt = [eeToMm(curX) - bboxX, eeToMm(curY) - bboxY];
      if (!pts.length || pts[pts.length - 1][0] !== pt[0] || pts[pts.length - 1][1] !== pt[1]) {
        pts.push(pt);
      }
    };
    for (const part of parts) {
      const token = part.trim();
      if (!token) continue;
      const cmd = token[0].toUpperCase();
      const args = token
        .slice(1)
        .trim()
        .split(/[\s,]+/)
        .filter(Boolean)
        .map(num);
      if ((cmd === "M" || cmd === "L") && args.length >= 2) {
        for (let i = 0; i + 1 < args.length; i += 2) {
          curX = args[i];
          curY = args[i + 1];
          append();
        }
      } else if (cmd === "H" && args.length >= 1) {
        curX = args[0];
        append();
      } else if (cmd === "V" && args.length >= 1) {
        curY = args[0];
        append();
      } else if (cmd === "A" && args.length >= 7) {
        curX = args[5];
        curY = args[6];
        append();
      } else if (cmd === "Z" && pts.length && (pts[0][0] !== pts[pts.length - 1][0] || pts[0][1] !== pts[pts.length - 1][1])) {
        pts.push([pts[0][0], pts[0][1]]);
      }
    }
    return pts;
  }

  // Layers imported for SOLIDREGION. Paste (5/6) stays on pads; 100/101 are decorative.
  const SOLID_REGION_LAYERS = new Set([1, 2, 3, 4, 13, 14, 99]);

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
      } else if (cmd === "ARC") {
        // ARC~stroke~layer~net~path~helper~id~locked
        const width = Math.max(eeToMm(p[1]), 0.01);
        const layer = FP_LAYERS[num(p[2])] || "F.Fab";
        const path = String(p[4] || "").replace(/,/g, " ").trim();
        const aIdx = path.toUpperCase().indexOf("A");
        if (aIdx > 0) {
          const before = path.slice(0, aIdx).replace(/^[Mm]\s*/, "").trim();
          const after = path.slice(aIdx + 1).trim().split(/[\s]+/).filter(Boolean);
          const startParts = before.split(/[\s]+/).filter(Boolean);
          if (startParts.length >= 2 && after.length >= 7) {
            const startX = eeToMm(startParts[0]) - bboxX;
            const startY = eeToMm(startParts[1]) - bboxY;
            const rx = eeToMm(after[0]);
            const ry = eeToMm(after[1]);
            const xRot = num(after[2]);
            const largeArc = after[3] === "1";
            const sweep = after[4] === "1";
            const endX = eeToMm(after[5]) - bboxX;
            const endY = eeToMm(after[6]) - bboxY;
            let cx = 0;
            let cy = 0;
            let extent = 0;
            if (ry !== 0) {
              [cx, cy, extent] = computeArc(
                startX,
                startY,
                rx,
                ry,
                xRot,
                largeArc,
                sweep,
                endX,
                endY
              );
              graphicBlocks.push(
                `\t(fp_arc (start ${cx.toFixed(2)} ${cy.toFixed(2)}) (end ${endX.toFixed(2)} ${endY.toFixed(2)}) (angle ${extent.toFixed(2)}) (layer ${layer}) (width ${width.toFixed(2)}))`
              );
            }
          }
        }
      } else if (cmd === "SOLIDREGION") {
        // SOLIDREGION~layer~net~path~solid|cutout|npth~id~~
        const layerId = num(p[1], -1);
        const regionType = String(p[4] || "solid").toLowerCase();
        if (SOLID_REGION_LAYERS.has(layerId) && (regionType === "solid" || regionType === "npth")) {
          const pts = parseFpSvgPath(p[3], bboxX, bboxY);
          if (pts.length >= 3) {
            const layer = FP_LAYERS[layerId] || "F.SilkS";
            if (layer === "F.CrtYd") {
              // Layer 99 is invisible body outline in EasyEDA → courtyard stroke.
              for (let i = 0; i + 1 < pts.length; i++) {
                graphicBlocks.push(
                  `\t(fp_line (start ${pts[i][0].toFixed(2)} ${pts[i][1].toFixed(2)}) (end ${pts[i + 1][0].toFixed(2)} ${pts[i + 1][1].toFixed(2)}) (layer F.CrtYd) (width 0.05))`
                );
              }
            } else {
              const ptsStr = pts.map(([x, y]) => `(xy ${x.toFixed(6)} ${y.toFixed(6)})`).join(" ");
              graphicBlocks.push(
                `\t(fp_poly (pts ${ptsStr}) (stroke (width 0) (type solid)) (fill solid) (layer ${layer}))`
              );
            }
          }
        }
      } else if (cmd === "TEXT") {
        // TEXT~type~x~y~stroke~rot~mirror~layer~net~fontSize~text~path~visible~id~
        const textType = p[1] || "";
        const tx = eeToMm(p[2]) - bboxX;
        const ty = eeToMm(p[3]) - bboxY;
        const thickness = Math.max(eeToMm(p[4]), 0.01);
        const orientation = angleToKi(p[5]);
        let layer = FP_LAYERS[num(p[7])] || "F.Fab";
        const fontSize = Math.max(eeToMm(p[9]), 0.25);
        const text = String(p[10] || "").trim();
        const isDisplayed = p[12] !== "0" && p[12] !== "false";
        if (text) {
          if (textType === "N") layer = layer.replace(".SilkS", ".Fab");
          const hide = !isDisplayed || textType === "N" ? " hide" : "";
          const mirror = layer.startsWith("B") ? " mirror" : "";
          graphicBlocks.push(
            `\t(fp_text user "${esc(text)}" (at ${tx.toFixed(2)} ${ty.toFixed(2)} ${orientation.toFixed(2)}) (layer ${layer})${hide}\n\t\t(effects (font (size ${fontSize.toFixed(2)} ${fontSize.toFixed(2)}) (thickness ${thickness.toFixed(2)})) (justify left${mirror}))\n\t)`
          );
        }
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
