"use strict";

/**
 * Automated end-to-end symbol conversion tests (TRD docs/symbol-e2e-trd.md).
 * Exit: 0 pass, 1 hard/quarantine fail, 2 infra/fixture error.
 */

const fs = require("fs");
const path = require("path");
const { loadConverter } = require("../tests/symbols/lib/load-converter");
const { irFromEasyeda } = require("../tests/symbols/lib/ir-from-easyeda");
const { irFromKicad, isParseableKicadSym } = require("../tests/symbols/lib/ir-from-kicad");
const { compareSymbols, irEqual } = require("../tests/symbols/lib/compare");
const { writeReports, githubJobSummary, ensureDir } = require("../tests/symbols/lib/report");

const ROOT = path.join(__dirname, "..");
const CORPUS_DIR = path.join(ROOT, "tests", "symbols", "corpus");
const SYNTH_DIR = path.join(ROOT, "tests", "symbols", "synthetic");
const ARTIFACTS = path.join(ROOT, "artifacts");

const TIER_MIN = { A: 3, B: 3, C: 3, D: 2, E: 2, F: 2, G: 1 };

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

function convertTwice(UnEasyKicad, component, meta) {
  const a = UnEasyKicad.exportSymbolFromComponent(component, meta);
  const b = UnEasyKicad.exportSymbolFromComponent(component, meta);
  return { a, b };
}

function runCase(UnEasyKicad, id, kind, dir) {
  const metaPath = path.join(dir, "meta.json");
  const eePath = path.join(dir, "easyeda-symbol.json");
  const refPath = path.join(dir, "reference.ir.json");

  if (!fs.existsSync(metaPath) || !fs.existsSync(eePath)) {
    return {
      id,
      kind,
      status: "ERROR",
      error: "missing meta.json / easyeda-symbol.json",
      hardFails: [],
      softFails: []
    };
  }
  if (kind === "corpus" && !fs.existsSync(refPath)) {
    return {
      id,
      kind,
      status: "ERROR",
      error: "missing reference.ir.json",
      hardFails: [],
      softFails: []
    };
  }

  const meta = readJson(metaPath);
  const component = readJson(eePath);
  const refIr = fs.existsSync(refPath) ? readJson(refPath) : null;

  const eeParsed = irFromEasyeda(component, {
    lcsc: kind === "corpus" ? meta.lcsc || id : meta.lcsc || "",
    package: meta.package || meta.name,
    name: meta.name || meta.package || (kind === "corpus" ? meta.lcsc || id : id.replace(/^synthetic:/, ""))
  });

  const lcsc = kind === "corpus" ? meta.lcsc || id : "";
  const { a, b } = convertTwice(UnEasyKicad, component, {
    lcsc,
    name: meta.name || meta.package || lcsc || id.replace(/^synthetic:/, ""),
    package: meta.package || meta.name || lcsc || id.replace(/^synthetic:/, ""),
    mpn: meta.mpn || ""
  });

  const result = {
    id,
    kind,
    tier: meta.tier,
    risk: meta.risk,
    hardFails: [],
    softFails: [],
    labels: [],
    unhandledSummary: eeParsed.unhandledSummary,
    unhandled: eeParsed.unhandled
  };

  if (!isParseableKicadSym(a.content)) {
    result.status = "BLOCKED";
    result.hardFails.push({ id: "PARSE", message: "emitted .kicad_sym failed to parse" });
    return result;
  }

  if (eeParsed.visiblePinCount > 0 && (a.pinCount === 0 || !a.content)) {
    result.hardFails.push({
      id: "H1",
      message: `converter emitted pinCount=${a.pinCount} but EasyEDA had ${eeParsed.visiblePinCount} visible pins`
    });
  }

  const dutIr = irFromKicad(a.content, meta.package || meta.name);
  const dutIr2 = irFromKicad(b.content, meta.package || meta.name);
  if (!irEqual(dutIr, dutIr2)) {
    result.hardFails.push({
      id: "IDEM",
      message: "idempotency: two converts produced different IR"
    });
  }

  const cmp = compareSymbols(dutIr, eeParsed.ir, {
    meta,
    tolerances: meta.tolerances,
    unhandled: eeParsed.unhandled,
    eeParsed
  });

  result.hardFails.push(...cmp.hardFails);
  result.softFails.push(...cmp.softFails);
  result.labels.push(...cmp.labels);

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

  if (refIr && !irEqual(refIr, eeParsed.ir, 1e-4)) {
    result.softFails.push({
      id: "REFDRIFT",
      message: "frozen reference.ir.json differs from live EasyEDA IR (re-freeze?)"
    });
    if (result.status === "PASS") result.status = "WARN";
  }

  // Synthetic expectations
  if (meta.expect === "warn" && result.status === "PASS" && !result.softFails.length) {
    result.status = "WARN";
    result.softFails.push({ id: "EXPECT", message: "expected WARN status" });
  }

  return result;
}

function checkTierCoverage(results) {
  const tiers = {};
  for (const r of results.filter((x) => x.kind === "corpus")) {
    const t = r.tier || "?";
    tiers[t] = (tiers[t] || 0) + 1;
  }
  const missing = [];
  for (const [tier, min] of Object.entries(TIER_MIN)) {
    if ((tiers[tier] || 0) < min) {
      missing.push(`${tier}=${tiers[tier] || 0}/${min}`);
    }
  }
  return { tiers, missing };
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

  try {
    UnEasyKicad.exportSymbolFromComponent({}, { lcsc: "NEG" });
    results.push({
      id: "negative:missing-datastr",
      kind: "synthetic",
      status: "BLOCKED",
      hardFails: [{ id: "NEG", message: "missing dataStr did not throw" }],
      softFails: []
    });
    console.log("• negative:missing-datastr ... BLOCKED");
  } catch (e) {
    results.push({
      id: "negative:missing-datastr",
      kind: "synthetic",
      status: "PASS",
      hardFails: [],
      softFails: [],
      labels: [],
      unhandledSummary: ""
    });
    console.log("• negative:missing-datastr ... PASS");
  }

  const corpus = listCorpusEntries();
  console.log(`Corpus entries: ${corpus.length}`);
  for (const lcsc of corpus) {
    process.stdout.write(`• ${lcsc} ... `);
    try {
      const r = runCase(UnEasyKicad, lcsc, "corpus", path.join(CORPUS_DIR, lcsc));
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
      const r = runCase(UnEasyKicad, `synthetic:${id}`, "synthetic", path.join(SYNTH_DIR, id));
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

  const { tiers, missing } = checkTierCoverage(results);

  const summary = {
    corpusTotal: corpus.length,
    syntheticTotal: synth.length,
    pass: results.filter((r) => r.status === "PASS").length,
    warn: results.filter((r) => r.status === "WARN").length,
    blocked: results.filter((r) => r.status === "BLOCKED").length,
    error: results.filter((r) => r.status === "ERROR").length,
    tierCounts: tiers,
    tierGaps: missing
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
  console.log("Tier counts:", tiers);
  if (missing.length) {
    console.log("Tier gaps (infra):", missing.join(", "));
  }

  if (infraError || summary.error > 0) {
    process.exit(2);
  }
  if (corpus.length > 0 && missing.length) {
    process.exit(2);
  }
  if (summary.blocked > 0) {
    process.exit(1);
  }
  process.exit(0);
}

main();
