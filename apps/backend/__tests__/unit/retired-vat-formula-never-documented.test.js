'use strict';

/**
 * F-G4-37 — the retired VAT formula must not survive as documentation.
 *
 * W14 (operator ruling 2026-08-22, the change log c28355ea) moved the VAT base
 * from the platform portion alone to the WHOLE ค่าบริการ (state + platform):
 * the SSOT is modules/billing/internal/fee-service.js buildPhaseFee, and
 * money-equation-property.test.js pins it. A comment that still states
 * "vat = Math.round(platform × VAT_RATE)" or "VAT on the platform fee only"
 * teaches the next reader the wrong equation, so this test reads the checkout
 * services and the billing module as text and fails on any such phrase.
 */

const fs = require('fs');
const path = require('path');

const BACKEND = path.resolve(__dirname, '..', '..');

const RETIRED_FORMULA = /platform\s*(?:×|\*)\s*VAT_RATE|VAT on the platform fee only/i;

function listJsFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules' || entry.name === '__tests__') continue;
            out.push(...listJsFiles(full));
        } else if (entry.isFile() && entry.name.endsWith('.js')) {
            out.push(full);
        }
    }
    return out;
}

function findRetiredFormula(files) {
    const hits = [];
    for (const file of files) {
        const lines = fs.readFileSync(file, 'utf8').split(/\r?\n/);
        lines.forEach((line, idx) => {
            if (RETIRED_FORMULA.test(line)) {
                hits.push(`${path.relative(BACKEND, file).replace(/\\/g, '/')}:${idx + 1}: ${line.trim()}`);
            }
        });
    }
    return hits;
}

describe('retired VAT formula (VAT on the platform fee only) is never documented again', () => {
    const scanned = [
        ...listJsFiles(path.join(BACKEND, 'services', 'checkout')),
        ...listJsFiles(path.join(BACKEND, 'modules', 'billing')),
    ];

    test('the scan covers the checkout services and the billing module', () => {
        expect(scanned.map((f) => path.relative(BACKEND, f).replace(/\\/g, '/'))).toEqual(expect.arrayContaining([
            'services/checkout/checkout-settlement-service.js',
            'services/checkout/stripe-checkout-service.js',
            'modules/billing/internal/fee-service.js',
        ]));
    });

    test('no file states vat = platform × VAT_RATE or "VAT on the platform fee only"', () => {
        expect(findRetiredFormula(scanned)).toEqual([]);
    });
});
