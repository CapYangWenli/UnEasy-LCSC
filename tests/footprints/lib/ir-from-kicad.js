"use strict";

const { parseSexpr, findAll, findOne, atomNum, isList, head } = require("./sexpr");
const { normalizeLayers, electricalBbox, round6 } = require("./units");

function child(node, name) {
  if (!isList(node)) return null;
  return node.find((c) => isList(c) && head(c) === name) || null;
}

function parsePad(padList) {
  // (pad NUMBER TYPE SHAPE (at x y [rot]) (size w h) (layers ...) [(drill ...)] [(primitives ...)])
  const number = String(padList[1] ?? "");
  const typeRaw = String(padList[2] || "smd");
  let type = typeRaw;
  if (typeRaw === "thru_hole" && number === "") {
    // HOLE exporter uses thru_hole with empty number; treat as thru_hole for compare
    type = "thru_hole";
  }
  const shapeRaw = String(padList[3] || "rect");
  const shape = shapeRaw === "custom" ? "polygon" : shapeRaw;

  const at = child(padList, "at") || [];
  const size = child(padList, "size") || [];
  const layersNode = child(padList, "layers");
  const drillNode = child(padList, "drill");
  const primitives = child(padList, "primitives");

  const layers = layersNode
    ? normalizeLayers(layersNode.slice(1).map(String))
    : [];

  const pad = {
    number,
    type,
    shape,
    center_mm: {
      x: round6(atomNum(at[1])),
      y: round6(atomNum(at[2]))
    },
    size_mm: {
      w: round6(atomNum(size[1])),
      h: round6(atomNum(size[2]))
    },
    rotation_deg: round6(atomNum(at[3], 0)),
    layers,
    polygon_mm: null
  };

  if (drillNode) {
    // (drill dia) or (drill oval w h)
    if (String(drillNode[1]) === "oval") {
      pad.drill_mm = {
        oval_w: round6(atomNum(drillNode[2])),
        oval_h: round6(atomNum(drillNode[3])),
        orientation: 0
      };
    } else {
      pad.drill_mm = { dia: round6(atomNum(drillNode[1])) };
    }
  }

  if (primitives) {
    const pts = findOne([primitives], "pts");
    if (pts) {
      pad.polygon_mm = [];
      for (let i = 1; i < pts.length; i++) {
        const xy = pts[i];
        if (isList(xy) && head(xy) === "xy") {
          pad.polygon_mm.push({
            x: round6(pad.center_mm.x + atomNum(xy[1])),
            y: round6(pad.center_mm.y + atomNum(xy[2]))
          });
        }
      }
    }
  }

  return pad;
}

/**
 * Parse a .kicad_mod string into FootprintIR.
 */
function irFromKicad(modText, nameHint) {
  const forms = parseSexpr(modText);
  const root = forms[0];
  if (!isList(root) || (head(root) !== "module" && head(root) !== "footprint")) {
    throw new Error("Not a valid KiCad footprint module");
  }

  const nameTok = String(root[1] || nameHint || "FOOTPRINT");
  const name = nameTok.includes(":") ? nameTok.split(":").pop() : nameTok;

  const attrNode = findOne([root], "attr");
  const attrVal = attrNode ? String(attrNode[1] || "") : "";
  const isSmd = attrVal === "smd" || (!attrVal && true);

  const padLists = findAll([root], "pad");
  const pads = padLists.map(parsePad);

  const holes = pads
    .filter((p) => p.number === "" && p.drill_mm && p.drill_mm.dia != null)
    .map((p) => ({
      center_mm: { ...p.center_mm },
      dia_mm: p.drill_mm.dia
    }));

  const modelNode = findOne([root], "model");
  let model3d_path = null;
  if (modelNode) {
    model3d_path = String(modelNode[1] || "");
  }

  return {
    name,
    pads,
    holes,
    bbox_mm: electricalBbox(pads, holes),
    attributes: {
      smd: attrVal === "smd" || (attrVal !== "through_hole" && isSmd),
      through_hole: attrVal === "through_hole"
    },
    model3d_path
  };
}

function isParseableKicadMod(modText) {
  try {
    irFromKicad(modText);
    return true;
  } catch {
    return false;
  }
}

module.exports = { irFromKicad, isParseableKicadMod, parsePad };
