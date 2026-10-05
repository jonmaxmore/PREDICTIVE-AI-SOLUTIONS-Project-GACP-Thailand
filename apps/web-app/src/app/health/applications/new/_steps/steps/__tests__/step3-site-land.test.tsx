/**
 * T7 — step 3 asks กทล.1 ส่วนที่ ๒ ข้อ ๑-๒, and the papers it asks for follow the answers.
 *
 * Two dimensions live on this screen — `landOwnership` and `areaType` — and both are
 * words the requirement register matches rules on. Change either and the filing owes a
 * different set of papers. The screen therefore RE-ASKS the server rather than keeping
 * its own idea of the required set, and each card says WHY it appeared, because a
 * document that turns up unexplained reads as a malfunction rather than as the law.
 */

import { renderToStaticMarkup } from 'react-dom/server';
import {
    LAND_TENURE_OPTIONS,
    AREA_TYPE_OPTIONS,
    AREA_UNIT_TH,
    LAND_DOCUMENT_FIELDS,
    STEP3_SITE_SLOT_IDS,
    STEP3_COPY_TH,
    needsLandlordName,
    AREA_TYPE_OPTIONS,
} from '../step3-site-land-config';
import { requiredReasonBadge } from '../requirement-slot-card-state';
import Step3SiteLand from '../step3-site-land';

const slot = (slotId: string, labelTH: string, requiredReason: string) => ({
    slotId, labelTH, description: null, sourceHint: null,
    required: true, requiredReason, satisfied: false,
    fileUrl: null, fileName: null, uploadedAt: null,
} as never);

describe('the vocabulary step 3 writes', () => {
    it('offers the register’s three land tenures', () => {
        expect(LAND_TENURE_OPTIONS.map((o) => o.value)).toEqual(['OWNED', 'STATE_PERMITTED', 'RENTED']);
    });

    it('offers the three ลักษณะพื้นที่ boxes — it is a checkbox row, not a single choice', () => {
        // สามข้อ (operator 2026-09-11) · "อื่น ๆ" ถูกถอดออกทั้งจากจอ จากทะเบียนกฎ
        // และจากใบ กทล.1 ที่ระบบพิมพ์ — จำนวนข้อที่ติ๊กคือตัวคูณค่าบริการ
        expect(AREA_TYPE_OPTIONS.map((o) => o.value)).toEqual(['OUTDOOR', 'GREENHOUSE', 'INDOOR']);
    });

    it('measures area in ตารางเมตร only, with no unit picker', () => {
        expect(AREA_UNIT_TH).toBe('ตารางเมตร');
        expect(STEP3_COPY_TH.areaSqm).toContain('ตารางเมตร');
        // A unit the applicant chooses is a number whose meaning depends on a second
        // field; 19 farms already had to be healed for exactly that.
        expect(STEP3_COPY_TH.areaSqm).not.toContain('ไร่');
    });

    it('reads as Thai and never shows a raw enum', () => {
        [...LAND_TENURE_OPTIONS, ...AREA_TYPE_OPTIONS].forEach((o) => {
            expect(o.labelTH).toMatch(/[ก-๙]/);
            expect(o.labelTH).not.toContain(o.value);
        });
        Object.values(STEP3_COPY_TH).forEach((line) => expect(line).not.toContain('—'));
    });

    it('asks only the paper’s own fields — no water system, no yield estimate', () => {
        const copy = JSON.stringify(STEP3_COPY_TH);
        ['ระบบน้ำ', 'ผลผลิตคาดการณ์', 'ผลผลิตที่คาด'].forEach((absent) => {
            expect(copy).not.toContain(absent);
        });
    });

    it('takes the land document’s details, with only type and number required', () => {
        const required = LAND_DOCUMENT_FIELDS.filter((f) => f.required).map((f) => f.key);
        expect(required).toEqual(['type', 'number']);
        expect(LAND_DOCUMENT_FIELDS.map((f) => f.key))
            .toEqual(['type', 'number', 'volume', 'page', 'issuedBy']);
    });
});

describe('which follow-up the answers open', () => {
    it('asks who the landlord is, only when the land is rented', () => {
        expect(needsLandlordName('RENTED')).toBe(true);
        expect(needsLandlordName('OWNED')).toBe(false);
        expect(needsLandlordName('STATE_PERMITTED')).toBe(false);
        expect(needsLandlordName(null)).toBe(false);
    });

    it('ลักษณะพื้นที่มีสามข้อ และไม่มี "อื่น ๆ" (operator 2026-09-11)', () => {
        // จำนวนข้อที่ติ๊กคือตัวคูณค่าบริการ และชุดที่ติ๊กคือขอบเขตบนใบรับรอง
        // ตัวเลือกที่สี่จึงไม่ใช่ตัวเลือกที่ไม่มีราคา
        expect(AREA_TYPE_OPTIONS.map((o) => o.value)).toEqual(['OUTDOOR', 'GREENHOUSE', 'INDOOR']);
        expect(AREA_TYPE_OPTIONS.every((o) => /[ก-๙]/.test(o.labelTH))).toBe(true);
    });
});

describe('each card says why it is there', () => {
    it('a building plan pulled in by อาคารระบบปิด explains itself', () => {
        expect(requiredReasonBadge(slot('building_plan_photos', 'แบบแปลนอาคาร', 'INDOOR')))
            .toBe('เพราะโรงเรือนระบบปิด');
    });

    it('a landlord consent pulled in by a lease explains itself', () => {
        expect(requiredReasonBadge(slot('landlord_consent', 'หนังสือยินยอม', 'RENTED')))
            .toBe('เพราะที่ดินเป็นการเช่า');
    });

    it('says nothing for ALWAYS — "you must because you must" explains nothing', () => {
        expect(requiredReasonBadge(slot('site_photos', 'ภาพถ่ายสถานที่', 'ALWAYS'))).toBeNull();
    });
});

describe('the screen', () => {
    const render = (farmData: Record<string, unknown>, slots: unknown[]) => renderToStaticMarkup(
        <Step3SiteLand
            farmData={farmData}
            slots={slots as never}
            appId="app-1"
            onChange={() => {}}
            onChanged={() => {}}
        />,
    );

    it('RENTED asks who the landlord is, and the consent card appears with its reason', () => {
        const html = render(
            { landOwnership: 'RENTED' },
            [slot('landlord_consent', 'หนังสือยินยอมจากเจ้าของที่ดิน', 'RENTED')],
        );
        expect(html).toContain(STEP3_COPY_TH.landlordName);
        expect(html).toContain('หนังสือยินยอมจากเจ้าของที่ดิน');
        expect(html).toContain('เพราะที่ดินเป็นการเช่า');
    });

    it('OWNED asks for no landlord, and the payload no longer carries the consent card', () => {
        const html = render({ landOwnership: 'OWNED' }, []);
        expect(html).not.toContain(STEP3_COPY_TH.landlordName);
        expect(html).not.toContain('หนังสือยินยอมจากเจ้าของที่ดิน');
    });

    it('อาคารระบบปิด brings the building plan, badged with its cause', () => {
        const html = render(
            { areaTypes: ['INDOOR'] },
            [slot('building_plan_photos', 'แบบแปลนอาคาร', 'INDOOR')],
        );
        expect(html).toContain('แบบแปลนอาคาร');
        expect(html).toContain('เพราะโรงเรือนระบบปิด');
    });

    it('tells the applicant that the document list follows their answers', () => {
        expect(render({}, [])).toContain(STEP3_COPY_TH.conditionalExplainer);
    });

    it('shows only the slots step 3 owns, whatever else the payload carries', () => {
        const html = render({}, [
            slot('site_photos', 'ภาพถ่ายสถานที่', 'ALWAYS'),
            slot('juristic_reg_6m', 'หนังสือรับรองการจดทะเบียนนิติบุคคล', 'HOLDER_TYPE'),
        ]);
        expect(html).toContain('ภาพถ่ายสถานที่');
        // A step-2 paper stays on step 2.
        expect(html).not.toContain('หนังสือรับรองการจดทะเบียนนิติบุคคล');
        expect(STEP3_SITE_SLOT_IDS).not.toContain('juristic_reg_6m');
    });
});
