#!/usr/bin/env node
/**
 * CI: merge the Istanbul coverage of the unit job and every integration shard, then enforce the
 * global thresholds from jest.config.js on the merged result.
 *
 * Usage: node scripts/merge-coverage.js <dir> [<outFile>]
 *   <dir>     holds one sub-folder per job, each with a coverage-final.json (artifacts downloaded side by side)
 *   <outFile> merged coverage-final.json (default: <dir>/merged/coverage-final.json)
 * Exit 1 when any threshold is missed. Uses the same summary maths as Jest's own threshold check.
 */
const fs = require('fs');
const path = require('path');
const { createCoverageMap } = require('istanbul-lib-coverage');
const { coverageThreshold } = require('../jest.config');

const dir = process.argv[2];
if (!dir) {
  console.error('usage: merge-coverage.js <dir> [<outFile>]');
  process.exit(2);
}
const outFile = process.argv[3] || path.join(dir, 'merged', 'coverage-final.json');

const inputs = fs
  .readdirSync(dir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => path.join(dir, e.name, 'coverage-final.json'))
  .filter((f) => fs.existsSync(f) && path.resolve(f) !== path.resolve(outFile)); // never re-read our own output
if (inputs.length === 0) {
  console.error(`merge-coverage: no coverage-final.json under ${dir}`);
  process.exit(2);
}

const map = createCoverageMap({});
for (const f of inputs) {
  map.merge(JSON.parse(fs.readFileSync(f, 'utf8')));
  console.log(`merged ${f}`);
}

fs.mkdirSync(path.dirname(outFile), { recursive: true });
fs.writeFileSync(outFile, JSON.stringify(map.toJSON()));

const summary = map.getCoverageSummary().toJSON();
let failed = false;
console.log('\nmetric       covered/total      pct   threshold');
for (const [metric, min] of Object.entries(coverageThreshold.global)) {
  const { covered, total, pct } = summary[metric];
  const ok = pct >= min;
  if (!ok) failed = true;
  console.log(`${metric.padEnd(11)} ${`${covered}/${total}`.padStart(13)} ${pct.toFixed(2).padStart(8)}%  >= ${min}  ${ok ? 'ok' : 'FAIL'}`);
}
if (failed) {
  console.error('\nCoverage is below the global threshold in jest.config.js.');
  process.exit(1);
}
