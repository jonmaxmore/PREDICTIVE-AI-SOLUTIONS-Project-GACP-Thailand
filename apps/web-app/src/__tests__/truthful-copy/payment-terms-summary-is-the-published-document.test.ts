/**
 * The payment-terms summary the web shows is taken from the document the
 * backend records acceptance of.
 *
 * Three independent artifacts: the summary module this bundle renders
 * (src/constants/payment-terms.ts), the published markdown
 * (docs/legal/payment-terms-th-v*.md), and the version the backend stamps on a
 * new grant (PUBLISHED_CONSENT_VERSIONS in middleware/consent-manager.js). The
 * names and coverage are compared with the catalogue export
 * (lib/pricing/fee-services.ts, the web mirror of SERVICE_CATALOGUE).
 *
 * Publishing v1.3 moves the backend default (its own test pins it to the newest
 * file on disk); this suite then goes red until the summary is rewritten from
 * the new text.
 */

import { describe, expect, it } from '@jest/globals';
import * as fs from 'fs';
import * as path from 'path';

import { readRepoFile, REPO_ROOT } from './backend-record';
import * as terms from '@/constants/payment-terms';
import { FEE_SERVICES_FALLBACK } from '@/lib/pricing/fee-services';

/** Applicant-facing text of a legal markdown file, flattened for substring checks. */
function flatten(doc: string): string {
    return doc
        .replace(/<!--[\s\S]*?-->/g, '')
        .replace(/\*\*/g, '')
        .replace(/\s+/g, ' ');
}

function backendPublishedVersion(): string {
    const m = readRepoFile('apps/backend/middleware/consent-manager.js')
        .match(/const PUBLISHED_CONSENT_VERSIONS = Object\.freeze\(\{[\s\S]*?PAYMENT_TERMS:\s*'([^']+)'/);
    if (!m || !m[1]) throw new Error('PUBLISHED_CONSENT_VERSIONS.PAYMENT_TERMS no longer matches; update this reader');
    return m[1];
}

describe('the payment-terms summary is the published document', () => {
    it('is written from the version the backend records a new grant under', () => {
        expect(terms.PAYMENT_TERMS_SUMMARY_VERSION).toBe(backendPublishedVersion());
        expect(fs.existsSync(path.join(REPO_ROOT, 'docs/legal', `${terms.PAYMENT_TERMS_SUMMARY_VERSION}.md`))).toBe(true);
    });

    it('its title and edition are the document heading', () => {
        const heading = readRepoFile(`docs/legal/${terms.PAYMENT_TERMS_SUMMARY_VERSION}.md`).split('\n')[0];
        expect(heading).toBe(`# ${terms.PAYMENT_TERMS_TITLE_TH} (ฉบับที่ ${terms.PAYMENT_TERMS_EDITION_TH})`);
    });

    it('every line it shows is text the document states', () => {
        const doc = flatten(readRepoFile(`docs/legal/${terms.PAYMENT_TERMS_SUMMARY_VERSION}.md`));
        for (const item of terms.PAYMENT_TERMS_SERVICE_LINES) {
            expect(doc).toContain(`${item.name}: ${item.covers}`);
        }
        expect(doc).toContain(terms.PAYMENT_TERMS_ONE_FEE_TH);
        expect(doc).toContain(terms.PAYMENT_TERMS_PRICE_BINDING_TH);
    });

    it('names the lines exactly as the catalogue the quotation, invoice and receipt print', () => {
        // FEE_SERVICES_FALLBACK is the one web mirror of the backend SERVICE_CATALOGUE
        // (pinned field for field by apps/backend/__tests__/unit/fee-service-catalogue-web-mirror.test.js).
        const keys = ['PHASE_1', 'PHASE_2', 'RENEWAL'] as const;
        expect(terms.PAYMENT_TERMS_SERVICE_LINES.map((l) => l.name)).toEqual(
            keys.map((k) => FEE_SERVICES_FALLBACK[k].name),
        );
        expect(terms.PAYMENT_TERMS_SERVICE_LINES.map((l) => `ครอบคลุม: ${l.covers}`)).toEqual(
            keys.map((k) => FEE_SERVICES_FALLBACK[k].coverage),
        );
    });

    it('carries no state/platform split', () => {
        const all = JSON.stringify(terms);
        expect(all).not.toContain('ค่าธรรมเนียมรัฐ');
        expect(all).not.toContain('ค่าบริการแพลตฟอร์ม');
    });
});
