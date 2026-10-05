/**
 * Radix Select empty-value guard (role-walkthrough 2026-07-10 regression).
 *
 * Radix's <Select.Item /> THROWS at render when given value="" — and because
 * the throw happens inside render, the WHOLE page dies to the error boundary
 * (seen live: /provider/herbs/CANNABIS showed "เกิดข้อผิดพลาด" with the raw
 * Radix message; the admin herb-management surface was unusable). API-level
 * tests can't catch this class — the API responds fine; the crash is purely
 * client-side.
 *
 * Native <select> elements are exempt: value="" on an <option> is valid HTML
 * and is used legitimately (admin/audit-log, admin/communication,
 * provider/scheduler/queue). So this guard only scans files that import the
 * Radix-backed Select (`@/components/ui/select` or its primitives), where an
 * options/data entry of `{ value: '' }` is a guaranteed page crash.
 *
 * Fix pattern (see provider/herbs/[code]/page.tsx): use a sentinel such as
 * 'ALL' for the "everything" option and map it back to '' in state.
 */

import fs from 'node:fs';
import path from 'node:path';

const APP_ROOT = path.resolve(__dirname, '../../../app');

const RADIX_SELECT_IMPORT = /from\s+['"]@\/components\/ui\/(?:primitives\/)?select['"]/;
const EMPTY_VALUE_LITERAL = /\{\s*value:\s*(?:''|"")/;

function walk(dir: string, out: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
            walk(full, out);
        } else if (/\.tsx?$/.test(entry.name) && !/\.test\./.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

describe('Radix Select empty-value guard', () => {
    it('no file using the Radix Select passes an option with value \'\' (page-crash class)', () => {
        const offenders: string[] = [];
        for (const file of walk(APP_ROOT)) {
            const src = fs.readFileSync(file, 'utf8');
            if (RADIX_SELECT_IMPORT.test(src) && EMPTY_VALUE_LITERAL.test(src)) {
                offenders.push(path.relative(APP_ROOT, file));
            }
        }
        expect(offenders).toEqual([]);
    });
});
