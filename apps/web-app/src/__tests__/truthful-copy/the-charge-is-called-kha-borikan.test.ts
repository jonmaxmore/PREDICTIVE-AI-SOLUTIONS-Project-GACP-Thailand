/**
 * The company's one charge is called ค่าบริการ on every screen
 * (operator 2026-09-11: "จะเป็นค่าบริการทั้งหมด"; fix/fees-from-server round 1,
 * 2026-10-03).
 *
 * The marketing menu still sent visitors to the price list under
 * "ค่าธรรมเนียม" while the page itself is titled ค่าบริการ, and the app's
 * status, dashboard, wizard, help and payment copy said ค่าธรรมเนียม for the
 * same charge.
 *
 * What may still say ค่าธรรมเนียม, and why:
 *   - legal text, listed and left for the operator: privacy-policy/page.tsx,
 *     and the pricing page line that names the accepted legal document by its
 *     own title ("เงื่อนไขการชำระค่าธรรมเนียมและการคืนเงิน");
 *   - a different thing: ค่าธรรมเนียมรัฐ / ภาครัฐ (the retired state fee, shown
 *     only on legacy rows), bank and transfer fees (accounting);
 *   - search aliases (FAQ `keywords`), so a visitor typing the old word still
 *     finds the answer, and `oldSystemRef` (the old system's step names);
 *   - staff accounting screens (app/provider/accounting, accounting-service).
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from '@jest/globals';

const SRC = path.join(__dirname, '..', '..');

function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (['__tests__', '__fixtures__', 'node_modules'].includes(entry.name)) continue;
            out.push(...sourceFiles(full));
        } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

const LEGAL_OR_STAFF = [
    /^app\/\(marketing\)\/privacy-policy\//,
    /^app\/provider\/accounting\//,
    /^lib\/services\/accounting-service\.ts$/,
];

const ALLOWED_LINE = [
    /ค่าธรรมเนียม(รัฐ|ภาครัฐ|ธนาคาร|โอน)/,
    /keywords:/,
    /oldSystemRef:/,
    /เงื่อนไขการชำระค่าธรรมเนียมและการคืนเงิน/,
];

const codeLines = (src: string) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .split('\n')
    .filter((line) => !/^\s*\/\//.test(line));

describe('the company charge is ค่าบริการ', () => {
    it('the marketing menu names the price list ค่าบริการ', () => {
        const header = fs.readFileSync(path.join(SRC, 'components/marketing/marketing-header.tsx'), 'utf8');
        expect(header).toMatch(/\{\s*href:\s*'\/pricing',\s*label:\s*'ค่าบริการ'\s*\}/);
    });

    it('no screen calls it ค่าธรรมเนียม outside the listed exceptions', () => {
        const hits: string[] = [];
        for (const file of sourceFiles(SRC)) {
            const rel = path.relative(SRC, file).split(path.sep).join('/');
            if (LEGAL_OR_STAFF.some((re) => re.test(rel))) continue;
            codeLines(fs.readFileSync(file, 'utf8')).forEach((line) => {
                if (!line.includes('ค่าธรรมเนียม')) return;
                if (ALLOWED_LINE.some((re) => re.test(line))) return;
                hits.push(`${rel}: ${line.trim().slice(0, 80)}`);
            });
        }
        expect(hits).toEqual([]);
    });
});
