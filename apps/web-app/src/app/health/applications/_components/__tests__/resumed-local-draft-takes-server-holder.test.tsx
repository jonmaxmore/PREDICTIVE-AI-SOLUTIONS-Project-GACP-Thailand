/**
 * Staging view-pack 2026-10-06, defect D2. This browser's stored wizard says the draft
 * is filed for the applicant personally; the server row says the company. The store
 * is already populated, so the page used to skip the server and keep showing the
 * stored holder after every reload. The holder of an existing draft is the server's.
 * Real wizard store and page; only the doors (api, entities, router, IndexedDB) are mocked.
 */
import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PERSONAL, COMPANY } from '@/components/holder/__tests__/fixtures';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockApiGet = jest.fn<Promise<unknown>, [string, unknown?]>();
jest.mock('@/lib/api/api-client', () => ({
    api: { get: (u: string, o?: unknown) => mockApiGet(u, o), delete: jest.fn(), post: jest.fn(async () => ({ success: true, data: {} })) },
    apiClient: { get: (u: string, o?: unknown) => mockApiGet(u, o), delete: jest.fn(), post: jest.fn(async () => ({ success: true, data: {} })) },
}));
jest.mock('@/lib/services/my-entities-provider', () => ({
    useMyEntities: () => ({ entities: [PERSONAL, COMPANY], isLoading: false, error: null, refresh: async () => {} }),
}));
jest.mock('@/lib/indexeddb-storage', () => ({
    indexedDBStorage: {
        getItem: async () => JSON.stringify({
            state: {
                ownerUserId: 'user-a', applicationId: 'draft-9', plantId: 'cannabis', requestType: 'NEW',
                certScope: 'PLANTING', holderEntityId: PERSONAL.id, applicantType: 'INDIVIDUAL', currentStep: 2,
            },
            version: 0,
        }),
        setItem: async () => {},
        removeItem: async () => {},
    },
}));
const mockRouter = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn() };
jest.mock('next/navigation', () => ({
    useRouter: () => mockRouter,
    useParams: () => ({ id: '2' }),
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

it('a stored draft whose holder disagrees with the server shows the server holder', async () => {
    mockApiGet.mockImplementation((url: string) => {
        if (url === '/applications/draft-9') {
            return Promise.resolve({
                success: true,
                data: { id: 'draft-9', status: 'DRAFT', entityId: COMPANY.id, formData: { plantId: 'cannabis', applicantType: 'JURISTIC' } },
            });
        }
        return Promise.resolve({ success: true, data: null });
    });
    await act(async () => {
        root.render(<><ApplicationStepPage /><ConnectedHolderChip step={2} /></>);
    });
    for (let i = 0; i < 4; i += 1) { await act(async () => { for (let j = 0; j < 10; j += 1) await Promise.resolve(); }); }
    const text = container.textContent ?? '';
    expect(text).toContain(`ยื่นในนาม ${COMPANY.displayName}`);
    expect(text).not.toContain(`ยื่นในนาม ${PERSONAL.displayName}`);
}, 20000);
