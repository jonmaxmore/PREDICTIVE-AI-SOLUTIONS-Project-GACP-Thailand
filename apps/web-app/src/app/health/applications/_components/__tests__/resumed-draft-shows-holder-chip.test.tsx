/**
 * R2 Task 15 fix round 1: a draft resumed from the server (IndexedDB empty) shows its
 * holder in the chip, because GET /applications/draft carries the row's entityId.
 * Real wizard store; only the doors (api, entities, router) are mocked.
 */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PERSONAL, COMPANY } from '@/components/holder/__tests__/fixtures';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockApiGet = jest.fn<Promise<unknown>, [string, unknown?]>();
jest.mock('@/lib/api/api-client', () => ({
    api: { get: (u: string, o?: unknown) => mockApiGet(u, o), delete: jest.fn() },
    apiClient: { get: (u: string, o?: unknown) => mockApiGet(u, o), delete: jest.fn() },
}));
jest.mock('@/lib/services/my-entities-provider', () => ({
    useMyEntities: () => ({ entities: [PERSONAL, COMPANY], isLoading: false, error: null, refresh: async () => {} }),
}));
// IndexedDB is empty: nothing local to say who the holder is.
jest.mock('@/lib/indexeddb-storage', () => ({
    indexedDBStorage: { getItem: async () => null, setItem: async () => {}, removeItem: async () => {} },
}));
const mockRouter = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn() };
jest.mock('next/navigation', () => ({
    useRouter: () => mockRouter,
    useParams: () => ({ id: '1' }),
    usePathname: () => '/',
    useSearchParams: () => new URLSearchParams(),
    notFound: jest.fn(),
}));

import ApplicationStepPage from '../application-step-page';
import { ConnectedHolderChip } from '../../new/_steps/holder-chip-connected';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    jest.clearAllMocks();
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

it('resumes a server draft with entityId and the chip names the holder', async () => {
    mockApiGet.mockImplementation((url: string) => {
        if (url.includes('/applications/draft')) {
            return Promise.resolve({
                success: true,
                data: {
                    id: 'draft-9', draftId: 'draft-9', status: 'DRAFT', entityId: COMPANY.id,
                    formData: { plantId: 'cannabis', requestType: 'NEW', certScope: 'PLANTING', applicantType: 'JURISTIC' },
                },
            });
        }
        return Promise.resolve({ success: true, data: {} });
    });
    await act(async () => {
        root.render(<><ApplicationStepPage /><ConnectedHolderChip step={2} /></>);
    });
    for (let i = 0; i < 4; i += 1) { await act(async () => { for (let j = 0; j < 10; j += 1) await Promise.resolve(); }); }
    expect(container.textContent).toContain(`ยื่นในนาม ${COMPANY.displayName}`);
}, 20000);
