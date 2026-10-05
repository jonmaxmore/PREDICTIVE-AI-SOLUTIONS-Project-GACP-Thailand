/**
 * กทล.1 ข้อ ๓ — what is grown, and what it is for.
 *
 * THREE objectives, each backed by an issued ภ.ท. licence, and no default (operator ruling
 * 2026-10-05): ศึกษาวิจัย ภ.ท. 09 · ส่งออกเพื่อการค้า ภ.ท. 10 · แปรรูปหรือจำหน่ายเพื่อการค้า
 * ภ.ท. 11. The words, labels and licence names are the web's one copy of the backend
 * vocabulary (lib/certification-purposes.ts); this file only shapes them for the screen.
 *
 * A purpose is a legal declaration about what the produce is for — it decides which issued
 * licence is demanded — so the platform may not make it for someone, and a stored word the
 * vocabulary no longer knows is never mapped to another: the applicant chooses again.
 */

import {
    CERTIFICATION_PURPOSES,
    purposeOptionLabel,
    isPurposeCode,
    type CertificationPurpose,
} from '@/lib/certification-purposes';

export type CertificationObjective = CertificationPurpose;

export interface ObjectiveOption {
    value: CertificationObjective;
    labelTH: string;
    helpTH: string;
}

export const OBJECTIVE_OPTIONS: ReadonlyArray<ObjectiveOption> = Object.freeze(
    CERTIFICATION_PURPOSES.map((purpose) => ({
        value: purpose.code,
        labelTH: purposeOptionLabel(purpose.code),
        helpTH: purpose.licenceName,
    })),
);

/** sessionStorage key: the stored purpose words the edit page could not carry into the wizard. */
export const STALE_PURPOSES_KEY = 'gacp_stale_purposes';

/** Remember (or forget) the words a loaded draft held that no licence backs. Step 4 shows them. */
export function recordStalePurposes(stale: readonly string[]): void {
    if (typeof window === 'undefined') { return; }
    if (stale.length > 0) {
        window.sessionStorage.setItem(STALE_PURPOSES_KEY, JSON.stringify(stale));
    } else {
        window.sessionStorage.removeItem(STALE_PURPOSES_KEY);
    }
}

export type VarietyKind = 'SEED' | 'OTHER_PART';
export type VarietyOrigin = 'DOMESTIC' | 'IMPORTED';

export const VARIETY_KIND_OPTIONS: ReadonlyArray<{ value: VarietyKind; labelTH: string }> = Object.freeze([
    { value: 'SEED', labelTH: 'เมล็ดพันธุ์' },
    { value: 'OTHER_PART', labelTH: 'ส่วนขยายพันธุ์อื่น เช่น กิ่งพันธุ์ ต้นกล้า' },
]);

export const VARIETY_ORIGIN_OPTIONS: ReadonlyArray<{ value: VarietyOrigin; labelTH: string }> = Object.freeze([
    { value: 'DOMESTIC', labelTH: 'ในประเทศ' },
    { value: 'IMPORTED', labelTH: 'นำเข้า' },
]);

export interface VarietyRow {
    kind: VarietyKind | null;
    name: string;
    origin: VarietyOrigin | null;
    originCountry?: string;
    source: string;
    quantity: string;
    unit: string;
}

export function emptyVarietyRow(): VarietyRow {
    // Every field blank and both choices null. The form asks; it does not assume.
    return { kind: null, name: '', origin: null, source: '', quantity: '', unit: '' };
}

/**
 * The paper prints two rows. A filing with more is not wrong — it is a farm growing
 * more than two varieties — so the extra ones go into a free-text note that the
 * generated กทล.1 prints beneath the table, rather than being silently dropped.
 */
export const VARIETY_ROWS_ON_THE_FORM = 2;

export function needsVarietiesNote(rows: readonly unknown[]): boolean {
    return rows.length > VARIETY_ROWS_ON_THE_FORM;
}

/** An imported variety has to say where from; a domestic one has no country to give. */
export function needsOriginCountry(origin: VarietyOrigin | null): boolean {
    return origin === 'IMPORTED';
}

export const STEP4_COPY_TH = Object.freeze({
    objectiveHeading: 'วัตถุประสงค์การขอรับรอง เลือกได้มากกว่าหนึ่งข้อ',
    varietiesHeading: 'สายพันธุ์และแหล่งที่มา',
    processingHeading: 'ข้อมูลการแปรรูป',
    addVariety: 'เพิ่มสายพันธุ์',
    removeVariety: 'ลบแถวนี้',
    varietiesNote: 'สายพันธุ์เพิ่มเติม',
    varietiesNoteHelp: 'แบบฟอร์ม กทล.1 มีช่องสำหรับสองสายพันธุ์ ระบบจะพิมพ์รายการที่เกินไว้ใต้ตาราง',
    originCountry: 'ประเทศต้นทาง',
    /** Shown the moment a purpose is ticked, so the extra paper is not a surprise at step 5. */
    licenceNoticeLead: 'ระบบจะขอตัวใบอนุญาตที่ออกให้แล้วในขั้นที่ 5 ได้แก่',
    /** Under the three choices: บอกว่าขายในประเทศหรือแปรรูปต้องเลือกข้อสามเพิ่ม (ส่งออกอย่างเดียวไม่พอ) */
    purposeHint: 'ถ้าขายในประเทศ หรือแปรรูป เช่น ตากแห้ง ตัดแต่ง ทำผลิตภัณฑ์ ให้เลือก \'แปรรูปหรือจำหน่ายเพื่อการค้า\' เพิ่ม',
    /** กระท่อมส่งออก: ใบอนุญาตตามมาตรา 10 พ.ร.บ.พืชกระท่อม ไม่ใช่ ภ.ท. (มติ operator 2026-10-05) */
    kratomExportNotice: 'ใบอนุญาตส่งออกพืชกระท่อม (ใบอนุญาตตามมาตรา 10 แห่ง พ.ร.บ.พืชกระท่อม พ.ศ. 2565)',
    /** An old draft holds a purpose no licence backs: it is shown, not silently dropped. */
    staleObjectivesLead: 'คำขอเดิมระบุวัตถุประสงค์ที่ใช้ไม่ได้แล้ว',
    staleObjectivesAction: 'กรุณาเลือกวัตถุประสงค์ใหม่จากสามข้อด้านล่าง',
    /** The refusal when the applicant tries to leave without an objective. */
    objectiveRequired: 'กรุณาเลือกวัตถุประสงค์การขอรับรองอย่างน้อยหนึ่งข้อ ระบบใช้ข้อมูลนี้ตัดสินว่าต้องขอเอกสารใดเพิ่ม',
});

/**
 * The issued licences the ticked purposes will ask for at step 5, in one sentence — or null
 * when nothing is ticked. Names come from the vocabulary, never retyped here.
 */
export function licenceNoticeFor(objectives: readonly string[], plantId?: string | null): string | null {
    // กระท่อม: ส่งออกขอใบอนุญาตตามพ.ร.บ.พืชกระท่อม · วิจัย/แปรรูปไม่มีใบอนุญาต
    if (plantId === 'kratom') {
        return objectives.includes('EXPORT')
            ? `${STEP4_COPY_TH.licenceNoticeLead} ${STEP4_COPY_TH.kratomExportNotice}`
            : null;
    }
    // อีกสี่ชนิดไม่มีใบอนุญาตให้แนบ
    if (plantId && plantId !== 'cannabis') { return null; }
    const named = CERTIFICATION_PURPOSES
        .filter((purpose) => objectives.includes(purpose.code))
        .map((purpose) => `${purpose.licenceName} (${purpose.licenceCode})`);
    return named.length > 0 ? `${STEP4_COPY_TH.licenceNoticeLead} ${named.join(' · ')}` : null;
}

/** What to tell an applicant whose stored purposes include words the vocabulary dropped. */
export function staleObjectivesNotice(stale: readonly string[]): string | null {
    return stale.length > 0
        ? `${STEP4_COPY_TH.staleObjectivesLead} (${stale.join(', ')}) ${STEP4_COPY_TH.staleObjectivesAction}`
        : null;
}

/**
 * What step 4 must have before the applicant may leave it.
 *
 * The plant is the load-bearing one. กทล.1 law is filed PER PLANT, so a filing that
 * names none is refused outright by the submit gate (APPLICATION_NOT_JUDGEABLE) rather
 * than judged leniently — asking here is what stops an applicant reaching the review
 * page only to be turned away.
 */
export function step4CanProceed(input: {
    plantId?: string | null;
    objectives?: readonly string[] | null;
}): boolean {
    // The plant is answered at STEP 1 since 2026-09-06 (F-QA-04) and gated there, so demanding
    // it again here would block a filing on a field this screen no longer shows — the v1
    // hard-lock class. `plantId` stays in the input type because callers still pass it.
    const objectives = input.objectives ?? [];
    return objectives.length > 0 && objectives.every(isPurposeCode);
}
