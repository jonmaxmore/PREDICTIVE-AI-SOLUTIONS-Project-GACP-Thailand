/**
 * No screen may hold its own copy of a price.
 *
 * Replaces the mirror tests that compared web literals to each other
 * (renewal-fee-display "the renewal numbers the frontend holds") and to the
 * backend (apps/backend/__tests__/unit/frontend-fee-mirror-cannot-drift.test.js).
 * A mirror pinned equal to the backend still shows the old price for as long as
 * a deploy lags a SystemConfig change; the fix is to have no mirror. Prices on
 * the web come from GET /api/pricing/fees through src/lib/pricing (server
 * components) or src/hooks/use-pricing.ts (client components), and the
 * behaviour is proven by fees-from-server.test.tsx with a response that differs
 * from every retired figure.
 *
 * What this file pins, by reading source:
 *   1. constants/fees.ts declares nothing at all. Its last value,
 *      PHASE_1_FEE_THRESHOLD (payment-service.ts guessed an invoice's phase
 *      from its amount with it), was removed in round 1 (2026-10-03).
 *   2. No file under src/ (tests aside) imports '@/constants/fees', and the
 *      barrel '@/constants' does not re-export it.
 *   3. The retired fee names are gone from src/ (tests aside), so nothing can
 *      pick one up again.
 *   4. The screens that show prices read the served fees.
 */

import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from '@jest/globals';

const SRC = path.join(__dirname, '..');
const read = (rel: string) => fs.readFileSync(path.join(SRC, rel), 'utf8');

function sourceFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === '__tests__' || entry.name === '__fixtures__' || entry.name === 'node_modules') continue;
            out.push(...sourceFiles(full));
        } else if (/\.(ts|tsx)$/.test(entry.name) && !/\.test\.(ts|tsx)$/.test(entry.name)) {
            out.push(full);
        }
    }
    return out;
}

const FILES = sourceFiles(SRC).map((f) => ({
    rel: path.relative(SRC, f).split(path.sep).join('/'),
    src: fs.readFileSync(f, 'utf8'),
}));

const RETIRED_NAMES = [
    'GACP_APPLICATION_FEE',
    'GACP_INSPECTION_FEE',
    'GACP_RENEWAL_FEE',
    'GACP_RENEWAL_PAYABLE_PER_SCOPE',
    'GACP_RENEWAL_CHARGE_COUNT',
    'GACP_VAT_RATE',
    'GACP_PHASE1_TOTAL',
    'GACP_PHASE2_TOTAL',
    'GACP_PER_TYPE_TOTAL',
    'GACP_FEE_LINE_ITEMS',
    'DEFAULT_FEES',
    'CULTIVATION_FEE_PER_METHOD',
    'PHASE_1_FEE_THRESHOLD',
];

describe('constants/fees.ts holds no price', () => {
    const fees = read('constants/fees.ts');
    const exported = [...fees.matchAll(/export\s+(?:const|function|let|var)\s+(\w+)/g)].map((m) => m[1]);

    it('exports nothing', () => {
        expect(exported).toEqual([]);
    });

    it('has no re-export form either (an empty `export {}` keeps it a module)', () => {
        expect(fees).not.toMatch(/export\s*\{\s*\w/);
        expect(fees).not.toMatch(/export\s*\*/);
    });
});

describe('no screen imports a literal fee', () => {
    it("nothing imports '@/constants/fees'", () => {
        const importers = FILES
            .filter((f) => /from\s+['"]@\/constants\/fees['"]/.test(f.src))
            .map((f) => f.rel);
        expect(importers).toEqual([]);
    });

    it("the '@/constants' barrel does not re-export it", () => {
        expect(read('constants/index.ts')).not.toMatch(/from\s+['"]\.\/fees['"]/);
    });


    // Code lines only: a comment recording that a name was removed is history,
    // not a reader of the value (same rule as ratchet.sh count_dup_source).
    const codeOnly = (src: string) => src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
        .join('\n');

    it.each(RETIRED_NAMES)('%s appears in no code under src/ (tests aside)', (name) => {
        const hits = FILES.filter((f) => new RegExp(`\\b${name}\\b`).test(codeOnly(f.src))).map((f) => f.rel);
        expect(hits).toEqual([]);
    });
});

describe('no amount is typed into a screen either', () => {
    // The figures the web held as constants until 2026-10-03, in every spelling
    // a source file could use.
    const FIGURES = ['5500', '27500', '33000', '35310', '5885', '29425'];
    const spellings = (n: string) => [n, n.replace(/(\d)(?=(\d{3})+$)/g, '$1_'), n.replace(/(\d)(?=(\d{3})+$)/g, '$1,')];
    const codeOnly = (src: string) => src
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .split('\n')
        .filter((line) => !/^\s*(\/\/|\*)/.test(line))
        .join('\n');

    it.each(FIGURES)('no code under src/ spells %s', (figure) => {
        const hits: string[] = [];
        for (const f of FILES) {
            const code = codeOnly(f.src);
            for (const sp of spellings(figure)) {
                if (new RegExp(`(^|[^0-9_,.])${sp}([^0-9_,]|$)`).test(code)) hits.push(`${f.rel} (${sp})`);
            }
        }
        expect(hits).toEqual([]);
    });

    // Round 5 (review MINOR 3): a VAT rate typed as a literal is the same defect
    // one step removed. Two screens split VAT out of an invoice total with
    // `total / 1.07 * 0.07`. A screen takes the split from the invoice row
    // (subtotal / vat) or from the served vatRate, never from a typed rate.
    it('no code under src/ types a VAT rate (0.07 / 1.07)', () => {
        const hits: string[] = [];
        for (const f of FILES) {
            codeOnly(f.src).split('\n').forEach((line) => {
                // (SVG path data such as `d="… -1.07 …"` is not a rate: a minus sign or a
                // digit before the figure excludes it.)
                if (/(^|[^0-9.\-])(1\.07|0\.07)(?![0-9])/.test(line)) hits.push(`${f.rel}: ${line.trim().slice(0, 80)}`);
            });
        }
        expect(hits).toEqual([]);
    });

    it('no code under src/ types a "N,NNN บาท" amount', () => {
        const hits = FILES
            .filter((f) => /[0-9]{1,3}(,[0-9]{3})+\s*บาท/.test(codeOnly(f.src)))
            .map((f) => f.rel);
        expect(hits).toEqual([]);
    });
});

describe('the price screens read the served fees', () => {
    const SERVER_SCREENS = [
        'app/(marketing)/pricing/page.tsx',
        'app/(marketing)/terms-of-service/page.tsx',
    ];
    const CLIENT_SCREENS = [
        'components/onboarding/OnboardingModal.tsx',
        'app/help/faq/faq-client.tsx',
        'app/health/onboarding/onboarding-client.tsx',
        'app/health/applications/[id]/client-view.tsx',
        'app/health/applications/renewal/payment-step.tsx',
    ];

    it.each(SERVER_SCREENS)('%s fetches the fees on the server', (rel) => {
        expect(read(rel)).toMatch(/fetchPublicFees\(\)/);
    });

    it.each(CLIENT_SCREENS)('%s reads the fees through the pricing hook', (rel) => {
        expect(read(rel)).toMatch(/use(?:Pricing|RenewalFee)\(\)/);
    });

    it('the renewal invoice step prints the register document, not a catalogue price (round 1)', () => {
        const src = read('app/health/applications/renewal/invoice-step.tsx')
            .replace(/\/\*[\s\S]*?\*\//g, '')
            .replace(/^\s*\/\/.*$/gm, '');
        expect(src).toMatch(/PaymentService\.getMyPayments\(\)/);
        expect(src).not.toMatch(/use(?:Pricing|RenewalFee)\(\)/);
        expect(src).not.toMatch(/Date\.now\(\)/);
    });
});
