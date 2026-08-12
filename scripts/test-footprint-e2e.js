"use strict";

/**
 * Automated end-to-end footprint conversion tests (TRD docs/footprint-e2e-trd.md).
 * Exit: 0 pass, 1 hard/quarantine fail, 2 infra/fixture error.
 */

const fs = require("fs");
const path = require("path");
const { loadConverter } = require("../tests/footprints/lib/load-converter");
const { irFromEasyeda } = require("../tests/footprints/lib/ir-from-easyeda");
const { irFromKicad, isParseableKicadMod } = require("../tests/footprints/lib/ir-from-kicad");
const {
  compareFootprints,
  assertNoDroppedPads,
  irEqual
} = require("../tests/footprints/lib/compare");
const { writeReports, githubJobSummary, ensureDir } = require("../tests/footprints/lib/report");

const ROOT = path.join(__dirname, "..");
const CORPUS_DIR = path.join(ROOT, "tests", "footprints", "corpus");
const SYNTH_DIR = path.join(ROOT, "tests", "footprints", "synthetic");
const ARTIFACTS = path.join(ROOT, "artifacts");

function readJson(p) {
  return JSON.parse(fs.readFileSync(p, "utf8"));
}

function listCorpusEntries() {
  if (!fs.existsSync(CORPUS_DIR)) return [];
  return fs
    .readdirSync(CORPUS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith("C"))
    .map((d) => d.name)
    .sort();
}

function listSyntheticEntries() {
  if (!fs.existsSync(SYNTH_DIR)) return [];
  return fs
    .readdirSync(SYNTH_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .sort();
}

function convertTwice(UnEasyKicad, dataStr, meta) {
  const a = UnEasyKicad.exportFootprint(dataStr, meta);
  const b = UnEasyKicad.exportFootprint(dataStr, meta);
  return { a, b };
}

function runCorpusCase(UnEasyKicad, lcsc) {
  const dir = path.join(CORPUS_DIR, lcsc);
  const metaPath = path.join(dir, "meta.json");
  const eePath = path.join(dir, "easyeda-footprint.json");
  const refPath = path.join(dir, "reference.ir.json");

  if (!fs.existsSync(metaPath) || !fs.existsSync(eePath) || !fs.existsSync(refPath)) {
    return {
      id: lcsc,
      kind: "corpus",
      status: "ERROR",
      error: "missing meta.json / easyeda-footprint.json / reference.ir.json",
      hardFails: [],
      softFails: []
    };
  }

  const meta = readJson(metaPath);
  const dataStr = readJson(eePath);
  const refIr = readJson(refPath);

  const eeParsed = irFromEasyeda(dataStr, {
    lcsc,
    package: meta.package,
    name: meta.package || lcsc
  });

  const { a, b } = convertTwice(UnEasyKicad, dataStr, {
    lcsc,
    name: meta.package || lcsc,
    package: meta.package || lcsc,
    mpn: meta.mpn || ""
  });

  const result = {
    id: lcsc,
    kind: "corpus",
    tier: meta.tier,
    risk: meta.risk,
    hardFails: [],
    softFails: [],
    labels: [],
    unhandledSummary: eeParsed.unhandledSummary,
    unhandled: eeParsed.unhandled,
    padDeltas: []
  };

  if (!isParseableKicadMod(a.content)) {
    result.status = "BLOCKED";
    result.hardFails.push({ id: "PARSE", message: "emitted .kicad_mod failed to parse" });
    return result;
  }

  const dutIr = irFromKicad(a.content, meta.package || lcsc);
  const dutIr2 = irFromKicad(b.content, meta.package || lcsc);
  if (!irEqual(dutIr, dutIr2)) {
    result.hardFails.push({ id: "IDEM", message: "idempotency: two converts produced different IR" });
  }

  // Prefer live EasyEDA IR for compare (catches reference drift) but also
  // require stored reference matches live IR structure for fixture integrity.
  const compareRef = eeParsed.ir;

  const cmp = compareFootprints(dutIr, compareRef, {
    meta,
    tolerances: meta.tolerances,
    unhandled: eeParsed.unhandled,
    solidRegionCopper: eeParsed.solidRegionCopper,
    expectModel3d: eeParsed.hasSvgNode,
    quarantineUnhandledElectrical: meta.risk === "high" && eeParsed.solidRegionCopper > 0
  });

  result.hardFails.push(...cmp.hardFails);
  result.softFails.push(...cmp.softFails);
  result.labels.push(...cmp.labels);
  result.padDeltas = cmp.padDeltas;

  const h11 = assertNoDroppedPads(
    eeParsed.padCommandCount,
    dutIr.pads.length,
    eeParsed.ir.pads.length
  );
  result.hardFails.push(...h11);

  // Zero-size guard
  for (const p of dutIr.pads) {
    if (p.size_mm.w <= 0 || p.size_mm.h <= 0) {
      result.hardFails.push({
        id: "ZERO",
        message: `zero-size pad "${p.number}" ${p.size_mm.w}x${p.size_mm.h}`
      });
    }
  }

  if (result.unhandledSummary) {
    console.log(`  UNHANDLED: ${result.unhandledSummary}`);
  }

  result.status = result.hardFails.length
    ? "BLOCKED"
    : result.softFails.length
      ? "WARN"
      : "PASS";
  if (cmp.status === "BLOCKED") result.status = "BLOCKED";
  result.labels = [...new Set(result.labels)];

  // Store frozen reference delta note if drifted
  if (!irEqual(refIr, eeParsed.ir, 1e-4)) {
    result.softFails.push({
      id: "REFDRIFT",
      message: "frozen reference.ir.json differs from live EasyEDA IR (re-freeze?)"
    });
    if (result.status === "PASS") result.status = "WARN";
  }

  return result;
}

function runSyntheticCase(UnEasyKicad, id) {
  const dir = path.join(SYNTH_DIR, id);
  const meta = readJson(path.join(dir, "meta.json"));
  const dataStr = readJson(path.join(dir, "easyeda-footprint.json"));
  const refPath = path.join(dir, "reference.ir.json");
  const refIr = fs.existsSync(refPath) ? readJson(refPath) : null;

  const result = {
    id: `synthetic:${id}`,
    kind: "synthetic",
    hardFails: [],
    softFails: [],
    labels: [],
    unhandledSummary: "",
    padDeltas: []
  };

  if (meta.expect === "error" || meta.expect === "skip") {
    try {
      const out = UnEasyKicad.exportFootprint(dataStr, { name: meta.name || id });
      const dut = irFromKicad(out.content);
      // Malformed: should not emit zero-size pads for *valid* input;
      // for malformed, allow skip/error — if it emits, check no crash and log.
      const zeros = dut.pads.filter((p) => p.size_mm.w <= 0 || p.size_mm.h <= 0);
      if (zeros.length) {
        result.hardFails.push({
          id: "NEG",
          message: `malformed input emitted zero-size pads (${zeros.length})`
        });
        result.status = "BLOCKED";
      } else {
        result.status = "PASS";
        result.softFails.push({
          id: "NEG",
          message: `malformed fixture converted without crash (pads=${dut.pads.length})`
        });
      }
    } catch (e) {
      result.status = "PASS";
      result.softFails.push({
        id: "NEG",
        message: `explicit error as expected: ${e.message || e}`
      });
    }
    return result;
  }

  const eeParsed = irFromEasyeda(dataStr, { name: meta.name || id, package: meta.name });
  result.unhandledSummary = eeParsed.unhandledSummary;

  const out = UnEasyKicad.exportFootprint(dataStr, { name: meta.name || id });
  if (!isParseableKicadMod(out.content)) {
    result.status = "BLOCKED";
    result.hardFails.push({ id: "PARSE", message: "synthetic .kicad_mod failed to parse" });
    return result;
  }

  const dutIr = irFromKicad(out.content);
  const compareRef = refIr || eeParsed.ir;
  const cmp = compareFootprints(dutIr, compareRef, {
    meta,
    tolerances: meta.tolerances,
    unhandled: eeParsed.unhandled
  });
  result.hardFails.push(...cmp.hardFails);
  result.softFails.push(...cmp.softFails);
  result.padDeltas = cmp.padDeltas;

  // Synthetic-specific checks
  if (meta.expectOvalOrientation) {
    const pad = dutIr.pads.find((p) => p.drill_mm && p.drill_mm.oval_w != null);
    if (!pad) {
      result.hardFails.push({ id: "H7", message: "expected oval drill pad" });
    } else {
      const exp = meta.expectOvalOrientation;
      if (
        Math.abs(pad.drill_mm.oval_w - exp.oval_w) > 0.05 ||
        Math.abs(pad.drill_mm.oval_h - exp.oval_h) > 0.05
      ) {
        result.hardFails.push({
          id: "H7",
          message: `oval drill got ${pad.drill_mm.oval_w}x${pad.drill_mm.oval_h}, expected ${exp.oval_w}x${exp.oval_h}`
        });
      }
    }
  }

  for (const p of dutIr.pads) {
    if (p.size_mm.w <= 0 || p.size_mm.h <= 0) {
      result.hardFails.push({
        id: "ZERO",
        message: `zero-size pad "${p.number}"`
      });
    }
  }

  result.status = result.hardFails.length
    ? "BLOCKED"
    : result.softFails.length
      ? "WARN"
      : "PASS";
  return result;
}

function main() {
  let UnEasyKicad;
  try {
    UnEasyKicad = loadConverter();
  } catch (e) {
    console.error("Infra error loading converter:", e.message || e);
    process.exit(2);
  }

  const results = [];
  let infraError = false;

  const corpus = listCorpusEntries();
  console.log(`Corpus entries: ${corpus.length}`);
  for (const lcsc of corpus) {
    process.stdout.write(`• ${lcsc} ... `);
    try {
      const r = runCorpusCase(UnEasyKicad, lcsc);
      results.push(r);
      console.log(r.status);
    } catch (e) {
      infraError = true;
      results.push({
        id: lcsc,
        kind: "corpus",
        status: "ERROR",
        error: String(e.message || e),
        hardFails: [],
        softFails: []
      });
      console.log("ERROR", e.message || e);
    }
  }

  const synth = listSyntheticEntries();
  console.log(`Synthetic entries: ${synth.length}`);
  for (const id of synth) {
    process.stdout.write(`• synthetic:${id} ... `);
    try {
      const r = runSyntheticCase(UnEasyKicad, id);
      results.push(r);
      console.log(r.status);
    } catch (e) {
      infraError = true;
      results.push({
        id: `synthetic:${id}`,
        kind: "synthetic",
        status: "ERROR",
        error: String(e.message || e),
        hardFails: [],
        softFails: []
      });
      console.log("ERROR", e.message || e);
    }
  }

  const summary = {
    corpusTotal: corpus.length,
    syntheticTotal: synth.length,
    pass: results.filter((r) => r.status === "PASS").length,
    warn: results.filter((r) => r.status === "WARN").length,
    blocked: results.filter((r) => r.status === "BLOCKED").length,
    error: results.filter((r) => r.status === "ERROR").length
  };

  const report = {
    generatedAt: new Date().toISOString(),
    summary,
    results
  };

  ensureDir(ARTIFACTS);
  const { jsonPath, mdPath } = writeReports(ARTIFACTS, report);
  console.log(`\nWrote ${jsonPath}`);
  console.log(`Wrote ${mdPath}`);

  const summaryMd = githubJobSummary(report);
  const ghPath = process.env.GITHUB_STEP_SUMMARY;
  if (ghPath) {
    fs.appendFileSync(ghPath, summaryMd + "\n", "utf8");
  }
  console.log("\n" + summaryMd);

  // Tier coverage check (infra warn if incomplete)
  const tiers = {};
  for (const r of results.filter((x) => x.kind === "corpus")) {
    const t = r.tier || "?";
    tiers[t] = (tiers[t] || 0) + 1;
  }
  console.log("Tier counts:", tiers);

  if (infraError || summary.error > 0) {
    process.exit(2);
  }
  if (summary.blocked > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main();
