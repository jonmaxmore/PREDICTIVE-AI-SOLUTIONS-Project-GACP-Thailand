/**
 * X4-FIX-C / M-2 — accounting mutate-flow notification consistency.
 *
 * Closes X4-A audit gap N-1: several accounting mutate flows closed
 * silently. Users had to infer success from the row appearing in the
 * table.
 *
 * X4-FIX-C wires `toast.success(...)` into every successful mutate so
 * the feedback pattern is uniform across the surface. This regression
 * guard pins the wiring at the source level — Radix Dialog portals
 * away in jsdom so we cannot mount the modals end-to-end here.
 */

import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

function readClient(...segments: string[]): string {
    return readFileSync(resolve(__dirname, '..', ...segments), 'utf-8');
}

describe('[X4-FIX-C / M-2] accounting mutate flows — toast.success', () => {
    describe('Period close', () => {
        const SRC = readClient('period-close', 'client-view.tsx');

        it('imports `toast` from sonner', () => {
            expect(SRC).toMatch(/import\s+\{\s*toast\s*\}\s+from\s+['"]sonner['"]/);
        });

        it('calls toast.success after a successful close', () => {
            const block = SRC.match(/onClosed=\{[\s\S]{0,400}?toast\.success/);
            expect(block).not.toBeNull();
        });

        it('calls toast.success after a successful reopen', () => {
            const block = SRC.match(/onReopened=\{[\s\S]{0,400}?toast\.success/);
            expect(block).not.toBeNull();
        });
    });

    describe('Manual journal entries', () => {
        const SRC = readClient('manual-journal-entries', 'client-view.tsx');

        it('imports `toast` from sonner', () => {
            expect(SRC).toMatch(/import\s+\{\s*toast\s*\}\s+from\s+['"]sonner['"]/);
        });

        it('calls toast.success after a successful create-draft', () => {
            const block = SRC.match(/onCreated=\{[\s\S]{0,400}?toast\.success/);
            expect(block).not.toBeNull();
        });
    });

    describe('WHT certificate record', () => {
        const SRC = readClient('wht', 'client-view.tsx');

        it('imports `toast` from sonner', () => {
            expect(SRC).toMatch(/import\s+\{\s*toast\s*\}\s+from\s+['"]sonner['"]/);
        });

        it('calls toast.success after a successful record', () => {
            const block = SRC.match(/onRecorded=\{[\s\S]{0,400}?toast\.success/);
            expect(block).not.toBeNull();
        });
    });

    describe('Purchase invoices create', () => {
        const SRC = readClient('purchase-invoices', 'client-view.tsx');

        it('imports `toast` from sonner', () => {
            expect(SRC).toMatch(/import\s+\{\s*toast\s*\}\s+from\s+['"]sonner['"]/);
        });

        it('calls toast.success after a successful create', () => {
            const block = SRC.match(/onCreated=\{[\s\S]{0,400}?toast\.success/);
            expect(block).not.toBeNull();
        });
    });
});
