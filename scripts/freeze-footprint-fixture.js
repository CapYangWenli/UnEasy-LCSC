"use strict";

/**
 * Freeze an LCSC footprint fixture for the e2e corpus.
 * Usage: node scripts/freeze-footprint-fixture.js C9864 [--tier B] [--risk medium] [--has-ep]
 * Optional batch: node scripts/freeze-footprint-fixture.js --manifest tests/footprints/corpus-manifest.json
 */

const fs = require("fs");
const path = require("path");
const { irFromEasyeda } = require("../tests/footprints/lib/ir-from-easyeda");

const ROOT = path.join(__dirname, "..");
const CORPUS = path.join(ROOT, "tests", "footprints", "corpus");

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} for ${url}`);
  return res.json();
}

async function fetchFootprintDataStr(lcsc) {
  const svgs = await fetchJson(`https://easyeda.com/api/products/${lcsc}/svgs`);
  if (!svgs || !svgs.result) {
    throw new Error(`No svgs result for ${lcsc}: ${JSON.stringify(svgs).slice(0, 200)}`);
  }
  const fp = svgs.result.find((r) => r.docType === 4);
  if (!fp) throw new Error(`No footprint (docType 4) for ${lcsc}`);
  const component = await fetchJson(
    `https://easyeda.com/api/components/${fp.component_uuid}`
  );
  const dataStr = component.result && component.result.dataStr;
  if (!dataStr) throw new Error(`No dataStr for ${lcsc} footprint`);
  // Also try to get MPN from symbol if present
  let mpn = "";
  let packageName = "";
  const sym = svgs.result.find((r) => r.docType === 2);
  if (sym) {
    try {
      const symC = await fetchJson(
        `https://easyeda.com/api/components/${sym.component_uuid}`
      );
      const para =
        (symC.result &&
          symC.result.dataStr &&
          symC.result.dataStr.head &&
          symC.result.dataStr.head.c_para) ||
        {};
      mpn = para["Manufacturer Part"] || para["BOM_Manufacturer Part"] || "";
      packageName = para.package || "";
    } catch (_) {
      /* ignore */
    }
  }
  const fpPara = (dataStr.head && dataStr.head.c_para) || {};
  packageName = packageName || fpPara.package || lcsc;
  return { dataStr, mpn, packageName, title: fp.title || packageName };
}

function writeFixture(lcsc, { dataStr, mpn, packageName, title }, opts) {
  const dir = path.join(CORPUS, lcsc);
  fs.mkdirSync(dir, { recursive: true });

  const meta = {
    lcsc,
    mpn: mpn || "",
    package: packageName || "",
    title: title || "",
    risk: opts.risk || "low",
    tier: opts.tier || "A",
    tags: opts.tags || [],
    hasEp: !!opts.hasEp,
    reference: "tertiary-easyeda-ir",
    frozenAt: new Date().toISOString()
  };
  if (opts.tolerances) meta.tolerances = opts.tolerances;

  fs.writeFileSync(
    path.join(dir, "easyeda-footprint.json"),
    JSON.stringify(dataStr, null, 2) + "\n",
    "utf8"
  );

  const { ir, unhandled, unhandledSummary, solidRegionCopper, padCommandCount } =
    irFromEasyeda(dataStr, { lcsc, package: packageName, name: packageName });

  fs.writeFileSync(
    path.join(dir, "reference.ir.json"),
    JSON.stringify(ir, null, 2) + "\n",
    "utf8"
  );

  fs.writeFileSync(
    path.join(dir, "meta.json"),
    JSON.stringify(
      {
        ...meta,
        padCommandCount,
        unhandledAtFreeze: unhandled,
        solidRegionCopperAtFreeze: solidRegionCopper
      },
      null,
      2
    ) + "\n",
    "utf8"
  );

  const notes = [
    `# ${lcsc}`,
    "",
    `- Package: ${packageName}`,
    `- MPN: ${mpn || "(unknown)"}`,
    `- Tier: ${meta.tier} · Risk: ${meta.risk}`,
    `- Reference: tertiary EasyEDA→IR`,
    unhandledSummary ? `- Unhandled at freeze: ${unhandledSummary}` : "- Unhandled at freeze: (none)",
    "",
    opts.notes || "Frozen from EasyEDA API for UnEasy-LCSC footprint e2e corpus.",
    ""
  ].join("\n");
  fs.writeFileSync(path.join(dir, "notes.md"), notes, "utf8");

  console.log(
    `Froze ${lcsc} → ${dir} (pads=${ir.pads.length}, unhandled=${unhandledSummary || "none"})`
  );
}

function parseArgs(argv) {
  const args = { ids: [], risk: "low", tier: "A", hasEp: false, tags: [], manifest: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--manifest") args.manifest = argv[++i];
    else if (a === "--risk") args.risk = argv[++i];
    else if (a === "--tier") args.tier = argv[++i];
    else if (a === "--has-ep") args.hasEp = true;
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
      hasEp: args.hasEp,
      tags: args.tags,
      notes: args.notes
    }));
  } else {
    console.error(
      "Usage: node scripts/freeze-footprint-fixture.js C9864 [--tier B] [--risk medium] [--has-ep]\n" +
        "   or: node scripts/freeze-footprint-fixture.js --manifest tests/footprints/corpus-manifest.json"
    );
    process.exit(2);
  }

  let errors = 0;
  for (const entry of entries) {
    const lcsc = entry.lcsc || entry.id;
    try {
      const fetched = await fetchFootprintDataStr(lcsc);
      writeFixture(lcsc, fetched, entry);
      // Be polite to EasyEDA
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
