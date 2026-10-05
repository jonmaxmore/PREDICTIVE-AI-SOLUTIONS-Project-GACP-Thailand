/**
 * Source pin: nothing under apps/backend/services or apps/backend/routes reaches
 * for the retired per-plant machinery any more.
 *
 * R8 of design note 2026-08-20-planting-tnt-design retires
 * per-plant tracking permanently (operator order, 2026-08-25, after a walk in
 * which one cycle-create press minted 500 PlantUnit rows that the harvest then
 * linked into its evidence chain). Resolution stops at the planting cycle / plot
 * and the Lot.
 *
 * Behaviour tests cover the doors we know about. This pin covers the ones nobody
 * thought to test: a stray require of the deleted plant-unit-service, or a call
 * to generatePlantUnits / linkToBatch re-added in a corner of the tree. It reads
 * the files on disk rather than the module graph, so a helper that is written but
 * not yet wired up is caught too.
 *
 * If this fails, the fix is to delete the reference — not to widen the allowlist.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const BACKEND_ROOT = path.resolve(__dirname, '../..');
const SCANNED_DIRS = ['services', 'routes'].map((d) => path.join(BACKEND_ROOT, d));

// Each identifier belonged to the per-plant generator or the harvest's per-plant
// linking loop; all three were deleted on 2026-08-25.
const RETIRED_IDENTIFIERS = [
  'generatePlantUnits',
  'linkToBatch',
  'plant-unit-service',
];

const CODE_EXTENSIONS = new Set(['.js', '.cjs', '.mjs', '.ts']);

function collectFiles(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') { continue; }
      collectFiles(full, out);
    } else if (CODE_EXTENSIONS.has(path.extname(entry.name))) {
      out.push(full);
    }
  }
  return out;
}

/**
 * Strip line and block comments before scanning. The removal deliberately leaves
 * comments that NAME what was deleted so nobody re-adds it — those explanations
 * are the point, and a pin that banned the words would push the next person into
 * deleting the only record of why the code is gone.
 */
function stripComments(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^[ \t]*\/\/.*$/gm, '')
    .replace(/([^:])\/\/.*$/gm, '$1');
}

describe('source pin — backend services + routes hold no per-plant references (spec R8)', () => {
  const files = SCANNED_DIRS.flatMap((dir) => collectFiles(dir));

  it('scans a non-trivial number of files, so a broken walk cannot pass vacuously', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  for (const identifier of RETIRED_IDENTIFIERS) {
    it(`no live code references "${identifier}"`, () => {
      const offenders = [];
      for (const file of files) {
        const code = stripComments(fs.readFileSync(file, 'utf8'));
        if (!code.includes(identifier)) { continue; }
        const line = code.split('\n').findIndex((l) => l.includes(identifier)) + 1;
        offenders.push(`${path.relative(BACKEND_ROOT, file).replace(/\\/g, '/')}:${line}`);
      }
      expect(offenders).toEqual([]);
    });
  }
});
