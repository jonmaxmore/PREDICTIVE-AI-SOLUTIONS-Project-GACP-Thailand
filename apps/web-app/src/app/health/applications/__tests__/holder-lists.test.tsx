/**
 * R2 Task 15 - the lists show whom each row is filed for, and offer holder chips
 * only when the user belongs to more than one entity. Rendered for real (mocked doors).
 */
import * as React from 'react';
import { readFileSync } from 'fs';
import { join } from 'path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { PERSONAL, COMPANY } from '@/components/holder/__tests__/fixtures';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const mockGet = jest.fn<Promise<unknown>, [string]>();
let mockEntities: unknown[] = [];

jest.mock('@/lib/api/api-client', () => ({
    apiClient: { get: (u: string) => mockGet(u), delete: jest.fn() },
    api: { get: (u: string) => mockGet(u), delete: jest.fn() },
}));
jest.mock('@/lib/api', () => ({
    apiClient: { get: (u: string) => mockGet(u) },
    api: { get: (u: string) => mockGet(u) },
}));
jest.mock('@/lib/services/auth-service', () => ({ AuthService: { getUser: () => ({ id: 'u1', role: 'HEALTH' }) } }));
jest.mock('@/lib/services/my-entities-provider', () => ({
    useMyEntities: () => ({ entities: mockEntities, isLoading: false, error: null, refresh: async () => {} }),
}));
jest.mock('@/components/ui/qr-image', () => ({ __esModule: true, QrImage: () => null }));
jest.mock('next/navigation', () => {
    const router = { push: jest.fn(), replace: jest.fn(), refresh: jest.fn(), back: jest.fn(), prefetch: jest.fn() };
    const params = new URLSearchParams();
    return { useRouter: () => router, usePathname: () => '/', useSearchParams: () => params };
});

import ApplicationsPage from '../client-view';
import CertificatesPage from '../../certificates/client-view';
import { LanguageProvider } from '@/lib/i18n/language-context';

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
    jest.clearAllMocks();
    container = document.createElement('div'); document.body.appendChild(container); root = createRoot(container);
});
afterEach(() => { act(() => root.unmount()); container.remove(); });

async function mount(page: React.ReactElement) {
    await act(async () => { root.render(<LanguageProvider>{page}</LanguageProvider>); });
    for (let i = 0; i < 3; i += 1) { await act(async () => { for (let j = 0; j < 10; j += 1) await Promise.resolve(); }); }
}
const chipLabels = () => Array.from(container.querySelectorAll('[role="group"] button')).map((b) => b.textContent);

const APPS = [
    { id: 'a1', applicationNumber: 'APP-0001', status: 'DRAFT', createdAt: '2026-10-01T00:00:00Z', entityId: 'e-personal', farmName: 'ไร่ก' },
    { id: 'a2', applicationNumber: 'APP-0002', status: 'DRAFT', createdAt: '2026-10-02T00:00:00Z', entityId: 'e-company', farmName: 'ไร่ข' },
];

describe('applications list', () => {
    it('with two entities: chips ทั้งหมด + one per name, a ยื่นในนาม line per row, and a chip filters', async () => {
        mockEntities = [PERSONAL, COMPANY];
        mockGet.mockResolvedValue({ success: true, data: APPS });
        await mount(<ApplicationsPage />);
        expect(chipLabels()).toEqual(['ทั้งหมด', 'สมชาย ใจดี', 'บริษัท สมุนไพรไทย จำกัด']);
        expect(container.textContent).toContain('ยื่นในนาม สมชาย ใจดี');
        expect(container.textContent).toContain('ยื่นในนาม บริษัท สมุนไพรไทย จำกัด');
        expect(container.textContent).not.toMatch(/workspace|พื้นที่ทำงาน/i);

        const company = Array.from(container.querySelectorAll('[role="group"] button')).find((b) => b.textContent === 'บริษัท สมุนไพรไทย จำกัด')!;
        await act(async () => { (company as HTMLButtonElement).click(); });
        expect(container.textContent).toContain('APP-0002');
        expect(container.textContent).not.toContain('APP-0001');
    });

    it('with one entity there are no chips', async () => {
        mockEntities = [PERSONAL];
        mockGet.mockResolvedValue({ success: true, data: APPS.slice(0, 1) });
        await mount(<ApplicationsPage />);
        expect(chipLabels()).toEqual([]);
    });
});

describe('certificates list (C5)', () => {
    const certs = (canPrintQr: boolean | undefined) => ({
        success: true,
        data: { data: [{
            id: 'c1', certificateNumber: 'GACP-TH-2569-99XYZ', applicationId: 'a1', farmId: 'f1',
            siteName: 'ฟาร์มทดสอบ', plantType: 'ขมิ้นชัน', issuedDate: '2026-01-01T00:00:00.000Z',
            expiryDate: '2028-01-01T00:00:00.000Z', status: 'ACTIVE',
            ...(canPrintQr === undefined ? {} : { canPrintQr }),
        }] },
    });
    const qrButtons = () => container.querySelectorAll('button[aria-label]');

    it('hides the QR action when the server says the caller may not print it', async () => {
        mockEntities = [PERSONAL];
        mockGet.mockResolvedValue(certs(false));
        await mount(<CertificatesPage />);
        expect(container.textContent).toContain('GACP-TH-2569-99XYZ');
        expect(Array.from(qrButtons()).some((b) => (b.getAttribute('aria-label') ?? '').includes('คิวอาร์โค้ด'))).toBe(false);
    });

    it('shows it when the server says the caller may', async () => {
        mockEntities = [PERSONAL];
        mockGet.mockResolvedValue(certs(true));
        await mount(<CertificatesPage />);
        expect(Array.from(qrButtons()).some((b) => (b.getAttribute('aria-label') ?? '').includes('คิวอาร์โค้ด'))).toBe(true);
    });
});

describe('certificates list carries holder chips (R2 task 15 fix 4)', () => {
    const cert = (id: string, entityId: string | null) => ({
        id, certificateNumber: `GACP-TH-2569-${id}`, applicationId: `a-${id}`, farmId: 'f1', entityId,
        siteName: 'ฟาร์มทดสอบ', plantType: 'ขมิ้นชัน', issuedDate: '2026-01-01T00:00:00.000Z',
        expiryDate: '2028-01-01T00:00:00.000Z', status: 'ACTIVE', canPrintQr: true,
    });

    it('two entities and rows that name their holder: chips, a ยื่นในนาม line, and the chip filters', async () => {
        mockEntities = [PERSONAL, COMPANY];
        mockGet.mockResolvedValue({ success: true, data: { data: [cert('AAA', 'e-personal'), cert('BBB', 'e-company')] } });
        await mount(<CertificatesPage />);
        expect(chipLabels()).toEqual(['ทั้งหมด', 'สมชาย ใจดี', 'บริษัท สมุนไพรไทย จำกัด']);
        expect(container.textContent).toContain('ยื่นในนาม บริษัท สมุนไพรไทย จำกัด');
        const company = Array.from(container.querySelectorAll('[role="group"] button')).find((b) => b.textContent === 'บริษัท สมุนไพรไทย จำกัด')!;
        await act(async () => { (company as HTMLButtonElement).click(); });
        expect(container.textContent).toContain('GACP-TH-2569-BBB');
        expect(container.textContent).not.toContain('GACP-TH-2569-AAA');
    });

    it('rows that do not name a holder: no chips (the page never guesses)', async () => {
        mockEntities = [PERSONAL, COMPANY];
        mockGet.mockResolvedValue({ success: true, data: { data: [cert('AAA', null)] } });
        await mount(<CertificatesPage />);
        expect(chipLabels()).toEqual([]);
    });
});

describe('no emoji on the list pages (government platform)', () => {
    const EMOJI = /\p{Extended_Pictographic}/u;

    it('applications and certificates render no emoji', async () => {
        mockEntities = [PERSONAL, COMPANY];
        mockGet.mockResolvedValue({ success: true, data: APPS });
        await mount(<ApplicationsPage />);
        expect(container.innerHTML).not.toMatch(EMOJI);
        act(() => root.unmount());
        root = createRoot(container);
        mockGet.mockResolvedValue({ success: true, data: { data: [] } });
        await mount(<CertificatesPage />);
        expect(container.innerHTML).not.toMatch(EMOJI);
    });

    it('the list pages sources carry no emoji', () => {
        for (const f of ['applications/client-view.tsx', 'certificates/client-view.tsx', 'establishments/client-view.tsx', 'payments/client-view.tsx']) {
            expect([f, readFileSync(join(__dirname, '..', '..', f), 'utf8').match(EMOJI)?.[0] ?? null]).toEqual([f, null]);
        }
    });
});
