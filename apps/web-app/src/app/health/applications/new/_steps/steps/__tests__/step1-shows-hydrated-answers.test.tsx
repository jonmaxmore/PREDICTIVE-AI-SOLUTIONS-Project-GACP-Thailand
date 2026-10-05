/**
 * step1-shows-hydrated-answers.test.tsx — P3 (staging walk 2026-09-29,
 * the backlog), the store-to-screen half.
 *
 * step1-request-type.tsx renders its selection purely from
 * `state.requestType` / `state.applicantType` (ChoiceCard `selected` prop,
 * `aria-pressed`). This pins that a store already carrying a hydrated draft's
 * answers (as client-view.tsx now writes on edit-entry) renders BOTH cards
 * selected on mount, and that mounting the step does not itself change those
 * two fields — the second half of "autosave does not change them": if step 1
 * ever wrote a different value on bare mount, the 3-second autosave debounce
 * would persist that overwrite before the applicant touched anything.
 *
 * The real store is not usable here: it reaches for IndexedDB
 * (idb-keyval → indexedDB.open) synchronously at module load, which jsdom
 * does not provide (crashes the process, not a catchable rejection) — the
 * same trap use-application-flow-store.ts's own comment on `persistSettled`
 * describes. So the hook is mocked, same as every other test that mounts a
 * step component against a chosen store state.
 */

import * as React from 'react';
import { describe, expect, it, jest, afterEach } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockUpdateState = jest.fn();

jest.mock('../../hooks/use-application-flow-store', () => ({
    useApplicationFlowStore: () => ({
        state: {
            requestType: 'NEW',
            applicantType: 'JURISTIC',
            holderEntityId: 'e-company',
            certScope: 'PLANTING',
            plantId: 'cannabis',
            previousCertificateNumber: null,
        },
        updateState: mockUpdateState,
    }),
}));

jest.mock('@/lib/services/my-entities-provider', () => ({
    useMyEntities: () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { PERSONAL, COMPANY } = require('@/components/holder/__tests__/fixtures');
        return { entities: [PERSONAL, COMPANY], isLoading: false, error: null, refresh: async () => {} };
    },
}));
jest.mock('next/navigation', () => ({ useSearchParams: () => new URLSearchParams('') }));

import Step1RequestType from '../step1-request-type';

describe('Step1RequestType — a hydrated draft (JURISTIC + NEW) renders both answers selected', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    afterEach(() => {
        if (root) {
            act(() => { root?.unmount(); });
            root = null;
        }
        if (container) {
            container.remove();
            container = null;
        }
        mockUpdateState.mockClear();
    });

    it('shows ขอใหม่ and นิติบุคคล pressed, and does not overwrite them on mount', () => {
        container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            root = createRoot(container!);
            root!.render(<Step1RequestType />);
        });

        const pressedButtons = Array.from(container.querySelectorAll('button[aria-pressed="true"]'));
        const pressedText = pressedButtons.map((btn) => btn.textContent || '').join(' | ');

        expect(pressedText).toContain('ขอใหม่');
        expect(pressedText).toContain('นิติบุคคล');

        // Mounting alone must not overwrite requestType/applicantType — the plant-fill
        // effect only ever calls updateState({ plantId }) (single open plant), and
        // plantId already matches so it must not even fire that.
        for (const [update] of mockUpdateState.mock.calls as Array<[Record<string, unknown>]>) {
            expect(update).not.toHaveProperty('requestType');
            expect(update).not.toHaveProperty('applicantType');
            expect(update).not.toHaveProperty('holderEntityId');
        }
    });
});
