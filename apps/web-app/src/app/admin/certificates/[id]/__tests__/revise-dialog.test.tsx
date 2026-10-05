/**
 * revise-dialog.test.tsx — /admin/certificates/[id] "ออกฉบับแก้ไขจากบันทึกต้นทาง"
 * dialog wired to the real doors
 * (GET  /api/admin/certificates/:id/revise-location/preview via
 *  AdminService.previewCertificateRevision,
 *  POST /api/admin/certificates/:id/revise-location via
 *  AdminService.reviseCertificateLocation).
 *
 *   (a) the button opens a dialog titled 'ออกฉบับแก้ไขครั้งที่ 1' that shows a
 *       เดิม / ใหม่ table with rows พืชสมุนไพร / จังหวัด / อำเภอ / ตำบล / ที่อยู่
 *       filled from the preview endpoint ('Unknown' → 'เชียงใหม่'); the
 *       description says the new values come from the source records (farm
 *       row + plant register); the preview is read exactly once per open;
 *   (b) the confirm 'ยืนยันออกฉบับแก้ไข' stays disabled until a non-blank
 *       reason is typed (max 500 chars, labelled textarea);
 *   (c) confirming calls reviseCertificateLocation(certId, reason) exactly
 *       once, the dialog closes, the row is reloaded through getCertificate,
 *       the hero shows 'ฉบับแก้ไขครั้งที่ 1' beside the number and a
 *       role="status" line announces the revision;
 *   (d) a CERTIFICATE_REVISION_NO_CHANGE result keeps the dialog open and
 *       shows the Thai cause + next action in role="alert" (never the code);
 *   (e) the button is absent for a revoked certificate;
 *   (f) a preview with changed: [] renders 'ข้อมูลตรงกันอยู่แล้ว ไม่มีอะไรต้องแก้ไข'
 *       and no confirm button;
 *   (g) a preview refusal (CERTIFICATE_FARM_LOCATION_MISSING) shows the Thai
 *       cause + next action in role="alert" and no confirm button;
 *   (g2) a preview refusal (CERTIFICATE_PLANT_UNKNOWN) names the plant
 *       register as the cause and editing the application as the next
 *       action in role="alert" (never the generic refresh-and-retry line,
 *       never the code) and no confirm button;
 *   (h) F-G4-58: a preview with changed ['cropType', 'province'] renders
 *       'พืชสมุนไพร' as the FIRST row, 'Herb' → 'กัญชา' with the ใหม่ cell in
 *       bold, while an unchanged row's ใหม่ cell is not bold.
 *
 * Shape follows revoke-dialog.test.tsx: createRoot + act, native value
 * setter + input event, dispatchEvent click, dialog primitives mocked
 * inline (Radix portals out of the container in jsdom).
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

// Typed locally so the fixture compiles both before and after the service
// type grows the revision columns — the RED run must fail on behaviour.
type DetailRow = CertificateDetail & {
    revisionNo?: number;
    revisedAt?: string | null;
    revisionReason?: string | null;
};

// The register facts a revision may correct. cropType is optional here
// for the same reason it is optional on the service type: the preview
// guard does not verify per-field presence, so a door without F-G4-58
// must not be typed as if it sent the plant.
type Facts = {
    cropType?: string | null;
    province: string | null;
    district: string | null;
    subDistrict: string | null;
    address: string | null;
};

type PreviewResult =
    | { ok: true; data: { current: Facts; corrected: Facts; changed: string[] } }
    | { ok: false; error: string; message: string };

type ReviseResult =
    | { ok: true; data: Record<string, unknown> }
    | { ok: false; error: string; message: string };

const mockGetCertificate = jest.fn<(id: string) => Promise<DetailRow | null>>();
const mockPreviewCertificateRevision = jest.fn<(id: string) => Promise<PreviewResult>>();
const mockReviseCertificateLocation = jest.fn<(id: string, reason: string) => Promise<ReviseResult>>();

// Only the doors are mocked; the module's constants (reason max length,
// Thai error copy, field labels) stay real so the view renders what
// production renders.
jest.mock('@/lib/services/admin-service', () => {
    const actual = jest.requireActual('@/lib/services/admin-service') as Record<string, unknown>;
    return {
        ...actual,
        AdminService: {
            getCertificate: (id: string) => mockGetCertificate(id),
            revokeCertificate: jest.fn(),
            previewCertificateRevision: (id: string) => mockPreviewCertificateRevision(id),
            reviseCertificateLocation: (id: string, reason: string) => mockReviseCertificateLocation(id, reason),
        },
    };
});

// ADMIN session, already hydrated.
jest.mock('@/lib/services/auth-provider', () => ({
    useAuth: () => ({ user: { id: 'admin-1', role: 'system_admin_dtam' }, isLoading: false }),
}));

// Stable router + the route param the page reads.
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
        useParams: () => ({ id: 'cert-1' }),
        usePathname: () => '/admin/certificates/cert-1',
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

// Finance chrome is not under test — keep the DOM small and deterministic.
jest.mock('@/components/finance', () => ({
    PageToolbar: ({ title }: { title?: string }) => <div>{title}</div>,
    StatusBadge: ({ status }: { status?: string }) => <span>{status}</span>,
    SummaryCard: () => null,
}));

import DetailView from '../detail-view';

const CERT_ID = 'cert-1';
const CERT_NUMBER = 'GACP-TH-2569-TEST01';
const OPEN_BUTTON = 'ออกฉบับแก้ไขจากบันทึกต้นทาง';
const CONFIRM_BUTTON = 'ยืนยันออกฉบับแก้ไข';
// The dialog names BOTH source records the new values come from.
const SOURCE_COPY = 'ค่าใหม่มาจากบันทึกต้นทางเท่านั้น (บันทึกฟาร์มและทะเบียนพืช)';
const PLANT_ROW = 'พืชสมุนไพร';
const THAI = /[฀-๿]/;

// Canonical lowercase status as certificate-service writes it; the stored
// placeholder 'Unknown' is exactly the register defect this door corrects.
const ACTIVE_CERT: DetailRow = {
    id: CERT_ID,
    certificateNumber: CERT_NUMBER,
    applicationId: 'app-1',
    farmName: 'ฟาร์มทดสอบ',
    cropType: 'กัญชา',
    status: 'active',
    issuedDate: '2026-01-01T00:00:00.000Z',
    expiryDate: '2029-01-01T00:00:00.000Z',
    province: 'Unknown',
    district: 'Unknown',
    subDistrict: 'Unknown',
    address: null,
    revisionNo: 1,
    revisedAt: null,
    revisionReason: null,
};

const REVISED_CERT: DetailRow = {
    ...ACTIVE_CERT,
    province: 'เชียงใหม่',
    district: 'แม่ริม',
    subDistrict: 'ริมใต้',
    address: '99 หมู่ 1',
    revisionNo: 2,
    revisedAt: '2026-08-27T10:00:00.000Z',
    revisionReason: 'SYSTEM_DATA_CORRECTION',
};

const REVOKED_CERT: DetailRow = {
    ...ACTIVE_CERT,
    status: 'revoked',
    revokedAt: '2026-08-27T00:00:00.000Z',
    revokedBy: 'admin-1',
    revokedReason: 'ตรวจพบการปลอมแปลงเอกสาร',
};

// Every location field differs; the plant already matches the register.
const PREVIEW_LOCATION_CHANGED: PreviewResult = {
    ok: true,
    data: {
        current: { cropType: 'กัญชา', province: 'Unknown', district: 'Unknown', subDistrict: 'Unknown', address: null },
        corrected: { cropType: 'กัญชา', province: 'เชียงใหม่', district: 'แม่ริม', subDistrict: 'ริมใต้', address: '99 หมู่ 1' },
        changed: ['province', 'district', 'subDistrict', 'address'],
    },
};

// F-G4-58: the stored 'Herb' stand-in resolves to the register's plant
// name; province differs too, district / subDistrict / address match.
const PREVIEW_PLANT_AND_PROVINCE_CHANGED: PreviewResult = {
    ok: true,
    data: {
        current: { cropType: 'Herb', province: 'Unknown', district: 'แม่ริม', subDistrict: 'ริมใต้', address: '99 หมู่ 1' },
        corrected: { cropType: 'กัญชา', province: 'เชียงใหม่', district: 'แม่ริม', subDistrict: 'ริมใต้', address: '99 หมู่ 1' },
        changed: ['cropType', 'province'],
    },
};

async function flushMicrotasks(rounds = 12): Promise<void> {
    for (let i = 0; i < rounds; i += 1) {
        await act(async () => {
            await Promise.resolve();
        });
    }
}

function buttonByText(text: string): HTMLButtonElement | undefined {
    return Array.from(document.body.querySelectorAll<HTMLButtonElement>('button')).find(
        (b) => (b.textContent || '').trim() === text,
    );
}

async function click(el: Element): Promise<void> {
    await act(async () => {
        el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
    });
    await flushMicrotasks();
}

async function typeInto(el: HTMLTextAreaElement, value: string): Promise<void> {
    await act(async () => {
        const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')!.set!;
        setter.call(el, value);
        el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await flushMicrotasks(2);
}

function dialog(): HTMLElement | null {
    return document.body.querySelector<HTMLElement>('[data-testid="dialog"]');
}

/** The table row whose first cell reads `label`, or undefined. */
function rowByLabel(label: string): HTMLTableRowElement | undefined {
    return Array.from(document.body.querySelectorAll<HTMLTableRowElement>('table tbody tr')).find(
        (tr) => (tr.cells[0]?.textContent || '').trim() === label,
    );
}

describe('/admin/certificates/[id] — revise dialog wired to the real doors', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;

    beforeEach(() => {
        jest.clearAllMocks();
        mockGetCertificate.mockResolvedValue(ACTIVE_CERT);
        mockPreviewCertificateRevision.mockResolvedValue(PREVIEW_LOCATION_CHANGED);
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

    async function mountPage(): Promise<void> {
        container = document.createElement('div');
        document.body.appendChild(container);
        await act(async () => {
            root = createRoot(container!);
            root.render(<DetailView />);
        });
        await flushMicrotasks();
    }

    async function openDialog(): Promise<void> {
        const trigger = buttonByText(OPEN_BUTTON);
        expect(trigger).toBeDefined();
        expect(trigger!.getAttribute('aria-label')).toBe(OPEN_BUTTON);
        await click(trigger!);
    }

    it('(a) the button opens a dialog with the เดิม / ใหม่ table from the preview endpoint', async () => {
        await mountPage();
        expect(document.body.textContent).toContain(CERT_NUMBER);
        expect(dialog()).toBeNull();
        expect(mockPreviewCertificateRevision).not.toHaveBeenCalled();

        await openDialog();

        expect(mockPreviewCertificateRevision).toHaveBeenCalledTimes(1);
        expect(mockPreviewCertificateRevision).toHaveBeenCalledWith(CERT_ID);
        expect(dialog()).not.toBeNull();
        expect(dialog()!.querySelector('h2')?.textContent).toContain('ออกฉบับแก้ไขครั้งที่ 1');
        // The description names both source records, never the farm alone.
        expect(dialog()!.textContent).toContain(SOURCE_COPY);
        expect(dialog()!.textContent).not.toContain('ค่าใหม่มาจากบันทึกฟาร์มเท่านั้น');

        const table = dialog()!.querySelector('table');
        expect(table).not.toBeNull();
        const headers = Array.from(table!.querySelectorAll('thead th')).map((th) => (th.textContent || '').trim());
        expect(headers).toEqual(expect.arrayContaining(['เดิม', 'ใหม่']));

        const province = rowByLabel('จังหวัด');
        expect(province).toBeDefined();
        const provinceCells = Array.from(province!.cells).map((c) => (c.textContent || '').trim());
        expect(provinceCells).toEqual(['จังหวัด', 'Unknown', 'เชียงใหม่']);

        expect(rowByLabel('อำเภอ')).toBeDefined();
        expect(rowByLabel('ตำบล')).toBeDefined();
        const address = rowByLabel('ที่อยู่');
        expect(address).toBeDefined();
        expect((address!.cells[2]?.textContent || '').trim()).toBe('99 หมู่ 1');

        // The plant row is present even when it did not change, and its
        // ใหม่ cell is not emphasised.
        const plant = rowByLabel(PLANT_ROW);
        expect(plant).toBeDefined();
        expect(Array.from(plant!.cells).map((c) => (c.textContent || '').trim())).toEqual([PLANT_ROW, 'กัญชา', 'กัญชา']);
        expect(plant!.cells[2]?.className).not.toContain('font-semibold');

        // Nothing was written by opening the dialog.
        expect(mockReviseCertificateLocation).not.toHaveBeenCalled();
    });

    it('(b) confirm stays disabled until a non-blank reason is typed', async () => {
        await mountPage();
        await openDialog();

        const textarea = dialog()!.querySelector<HTMLTextAreaElement>('textarea');
        expect(textarea).not.toBeNull();
        expect(textarea!.getAttribute('maxlength')).toBe('500');
        expect(textarea!.id).not.toBe('');
        const label = document.body.querySelector<HTMLLabelElement>(`label[for="${textarea!.id}"]`);
        expect(label).not.toBeNull();
        expect(label!.textContent).toContain('เหตุผล');

        const confirm = buttonByText(CONFIRM_BUTTON);
        expect(confirm).toBeDefined();
        expect(confirm!.disabled).toBe(true);

        await typeInto(textarea!, '   ');
        expect(buttonByText(CONFIRM_BUTTON)!.disabled).toBe(true);

        await typeInto(textarea!, 'ระบบบันทึกจังหวัดเป็น Unknown ตอนออกใบรับรอง');
        expect(buttonByText(CONFIRM_BUTTON)!.disabled).toBe(false);
        expect(mockReviseCertificateLocation).not.toHaveBeenCalled();
    });

    it('(c) confirming calls the door once, reloads the row, shows ฉบับแก้ไขครั้งที่ 1 and announces it', async () => {
        mockGetCertificate
            .mockResolvedValueOnce(ACTIVE_CERT)
            .mockResolvedValue(REVISED_CERT);
        mockReviseCertificateLocation.mockResolvedValue({
            ok: true,
            data: {
                id: CERT_ID,
                certificateNumber: CERT_NUMBER,
                revisionNo: 2,
                revisedAt: '2026-08-27T10:00:00.000Z',
                correctedFields: ['province', 'district', 'subDistrict', 'address'],
            },
        });

        await mountPage();
        const hero = () => document.body.querySelector('[aria-labelledby="cert-number-heading"]');
        expect(hero()).not.toBeNull();
        expect(hero()!.textContent).not.toContain('ฉบับแก้ไขครั้งที่');

        await openDialog();
        const reason = 'ระบบบันทึกจังหวัดเป็น Unknown ตอนออกใบรับรอง';
        await typeInto(dialog()!.querySelector<HTMLTextAreaElement>('textarea')!, `  ${reason}  `);
        await click(buttonByText(CONFIRM_BUTTON)!);

        expect(mockReviseCertificateLocation).toHaveBeenCalledTimes(1);
        expect(mockReviseCertificateLocation).toHaveBeenCalledWith(CERT_ID, reason);
        // Reloaded through the existing load(): initial + post-revise.
        expect(mockGetCertificate).toHaveBeenCalledTimes(2);

        // Dialog closed, revision line beside the number, success announced.
        expect(dialog()).toBeNull();
        expect(document.body.querySelector('textarea')).toBeNull();
        expect(hero()!.textContent).toContain('ฉบับแก้ไขครั้งที่ 1');
        expect(hero()!.textContent).toContain('27 ส.ค. 2569');
        const status = Array.from(document.body.querySelectorAll('[role="status"]')).find((el) =>
            (el.textContent || '').includes(`ออกฉบับแก้ไขครั้งที่ 1 ของใบรับรอง ${CERT_NUMBER} แล้ว`),
        );
        expect(status).toBeDefined();
        // The revision history names the reason by its Thai label, never the code.
        expect(document.body.textContent).toContain('ประวัติการแก้ไข');
        expect(document.body.textContent).toContain('แก้ไขข้อมูลบนใบรับรองให้ตรงกับบันทึกต้นทาง (ความผิดพลาดของระบบ)');
        expect(document.body.textContent).not.toContain('SYSTEM_DATA_CORRECTION');
    });

    it('(d) a CERTIFICATE_REVISION_NO_CHANGE result keeps the dialog open with the Thai message in role="alert"', async () => {
        mockReviseCertificateLocation.mockResolvedValue({
            ok: false,
            error: 'CERTIFICATE_REVISION_NO_CHANGE',
            message: 'Certificate location already matches the farm record',
        });

        await mountPage();
        await openDialog();
        await typeInto(dialog()!.querySelector<HTMLTextAreaElement>('textarea')!, 'เหตุผลทดสอบ');
        await click(buttonByText(CONFIRM_BUTTON)!);

        expect(mockReviseCertificateLocation).toHaveBeenCalledTimes(1);
        // Still open.
        expect(dialog()).not.toBeNull();
        expect(dialog()!.querySelector('textarea')).not.toBeNull();
        const alerts = Array.from(dialog()!.querySelectorAll('[role="alert"]'));
        expect(alerts).toHaveLength(1);
        const alertText = (alerts[0].textContent || '').trim();
        expect(alertText).toMatch(THAI);
        expect(alertText).toContain('ไม่มีอะไรต้องแก้ไข');
        expect(alertText).not.toContain('CERTIFICATE_REVISION_NO_CHANGE');
        expect(alertText).not.toContain('already matches');
        expect(alertText).not.toContain('—');
        // No reload on failure — the page did not pretend the revision happened.
        expect(mockGetCertificate).toHaveBeenCalledTimes(1);
        expect(document.body.textContent).not.toContain('ออกฉบับแก้ไขครั้งที่ 1 ของใบรับรอง');
    });

    it('(e) the button is absent for a revoked certificate', async () => {
        mockGetCertificate.mockResolvedValue(REVOKED_CERT);

        await mountPage();

        expect(document.body.textContent).toContain('ใบรับรองนี้ถูกเพิกถอน');
        expect(buttonByText(OPEN_BUTTON)).toBeUndefined();
        expect(document.body.textContent).not.toContain(OPEN_BUTTON);
        expect(mockPreviewCertificateRevision).not.toHaveBeenCalled();
    });

    it('(f) a preview with changed: [] says the data already matches and offers no confirm', async () => {
        mockPreviewCertificateRevision.mockResolvedValue({
            ok: true,
            data: {
                current: { cropType: 'กัญชา', province: 'เชียงใหม่', district: 'แม่ริม', subDistrict: 'ริมใต้', address: '99 หมู่ 1' },
                corrected: { cropType: 'กัญชา', province: 'เชียงใหม่', district: 'แม่ริม', subDistrict: 'ริมใต้', address: '99 หมู่ 1' },
                changed: [],
            },
        });

        await mountPage();
        await openDialog();

        expect(dialog()).not.toBeNull();
        expect(dialog()!.textContent).toContain('ข้อมูลตรงกันอยู่แล้ว ไม่มีอะไรต้องแก้ไข');
        expect(buttonByText(CONFIRM_BUTTON)).toBeUndefined();
        expect(mockReviseCertificateLocation).not.toHaveBeenCalled();
    });

    it('(g) a preview refusal shows the Thai cause + next action in role="alert" and no confirm', async () => {
        mockPreviewCertificateRevision.mockResolvedValue({
            ok: false,
            error: 'CERTIFICATE_FARM_LOCATION_MISSING',
            message: 'Farm location incomplete',
        });

        await mountPage();
        await openDialog();

        expect(dialog()).not.toBeNull();
        const alerts = Array.from(dialog()!.querySelectorAll('[role="alert"]'));
        expect(alerts).toHaveLength(1);
        const alertText = (alerts[0].textContent || '').trim();
        expect(alertText).toMatch(THAI);
        expect(alertText).not.toContain('CERTIFICATE_FARM_LOCATION_MISSING');
        expect(alertText).not.toContain('Farm location incomplete');
        expect(alertText).toContain('ลองอีกครั้ง');
        expect(buttonByText(CONFIRM_BUTTON)).toBeUndefined();
        expect(mockReviseCertificateLocation).not.toHaveBeenCalled();
    });

    it('(g2) a CERTIFICATE_PLANT_UNKNOWN preview refusal names the plant register, not "refresh and retry"', async () => {
        // The service's `message` is what it emits TODAY for a code it has
        // no copy for: the generic revise fallback. The view must not show
        // that line for this code, because retrying cannot fix the plant.
        mockPreviewCertificateRevision.mockResolvedValue({
            ok: false,
            error: 'CERTIFICATE_PLANT_UNKNOWN',
            message: 'ออกฉบับแก้ไขไม่สำเร็จ รีเฟรชหน้าจอเพื่อดูสถานะใบรับรองแล้วลองอีกครั้ง หากยังไม่สำเร็จ ติดต่อผู้ดูแลระบบ',
        });

        await mountPage();
        await openDialog();

        expect(dialog()).not.toBeNull();
        const alerts = Array.from(dialog()!.querySelectorAll('[role="alert"]'));
        expect(alerts).toHaveLength(1);
        const alertText = (alerts[0].textContent || '').trim();
        expect(alertText).toMatch(THAI);
        expect(alertText).not.toContain('CERTIFICATE_PLANT_UNKNOWN');
        // Cause: the application's plant is not one the plant register knows.
        expect(alertText).toContain('ชนิดพืช');
        expect(alertText).toContain('ทะเบียนพืช');
        // Next action: edit the application, then reopen this dialog.
        expect(alertText).toContain('แก้ไขคำขอ');
        expect(alertText).toContain('เปิดหน้าต่างนี้อีกครั้ง');
        // Not the generic retry line.
        expect(alertText).not.toContain('รีเฟรชหน้าจอเพื่อดูสถานะใบรับรอง');
        expect(buttonByText(CONFIRM_BUTTON)).toBeUndefined();
        expect(mockReviseCertificateLocation).not.toHaveBeenCalled();
    });

    it('(h) F-G4-58: a changed plant renders the พืชสมุนไพร row first, Herb → กัญชา in bold', async () => {
        mockPreviewCertificateRevision.mockResolvedValue(PREVIEW_PLANT_AND_PROVINCE_CHANGED);

        await mountPage();
        await openDialog();

        const rows = Array.from(dialog()!.querySelectorAll<HTMLTableRowElement>('table tbody tr'));
        expect(rows).toHaveLength(5);
        const labels = rows.map((tr) => (tr.cells[0]?.textContent || '').trim());
        expect(labels).toEqual([PLANT_ROW, 'จังหวัด', 'อำเภอ', 'ตำบล', 'ที่อยู่']);

        const plant = rows[0];
        const plantCells = Array.from(plant.cells).map((c) => (c.textContent || '').trim());
        expect(plantCells).toEqual([PLANT_ROW, 'Herb', 'กัญชา']);
        // The corrected plant is emphasised; the unchanged เดิม cell is not.
        expect(plant.cells[2]?.className).toContain('font-semibold');
        expect(plant.cells[1]?.className).not.toContain('font-semibold');

        // Province changed too: emphasised. District did not: muted.
        expect(rowByLabel('จังหวัด')!.cells[2]?.className).toContain('font-semibold');
        const district = rowByLabel('อำเภอ')!;
        expect(Array.from(district.cells).map((c) => (c.textContent || '').trim())).toEqual(['อำเภอ', 'แม่ริม', 'แม่ริม']);
        expect(district.cells[2]?.className).not.toContain('font-semibold');

        // A changed plant is a change: the reason field and confirm are offered.
        expect(dialog()!.querySelector('textarea')).not.toBeNull();
        expect(buttonByText(CONFIRM_BUTTON)).toBeDefined();
        expect(mockReviseCertificateLocation).not.toHaveBeenCalled();
    });
});
