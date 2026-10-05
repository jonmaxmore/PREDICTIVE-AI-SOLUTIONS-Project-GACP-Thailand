/**
 * status-and-identities.test.tsx — /admin/certificates/[id] header chip and
 * identity fields (ledger F-G4-46, F-G4-47).
 *
 * Evidence: evidence/g4-rebuild-2026-08-25/c01/C01-04-revoked.png — after a
 * real revocation the header chip read 'ไม่ทราบสถานะ' while the panel below
 * knew the row was revoked; 'ออกโดย', 'ผู้ดำเนินการ' and 'ใบสมัคร' printed raw
 * uuids; 'จังหวัด' printed the English word Unknown.
 *
 *   (a) a revoked row (canonical lowercase 'revoked', as certificate-service
 *       writes it) renders 'เพิกถอนแล้ว' and never 'ไม่ทราบสถานะ';
 *   (b) an active row ('active') renders 'กำลังใช้งาน';
 *   (c) with applicationNumber + staff display names supplied, no 36-char
 *       uuid appears as visible text anywhere on the page; the application
 *       number is a link to the admin application page;
 *   (d) province null renders 'ไม่ระบุ'; the stored placeholder 'Unknown'
 *       renders 'ไม่ระบุ' too — the English word never reaches the screen;
 *   (e) without a display name the person renders as 'เจ้าหน้าที่' plus the
 *       last 6 characters of the id in a <code>, still never the full uuid;
 *   (f) the literal the backend stores when no person acted — 'system'
 *       (revokeCertificateForApplication default) / 'SYSTEM'
 *       (revokeCertificate default) — reads 'ระบบ' under both 'ออกโดย' and
 *       'ผู้ดำเนินการ'; never 'ออกอัตโนมัติ' on a revocation, never
 *       'เจ้าหน้าที่' + a slice of the word.
 *
 * Shape follows revoke-dialog.test.tsx: createRoot + act, dialog primitives
 * mocked inline. The finance chrome (StatusBadge, SummaryCard, PageToolbar)
 * is REAL here — the chip label under test is what production renders.
 */

import * as React from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import type { CertificateDetail } from '@/lib/services/admin-service';

declare global {
    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The identity/application fields the backend detail route supplies. Typed
// locally so the fixture compiles both before and after the service type
// grows them — the RED run must fail on behaviour, not on a type error.
type StaffIdentity = { id: string; displayName: string | null };
type DetailRow = CertificateDetail & {
    application?: { id: string; applicationNumber: string | null } | null;
    issuer?: StaffIdentity | null;
    revoker?: StaffIdentity | null;
};

const mockGetCertificate = jest.fn<(id: string) => Promise<DetailRow | null>>();

jest.mock('@/lib/services/admin-service', () => {
    const actual = jest.requireActual('@/lib/services/admin-service') as Record<string, unknown>;
    return {
        ...actual,
        AdminService: {
            getCertificate: (id: string) => mockGetCertificate(id),
            revokeCertificate: jest.fn(),
        },
    };
});

jest.mock('@/lib/services/auth-provider', () => ({
    useAuth: () => ({ user: { id: 'admin-1', role: 'system_admin_dtam' }, isLoading: false }),
}));

const CERT_ID = '0c2f7b1e-5d3a-4c8b-9e2f-1a2b3c4d5e6f';

jest.mock('next/navigation', () => {
    const router = {
        push: jest.fn(),
        replace: jest.fn(),
        refresh: jest.fn(),
        back: jest.fn(),
        forward: jest.fn(),
        prefetch: jest.fn(),
    };
    return {
        useRouter: () => router,
        useParams: () => ({ id: '0c2f7b1e-5d3a-4c8b-9e2f-1a2b3c4d5e6f' }),
        usePathname: () => '/admin/certificates/0c2f7b1e-5d3a-4c8b-9e2f-1a2b3c4d5e6f',
        useSearchParams: () => new URLSearchParams(),
    };
});

// Radix Dialog portals out of the container in jsdom — render inline.
jest.mock('@/components/ui/primitives/dialog', () => ({
    Dialog: ({ open, children }: { open?: boolean; children?: React.ReactNode }) =>
        open ? <div data-testid="dialog">{children}</div> : null,
    DialogContent: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    DialogHeader: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
    DialogTitle: ({ children }: { children?: React.ReactNode }) => <h2>{children}</h2>,
    DialogDescription: ({ children }: { children?: React.ReactNode }) => <p>{children}</p>,
    DialogFooter: ({ children }: { children?: React.ReactNode }) => <div>{children}</div>,
}));

import DetailView from '../detail-view';

const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

const APPLICATION_ID = 'd74191d7-055b-49b4-a555-501cd30a9954';
const ISSUER_ID = '79242ab9-ae05-46e8-81f2-4743730ad7be';
const REVOKER_ID = 'f71d11dc-e896-4c93-86b0-00af70c4aa54';
const APPLICATION_NUMBER = 'GACP-2569-000123';

const ACTIVE_CERT: DetailRow = {
    id: CERT_ID,
    certificateNumber: 'GACP-TH-2569-CAE820',
    applicationId: APPLICATION_ID,
    application: { id: APPLICATION_ID, applicationNumber: APPLICATION_NUMBER },
    farmName: 'ไร่ใจดีสมุนไพรไทย',
    cropType: 'Herb',
    status: 'active',
    issuedDate: '2024-01-01T00:00:00.000Z',
    expiryDate: '2027-01-01T00:00:00.000Z',
    issuedBy: ISSUER_ID,
    issuer: { id: ISSUER_ID, displayName: 'สมชาย ตรวจดี' },
    province: 'เชียงใหม่',
    district: 'สันทราย',
};

const REVOKED_CERT: DetailRow = {
    ...ACTIVE_CERT,
    status: 'revoked',
    revokedAt: '2026-08-27T00:00:00.000Z',
    revokedBy: REVOKER_ID,
    revoker: { id: REVOKER_ID, displayName: 'สมหญิง เพิกถอน' },
    revokedReason: 'ใบรับรองนี้ลงนามด้วยคีย์ที่ระบบไม่เชื่อถือ',
};

async function flushMicrotasks(rounds = 12): Promise<void> {
    for (let i = 0; i < rounds; i += 1) {
        await act(async () => {
            await Promise.resolve();
        });
    }
}

function visibleText(): string {
    return document.body.textContent || '';
}

function fieldValue(label: string): string {
    const dt = Array.from(document.body.querySelectorAll('dt')).find(
        (el) => (el.textContent || '').trim() === label,
    );
    expect(dt).toBeDefined();
    const dd = dt!.nextElementSibling;
    expect(dd).not.toBeNull();
    return (dd!.textContent || '').trim();
}

describe('/admin/certificates/[id] — status chip and identities', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        mockGetCertificate.mockResolvedValue(ACTIVE_CERT);
    });

    afterEach(() => {
        if (root) {
            act(() => {
                root?.unmount();
            });
            root = null;
        }
        if (container) {
            container.remove();
            container = null;
        }
    });

    async function mountPage(row: DetailRow): Promise<void> {
        mockGetCertificate.mockResolvedValue(row);
        container = document.createElement('div');
        document.body.appendChild(container);
        await act(async () => {
            root = createRoot(container!);
            root.render(<DetailView />);
        });
        await flushMicrotasks();
        expect(visibleText()).toContain(row.certificateNumber);
    }

    it('(a) a revoked row renders เพิกถอนแล้ว in the header chip, never ไม่ทราบสถานะ', async () => {
        await mountPage(REVOKED_CERT);

        expect(visibleText()).toContain('เพิกถอนแล้ว');
        expect(visibleText()).not.toContain('ไม่ทราบสถานะ');
        // The revoked panel still renders from the same row.
        expect(visibleText()).toContain('ใบรับรองนี้ถูกเพิกถอน');
    });

    it('(b) an active row renders กำลังใช้งาน', async () => {
        await mountPage(ACTIVE_CERT);

        expect(visibleText()).toContain('กำลังใช้งาน');
        expect(visibleText()).not.toContain('ไม่ทราบสถานะ');
    });

    it('(c) no 36-char uuid is visible when applicationNumber and names are supplied; the application number links to the admin application page', async () => {
        await mountPage(REVOKED_CERT);

        expect(visibleText()).not.toMatch(UUID_RE);
        expect(visibleText()).toContain(APPLICATION_NUMBER);
        expect(visibleText()).toContain('สมชาย ตรวจดี');
        expect(visibleText()).toContain('สมหญิง เพิกถอน');

        const appLink = Array.from(document.body.querySelectorAll<HTMLAnchorElement>('a')).find(
            (a) => (a.textContent || '').trim() === APPLICATION_NUMBER,
        );
        expect(appLink).toBeDefined();
        expect(appLink!.getAttribute('href')).toBe(
            `/admin/applications/${APPLICATION_ID}/force-status`,
        );
    });

    it('(d) province null renders ไม่ระบุ; the stored placeholder Unknown renders ไม่ระบุ too', async () => {
        await mountPage({ ...ACTIVE_CERT, province: null, district: null });
        expect(fieldValue('จังหวัด')).toBe('ไม่ระบุ');
        expect(visibleText()).not.toContain('Unknown');

        act(() => {
            root?.unmount();
        });
        root = null;
        container?.remove();
        container = null;

        await mountPage({ ...ACTIVE_CERT, province: 'Unknown', district: '-' });
        expect(fieldValue('จังหวัด')).toBe('ไม่ระบุ');
        expect(visibleText()).not.toContain('Unknown');
    });

    it('(e) without a display name a person renders as เจ้าหน้าที่ + the last 6 id characters in a <code>, never the full uuid', async () => {
        await mountPage({
            ...REVOKED_CERT,
            issuer: { id: ISSUER_ID, displayName: null },
            revoker: null,
        });

        expect(visibleText()).not.toMatch(UUID_RE);
        const codes = Array.from(document.body.querySelectorAll('code')).map((c) => (c.textContent || '').trim());
        expect(codes).toContain(ISSUER_ID.slice(-6));
        expect(codes).toContain(REVOKER_ID.slice(-6));
        expect(fieldValue('ออกโดย')).toContain('เจ้าหน้าที่');
        expect(fieldValue('ผู้ดำเนินการ')).toContain('เจ้าหน้าที่');
    });

    it('(f) the stored system literal reads ระบบ under ผู้ดำเนินการ and ออกโดย, never ออกอัตโนมัติ on a revocation', async () => {
        // certificate-service.js revokeCertificateForApplication defaults
        // revokedBy to 'system'; revokeCertificate defaults actorId to
        // 'SYSTEM'. The detail route returns { id, displayName: null } when
        // the user lookup misses, so the literal reaches the component as id.
        await mountPage({
            ...REVOKED_CERT,
            issuedBy: 'SYSTEM',
            issuer: { id: 'SYSTEM', displayName: null },
            revokedBy: 'system',
            revoker: { id: 'system', displayName: null },
        });

        expect(fieldValue('ผู้ดำเนินการ')).toBe('ระบบ');
        expect(fieldValue('ออกโดย')).toBe('ระบบ');
        expect(visibleText()).not.toContain('ออกอัตโนมัติ');
        expect(visibleText()).not.toContain('เจ้าหน้าที่');
        const codes = Array.from(document.body.querySelectorAll('code')).map((c) => (c.textContent || '').trim());
        expect(codes).not.toContain('system');
        expect(codes).not.toContain('SYSTEM');
    });

    it('(g) the provenance block uses token neutrals on its <dl>/<dt>, never a slate-* utility (gacp-design-tokens SKILL.md:25, :72)', async () => {
        await mountPage(ACTIVE_CERT);

        const section = document.body.querySelector('section[aria-labelledby="provenance-heading"]');
        expect(section).not.toBeNull();
        const dl = section!.querySelector('dl');
        expect(dl).not.toBeNull();
        const dts = Array.from(dl!.querySelectorAll('dt'));
        expect(dts.map((d) => (d.textContent || '').trim())).toEqual(['ใบสมัคร', 'ออกโดย']);

        expect(dl!.className).not.toMatch(/slate-/);
        expect(dl!.className).toContain('text-foreground');
        for (const dt of dts) {
            expect(dt.className).not.toMatch(/slate-/);
            expect(dt.className).toContain('text-muted-foreground');
        }
    });

});
