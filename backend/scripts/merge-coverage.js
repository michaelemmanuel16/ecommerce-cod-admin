#!/usr/bin/env node
/**
 * CI: merge the Istanbul coverage of the unit job and every integration shard, write ONE lcov file, and
 * enforce the global thresholds from jest.config.js on the merged result.
 *
 * Usage: node scripts/merge-coverage.js <dir> <lcovOut>
 *   <dir>     holds one sub-folder per job, each with a coverage-final.json (artifacts downloaded side by side)
 *   <lcovOut> the merged lcov file, e.g. coverage-in/merged/lcov.info
 * Exit 1 when any threshold is missed. Uses the same summary maths as Jest's own threshold check.
 */
const fs = require('fs');
const path = require('path');
const { createRequire } = require('module');
const { createCoverageMap } = require('istanbul-lib-coverage');
const { coverageThreshold } = require('../jest.config');

// istanbul-lib-report and istanbul-reports come with Jest (nested under @jest/reporters), not as our own dependency.
const fromJest = createRequire(require.resolve('@jest/reporters'));
const libReport = fromJest('istanbul-lib-report');
const reports = fromJest('istanbul-reports');

const [dir, lcovOut] = process.argv.slice(2);
if (!dir || !lcovOut) {
  console.error('usage: merge-coverage.js <dir> <lcovOut>');
  process.exit(2);
}

const inputs = fs
  .readdirSync(dir, { withFileTypes: true })
  .filter((e) => e.isDirectory())
  .map((e) => path.join(dir, e.name, 'coverage-final.json'))
  .filter((f) => fs.existsSync(f));
if (inputs.length === 0) {
  console.error(`merge-coverage: no coverage-final.json under ${dir}`);
  process.exit(2);
}

const map = createCoverageMap({});
for (const f of inputs) {
  map.merge(JSON.parse(fs.readFileSync(f, 'utf8')));
  console.log(`merged ${f}`);
}

fs.mkdirSync(path.dirname(lcovOut), { recursive: true });
reports
  .create('lcovonly', { file: path.basename(lcovOut) })
  .execute(libReport.createContext({ dir: path.dirname(lcovOut), coverageMap: map }));
console.log(`wrote ${lcovOut}`);

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
