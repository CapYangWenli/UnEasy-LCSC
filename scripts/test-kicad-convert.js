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
  console.log(
    codeId,
    "pins",
    pinCount,
    "units",
    unitCount,
    "pads",
    padCount,
    "file",
    out.symbol.filename
  );
  if (pinCount < expectPinsMin || padCount < 1) {
    throw new Error(`Unexpected conversion for ${codeId}`);
  }
}

(async () => {
  await testPart("C14284", 2);
  await testPart("C17702531", 100);
  console.log("OK");
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
