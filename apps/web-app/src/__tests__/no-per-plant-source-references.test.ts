/**
 * Source pin: nothing under apps/web-app/src offers the user a per-plant door.
 *
 * R8 of design note 2026-08-20-planting-tnt-design retires
 * per-plant tracking permanently (operator order, 2026-08-25, after a walk in
 * which one cycle-create press minted 500 PlantUnit rows that the harvest then
 * linked into its evidence chain). Resolution stops at the planting cycle / plot
 * and the Lot. "จำนวนต้น" survives only as a declared number on the cycle.
 *
 * Two things are pinned:
 *   - `listPlantUnits`, the client call that read the per-plant registry. The
 *     endpoint behind it is gone, so any surviving caller is a 404 waiting to
 *     happen — and a reason for someone to "fix" it by restoring the route.
 *   - the Thai string 'สร้างรายต้น' ("create per plant"), the button that
 *     started the whole thing. A retired feature whose button is still on screen
 *     is not retired.
 *
 * The scan reads files on disk rather than the module graph, so a component that
 * is written but not yet routed is caught too. If this fails, the fix is to
 * delete the reference — not to widen the allowlist.
 */
import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';

const SRC_ROOT = path.resolve(__dirname, '..');
const CODE_EXTENSIONS = new Set(['.ts', '.tsx', '.js', '.jsx']);

// The per-plant client call, and the Thai label on the door it opened.
const RETIRED_REFERENCES = ['listPlantUnits', 'สร้างรายต้น'];

function collectFiles(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '__tests__') { continue; }
            collectFiles(full, out);
        } else if (CODE_EXTENSIONS.has(path.extname(entry.name))) {
            out.push(full);
        }
    }
    return out;
}

/**
 * Strip comments before scanning. The removal deliberately leaves comments that
 * NAME what was deleted so nobody re-adds it — those explanations are the point,
 * and a pin that banned the words would push the next person into deleting the
 * only record of why the code is gone.
 */
function stripComments(source: string): string {
    return source
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/\{\s*\/\*[\s\S]*?\*\/\s*\}/g, '')
        .replace(/^[ \t]*\/\/.*$/gm, '')
        .replace(/([^:])\/\/.*$/gm, '$1');
}

describe('source pin — apps/web-app/src renders no per-plant door (spec R8)', () => {
    const files = collectFiles(SRC_ROOT);

    it('scans a non-trivial number of files, so a broken walk cannot pass vacuously', () => {
        expect(files.length).toBeGreaterThan(100);
    });

    it.each(RETIRED_REFERENCES)('no live source references %s', (needle) => {
        const offenders: string[] = [];
        for (const file of files) {
            const code = stripComments(fs.readFileSync(file, 'utf8'));
            if (!code.includes(needle)) { continue; }
            const line = code.split('\n').findIndex((l) => l.includes(needle)) + 1;
            offenders.push(`${path.relative(SRC_ROOT, file).replace(/\\/g, '/')}:${line}`);
        }
        expect(offenders).toEqual([]);
    });
});
