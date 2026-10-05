/**
 * C4 (operator 2026-09-30 "ทำทางแยก") — the planting-activity page uploads and
 * removes attachments through its own door under the planting cycle
 * (`/planting-cycles/:id/attachments`), never through
 * `/applications/draft-documents`, which found or created an application draft
 * to hang the file on.
 *
 * The hook is mounted with createRoot + act; the api client, the planting
 * service, the permission hook and the toast are mocked so only the requests
 * the hook makes are under test. The response shape it reads is unchanged
 * (documentId / fileName / fileUrl), so the page UI does not change.
 */

import * as React from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type ApiResult = { success: boolean; data?: Record<string, unknown>; error?: string };
const mockPost = jest.fn<(url: string, body: unknown) => Promise<ApiResult>>();
const mockDelete = jest.fn<(url: string) => Promise<ApiResult>>();
jest.mock('@/lib/api', () => ({
    api: {
        post: (url: string, body: unknown) => mockPost(url, body),
        delete: (url: string) => mockDelete(url),
    },
}));
jest.mock('@/lib/services/planting-service', () => ({
    plantingService: {
        getCycleById: async () => ({ success: true, data: { id: 'cycle-1', plots: [] } }),
        listActivities: async () => ({ success: true, data: [] }),
        createActivity: async () => ({ success: true }),
    },
}));
jest.mock('@/lib/services/use-entity-permissions', () => ({
    NO_PERMISSION_TOOLTIP_TH: 'ไม่มีสิทธิ์',
    activityPermissionFor: (type: string) => `ACTIVITY_${type}`,
    computeCanLogSelectedActivity: () => true,
    useEntityPermissions: () => ({ has: () => true, reportPermissionDenial: () => undefined }),
}));
jest.mock('sonner', () => ({
    toast: { success: () => undefined, error: () => undefined, warning: () => undefined },
}));

import { usePlantingActivitiesPage } from '../use-planting-activities-page';

type HookValue = ReturnType<typeof usePlantingActivitiesPage>;

describe('planting activities hook — attachments use the cycle\'s own door (C4)', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;
    let hook: HookValue | null = null;

    function Harness({ cycleId }: { cycleId: string }) {
        hook = usePlantingActivitiesPage(cycleId);
        return null;
    }

    beforeEach(async () => {
        jest.clearAllMocks();
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
        await act(async () => {
            root?.render(<Harness cycleId="cycle-1" />);
        });
    });

    afterEach(() => {
        act(() => { root?.unmount(); });
        container?.remove();
        root = null;
        container = null;
        hook = null;
    });

    it('uploads to /planting-cycles/:id/attachments with the selected activity type, and keeps the returned shape', async () => {
        mockPost.mockResolvedValue({
            success: true,
            data: { documentId: 'att-1', fileName: 'irrigation.pdf', fileUrl: '/uploads/application-drafts/x.pdf' },
        });
        const file = new File(['%PDF-1.4'], 'irrigation.pdf', { type: 'application/pdf' });

        await act(async () => { await hook?.uploadAttachment(file); });

        expect(mockPost).toHaveBeenCalledTimes(1);
        const [url, body] = mockPost.mock.calls[0];
        expect(url).toBe('/planting-cycles/cycle-1/attachments?activityType=IRRIGATION');
        expect(body).toBeInstanceOf(FormData);
        expect((body as FormData).get('file')).toBeInstanceOf(File);
        expect((body as FormData).get('applicationId')).toBeNull();
        expect(hook?.uploadedAttachments).toEqual([
            { documentId: 'att-1', fileName: 'irrigation.pdf', fileUrl: '/uploads/application-drafts/x.pdf' },
        ]);
    });

    it('removes through DELETE /planting-cycles/:id/attachments/:documentId', async () => {
        mockPost.mockResolvedValue({ success: true, data: { documentId: 'att 2', fileName: 'a.pdf', fileUrl: '' } });
        mockDelete.mockResolvedValue({ success: true, data: { documentId: 'att 2', deleted: true } });
        await act(async () => { await hook?.uploadAttachment(new File(['x'], 'a.pdf', { type: 'application/pdf' })); });

        await act(async () => { await hook?.removeAttachment('att 2'); });

        expect(mockDelete).toHaveBeenCalledWith('/planting-cycles/cycle-1/attachments/att%202');
        expect(hook?.uploadedAttachments).toEqual([]);
    });

    it('the hook source never names /applications/draft-documents', () => {
        const src = readFileSync(join(__dirname, '..', 'use-planting-activities-page.ts'), 'utf8');
        expect(src).not.toMatch(/\/applications\/draft-documents/);
    });
});
