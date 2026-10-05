/**
 * W1-WIZARD — outcome classification for the wizard's two gating fetches
 * (GET /applications/config, GET /applications/draft).
 *
 * The bug these helpers fix: a 503/network failure on either fetch was
 * swallowed inside application-step-page.tsx, leaving farmers on bad
 * networks with a spinner / silently-defaulted form and no way to retry.
 * The api-client NEVER rejects — it returns `{ success: false, ... }`
 * envelopes — so "backend unreachable" must be detected from the envelope,
 * not from a thrown error.
 *
 * Semantics anchored here:
 *   1. Config: `success: false` (503, network, timeout) → 'unavailable' —
 *      the caller must render the graceful error state, never silently
 *      fall back to default steps.
 *   2. Config: `success: true` + non-empty steps → filtered ALL_STEPS;
 *      `success: true` without steps → the full default list (backend
 *      answered, no per-plant override — same behavior as before).
 *   3. Draft: `success: false` → 'unavailable'. A genuine "no draft" is
 *      HTTP 200 `{success:true, data:null}` (see backend
 *      routes/api/applications/applications.js GET /draft), which the
 *      api-client unwraps to the envelope-echo `{success, data:null}` —
 *      that and any draft without formData.plantId classify as 'empty'
 *      (blank form is correct), NEVER as 'unavailable'.
 */

import { resolveActiveSteps, classifyDraftResponse } from '../hooks/wizard-load-outcome';

// Minimal step fixtures — no icon imports (they drag Lucide ESM into ts-jest).
const STEPS = [
    { stepNumber: 1, key: 'consent' },
    { stepNumber: 2, key: 'plant_selection' },
    { stepNumber: 4, key: 'general' },
] as const;

describe('resolveActiveSteps', () => {
    it('returns unavailable on a failed envelope (backend 503)', () => {
        const outcome = resolveActiveSteps(
            { success: false, error: 'Service unavailable', status: 503 },
            STEPS,
        );
        expect(outcome).toEqual({ kind: 'unavailable' });
    });

    it('returns unavailable on a network-error envelope (no status)', () => {
        const outcome = resolveActiveSteps(
            { success: false, error: 'Unable to connect to server' },
            STEPS,
        );
        expect(outcome).toEqual({ kind: 'unavailable' });
    });

    it('filters ALL_STEPS by the backend step numbers on success', () => {
        const outcome = resolveActiveSteps(
            { success: true, data: { steps: [1, 4] } },
            STEPS,
        );
        expect(outcome.kind).toBe('ok');
        if (outcome.kind === 'ok') {
            expect(outcome.steps.map((s) => s.stepNumber)).toEqual([1, 4]);
        }
    });

    it('falls back to the full default list when success carries no steps', () => {
        for (const data of [undefined, {}, { steps: [] }] as const) {
            const outcome = resolveActiveSteps(
                { success: true, ...(data !== undefined ? { data } : {}) },
                STEPS,
            );
            expect(outcome.kind).toBe('ok');
            if (outcome.kind === 'ok') {
                expect(outcome.steps.map((s) => s.stepNumber)).toEqual([1, 2, 4]);
            }
        }
    });
});

describe('classifyDraftResponse', () => {
    it('returns unavailable on a failed envelope (backend 503)', () => {
        expect(
            classifyDraftResponse({ success: false, error: 'Service unavailable', status: 503 }),
        ).toEqual({ kind: 'unavailable' });
    });

    it('returns unavailable on a network-error envelope', () => {
        expect(
            classifyDraftResponse({ success: false, error: 'Unable to connect to server' }),
        ).toEqual({ kind: 'unavailable' });
    });

    it('classifies the backend "no draft" 200 (envelope echo, data:null) as empty', () => {
        // api-client unwraps `{success:true, data:null}` to `body.data ?? body`,
        // i.e. the caller sees the envelope itself — formData is absent.
        expect(
            classifyDraftResponse({ success: true, data: { success: true, data: null } as never }),
        ).toEqual({ kind: 'empty' });
    });

    it('classifies a draft without formData.plantId as empty (blank form is correct)', () => {
        expect(
            classifyDraftResponse({ success: true, data: { draftId: 'd1', formData: {} } }),
        ).toEqual({ kind: 'empty' });
    });

    it('returns the draft when formData.plantId is present', () => {
        const draft = { draftId: 'd1', formData: { plantId: 'cannabis' } };
        expect(classifyDraftResponse({ success: true, data: draft })).toEqual({
            kind: 'draft',
            draft,
        });
    });
});

// Review-pass additions: definitive 4xx envelopes carry a backend verdict —
// they must never produce the endless "temporary glitch, retry" state.
describe('definitive 4xx handling (review pass)', () => {
    const STEPS = [{ stepNumber: 1 }, { stepNumber: 2 }, { stepNumber: 3 }];

    it('config 403 falls back to the default step list instead of unavailable', () => {
        const out = resolveActiveSteps({ success: false, status: 403 }, STEPS);
        expect(out.kind).toBe('ok');
        if (out.kind === 'ok') expect(out.steps).toHaveLength(3);
    });

    it('config 503 is still unavailable', () => {
        expect(resolveActiveSteps({ success: false, status: 503 }, STEPS).kind).toBe('unavailable');
    });

    it('draft 404 classifies as empty (blank form), not unavailable', () => {
        expect(classifyDraftResponse({ success: false, status: 404 }).kind).toBe('empty');
    });

    it('draft network failure (no status) stays unavailable', () => {
        expect(classifyDraftResponse({ success: false }).kind).toBe('unavailable');
    });
});
