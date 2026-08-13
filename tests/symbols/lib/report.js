"use strict";

const fs = require("fs");
const path = require("path");

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function writeReports(artifactsDir, report) {
  ensureDir(artifactsDir);
  const jsonPath = path.join(artifactsDir, "symbol-report.json");
  const mdPath = path.join(artifactsDir, "symbol-report.md");
  fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2), "utf8");
  fs.writeFileSync(mdPath, toMarkdown(report), "utf8");
  return { jsonPath, mdPath };
}

function toMarkdown(report) {
  const lines = [];
  lines.push("# Symbol E2E Report");
  lines.push("");
  lines.push(`- Generated: ${report.generatedAt}`);
  lines.push(`- Corpus: ${report.summary.corpusTotal} | Synthetic: ${report.summary.syntheticTotal}`);
  lines.push(
    `- PASS: ${report.summary.pass} | WARN: ${report.summary.warn} | BLOCKED: ${report.summary.blocked} | ERROR: ${report.summary.error}`
  );
  if (report.summary.tierCounts) {
    lines.push(`- Tier counts: ${JSON.stringify(report.summary.tierCounts)}`);
  }
  lines.push("");

  const blocked = report.results.filter((r) => r.status === "BLOCKED" || r.status === "ERROR");
  if (blocked.length) {
    lines.push("## BLOCKED / ERROR");
    lines.push("");
    for (const r of blocked) {
      lines.push(`### ${r.id}`);
      if (r.unhandledSummary) lines.push(`- UNHANDLED: ${r.unhandledSummary}`);
      if (r.labels && r.labels.length) lines.push(`- Labels: ${r.labels.join(", ")}`);
      for (const f of r.hardFails || []) {
        lines.push(`- **${f.id}**: ${f.message}`);
      }
      if (r.error) lines.push(`- Error: ${r.error}`);
      lines.push("");
    }
  }

  lines.push("## All results");
  lines.push("");
  lines.push("| ID | Status | Hard | Soft | Unhandled |");
  lines.push("| --- | --- | ---: | ---: | --- |");
  for (const r of report.results) {
    lines.push(
      `| ${r.id} | ${r.status} | ${(r.hardFails || []).length} | ${(r.softFails || []).length} | ${r.unhandledSummary || ""} |`
    );
  }
  lines.push("");

  const warns = report.results.filter((r) => (r.softFails || []).length);
  if (warns.length) {
    lines.push("## Soft failures / quarantine notes");
    lines.push("");
    for (const r of warns) {
      lines.push(`### ${r.id}`);
      for (const f of r.softFails || []) {
        lines.push(`- ${f.id}: ${f.message}`);
      }
      lines.push("");
    }
  }

  return lines.join("\n");
}

function githubJobSummary(report) {
  const blocked = report.results
    .filter((r) => r.status === "BLOCKED" || r.status === "ERROR")
    .map((r) => r.id);
  const lines = [];
  lines.push("### Symbol E2E");
  lines.push("");
  lines.push(
    `PASS ${report.summary.pass} · WARN ${report.summary.warn} · BLOCKED ${report.summary.blocked} · ERROR ${report.summary.error}`
  );
  if (report.summary.tierCounts) {
    lines.push(`Tiers: ${JSON.stringify(report.summary.tierCounts)}`);
  }
  if (blocked.length) {
    lines.push("");
    lines.push(`**BLOCKED:** ${blocked.join(", ")}`);
  }
  return lines.join("\n");
}

module.exports = { writeReports, toMarkdown, githubJobSummary, ensureDir };
