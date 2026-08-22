const fs = require("fs");
const path = require("path");
const vm = require("vm");

const code = fs.readFileSync(path.join(__dirname, "..", "src", "kicad", "convert.js"), "utf8");
const ctx = { globalThis: {} };
vm.createContext(ctx);
vm.runInContext(code, ctx);
const UnEasyKicad = ctx.globalThis.UnEasyKicad;

async function testPart(codeId, expectPinsMin) {
  const svgs = await (await fetch(`https://easyeda.com/api/products/${codeId}/svgs`)).json();
  const sym = svgs.result.find((r) => r.docType === 2);
  const fp = svgs.result.find((r) => r.docType === 4);
  const symbolComponent = (
    await (await fetch(`https://easyeda.com/api/components/${sym.component_uuid}`)).json()
  ).result;
  const fpD = (
    await (await fetch(`https://easyeda.com/api/components/${fp.component_uuid}`)).json()
  ).result.dataStr;

  const out = UnEasyKicad.convertEasyedaToKicad({
    symbolComponent,
    footprintDataStr: fpD,
    lcsc: codeId,
    name: codeId
  });

  const pinCount = (out.symbol.content.match(/\(pin /g) || []).length;
  const unitCount = (out.symbol.content.match(/_(\d+)_1"/g) || []).length;
  const padCount = (out.footprint.content.match(/\(pad /g) || []).length;
  const rect = out.symbol.content.match(
    /\(rectangle\s*\(start ([-\d.]+) ([-\d.]+)\)\s*\(end ([-\d.]+) ([-\d.]+)\)/
  );
  let rectW = 0;
  let rectH = 0;
  if (rect) {
    rectW = Math.abs(+rect[3] - +rect[1]);
    rectH = Math.abs(+rect[4] - +rect[2]);
  }
  console.log(
    codeId,
    "pins",
    pinCount,
    "units",
    unitCount,
    "pads",
    padCount,
    "rect",
    `${rectW.toFixed(2)}x${rectH.toFixed(2)}`,
    "file",
    out.symbol.filename
  );
  if (pinCount < expectPinsMin || padCount < 1) {
    throw new Error(`Unexpected conversion for ${codeId}`);
  }
  return { out, rectW, rectH, pinCount };
}

(async () => {
  await testPart("C14284", 2);
  await testPart("C17702531", 100);
  const c9864 = await testPart("C9864", 8);
  if (!(c9864.rectW > 1 && c9864.rectH > 1)) {
    throw new Error(
      `C9864 body rectangle degenerate: ${c9864.rectW}x${c9864.rectH}`
    );
  }

  // Footprint descr should include MPN from the symbol (not the package).
  const c98715 = await testPart("C98715", 8);
  const descr = (c98715.out.footprint.content.match(/\(descr "([^"]*)"\)/) || [])[1] || "";
  if (!/UC3845BD1R2G/.test(descr)) {
    throw new Error(`C98715 footprint descr missing MPN: ${descr}`);
  }
  if (!/\(property "MPN" "UC3845BD1R2G"\)/.test(c98715.out.footprint.content)) {
    throw new Error("C98715 footprint missing MPN property");
  }

  // LED body uses EasyEDA PT~ SVG paths (triangle) — must appear as polylines.
  const led = await testPart("C51933324", 2);
  const polys = led.out.symbol.content.match(/\(polyline/g) || [];
  if (polys.length < 6) {
    throw new Error(
      `C51933324 expected PT triangles as polylines, got ${polys.length} polylines`
    );
  }
  // Main diode triangle vertices should form a closed shape (first == last after Z).
  if (!/\(xy [-\d.]+ [-\d.]+\) \(xy [-\d.]+ [-\d.]+\) \(xy [-\d.]+ [-\d.]+\) \(xy [-\d.]+ [-\d.]+\)/.test(
    led.out.symbol.content
  )) {
    throw new Error("C51933324 missing closed triangle polyline from PT~");
  }

  // Inductor body uses EasyEDA A~ SVG arcs — must appear as KiCad (arc start/mid/end).
  const inductor = await testPart("C55315393", 2);
  const arcs = inductor.out.symbol.content.match(/\(arc\b/g) || [];
  if (arcs.length < 4) {
    throw new Error(
      `C55315393 expected 4 inductor A~ loops as arcs, got ${arcs.length}`
    );
  }
  if (
    !/\(arc[\s\S]*?\(start [-\d.]+ [-\d.]+\)[\s\S]*?\(mid [-\d.]+ [-\d.]+\)[\s\S]*?\(end [-\d.]+ [-\d.]+\)/.test(
      inductor.out.symbol.content
    )
  ) {
    throw new Error("C55315393 missing (arc (start) (mid) (end)) from A~");
  }
  console.log("OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
