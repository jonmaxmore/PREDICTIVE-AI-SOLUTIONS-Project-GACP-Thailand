/**
 * verify-status-reason.test.tsx — the public verifier says WHY in Thai, and a
 * superseded certificate points at its renewal (ledger F-G4-57).
 *
 * Before this, a citizen who scanned the QR of a certificate that was not valid
 * read 'ใบรับรองไม่ถูกต้อง' over an ENGLISH sentence from the backend
 * ('Certificate has expired'), or the bare English fallback 'Certificate
 * Invalid' — and a certificate replaced by a renewal was shown as plain
 * "invalid" with no way to reach the current one.
 *
 * The backend now publishes `data.reasonCode` ('EXPIRED' | 'SUSPENDED' |
 * 'REVOKED' | 'RENEWED' | 'NOT_FOUND' | 'CODE_MISMATCH' | null) next to the
 * unchanged English `data.reason`, and `data.renewal.successorCertificateNumber`
 * for a superseded certificate (apps/backend/routes/api/auth/
 * public-verify-reason.js). These contracts pin the Thai copy derived from them
 * and the link to the successor.
 *
 * Convention (as in verify-crypto-verdict.test.tsx): the pure view-model
 * (deriveVerifyView) and the presentational component (StatusReason) live in
 * the sibling `verify-view` module, so they render through
 * renderToStaticMarkup without standing up the async server component.
 */

import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { deriveVerifyView, StatusReason } from '../verify-view';

const SUCCESSOR = 'GACP-TH-2570-C41D9E';

/** The exact copy the citizen reads. */
const COPY = {
    EXPIRED: {
        title: 'ใบรับรองหมดอายุแล้ว',
        detail: 'ใบรับรองฉบับนี้พ้นวันหมดอายุแล้ว สอบถามสถานะการต่ออายุได้จากผู้ถือใบรับรอง',
    },
    SUSPENDED: {
        title: 'ใบรับรองถูกระงับชั่วคราว',
        detail: 'หน่วยรับรองระงับการใช้ใบรับรองฉบับนี้ชั่วคราว ยังใช้อ้างอิงไม่ได้จนกว่าจะได้รับการคืนสถานะ',
    },
    REVOKED: {
        title: 'ใบรับรองถูกเพิกถอนแล้ว',
        detail: 'หน่วยรับรองเพิกถอนใบรับรองฉบับนี้แล้ว ใช้อ้างอิงไม่ได้อีก',
    },
    RENEWED: {
        title: 'ใบรับรองฉบับนี้ถูกแทนที่ด้วยฉบับต่ออายุแล้ว',
        detail: 'กรุณาตรวจสอบใบรับรองฉบับปัจจุบันแทน',
    },
    NOT_FOUND: {
        title: 'ไม่พบใบรับรองเลขที่นี้ในทะเบียน',
        detail: 'ตรวจสอบเลขที่ใบรับรองบนเอกสารอีกครั้ง หรือสอบถามจากผู้ถือใบรับรอง',
    },
    CODE_MISMATCH: {
        title: 'รหัสตรวจสอบไม่ตรงกับใบรับรอง',
        detail: 'สแกน QR จากเอกสารฉบับจริงอีกครั้ง หรือสอบถามจากผู้ถือใบรับรอง',
    },
} as const;

/**
 * An expired certificate that HAS a successor says both things at once: it is
 * expired (the public status word), and there is a current document to look at.
 */
const EXPIRED_WITH_SUCCESSOR_DETAIL =
    'ใบรับรองฉบับนี้หมดอายุและมีฉบับต่ออายุแล้ว กรุณาตรวจสอบใบรับรองฉบับปัจจุบันแทน';

const GENERIC_TITLE = 'ใบรับรองไม่ถูกต้อง';
/**
 * C2-2: a dead end is not an answer. The generic fallback now names what the
 * citizen can actually DO next (ask the holder, or contact the certification
 * body), not only that the status could not be read.
 */
const GENERIC_DETAIL =
    'ไม่พบสถานะที่ใช้อ้างอิงได้ของใบรับรองฉบับนี้ สอบถามจากผู้ถือใบรับรอง หรือติดต่อหน่วยรับรอง';

describe('deriveVerifyView — statusReason', () => {
    it('a status-valid certificate has no status reason to show', () => {
        const view = deriveVerifyView({
            verified: true,
            data: { integrity: 'VALID', signatureValid: true, reasonCode: null, renewal: null },
        });
        expect(view.statusValid).toBe(true);
        expect(view.statusReason).toBeNull();
    });

    it.each([
        ['EXPIRED', 'Certificate has expired'],
        ['SUSPENDED', 'Certificate is suspended'],
        ['REVOKED', 'Certificate has been revoked'],
        ['RENEWED', 'Certificate has been renewed'],
        ['NOT_FOUND', 'Certificate not found'],
        ['CODE_MISMATCH', 'Invalid verification code'],
    ] as const)('%s is told in Thai, not in the English the backend sends', (code, englishReason) => {
        const view = deriveVerifyView({
            verified: false,
            data: { status: 'x', reason: englishReason, reasonCode: code },
        });
        expect(view.statusReason).toEqual({
            code,
            title: COPY[code].title,
            detail: COPY[code].detail,
            successorNumber: null,
            reasonEN: null,
        });
        // The English sentence must not survive into what the citizen reads.
        expect(view.statusReason?.title).not.toContain('Certificate');
        expect(view.statusReason?.detail).not.toContain('Certificate');
        // No em dash in Thai copy (COMMON.md).
        expect(view.statusReason?.detail).not.toMatch(/—/);
    });

    it('RENEWED carries the successor number when the backend resolved one', () => {
        const view = deriveVerifyView({
            verified: false,
            data: {
                status: 'renewed',
                reason: 'Certificate has been renewed',
                reasonCode: 'RENEWED',
                renewal: { successorCertificateNumber: SUCCESSOR },
            },
        });
        expect(view.statusReason).toEqual({
            code: 'RENEWED',
            title: COPY.RENEWED.title,
            detail: COPY.RENEWED.detail,
            successorNumber: SUCCESSOR,
            reasonEN: null,
        });
    });

    it('RENEWED whose successor did not resolve still explains itself, without a number', () => {
        const view = deriveVerifyView({
            verified: false,
            data: { status: 'renewed', reasonCode: 'RENEWED', renewal: null },
        });
        expect(view.statusReason?.code).toBe('RENEWED');
        expect(view.statusReason?.successorNumber).toBeNull();
    });

    /**
     * C-F1: expiry wins over the stored status on the wire, so a renewed
     * certificate that has since passed its expiryDate arrives as EXPIRED with
     * `renewal` still set. The successor must survive that: the pointer belongs
     * to the certificate, not to one particular reason code.
     */
    it('an EXPIRED certificate that was also renewed keeps the pointer to its successor', () => {
        const view = deriveVerifyView({
            verified: false,
            data: {
                status: 'expired',
                reason: 'Certificate has expired',
                reasonCode: 'EXPIRED',
                renewal: { successorCertificateNumber: SUCCESSOR },
            },
        });
        expect(view.statusReason).toEqual({
            code: 'EXPIRED',
            title: COPY.EXPIRED.title,
            detail: EXPIRED_WITH_SUCCESSOR_DETAIL,
            successorNumber: SUCCESSOR,
            reasonEN: null,
        });
    });

    it('an EXPIRED certificate with no successor keeps its plain expiry wording', () => {
        const view = deriveVerifyView({
            verified: false,
            data: { status: 'expired', reason: 'Certificate has expired', reasonCode: 'EXPIRED' },
        });
        expect(view.statusReason?.detail).toBe(COPY.EXPIRED.detail);
        expect(view.statusReason?.successorNumber).toBeNull();
    });

    it('no reasonCode but an English reason (backend not yet deployed): Thai first, English beside it', () => {
        const view = deriveVerifyView({
            verified: false,
            data: { status: 'expired', reason: 'Certificate has expired' },
        });
        expect(view.statusReason).toEqual({
            code: null,
            title: GENERIC_TITLE,
            // The citizen is never told ONLY in English: the detail stays Thai.
            detail: GENERIC_DETAIL,
            successorNumber: null,
            reasonEN: 'Certificate has expired',
        });
    });

    it('neither a code nor a reason: the citizen is still told something true', () => {
        const view = deriveVerifyView({ verified: false, data: { status: 'invalid' } });
        expect(view.statusReason).toEqual({
            code: null,
            title: GENERIC_TITLE,
            detail: GENERIC_DETAIL,
            successorNumber: null,
            reasonEN: null,
        });
    });

    it('a reasonCode this build does not know falls back instead of printing the raw enum', () => {
        const view = deriveVerifyView({
            verified: false,
            data: { status: 'x', reasonCode: 'WITHDRAWN', reason: 'Certificate was withdrawn' },
        });
        expect(view.statusReason?.code).toBeNull();
        expect(view.statusReason?.title).toBe(GENERIC_TITLE);
        expect(view.statusReason?.detail).toBe(GENERIC_DETAIL);
        expect(view.statusReason?.reasonEN).toBe('Certificate was withdrawn');
        // A raw backend enum is never shown to an applicant (COMMON.md).
        expect(view.statusReason?.detail).not.toContain('WITHDRAWN');
        expect(view.statusReason?.title).not.toContain('WITHDRAWN');
    });

    /**
     * C-F3: the copy table is a plain object, so a code that names something on
     * Object.prototype used to resolve to an inherited value and render as
     * `undefined`. A code only counts when the table OWNS the key.
     */
    it.each(['constructor', 'toString', '__proto__', 'valueOf'])(
        'the prototype-chain key %s is not a reason code',
        (poisoned) => {
            const view = deriveVerifyView({
                verified: false,
                data: { status: 'x', reasonCode: poisoned },
            });
            expect(view.statusReason?.code).toBeNull();
            expect(view.statusReason?.title).toBe(GENERIC_TITLE);
            expect(view.statusReason?.detail).toBe(GENERIC_DETAIL);
        },
    );

    it('a null result (fetch failed) does not crash the derivation', () => {
        const view = deriveVerifyView(null);
        expect(view.statusReason).toEqual({
            code: null,
            title: GENERIC_TITLE,
            detail: GENERIC_DETAIL,
            successorNumber: null,
            reasonEN: null,
        });
    });
});

describe('StatusReason (presentational)', () => {
    it('renders nothing for a status-valid certificate', () => {
        const view = deriveVerifyView({
            verified: true,
            data: { integrity: 'VALID', signatureValid: true },
        });
        expect(renderToStaticMarkup(<StatusReason view={view} />)).toBe('');
    });

    it('renders the Thai title and detail for an expired certificate', () => {
        const view = deriveVerifyView({
            verified: false,
            data: { status: 'expired', reason: 'Certificate has expired', reasonCode: 'EXPIRED' },
        });
        const html = renderToStaticMarkup(<StatusReason view={view} />);
        expect(html).toContain(COPY.EXPIRED.title);
        expect(html).toContain(COPY.EXPIRED.detail);
        expect(html).not.toContain('Certificate has expired');
        // Thai must not be spaced out / upper-cased (COMMON.md).
        expect(html).not.toMatch(/tracking-|uppercase|font-black/);
    });

    it.each(['NOT_FOUND', 'CODE_MISMATCH'] as const)(
        'renders the Thai answer for %s, the commonest citizen failures',
        (code) => {
            const view = deriveVerifyView({
                verified: false,
                data: { status: 'invalid', reasonCode: code },
            });
            const html = renderToStaticMarkup(<StatusReason view={view} />);
            expect(html).toContain(COPY[code].title);
            expect(html).toContain(COPY[code].detail);
            expect(html).not.toContain(GENERIC_TITLE);
        },
    );

    it('RENEWED with a successor links to the current certificate', () => {
        const view = deriveVerifyView({
            verified: false,
            data: {
                status: 'renewed',
                reasonCode: 'RENEWED',
                renewal: { successorCertificateNumber: SUCCESSOR },
            },
        });
        const html = renderToStaticMarkup(<StatusReason view={view} />);
        expect(html).toContain(COPY.RENEWED.title);
        expect(html).toContain(`href="/verify/${SUCCESSOR}"`);
        expect(html).toContain(`ตรวจสอบฉบับปัจจุบัน ${SUCCESSOR}`);
    });

    it('an EXPIRED certificate with a successor renders the link too (C-F1)', () => {
        const view = deriveVerifyView({
            verified: false,
            data: {
                status: 'expired',
                reason: 'Certificate has expired',
                reasonCode: 'EXPIRED',
                renewal: { successorCertificateNumber: SUCCESSOR },
            },
        });
        const html = renderToStaticMarkup(<StatusReason view={view} />);
        expect(html).toContain(COPY.EXPIRED.title);
        expect(html).toContain(EXPIRED_WITH_SUCCESSOR_DETAIL);
        expect(html).toContain(`href="/verify/${SUCCESSOR}"`);
        expect(html).toContain(`ตรวจสอบฉบับปัจจุบัน ${SUCCESSOR}`);
    });

    /**
     * C-F4: a certificate number is data, not a URL fragment. '#' in a raw href
     * would truncate the link at the anchor and send the citizen to /verify/GACP.
     */
    it('percent-encodes the successor number in the link', () => {
        const view = deriveVerifyView({
            verified: false,
            data: {
                status: 'renewed',
                reasonCode: 'RENEWED',
                renewal: { successorCertificateNumber: 'GACP-TH-2570-A#1/2' },
            },
        });
        const html = renderToStaticMarkup(<StatusReason view={view} />);
        expect(html).toContain('href="/verify/GACP-TH-2570-A%231%2F2"');
        expect(html).not.toContain('href="/verify/GACP-TH-2570-A#1/2"');
        // The number itself is still readable in the link text.
        expect(html).toContain('ตรวจสอบฉบับปัจจุบัน GACP-TH-2570-A#1/2');
    });

    it('RENEWED without a successor renders the explanation and NO dead link', () => {
        const view = deriveVerifyView({
            verified: false,
            data: { status: 'renewed', reasonCode: 'RENEWED' },
        });
        const html = renderToStaticMarkup(<StatusReason view={view} />);
        expect(html).toContain(COPY.RENEWED.title);
        expect(html).not.toContain('<a ');
        expect(html).not.toContain('ตรวจสอบฉบับปัจจุบัน');
    });

    it('the pre-deploy fallback shows the Thai first and the backend English as a third line', () => {
        const view = deriveVerifyView({
            verified: false,
            data: { status: 'suspended', reason: 'Certificate is suspended' },
        });
        const html = renderToStaticMarkup(<StatusReason view={view} />);
        expect(html).toContain(GENERIC_TITLE);
        expect(html).toContain(GENERIC_DETAIL);
        // English is present as evidence, but never as the only explanation:
        // it comes after the Thai detail.
        expect(html).toContain('Certificate is suspended');
        expect(html.indexOf(GENERIC_DETAIL)).toBeLessThan(html.indexOf('Certificate is suspended'));
    });

    it('no English reason at all: no empty third line is rendered', () => {
        const view = deriveVerifyView({ verified: false, data: { status: 'invalid' } });
        const html = renderToStaticMarkup(<StatusReason view={view} />);
        expect(html).toContain(GENERIC_TITLE);
        expect(html).toContain(GENERIC_DETAIL);
        expect(html.match(/<p/g) ?? []).toHaveLength(2);
    });

    /**
     * C2-1: the English third line sits on the red hero (bg-red-50). Rendered
     * at text-red-700/70 its contrast against that background is ~3.6:1 — below
     * the WCAG AA 4.5:1 floor, and at 11px it was the smallest text on the page
     * as well. Full-strength text-red-700 at text-xs measures ~5.9:1. This is
     * the ONE line on the verifier that carries the real cause when the code is
     * unclassifiable, so it must be legible, not decorative.
     */
    it('renders the English third line at AA contrast, not faded 11px', () => {
        const view = deriveVerifyView({
            verified: false,
            data: { status: 'suspended', reason: 'Certificate is suspended' },
        });
        const html = renderToStaticMarkup(<StatusReason view={view} />);
        expect(html).toContain(`<p class="text-xs text-red-700">Certificate is suspended</p>`);
        expect(html).not.toContain('text-red-700/70');
        expect(html).not.toContain('text-[11px]');
    });
});
