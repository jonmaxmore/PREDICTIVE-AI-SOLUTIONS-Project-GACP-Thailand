/**
 * Walk D3: the slot card's delete control is enabled only while the server says the
 * filing is still editable. The answer travels GET /requirements → useRequirementSlots
 * → the step → the card; this pins the two hops a card test cannot see.
 *
 * Pattern: HookHarness + createRoot/act (mirrors first-filing-sees-its-documents.test.tsx).
 */
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
    // eslint-disable-next-line no-var
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mockFetch = jest.fn<(appId: string) => Promise<{ slots: unknown[]; editable?: boolean }>>();
jest.mock('@/lib/services/application-requirements', () => {
    const actual = jest.requireActual('@/lib/services/application-requirements') as Record<string, unknown>;
    return { ...actual, fetchApplicationRequirements: (appId: string) => mockFetch(appId) };
});
jest.mock('@/lib/services/draft-document-upload', () => ({
    uploadDraftDocument: jest.fn(async () => ({ error: null })),
}));

import { useRequirementSlots, type RequirementSlotsState } from '../use-requirement-slots';
import { Step5PlansDocs } from '../../steps/step5-plans-docs';
import { Step3SiteLand } from '../../steps/step3-site-land';
import { Step2Identity } from '../../steps/step2-identity';
import type { RequirementSlot } from '@/lib/services/application-requirements';

function HookHarness({ onChange }: { onChange: (v: RequirementSlotsState) => void }) {
    const value = useRequirementSlots('app-1');
    useEffect(() => { onChange(value); });
    return null;
}

let container: HTMLDivElement;
let root: Root;
let latest: RequirementSlotsState;

beforeEach(() => {
    mockFetch.mockReset();
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
});
afterEach(async () => {
    await act(async () => { root.unmount(); });
    container.remove();
});

async function mountHook(): Promise<void> {
    await act(async () => { root.render(<HookHarness onChange={(v) => { latest = v; }} />); });
    await act(async () => { await Promise.resolve(); });
}

describe('useRequirementSlots carries the server’s editable answer', () => {
    it('true when the server says true', async () => {
        mockFetch.mockResolvedValue({ slots: [], editable: true });
        await mountHook();
        expect(latest.editable).toBe(true);
    });

    it('false when the server says false, and false (fail closed) when an older server says nothing', async () => {
        mockFetch.mockResolvedValue({ slots: [], editable: false });
        await mountHook();
        expect(latest.editable).toBe(false);
        mockFetch.mockResolvedValue({ slots: [] });
        await act(async () => { await latest.reload(); });
        expect(latest.editable).toBe(false);
    });
});

const ATTACHED: RequirementSlot = {
    slotId: 'site_map', labelTH: 'แผนที่', description: null, sourceHint: null,
    required: true, requiredReason: 'ALWAYS', satisfied: true, documentId: 'doc-1',
    fileUrl: '/uploads/x.pdf', fileName: 'x.pdf', uploadedAt: null,
};
const deleteButton = (html: string) => {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    return Array.from(doc.querySelectorAll('button')).find((b) => b.textContent === 'ลบไฟล์');
};

describe('each step hands `editable` to its cards', () => {
    it('step 5', () => {
        const on = renderToStaticMarkup(<Step5PlansDocs slots={[ATTACHED]} appId="app-1" onChanged={() => {}} editable />);
        const off = renderToStaticMarkup(<Step5PlansDocs slots={[ATTACHED]} appId="app-1" onChanged={() => {}} editable={false} />);
        expect(deleteButton(on)!.hasAttribute('disabled')).toBe(false);
        expect(deleteButton(off)!.hasAttribute('disabled')).toBe(true);
    });

    it('step 3', () => {
        const slot = { ...ATTACHED, slotId: 'land_rights' };
        const props = { farmData: {}, slots: [slot], appId: 'app-1', onChange: () => {}, onChanged: () => {} };
        const on = renderToStaticMarkup(<Step3SiteLand {...props} editable />);
        const off = renderToStaticMarkup(<Step3SiteLand {...props} editable={false} />);
        expect(deleteButton(on)!.hasAttribute('disabled')).toBe(false);
        expect(deleteButton(off)!.hasAttribute('disabled')).toBe(true);
    });

    it('step 2', () => {
        const slot = { ...ATTACHED, slotId: 'id_house_reg' };
        const props = { applicantType: 'INDIVIDUAL', applicantData: {}, slots: [slot], appId: 'app-1', onChange: () => {}, onChanged: () => {} };
        const on = renderToStaticMarkup(<Step2Identity {...props} editable />);
        const off = renderToStaticMarkup(<Step2Identity {...props} editable={false} />);
        expect(deleteButton(on)!.hasAttribute('disabled')).toBe(false);
        expect(deleteButton(off)!.hasAttribute('disabled')).toBe(true);
    });
});
