#!/usr/bin/env node
/* eslint-disable */

// Advisory reporter for the coverage ratchet: names production files that already reach 100% on
// all four Istanbul metrics (branches, functions, lines, statements) but are not yet listed in
// jest.coverage-gate.config.js (PINNED_LOGIC / PINNED_DECLARATIVE). The gate only protects paths
// someone entered by hand, so a file can become complete without anyone noticing — and a later
// change can erode it without turning CI red. This script reads the run's own json-summary report
// and prints those candidates so humans can pin them.
//
// Intentionally never fails: a PR can complete a file it never touched, and failing for that would
// train the team to ignore a red gate. Missing or unreadable reports (e.g. the gate failed before
// writing coverage-summary.json) are treated as "nothing to report" and still exit 0.
//
// Usage: node scripts/coverage-unpinned-complete.js [coverage-summary.json]
// Default report path (cwd-relative): coverage-gate/coverage-summary.json

const fs = require('fs');
const path = require('path');

const DEFAULT_REPORT = 'coverage-gate/coverage-summary.json';
const METRICS = ['branches', 'functions', 'lines', 'statements'];
const LABEL_LOGIC = 'PINNED_LOGIC';
const LABEL_DECLARATIVE = 'PINNED_DECLARATIVE';
// Align both prefixes to the longer constant so paths start in the same column.
const LABEL_WIDTH = LABEL_DECLARATIVE.length;

function main() {
  const reportPath = process.argv[2] || DEFAULT_REPORT;

  if (!fs.existsSync(reportPath)) {
    console.log(
      `Coverage ratchet: coverage summary not found at ${reportPath} ` +
        `(gate likely failed before writing it); nothing to report.`,
    );
    process.exit(0);
  }

  let raw;
  try {
    raw = fs.readFileSync(reportPath, 'utf8');
  } catch {
    console.log(
      `Coverage ratchet: coverage summary not found at ${reportPath} ` +
        `(gate likely failed before writing it); nothing to report.`,
    );
    process.exit(0);
  }

  let summary;
  try {
    summary = JSON.parse(raw);
  } catch {
    console.log('Coverage ratchet: coverage summary is not valid JSON; nothing to report.');
    process.exit(0);
  }

  const config = require(path.join(__dirname, '..', 'jest.coverage-gate.config.js'));
  const pinned = new Set(Object.keys(config.coverageThreshold));

  const unpinned = [];

  for (const [fileKey, entry] of Object.entries(summary)) {
    if (fileKey === 'total') continue;
    if (!entry || typeof entry !== 'object') continue;

    const allHundred = METRICS.every((m) => {
      const node = entry[m];
      return node && typeof node.pct === 'number' && node.pct === 100;
    });
    if (!allHundred) continue;

    const rel = normalizeToSrc(fileKey);
    if (!rel) continue;
    if (pinned.has(rel)) continue;

    const functionsTotal = entry.functions && typeof entry.functions.total === 'number' ? entry.functions.total : 0;
    const branchesTotal = entry.branches && typeof entry.branches.total === 'number' ? entry.branches.total : 0;
    const label = functionsTotal > 0 || branchesTotal > 0 ? LABEL_LOGIC : LABEL_DECLARATIVE;

    unpinned.push({ label, rel });
  }

  unpinned.sort((a, b) => {
    if (a.rel < b.rel) return -1;
    if (a.rel > b.rel) return 1;
    return 0;
  });

  if (unpinned.length === 0) {
    console.log('Coverage ratchet: every file at 100% is pinned.');
  } else {
    console.log(`Coverage ratchet: ${unpinned.length} file(s) reach 100% on all four metrics but are not pinned.`);
    console.log('');
    for (const { label, rel } of unpinned) {
      console.log(`  ${label.padEnd(LABEL_WIDTH)}  ${rel}`);
    }
    console.log('');
    console.log('Nothing guards these today: a later change can erode them without turning the gate red.');
    console.log(
      'Add each path to the matching array in jest.coverage-gate.config.js — see docs/coverage-gate.md, "How the list grows".',
    );
  }

  const stepSummary = process.env.GITHUB_STEP_SUMMARY;
  if (stepSummary) {
    try {
      let md = '## Coverage ratchet: unpinned complete files\n\n';
      if (unpinned.length === 0) {
        md += 'Coverage ratchet: every file at 100% is pinned.\n';
      } else {
        for (const { label, rel } of unpinned) {
          md += `- ${label} \`${rel}\`\n`;
        }
      }
      fs.appendFileSync(stepSummary, md);
    } catch {
      // Advisory only: never fail the job if the summary file is unwritable.
    }
  }

  process.exit(0);
}

/**
 * Turn an Istanbul absolute path (or an already-relative key) into a repo-relative `src/...` path.
 * Returns null when the file is outside `src/`.
 */
function normalizeToSrc(fileKey) {
  if (fileKey.startsWith('src/')) return fileKey;

  const idx = fileKey.lastIndexOf('/src/');
  if (idx === -1) return null;

  // Slice from the 's' of 'src/' — skip the leading slash of '/src/'.
  return fileKey.slice(idx + 1);
}

try {
  main();
} catch {
  process.exit(0);
}
