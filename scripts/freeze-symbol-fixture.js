"use strict";

/**
 * Freeze an LCSC symbol fixture for the e2e corpus.
 * Usage: node scripts/freeze-symbol-fixture.js C51933324 --tier C --risk high --tags pt-path,LED
 * Batch: node scripts/freeze-symbol-fixture.js --manifest tests/symbols/corpus-manifest.json
 */

const fs = require("fs");
const path = require("path");
const { irFromEasyeda } = require("../tests/symbols/lib/ir-from-easyeda");

const ROOT = path.join(__dirname, "..");
const CORPUS = path.join(ROOT, "tests", "symbols", "corpus");

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function fetchSymbolComponent(lcsc) {
  const svgs = await fetchJson(`https://easyeda.com/api/products/${lcsc}/svgs`);
  if (!svgs || !svgs.result) {
    throw new Error(`No svgs result for ${lcsc}: ${JSON.stringify(svgs).slice(0, 200)}`);
  }
  const sym = svgs.result.find((r) => r.docType === 2);
  if (!sym) throw new Error(`No symbol (docType 2) for ${lcsc}`);
  const component = await fetchJson(
    `https://easyeda.com/api/components/${sym.component_uuid}`
  );
  const result = component.result;
  if (!result || !result.dataStr) {
    throw new Error(`No symbol dataStr for ${lcsc} (原理图未绘制?)`);
  }

  const para = (result.dataStr.head && result.dataStr.head.c_para) || {};
  const mpn = para["Manufacturer Part"] || para["BOM_Manufacturer Part"] || "";
  const packageName = para.package || lcsc;

  return {
    component: {
      dataStr: result.dataStr,
      subparts: Array.isArray(result.subparts) ? result.subparts : []
    },
    mpn,
    packageName,
    title: sym.title || packageName
  };
}

function writeFixture(lcsc, { component, mpn, packageName, title }, opts) {
  const dir = path.join(CORPUS, lcsc);
  fs.mkdirSync(dir, { recursive: true });

  const { ir, unhandled, unhandledSummary, visiblePinCount, hiddenPinCount, subpartCount } =
    irFromEasyeda(component, { lcsc, package: packageName, name: packageName });

  const meta = {
    lcsc,
    mpn: mpn || "",
    package: packageName || "",
    title: title || "",
    risk: opts.risk || "low",
    tier: opts.tier || "A",
    tags: opts.tags || [],
    reference: "tertiary-easyeda-ir",
    frozenAt: new Date().toISOString(),
    visiblePinCount,
    hiddenPinCount,
    unitCount: ir.unitCount,
    subpartCount,
    unhandledAtFreeze: unhandled
  };
  if (opts.tolerances) meta.tolerances = opts.tolerances;

  fs.writeFileSync(
    path.join(dir, "easyeda-symbol.json"),
    JSON.stringify(component, null, 2) + "\n",
    "utf8"
  );
  fs.writeFileSync(path.join(dir, "reference.ir.json"), JSON.stringify(ir, null, 2) + "\n", "utf8");
  fs.writeFileSync(path.join(dir, "meta.json"), JSON.stringify(meta, null, 2) + "\n", "utf8");

  const notes = [
    `# ${lcsc}`,
    "",
    `- Package: ${packageName}`,
    `- MPN: ${mpn || "(unknown)"}`,
    `- Tier: ${meta.tier} · Risk: ${meta.risk}`,
    `- Units: ${ir.unitCount} · Visible pins: ${visiblePinCount}`,
    `- Reference: tertiary EasyEDA→IR`,
    unhandledSummary ? `- Unhandled at freeze: ${unhandledSummary}` : "- Unhandled at freeze: (none)",
    "",
    opts.notes || "Frozen from EasyEDA API for UnEasy-LCSC symbol e2e corpus.",
    ""
  ].join("\n");
  fs.writeFileSync(path.join(dir, "notes.md"), notes, "utf8");

  console.log(
    `Froze ${lcsc} → ${dir} (units=${ir.unitCount}, pins=${visiblePinCount}, unhandled=${unhandledSummary || "none"})`
  );
}

function parseArgs(argv) {
  const args = { ids: [], risk: "low", tier: "A", tags: [], manifest: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--manifest") args.manifest = argv[++i];
    else if (a === "--risk") args.risk = argv[++i];
    else if (a === "--tier") args.tier = argv[++i];
    else if (a === "--tags") args.tags = String(argv[++i] || "").split(",").filter(Boolean);
    else if (a === "--notes") args.notes = argv[++i];
    else if (!a.startsWith("-")) args.ids.push(a);
  }
  return args;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  let entries = [];

  if (args.manifest) {
    const manifestPath = path.isAbsolute(args.manifest)
      ? args.manifest
      : path.join(ROOT, args.manifest);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
    entries = manifest.parts || manifest;
  } else if (args.ids.length) {
    entries = args.ids.map((lcsc) => ({
      lcsc,
      tier: args.tier,
      risk: args.risk,
      tags: args.tags,
      notes: args.notes
    }));
  } else {
    console.error(
      "Usage: node scripts/freeze-symbol-fixture.js C51933324 [--tier C] [--risk high] [--tags pt-path,LED]\n" +
        "   or: node scripts/freeze-symbol-fixture.js --manifest tests/symbols/corpus-manifest.json"
    );
    process.exit(2);
  }

  let errors = 0;
  for (const entry of entries) {
    const lcsc = entry.lcsc || entry.id;
    try {
      const fetched = await fetchSymbolComponent(lcsc);
      writeFixture(lcsc, fetched, entry);
      await new Promise((r) => setTimeout(r, 300));
    } catch (e) {
      console.error(`FAIL ${lcsc}:`, e.message || e);
      errors++;
    }
  }
  if (errors) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(2);
});
