"use strict";

const { parseSexpr, findAll, findOne, atomNum, isList, head } = require("../../footprints/lib/sexpr");
const { round2 } = require("./units");

function child(node, name) {
  if (!isList(node)) return null;
  return node.find((c) => isList(c) && head(c) === name) || null;
}

function parsePin(pinList) {
  const type = String(pinList[1] || "unspecified");
  const style = String(pinList[2] || "line");
  const at = child(pinList, "at") || [];
  const lenNode = child(pinList, "length");
  const nameNode = child(pinList, "name");
  const numNode = child(pinList, "number");

  let pinName = "";
  if (nameNode && nameNode[1] != null) pinName = String(nameNode[1]);
  let pinNumber = "";
  if (numNode && numNode[1] != null) pinNumber = String(numNode[1]);

  return {
    number: pinNumber,
    name: pinName,
    type,
    style,
    x_mm: round2(atomNum(at[1])),
    y_mm: round2(atomNum(at[2])),
    rotation_deg: Math.round(atomNum(at[3], 0)),
    length_mm: round2(lenNode ? atomNum(lenNode[1]) : 0),
    visible: true
  };
}

function parseRectangle(rectList) {
  const start = child(rectList, "start") || [];
  const end = child(rectList, "end") || [];
  return {
    kind: "rectangle",
    start: { x: round2(atomNum(start[1])), y: round2(atomNum(start[2])) },
    end: { x: round2(atomNum(end[1])), y: round2(atomNum(end[2])) }
  };
}

function parseCircle(circleList) {
  const center = child(circleList, "center") || [];
  const radius = child(circleList, "radius");
  const fillNode = child(circleList, "fill");
  let fill = "none";
  if (fillNode) {
    const typeNode = child(fillNode, "type");
    fill = typeNode ? String(typeNode[1] || "none") : "none";
  }
  return {
    kind: "circle",
    center: { x: round2(atomNum(center[1])), y: round2(atomNum(center[2])) },
    radius: round2(radius ? atomNum(radius[1]) : 0),
    fill
  };
}

function parsePolyline(polyList) {
  const ptsNode = child(polyList, "pts") || [];
  const pts = [];
  for (let i = 1; i < ptsNode.length; i++) {
    const xy = ptsNode[i];
    if (isList(xy) && head(xy) === "xy") {
      pts.push({ x: round2(atomNum(xy[1])), y: round2(atomNum(xy[2])) });
    }
  }
  const fillNode = child(polyList, "fill");
  let fill = "none";
  if (fillNode) {
    const typeNode = child(fillNode, "type");
    fill = typeNode ? String(typeNode[1] || "none") : "none";
  }
  const closed =
    pts.length >= 3 &&
    Math.abs(pts[0].x - pts[pts.length - 1].x) < 0.02 &&
    Math.abs(pts[0].y - pts[pts.length - 1].y) < 0.02;
  return { kind: "polyline", pts, closed, fill };
}

function parseUnitSymbol(symList) {
  const symName = String(symList[1] || "");
  const unitNameNode = child(symList, "unit_name");
  const unitName = unitNameNode ? String(unitNameNode[1] || "") : "";

  // NAME_0_1 or NAME_1_1
  const m = symName.match(/_(\d+)_\d+$/);
  const id = m ? parseInt(m[1], 10) : 0;

  const pins = findAll([symList], "pin").map(parsePin);
  const graphics = [];
  for (const r of findAll([symList], "rectangle")) graphics.push(parseRectangle(r));
  for (const c of findAll([symList], "circle")) graphics.push(parseCircle(c));
  for (const pl of findAll([symList], "polyline")) graphics.push(parsePolyline(pl));

  return { id, name: unitName, pins, graphics };
}

function parseProperty(propList) {
  return { key: String(propList[1] || ""), value: String(propList[2] || "") };
}

/**
 * Parse a .kicad_sym string into SymbolIR.
 */
function irFromKicad(symText, nameHint) {
  const forms = parseSexpr(symText);
  const root = forms[0];
  if (!isList(root) || head(root) !== "kicad_symbol_lib") {
    throw new Error("Not a valid KiCad symbol library");
  }

  const topSymbols = root.filter((c) => isList(c) && head(c) === "symbol");
  if (!topSymbols.length) throw new Error("No symbol in library");

  const top = topSymbols[0];
  const name = String(top[1] || nameHint || "SYMBOL");

  const props = {};
  for (const p of findAll([top], "property")) {
    const parsed = parseProperty(p);
    props[parsed.key] = parsed.value;
  }

  const unitSymbols = top.filter(
    (c) => isList(c) && head(c) === "symbol" && String(c[1] || "").includes("_")
  );
  const units = unitSymbols.length
    ? unitSymbols.map(parseUnitSymbol)
    : [parseUnitSymbol(top)];

  const packageFromFp = String(props.Footprint || "");
  const packageName = packageFromFp.includes(":")
    ? packageFromFp.split(":").pop()
    : packageFromFp.replace(/^UnEasy-LCSC:/, "");

  return {
    name,
    prefix: props.Reference || "U",
    packageName,
    unitCount: units.length,
    properties: {
      lcsc: props["LCSC Part"] || "",
      manufacturer: props.Manufacturer || "",
      mpn: props.MPN || "",
      datasheet: props.Datasheet || "",
      footprint: props.Footprint || ""
    },
    units,
    unhandled: []
  };
}

function isParseableKicadSym(symText) {
  try {
    irFromKicad(symText);
    return true;
  } catch {
    return false;
  }
}

module.exports = { irFromKicad, isParseableKicadSym, parsePin, parseUnitSymbol };
