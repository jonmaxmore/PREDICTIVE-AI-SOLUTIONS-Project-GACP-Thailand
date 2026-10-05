/**
 * verify-revision-line.test.tsx — certificate revision (ฉบับแก้ไขภายใต้เลขเดิม)
 * on the public verifier.
 *
 * The backend verify JSON (apps/backend/routes/api/auth/public.js) is additive:
 * `data.revision` is `null` at revision 1 and
 * `{ no, revisedAt, reasonLabel, history: [{ no, signedAt, supersededAt }] }`
 * once the certificate has been corrected. The page must:
 *
 *   1. with `revision` present: render ONE neutral line under the hero
 *      ("ฉบับแก้ไขครั้งที่ 1 · <date> · <reasonLabel>") plus a link
 *      "ดูฉบับก่อนหน้า" to `/verify/<no>/revision/1`, while the status hero
 *      STAYS GREEN — a revision never downgrades trust;
 *   2. with `revision: null`: render none of that;
 *   3. never print the admin's free text (reasonText); only the reason label.
 *
 * The archived-revision page (`/verify/<no>/revision/<n>`) fetches
 * `/api/v1/public/verify/<no>/revisions/<n>` and renders the archived snapshot
 * with its own verdict "ฉบับนี้ถูกต้อง ณ วันที่ออก และถูกแทนที่แล้วเมื่อ <date>".
 *
 * Both pages are async server components; next/headers and fetch are the only
 * two things stubbed (same convention as verify-holder-row.test.tsx).
 */

import { renderToStaticMarkup } from 'react-dom/server';

const mockHeaderGet = jest.fn((name: string) =>
    name === 'x-forwarded-host' ? 'staging.gacpth.com' : name === 'x-forwarded-proto' ? 'https' : null,
);

jest.mock('next/headers', () => ({
    headers: async () => ({ get: (name: string) => mockHeaderGet(name) }),
}));

import PublicCertVerifyPage from '../page';
import PublicCertRevisionPage from '../revision/[n]/page';
import { deriveVerifyView } from '../verify-view';

const CERT_NO = 'GACP-TH-2569-A3F7B2';
const GREEN_HERO_TH = 'ใบรับรองถูกต้องและยังมีผลบังคับใช้';
const REVISION_LINE_TH = 'ฉบับแก้ไขครั้งที่ 1';
const REASON_LABEL_TH = 'แก้ไขข้อมูลบนใบรับรองให้ตรงกับบันทึกต้นทาง (ความผิดพลาดของระบบ)';
const PREVIOUS_LINK_TH = 'ดูฉบับก่อนหน้า';
const REASON_TEXT_NEVER_SHOWN = 'ADMIN-FREE-TEXT-MUST-NOT-LEAK';

const REVISION_R2 = {
    no: 2,
    revisedAt: '2026-08-27T02:00:00Z',
    reasonLabel: REASON_LABEL_TH,
    // Defensive: the backend never sends reasonText, but if a future change
    // did, the page must still not print it.
    reasonText: REASON_TEXT_NEVER_SHOWN,
    history: [{ no: 1, signedAt: '2026-01-01T00:00:00.000Z', supersededAt: '2026-08-27T02:00:00Z' }],
};

function stubVerifyResponse(revision: unknown) {
    global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({
            success: true,
            verified: true,
            valid: true,
            data: {
                certificateNumber: CERT_NO,
                status: 'active',
                integrity: 'VALID',
                signatureValid: true,
                sealed: true,
                revision,
                certificate: {
                    farmName: 'ฟาร์มสมุนไพรบ้านนา',
                    holderDisplayName: 'บริษัท สมุนไพรไทย จำกัด',
                    province: 'เชียงใหม่',
                    cropTypes: ['ขมิ้นชัน'],
                    issueDate: '2026-01-01T00:00:00.000Z',
                    expiryDate: '2029-01-01T00:00:00.000Z',
                    standards: ['GACP'],
                },
                verifiedAt: '2026-08-27T03:00:00.000Z',
            },
        }),
    }) as unknown as typeof fetch;
}

function stubRevisionResponse(body: { ok: boolean; status: number; json?: unknown }) {
    global.fetch = jest.fn().mockResolvedValue({
        ok: body.ok,
        status: body.status,
        json: async () => body.json,
    }) as unknown as typeof fetch;
}

async function renderVerifyPage(certNumber = CERT_NO) {
    const element = await PublicCertVerifyPage({
        params: Promise.resolve({ 'cert-number': certNumber }),
    });
    return renderToStaticMarkup(element);
}

async function renderRevisionPage(certNumber = CERT_NO, n = '1') {
    const element = await PublicCertRevisionPage({
        params: Promise.resolve({ 'cert-number': certNumber, n }),
    });
    return renderToStaticMarkup(element);
}

afterEach(() => {
    jest.clearAllMocks();
});

describe('deriveVerifyView carries data.revision through unchanged', () => {
    it('returns the revision block typed, exactly as the backend sent it', () => {
        const view = deriveVerifyView({
            verified: true,
            data: { integrity: 'VALID', signatureValid: true, sealed: true, revision: REVISION_R2 },
        });
        expect(view.revision).not.toBeNull();
        expect(view.revision?.no).toBe(2);
        expect(view.revision?.reasonLabel).toBe(REASON_LABEL_TH);
        expect(view.revision?.history).toEqual([
            { no: 1, signedAt: '2026-01-01T00:00:00.000Z', supersededAt: '2026-08-27T02:00:00Z' },
        ]);
        // A revision never changes the trust verdict.
        expect(view.heroTone).toBe('success');
        expect(view.showVerifiedChip).toBe(true);
    });

    it('is null when the backend sent null, and null when the field is absent (backend not yet deployed)', () => {
        expect(deriveVerifyView({ verified: true, data: { integrity: 'VALID', signatureValid: true, revision: null } }).revision).toBeNull();
        expect(deriveVerifyView({ verified: true, data: { integrity: 'VALID', signatureValid: true } }).revision).toBeNull();
        expect(deriveVerifyView(null).revision).toBeNull();
    });
});

describe('public verify page — revision line under the hero', () => {
    it('revision at r2 → one neutral line + link to the archived revision 1; hero stays green', async () => {
        stubVerifyResponse(REVISION_R2);
        const html = await renderVerifyPage();

        expect(html).toContain(REVISION_LINE_TH);
        expect(html).toContain('27 ส.ค. 2569');
        expect(html).toContain('แก้ไขข้อมูลบนใบรับรองให้ตรงกับบันทึกต้นทาง');
        expect(html).toContain(PREVIOUS_LINK_TH);
        expect(html).toContain(`href="/verify/${CERT_NO}/revision/1"`);

        // The hero is untouched: still the green success copy, never the red one.
        expect(html).toContain(GREEN_HERO_TH);
        expect(html).not.toContain('ใบรับรองไม่ถูกต้อง');
        expect(html).not.toContain('เอกสารถูกแก้ไข');

        // The line is neutral (muted), not painted in the hero's colour.
        expect(html).toMatch(/bg-muted[^"]*text-muted-foreground|text-muted-foreground[^"]*bg-muted/);

        // The admin's free text never reaches the public.
        expect(html).not.toContain(REASON_TEXT_NEVER_SHOWN);
    });

    it('revision null → no revision line, no link, hero unchanged', async () => {
        stubVerifyResponse(null);
        const html = await renderVerifyPage();

        expect(html).not.toContain('ฉบับแก้ไขครั้งที่');
        expect(html).not.toContain(PREVIOUS_LINK_TH);
        expect(html).not.toContain(`/verify/${CERT_NO}/revision/`);
        expect(html).toContain(GREEN_HERO_TH);
    });
});

describe('archived revision page — /verify/<no>/revision/<n>', () => {
    const SNAPSHOT_R1 = {
        success: true,
        data: {
            certificateNumber: CERT_NO,
            revisionNo: 1,
            superseded: true,
            supersededAt: '2026-08-27T02:00:00Z',
            integrity: 'VALID',
            signatureValid: true,
            snapshot: {
                province: 'Unknown',
                district: 'Unknown',
                subDistrict: 'Unknown',
                farmName: 'ฟาร์มสมุนไพรบ้านนา',
            },
        },
    };

    it('fetches /api/v1/public/verify/<no>/revisions/<n> from the request host, like the verify page', async () => {
        stubRevisionResponse({ ok: true, status: 200, json: SNAPSHOT_R1 });
        await renderRevisionPage(CERT_NO, '1');
        const fetchMock = global.fetch as unknown as jest.Mock;
        expect(fetchMock).toHaveBeenCalledTimes(1);
        expect(fetchMock.mock.calls[0]?.[0]).toBe(
            `https://staging.gacpth.com/api/v1/public/verify/${CERT_NO}/revisions/1`,
        );
    });

    it('VALID + signed archived snapshot → "valid when issued, superseded on <date>" + the snapshot fields', async () => {
        stubRevisionResponse({ ok: true, status: 200, json: SNAPSHOT_R1 });
        const html = await renderRevisionPage(CERT_NO, '1');

        expect(html).toContain('ฉบับนี้ถูกต้อง ณ วันที่ออก และถูกแทนที่แล้วเมื่อ 27 ส.ค. 2569');
        // The archived fact is shown as archived, exactly as it was recorded.
        expect(html).toContain('Unknown');
        expect(html).toContain('ฟาร์มสมุนไพรบ้านนา');
        expect(html).toContain(CERT_NO);
        // A way back to the live document.
        expect(html).toContain(`href="/verify/${CERT_NO}"`);
        // Never the live page's green "valid and in force" claim.
        expect(html).not.toContain(GREEN_HERO_TH);
    });

    it('TAMPERED archived snapshot → the tampered verdict, never the "valid when issued" one', async () => {
        stubRevisionResponse({
            ok: true,
            status: 200,
            json: { ...SNAPSHOT_R1, data: { ...SNAPSHOT_R1.data, integrity: 'TAMPERED', signatureValid: false } },
        });
        const html = await renderRevisionPage(CERT_NO, '1');
        expect(html).not.toContain('ฉบับนี้ถูกต้อง ณ วันที่ออก');
        expect(html).toContain('เอกสารถูกแก้ไข ไม่ตรงกับต้นฉบับ');
    });

    it('404 (no such revision) → "not found" copy, no verdict, link back to the live document', async () => {
        stubRevisionResponse({ ok: false, status: 404, json: { success: false, error: 'REVISION_NOT_FOUND' } });
        const html = await renderRevisionPage(CERT_NO, '9');
        expect(html).toContain('ไม่พบฉบับก่อนหน้า');
        expect(html).not.toContain('ฉบับนี้ถูกต้อง ณ วันที่ออก');
        expect(html).toContain(`href="/verify/${CERT_NO}"`);
    });

    it('backend unreachable → neutral "cannot verify now" copy, never a verdict', async () => {
        global.fetch = jest.fn().mockRejectedValue(new Error('ECONNREFUSED')) as unknown as typeof fetch;
        const html = await renderRevisionPage(CERT_NO, '1');
        expect(html).toContain('ไม่สามารถตรวจสอบได้ในขณะนี้');
        expect(html).not.toContain('ฉบับนี้ถูกต้อง ณ วันที่ออก');
        expect(html).not.toContain('ไม่พบฉบับก่อนหน้า');
    });
});
