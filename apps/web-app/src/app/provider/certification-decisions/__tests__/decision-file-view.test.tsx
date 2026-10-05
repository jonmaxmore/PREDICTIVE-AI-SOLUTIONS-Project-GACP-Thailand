/**
 * The approver's read-only file (Batch A item 1). The component is presentational: it takes
 * the payload GET /api/provider/auditor/applications/:id/decision-file returns and shows
 * what the decision rests on. No form controls: the approver reads here and decides on the list.
 */
import * as React from 'react';
import { describe, expect, it, beforeEach, afterEach, jest } from '@jest/globals';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';

declare global {

    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

jest.mock('next/navigation', () => ({
    useRouter: () => ({ push: jest.fn(), replace: jest.fn(), back: jest.fn(), prefetch: jest.fn() }),
    usePathname: () => '/provider/certification-decisions/app-1',
    useSearchParams: () => new URLSearchParams(),
}));
jest.mock('@/components/feature/document-viewer-modal', () => ({
    DocumentViewerModal: () => null,
}));

import { DecisionFileView } from '../[id]/decision-file-view';
import type { DecisionFile } from '../[id]/decision-file-types';

const FILE: DecisionFile = {
    application: {
        id: 'app-1', applicationNumber: 'APP-9001', status: 'AUDIT_PASSED', applicantName: 'สมชาย ใจดี',
        submittedAt: '2026-09-01T00:00:00.000Z', updatedAt: '2026-10-01T00:00:00.000Z', scheduledDate: null,
        farmAddress: '1 หมู่ 2 ต.ทดสอบ', farmLatitude: 13.7, farmLongitude: 100.5,
    },
    documents: [
        { slotId: 'ID_CARD', labelTH: 'สำเนาบัตรประชาชน', required: true, satisfied: true, fileUrl: '/uploads/application-drafts/1.pdf', fileName: 'idcard.pdf', verdict: 'ACCEPTED', reviewReason: null },
        { slotId: 'LAND', labelTH: 'เอกสารสิทธิ์ที่ดิน', required: true, satisfied: false, fileUrl: null, fileName: null, verdict: null, reviewReason: null },
    ],
    onsite: {
        audit: { id: 'audit-1' },
        checklist: [
            { itemCode: '1.1', section: 'SITE_SELECTION', prompt: 'พื้นที่ปลอดจากแหล่งปนเปื้อน', isCritical: true, response: 'PASS', notes: null },
            { itemCode: '1.2', section: 'SITE_SELECTION', prompt: 'แปลงปลูกห่างจากแหล่งน้ำเสีย', isCritical: false, response: 'FAIL', notes: 'ขาดป้ายเตือน' },
            { itemCode: '2.1', section: 'WATER_SOURCE', prompt: 'แหล่งน้ำมีผลตรวจคุณภาพ', isCritical: true, response: null, notes: null },
        ],
        photos: [
            {
                photoId: 'p1', uploadedBy: 'u', uploadedAt: '2026-10-01T01:00:00.000Z', capturedAt: '2026-10-01T01:00:00.000Z',
                fileHash: 'abcdef0123456789'.repeat(4), gps: { latitude: 13.7, longitude: 100.5 },
                place: { status: 'MEASURED', distanceMeters: 12, toleranceMeters: 500, beyondTolerance: false },
                time: { capturedAtSource: 'CALLER_SUPPLIED_UNVERIFIED', windowSource: 'INSPECTION_START', status: 'INSIDE', offsetSeconds: 30 },
                appearance: { perceptualHash: 'ff', algorithm: 'dhash64' },
                flags: ['NEAR_DUPLICATE'], caption: 'ทางเข้า', fileUrl: '/uploads/audits/audit-1/p1.jpg', fileName: 'p1.jpg',
            },
            {
                photoId: 'p2', uploadedBy: 'u', uploadedAt: '2026-10-01T01:05:00.000Z', capturedAt: '2026-10-01T01:05:00.000Z',
                fileHash: '0123456789abcdef'.repeat(4), gps: { latitude: 13.7, longitude: 100.5 },
                place: { status: 'MEASURED', distanceMeters: 9000, toleranceMeters: 500, beyondTolerance: true },
                time: { capturedAtSource: 'CALLER_SUPPLIED_UNVERIFIED', windowSource: 'INSPECTION_START', status: 'INSIDE', offsetSeconds: 60 },
                appearance: { perceptualHash: 'ff', algorithm: 'dhash64' },
                flags: ['PLACE_BEYOND_TOLERANCE', 'NEAR_DUPLICATE'], caption: null, fileUrl: null, fileName: null,
            },
        ],
        nearDuplicatePairs: [{ photoIds: ['p1', 'p2'], distanceBits: 0, sameFileHash: false, algorithm: 'dhash64' }],
        notRecorded: { place: 0, time: 0, appearance: 0 },
        needsAttention: 2,
        toleranceMeters: 500,
        gps: {
            checkIn: { latitude: 13.7, longitude: 100.5, accuracy: 8, at: '2026-10-01T00:30:00.000Z' },
            withinTolerance: true, distanceMeters: 15, farmLatitude: 13.7, farmLongitude: 100.5, toleranceMeters: 500, unknownFarmLocation: false,
        },
        evidenceGate: { sufficient: false, code: 'INCOMPLETE_CHECKLIST', messageTh: 'แบบตรวจแปลงยังตอบไม่ครบทุกข้อ' },
    },
    inspectorSummary: { inspectorName: 'ผู้ตรวจ หนึ่ง', decision: 'PASS', notes: 'ผ่านทุกข้อสำคัญ', reasonCode: null, decidedAt: '2026-10-01T02:00:00.000Z' },
    carHistory: {
        rounds: [{ roundNo: 1, decidedAt: '2026-09-10T00:00:00.000Z', dueAt: '2026-09-17T00:00:00.000Z' }],
        decisions: [{ decision: 'MINOR', notes: 'ป้ายเตือนไม่ครบ', reasonCode: null, decidedAt: '2026-09-10T00:00:00.000Z', findings: [{ nonConformity: 'ไม่มีป้ายเตือน', correctiveAction: 'ติดป้าย', category: null }] }],
        applicantDocuments: [{ name: 'ภาพป้าย.jpg', path: '/uploads/car/x.jpg', uploadedAt: '2026-09-20T00:00:00.000Z' }],
    },
};

describe('DecisionFileView', () => {
    let container: HTMLDivElement;
    let root: Root;
    beforeEach(() => {
        container = document.createElement('div');
        document.body.appendChild(container);
        root = createRoot(container);
    });
    afterEach(() => {
        act(() => { root.unmount(); });
        container.remove();
    });
    const render = () => { act(() => { root.render(<DecisionFileView file={FILE} />); }); return container.textContent || ''; };

    it('shows the application and who filed it', () => {
        const t = render();
        expect(t).toContain('APP-9001');
        expect(t).toContain('สมชาย ใจดี');
        expect(t).toContain('1 หมู่ 2 ต.ทดสอบ');
    });

    it('shows each document with its officer verdict, and says plainly when one is missing', () => {
        const t = render();
        expect(t).toContain('สำเนาบัตรประชาชน');
        expect(t).toContain('รับแล้ว');
        expect(t).toContain('เอกสารสิทธิ์ที่ดิน');
        expect(t).toContain('ยังไม่ได้แนบ');
    });

    it('shows the checklist result per item, the failed one with its note, and an unanswered one as unanswered', () => {
        const t = render();
        expect(t).toContain('พื้นที่ปลอดจากแหล่งปนเปื้อน');
        expect(t).toContain('ไม่ผ่าน');
        expect(t).toContain('ขาดป้ายเตือน');
        expect(t).toContain('ยังไม่ได้ตอบ');
    });

    it('shows photos with hash, GPS, time and the duplicate / out-of-place flags', () => {
        const t = render();
        expect(t).toContain('abcdef012345');
        expect(t).toContain('13.7');
        expect(t).toContain('ภาพซ้ำหรือคล้ายกันมาก');
        expect(t).toContain('ห่างจากฟาร์มเกินเกณฑ์');
    });

    it('shows the GPS check-in against the farm', () => {
        const t = render();
        expect(t).toContain('เช็คอิน');
        expect(t).toContain('15');
    });

    it('shows the inspector summary and the correction history', () => {
        const t = render();
        expect(t).toContain('ผ่านทุกข้อสำคัญ');
        expect(t).toContain('ไม่มีป้ายเตือน');
        expect(t).toContain('ติดป้าย');
        expect(t).toContain('ภาพป้าย.jpg');
    });

    it('warns the approver before pressing อนุมัติ when the evidence would not pass issuance', () => {
        const t = render();
        expect(t).toContain('แบบตรวจแปลงยังตอบไม่ครบทุกข้อ');
    });

    it('is read-only: no form controls', () => {
        render();
        expect(container.querySelector('form, textarea, input, select')).toBeNull();
    });

    it('uses no emoji and no unexplained CAR jargon', () => {
        const t = render();
        expect(t).not.toMatch(/[\u{1F300}-\u{1FAFF}☀-➿]/u);
        expect(t).not.toMatch(/\bCAR\b/);
    });
});

describe('route access to the approver\'s file', () => {
    it('certificate_approver opens /provider/certification-decisions/:id; the inspector does not', () => {
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { providerRoleCanOpen } = require('@/lib/provider-role-config');
        expect(providerRoleCanOpen('certificate_approver', '/provider/certification-decisions/app-1')).toBe(true);
        expect(providerRoleCanOpen('field_inspector', '/provider/certification-decisions/app-1')).toBe(false);
    });
});
