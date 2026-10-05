/**
 * Canonical Application Validator (C2 fix)
 *
 * The LIVE applicant wizard (apps/web-app/.../new/_steps) posts CANONICAL
 * camelCase formData to /applications/prepare and /applications/submit:
 *
 *     { plantId, serviceType, certificationPurposes, locationType,
 *       cultivationMethods, applicantData, farmData, siteData, plots, lots,
 *       cultivationDetails, productionData, harvestData, documents, ... }
 *
 * It NEVER populates `formData.steps.{1..9}`. The legacy snake-case
 * `validateAllSteps` (validation/application-schemas.js) therefore saw `{}`
 * and 422'd EVERY real submit (C2). The legacy snake-case schema is the
 * *legacy step-keyed* wizard contract — its field names (plot_name,
 * land_title_no, area_rai/ngan/sq_wa, surrounding_environment,
 * soil_analysis_date, harvest_criteria, traceability_code_format, …) and its
 * applicant_type enum (INDIVIDUAL / COMMUNITY_ENTERPRISE / LEGAL_ENTITY) do
 * NOT match the canonical wizard, which collects a different, mostly-
 * overlapping field set (camelCase, nested, applicantType INDIVIDUAL /
 * JURISTIC / COMMUNITY).
 *
 * This module validates the CANONICAL shape with rigorous Zod schemas that
 * mirror the live wizard's REAL completeness contract (the review-step
 * checklist + the GACP-required fields each step actually collects), and
 * returns the SAME { isValid, errorsByStep, missingFields } envelope the
 * route already uses — so a genuinely-incomplete canonical application is
 * rejected with accurate per-step errors, and a complete one is accepted.
 *
 * `normalizeCanonicalToSteps` exposes the canonical→step mapping explicitly
 * (auditable against application-schemas.js — e.g. plot = step 5, NOT step 2)
 * so the relationship between canonical fields and Zod steps is testable.
 *
 * @module validation/canonical-application-validator
 */

const { z } = require('zod');
// F-PLOT-AREAUNIT-DEADEND fix (Task 1) — the closed set of area units the
// platform can still read (shared/area-utils.js:40-53). A plot whose unit is
// absent or outside this set is exactly the ×1,600 rai/sqm ambiguity that
// module refuses to guess at (:67-76); enforcing the SAME enum here stops the
// bad row at intake instead of at cert generation.
const { LEGACY_UNIT_TO_SQM } = require('../shared/area-utils');
// F-G4-10 — the SAME check digit registration enforces, from the SAME module the
// wizard's step 4 calls in the browser. The browser check is a courtesy; this is
// the one that decides what reaches the certificate.
const { checkThaiId } = require('@gacp/validation/thai-id-checksum');
const { asPlantSlug } = require('../config/plant-species-slugs');

// Helpers

function asObject(value) {
    return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

function asArray(value) {
    return Array.isArray(value) ? value : [];
}

function firstNonEmpty(...values) {
    for (const value of values) {
        if (value === null || value === undefined) { continue; }
        if (typeof value === 'string') {
            const trimmed = value.trim();
            if (trimmed.length > 0) { return trimmed; }
            continue;
        }
        return value;
    }
    return undefined;
}

function hasUploadedDocument(documents) {
    return asArray(documents).some((doc) => doc && (doc.uploaded || doc.url || doc.fileName));
}

// Mirrors shared/area-utils.js's canonicalise() (trim + lowercase, :55-57).
// That helper is not exported — area-utils.js is out of scope for this fix
// (spec: "NO generator/area-utils changes") — so the same two operations are
// repeated here rather than widening that module's surface.
function canonicaliseAreaUnit(unit) {
    return String(unit == null ? '' : unit).trim().toLowerCase();
}

const VALID_AREA_UNITS = Object.keys(LEGACY_UNIT_TO_SQM);
const VALID_AREA_UNITS_LABEL = VALID_AREA_UNITS.join(', ');

function isValidAreaUnit(unit) {
    const canonical = canonicaliseAreaUnit(unit);
    return Boolean(canonical) && VALID_AREA_UNITS.includes(canonical);
}

// Canonical → snake-case step shape mapping
//
// This is the inverse of the FE wizard step components. Each canonical field
// is placed in the SAME step slot the legacy Zod schema expects, so the
// mapping can be audited (plot → step 5, applicant → step 4, harvest →
// step 7, …). Only the fields the live wizard actually collects are mapped;
// fields the wizard never produces are intentionally omitted (mapping them in
// and requiring them would re-create C2 by rejecting every real submit).

function normalizeCanonicalToSteps(formDataInput) {
    const formData = asObject(formDataInput);
    const applicant = asObject(formData.applicantData);
    const farm = asObject(formData.farmData);
    const plots = asArray(formData.plots);
    const firstPlot = asObject(plots[0]);
    const production = asObject(formData.productionData);
    const harvest = asObject(formData.harvestData);

    // Step 2 — plant & cultivation selection (plant-selection-step.tsx)
    const step2 = {
        plant_id: firstNonEmpty(formData.plantId),
        service_type: firstNonEmpty(formData.serviceType),
        certification_purposes: asArray(formData.certificationPurposes),
        // ลักษณะพื้นที่ IS the cultivation declaration on the six-step wizard.
        //
        // กทล.๑ ส่วนที่ ๒ asks it as a checkbox row and the wizard stores the ticks at
        // `farmData.areaTypes`; `formData.cultivationMethods` belonged to the wizard this
        // one replaced and nothing writes it any more (`setCultivationMethods` exists in
        // the store and no step calls it). Demanding the dead key refused EVERY filing at
        // the submit door, naming a field the applicant cannot find because it is not on
        // any screen — F-APPV2-01, the v1-hard-lock class.
        //
        // The legacy key still wins where a filing carries one, so nothing already in
        // flight changes meaning. The SAME precedence is written into
        // fee-service.collectUniqueCultivationMethods, because the gate and the price must
        // read one declaration: accepting ticks here while the price looked elsewhere
        // would bill a filing for fewer types than it declared, which is worse than
        // refusing it (operator ruling 2026-09-06 — "ถ้าเลือก 3 รูปแบบการปลูก ราคาก็คือ
        // 3 รูปแบบ").
        // areaTypes (what step 3 wrote and the farmer selected) is authoritative;
        // legacy cultivationMethods is the fallback for filings that never wrote it.
        // Operator ruling 2026-09-06 superseding the earlier cultivationMethods-wins
        // order — the gate reads the SAME precedence as fee-service.collectUnique-
        // CultivationMethods so an accepted filing is never priced for a different
        // number of types than the gate judged.
        cultivation_methods: asArray(asObject(formData.farmData).areaTypes).length
            ? asArray(asObject(formData.farmData).areaTypes)
            : asArray(formData.cultivationMethods),
    };

    // Step 4 — applicant (general-step.tsx). Carries the FE applicantType
    // enum verbatim (INDIVIDUAL / JURISTIC / COMMUNITY) plus the per-branch
    // identity fields the wizard requires.
    // v2 first: the six-step wizard stores the answer TOP-LEVEL (a wizard-owned key on
    // the draft allowlist); applicantData.applicantType is the old wizard's spelling and
    // still wins nothing away from filings that carry it.
    const applicantType = firstNonEmpty(formData.applicantType, applicant.applicantType);
    const step4 = {
        applicant_type: applicantType,
        // INDIVIDUAL
        first_name: firstNonEmpty(applicant.firstName),
        last_name: firstNonEmpty(applicant.lastName),
        id_card: firstNonEmpty(applicant.idCard),
        phone: firstNonEmpty(applicant.phone, applicant.presidentPhone, applicant.contactPhone, applicant.companyPhone),
        address: firstNonEmpty(applicant.address, applicant.communityAddress, applicant.companyAddress),
        // COMMUNITY — the six-step wizard's spelling last, the way step 5 below does it.
        // `communityRegistrationNo` is what step2-identity-config.ts asks for; the two
        // names above belonged to the wizard this one replaced.
        community_name: firstNonEmpty(applicant.communityName),
        president_name: firstNonEmpty(applicant.presidentName),
        community_reg_number: firstNonEmpty(
            applicant.communityRegNumber,
            applicant.registrationSVC01,
            applicant.communityRegistrationNo,
        ),
        president_id_card: firstNonEmpty(applicant.presidentIdCard),
        // JURISTIC
        company_name: firstNonEmpty(applicant.companyName),
        // A Thai company's registration number IS its corporate tax id — this file's own
        // schema says so two hundred lines down, which is why the wizard asks for it once
        // under the label "เลขทะเบียนนิติบุคคลหรือเลขประจำตัวผู้เสียภาษี" and stores it as
        // `taxId`. Reading it here is not a guess about the applicant's meaning; it is
        // what the number is. The legacy key still wins for filings that carry it.
        registration_number: firstNonEmpty(applicant.registrationNumber, applicant.taxId),
        tax_id: firstNonEmpty(applicant.taxId),
        director_name: firstNonEmpty(applicant.directorName, applicant.authorizedSignatory),
        director_id_card: firstNonEmpty(applicant.directorIdCard),
    };

    // Step 5 — farm & plot (farm-info-step.tsx). plot_name/area_size/system
    // still read plots[0] (unchanged, out of this fix's scope) — but
    // plot_area_units maps EVERY plot (F-PLOT-AREAUNIT-DEADEND fix, Task 1):
    // the mapper used to read plots[0] only, so a payload with a valid
    // plots[0] and a unit-less plots[1] (or later) was invisible to
    // validation entirely.
    const step5 = {
        // กทล.๑ ส่วนที่ ๒ vocabulary first (siteName/siteAddress/areaSqm — what the
        // six-step wizard writes), legacy keys as the fallback. The SAME aliases the PDF
        // renderer already reads (katorlor1-template-service.farmForForm): the validator
        // and the paper must describe one filing, and Deep QA proved they did not — a
        // browser-walked filing showed its site on the review page and was refused
        // farm_name at the door.
        farm_name: firstNonEmpty(farm.siteName, farm.farmName),
        address: firstNonEmpty(farm.siteAddress, farm.address),
        // กทล.๑ ส่วนที่ ๒ ข้อ ๑ writes the site location as three separate fields; the
        // certificate names them (resolveFarmForCertificate reads farmData.province /
        // district / subDistrict). `subdistrict` is accepted as an alias because the cert
        // resolver reads both spellings.
        province: firstNonEmpty(farm.province),
        district: firstNonEmpty(farm.district),
        sub_district: firstNonEmpty(farm.subDistrict, farm.subdistrict),
        postal_code: firstNonEmpty(farm.postalCode),
        total_area_size: firstNonEmpty(farm.areaSqm, farm.totalAreaSize),
        // farm-areaunit-default fix (Task 2) — the farm's OWN totalAreaUnit,
        // mapped alongside total_area_size the same way (see canonicalStep5Schema).
        // `areaSqm` is the v2 field and its unit is in its NAME, so a filing that
        // declared through it has declared the unit too.
        total_area_unit: firstNonEmpty(farm.totalAreaUnit,
            firstNonEmpty(farm.areaSqm) !== undefined ? 'sqm' : undefined),
        plot_count: plots.length,
        plot_name: firstNonEmpty(firstPlot.name),
        plot_area_size: firstNonEmpty(firstPlot.areaSize),
        plot_solar_system: firstNonEmpty(firstPlot.solarSystem),
        plot_area_units: plots.map((plot, index) => {
            const plotObj = asObject(plot);
            return {
                label: firstNonEmpty(plotObj.name) || `แปลงที่ ${index + 1}`,
                unit: plotObj.areaUnit,
            };
        }),
    };

    // Step 6 — production (production-info-step.tsx)
    const step6 = {
        propagation_type: asArray(production.propagationType),
        plant_parts: asArray(production.plantParts),
    };

    // Step 7 — harvest & quality (quality-control-step.tsx)
    const step7 = {
        harvest_method: firstNonEmpty(harvest.harvestMethod),
        drying_method: firstNonEmpty(harvest.dryingMethod),
        storage_system: firstNonEmpty(harvest.storageSystem),
    };

    return {
        2: step2,
        4: step4,
        5: step5,
        6: step6,
        7: step7,
    };
}

// Canonical Zod schemas (mirror the live wizard's real per-step contract)

const requiredString = (label) =>
    z.string({ message: `${label} จำเป็น` }).trim().min(1, { message: `${label} จำเป็น` });

const requiredArray = (label) =>
    z.array(z.any()).min(1, { message: `${label} จำเป็น` });

/**
 * ลักษณะพื้นที่ปลูก (กทล.๑ ข้อ ๒(๒)) — **คำปิด สามคำ**
 *
 * operator 2026-09-11: *"เรามีแค่ 3 อย่างนะ ... ที่ไม่ติ๊กกับเกิน 3 มันไม่ถูกต้อง"*
 * และเลือกให้ถอด "อื่น ๆ" ออกจากจอและจากทะเบียน
 *
 * ทำไมต้องปิดที่ประตูนี้: ค่าบริการถูกคูณด้วย **จำนวนลักษณะที่คำขอประกาศ** และเงื่อนไข
 * เดิมคือ `z.array(z.any()).min(1)` ซึ่งถามแค่ "มีไหม" ไม่ถามว่า "เป็นคำอะไร"
 * วัดกับตัวคิดเงินจริงก่อนแก้ (2026-09-11):
 *   ส่งค่าอะไรก็ได้มาห้าค่า → คิดห้าลักษณะ = 176,550 บาท
 *   พิมพ์ OUTDOOR + OUTDOORS → คิดสองลักษณะ = 70,620 บาท
 * คลาสเดียวกับ `plantId` ที่เคยเป็นข้อความอิสระแล้วเอกสารบังคับเก้าใบกลายเป็นศูนย์
 */
const AREA_TYPES = Object.freeze(['OUTDOOR', 'GREENHOUSE', 'INDOOR']);

/** ป้ายไทยของแต่ละคำ — ใช้ในข้อความปฏิเสธ ให้ผู้ยื่นรู้ว่าเลือกได้จากอะไร */
const AREA_TYPE_LABEL_TH = Object.freeze({
    OUTDOOR: 'กลางแจ้ง',
    GREENHOUSE: 'โรงเรือน',
    INDOOR: 'อาคารระบบปิด',
});

/** wizard ส่งคำตัวใหญ่ · คำขอยุคก่อนส่งตัวเล็ก — รับทั้งสองรูป ปฏิเสธเฉพาะคำที่ไม่รู้จัก */
const asAreaTypeWord = (value) => String(value ?? '').trim().toUpperCase();

/**
 * รายการลักษณะพื้นที่ที่ยอมรับได้
 *
 * **ไม่มีเพดานเป็นเลข** โดยตั้งใจ: เมื่อคำที่ไม่รู้จักถูกปฏิเสธ และคำซ้ำถูกปฏิเสธ
 * จำนวนสูงสุดที่ผ่านได้เท่ากับจำนวนคำในทะเบียนเอง · เลขเพดานที่พิมพ์มือจะเป็น
 * ความจริงซ้อนอีกชุดที่ต้องคอยแก้ตามทุกครั้งที่ทะเบียนเปลี่ยน
 */
const requiredAreaTypes = (label) =>
    z.array(z.any(), { message: `${label} จำเป็น` })
        .min(1, { message: `${label} จำเป็น — ต้องเลือกอย่างน้อยหนึ่งข้อ` })
        .superRefine((values, ctx) => {
            const words = values.map(asAreaTypeWord);
            const choices = AREA_TYPES.map((w) => AREA_TYPE_LABEL_TH[w]).join(' / ');

            const unknown = words.filter((w) => !AREA_TYPES.includes(w));
            if (unknown.length) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `${label} ไม่ถูกต้อง — เลือกได้จาก ${choices} เท่านั้น`,
                });
            }

            if (new Set(words).size !== words.length) {
                ctx.addIssue({
                    code: z.ZodIssueCode.custom,
                    message: `${label} ซ้ำกัน — แต่ละข้อเลือกได้ครั้งเดียว`,
                });
            }
        });

/**
 * The plant is not free text.
 *
 * `plantId` decides WHICH BODY OF LAW judges the filing: the requirement register is
 * seeded per plant, so a word it does not know used to reach the engine and match only
 * the rules that bind every plant — which, for an individual applicant, is none. Nine
 * required documents became zero by typing one word into a field the applicant owns.
 *
 * The vocabulary AND its normalisation both come from the ONE bridge between the wizard's
 * slugs and the plant_species master codes, so this door and the engine cannot drift
 * apart — including on case, which they did: the engine lower-cased and this door did not.
 */
const requiredPlant = (label) =>
    requiredString(label).refine((value) => asPlantSlug(value) !== null, {
        message: `${label} ไม่ถูกต้อง กรุณาเลือกชนิดพืชจากรายการที่ระบบเปิดรับ`,
    });

// Step 2 — must have selected a plant + at least one cultivation method.
const canonicalStep2Schema = z.object({
    plant_id: requiredPlant('ชนิดพืช'),
    cultivation_methods: requiredAreaTypes('ลักษณะพื้นที่ปลูก'),
}).passthrough();

/**
 * A required Thai 13-digit ID: present AND passing the national check digit.
 *
 * F-G4-10 — this field used to be `requiredString(...).min(13)`. `.min(13)` is a
 * STRING-length floor, so `'abcdefghijklm'` and a 20-digit number both passed,
 * and so did every invented 13-digit number. The certificate is minted from this
 * data, so an unchecked number here is a number on a government certificate.
 */
const requiredThaiId = (label) =>
    requiredString(label).superRefine((value, ctx) => {
        const result = checkThaiId(value, { label });
        if (!result.ok) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.message });
        }
    });

/**
 * A Thai 13-digit ID that is checked WHEN GIVEN.
 *
 * Deliberately not `requiredThaiId`: these fields are not required by the wizard
 * today, and making them required here would 422 drafts that were legitimately
 * complete when they were saved. This closes the checksum hole without changing
 * what counts as a complete application — a separate question, and not this one.
 */
const optionalThaiId = (label) =>
    z.any().optional().superRefine((value, ctx) => {
        if (value === undefined || value === null || String(value).trim() === '') {
            return;
        }
        const result = checkThaiId(value, { label });
        if (!result.ok) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.message });
        }
    });

// Step 4 — applicant identity, polymorphic on the FE applicantType enum.
const APPLICANT_BRANCHES = {
    INDIVIDUAL: z.object({
        applicant_type: z.literal('INDIVIDUAL'),
        first_name: requiredString('ชื่อ'),
        last_name: requiredString('นามสกุล'),
        id_card: requiredThaiId('เลขบัตรประชาชน'),
        phone: requiredString('เบอร์โทรศัพท์'),
        address: requiredString('ที่อยู่'),
    }).passthrough(),
    // ชื่อสาขาคือ COMMUNITY_ENTERPRISE ตามคำที่ schema ของฐานข้อมูล (entity.prisma:35),
    // ทะเบียนกฎ (requirement_rules.holderType) และหน้าจอขั้น 1 ใช้ตรงกันทั้งหมด · ประตูนี้
    // เป็นที่เดียวที่ยังพูดคำว่า COMMUNITY เฉย ๆ แล้วปฏิเสธคำขอวิสาหกิจชุมชนทุกใบด้วยเหตุผล
    // ที่ผู้ยื่นแก้ไม่ได้ ("ประเภทผู้ยื่นคำขอไม่ถูกต้อง: COMMUNITY_ENTERPRISE") · คำเก่ายังรับอยู่
    // ด้านล่าง เพื่อไม่ให้คำขอที่กำลังเดินเปลี่ยนความหมาย
    COMMUNITY_ENTERPRISE: z.object({
        applicant_type: z.literal('COMMUNITY_ENTERPRISE'),
        community_name: requiredString('ชื่อวิสาหกิจชุมชน'),
        president_name: requiredString('ชื่อประธาน'),
        // NO checksum: DOAE's 11-digit วิสาหกิจชุมชน registration number has never
        // had a published check digit. Running the national-ID rule over it would
        // reject every legitimate community enterprise in the country.
        community_reg_number: requiredString('เลขทะเบียนวิสาหกิจชุมชน'),
        president_id_card: optionalThaiId('เลขบัตรประชาชนประธาน'),
    }).passthrough(),
    JURISTIC: z.object({
        applicant_type: z.literal('JURISTIC'),
        company_name: requiredString('ชื่อบริษัท/องค์กร'),
        registration_number: requiredString('เลขทะเบียนนิติบุคคล'),
        director_name: requiredString('ชื่อผู้มีอำนาจลงนาม'),
        // In Thailand a company's registration number IS its corporate tax ID,
        // and it carries the same check digit as a citizen's card.
        tax_id: optionalThaiId('เลขประจำตัวผู้เสียภาษี'),
        director_id_card: optionalThaiId('เลขบัตรประชาชนผู้มีอำนาจลงนาม'),
    }).passthrough(),
};

// คำเก่าของ wizard ตัวก่อน — ยังรับได้ ตัดสินด้วยกติกาชุดเดียวกับคำปัจจุบัน
APPLICANT_BRANCHES.COMMUNITY = APPLICANT_BRANCHES.COMMUNITY_ENTERPRISE
    .extend({ applicant_type: z.literal('COMMUNITY') });

const VALID_APPLICANT_TYPES = Object.keys(APPLICANT_BRANCHES);

const canonicalStep4Schema = {
    safeParse(data) {
        const obj = data && typeof data === 'object' ? data : {};
        const applicantType = String(obj.applicant_type || '').trim();
        if (!applicantType) {
            return {
                success: false,
                error: { issues: [{ path: ['applicant_type'], message: 'ประเภทผู้ยื่นคำขอ จำเป็น', code: 'invalid_type' }] },
            };
        }
        const schema = APPLICANT_BRANCHES[applicantType];
        if (!schema) {
            return {
                success: false,
                error: {
                    issues: [{
                        path: ['applicant_type'],
                        message: `ประเภทผู้ยื่นคำขอไม่ถูกต้อง: ${applicantType} (ต้องเป็น ${VALID_APPLICANT_TYPES.join(', ')})`,
                        code: 'invalid_enum_value',
                    }],
                },
            };
        }
        return schema.safeParse(data);
    },
};

// F-PLOT-AREAUNIT-DEADEND fix (Task 1) — EVERY plot must carry an areaUnit
// from the closed LEGACY_UNIT_TO_SQM enum, compared case-insensitively (the
// UI wizard posts 'Sqm' capitalised — farm-info-step.tsx:252,387 — so a
// case-sensitive enum would block every real user). Absent/unrecognised is
// exactly the ambiguity area-utils.js's storedAreaToSqm refuses to guess at;
// this schema refuses it earlier, at intake, with a fixable 422 naming the
// plot instead of a 500 at cert generation. A DRAFT resubmitted through the
// wizard self-heals: the wizard always sets Sqm on every plot it renders.
const plotAreaUnitsSchema = z.array(z.object({
    label: z.string(),
    unit: z.any().optional(),
})).superRefine((plotUnits, ctx) => {
    plotUnits.forEach((plotUnit, index) => {
        if (!isValidAreaUnit(plotUnit.unit)) {
            ctx.addIssue({
                code: z.ZodIssueCode.custom,
                path: [index, 'unit'],
                // F-PLOT-AREAUNIT-DEADEND fix review (2026-08-19, whole-branch review) —
                // the old trailing clause ("แก้ไขผ่านฟอร์มแปลงปลูกเพื่อบันทึกหน่วยอัตโนมัติ")
                // told the applicant to fix this through the plot form, but the wizard
                // has NO unit control (farm-info-step.tsx has no field for it — the form
                // only ever WRITES a hardcoded 'Sqm' on a fresh plot; it never reads one
                // back) and an EXISTING plot with no unit is kept verbatim on re-save, so
                // that instruction did nothing. Corrected to name the real remedy (an
                // operator-run heal, or contacting staff) instead of a self-service step
                // that does not exist. See the backlog for the tracked FE follow-up.
                message: `หน่วยพื้นที่ของแปลง "${plotUnit.label}" ไม่ถูกต้องหรือไม่ได้ระบุ `
                    + `(ต้องเป็นหนึ่งใน: ${VALID_AREA_UNITS_LABEL}) — ระบุหน่วยพื้นที่ของแปลง `
                    + `(หน่วยที่รับ: ตร.ม./ไร่/งาน/ตร.วา) และให้ติดต่อเจ้าหน้าที่หากแปลงนี้มาจากคำขอเดิมที่ไม่มีหน่วย`,
            });
        }
    });
});

// farm-areaunit-default fix (Task 2) — the farm's OWN totalAreaUnit must be
// present and in the same closed LEGACY_UNIT_TO_SQM enum, case-insensitive
// (the UI wizard posts 'Sqm' capitalised — farm-info-step.tsx:75). Absent or
// unrecognised is the same ×1,600 rai/sqm ambiguity the plot check above
// refuses to guess at (council precedent, wf_1ccad24b) — this closed the
// last LIVE silent-default door: certificate-service.js (farm CREATE at
// mint) used to read `farmData.totalAreaUnit || productionData.areaUnit ||
// AREA_UNIT` and would silently mint Sqm for a unit-less farm (fixed, Task
// 3). NOT the last occurrence of the pattern in the tree: the same
// `farmData.totalAreaUnit || AREA_UNIT` guess lived in
// application-submission-methods.js, the wizard write path behind
// ENABLE_PROVIDER_LEGACY_ALIAS; that file was deleted with the /api/wizard
// door (R2 Task 10), closing cleanup item (f).
//
// Honesty rule (plot-mission review, whole-branch review 2026-08-19 — a false
// "fix it in the form" instruction got a MAJOR): farm-info-step.tsx sets
// totalAreaUnit programmatically ('Sqm' default, farm-info-step.tsx:75) and
// exposes NO unit control, so the message does not tell the user to fix it
// via the form — the real remedy is that the system sets the unit
// automatically, and a legacy farm with no unit needs a staff-run heal
// (scripts/maintenance/heal-plot-area-unit.js --target farm).
const totalAreaUnitSchema = z.any().superRefine((unit, ctx) => {
    if (!isValidAreaUnit(unit)) {
        ctx.addIssue({
            code: z.ZodIssueCode.custom,
            message: `หน่วยพื้นที่ฟาร์มไม่ถูกต้องหรือไม่ได้ระบุ `
                + `(ต้องเป็นหนึ่งใน: ${VALID_AREA_UNITS_LABEL}) — `
                + `ระบบตั้งหน่วยให้อัตโนมัติเมื่อกรอกผ่านฟอร์ม `
                + `ใบเก่าที่ไม่มีหน่วยให้ติดต่อเจ้าหน้าที่`,
        });
    }
});

// Step 5 — farm basics + at least one plot with a name/area/system/unit.
const canonicalStep5Schema = z.object({
    farm_name: requiredString('ชื่อฟาร์ม'),
    address: requiredString('ที่อยู่ฟาร์ม'),
    province: requiredString('จังหวัด'),
    total_area_size: requiredString('ขนาดพื้นที่ฟาร์ม'),
    total_area_unit: totalAreaUnitSchema,
    plot_count: z.number().int().min(1, { message: 'ต้องมีแปลงปลูกอย่างน้อย 1 แปลง' }),
    plot_name: requiredString('ชื่อแปลง'),
    plot_area_size: requiredString('ขนาดพื้นที่แปลง'),
    plot_solar_system: requiredString('ระบบปลูกของแปลง'),
    plot_area_units: plotAreaUnitsSchema,
}).passthrough();

// Step 6 — production must record propagation + plant parts.
const canonicalStep6Schema = z.object({
    propagation_type: requiredArray('วิธีการขยายพันธุ์'),
    plant_parts: requiredArray('ส่วนของพืชที่ใช้'),
}).passthrough();

// Step 7 — harvest & post-harvest method required.
const canonicalStep7Schema = z.object({
    harvest_method: requiredString('วิธีการเก็บเกี่ยว'),
    drying_method: requiredString('วิธีการอบแห้ง'),
    storage_system: requiredString('ระบบการจัดเก็บ'),
}).passthrough();

/**
 * Step 5 as the SIX-STEP กทล.๑ wizard files it: a SITE, not plots.
 *
 * The redesign's mapping retired the old wizard's plot rows, production-info and
 * quality-control at FILING time — plots are born after certification for T&T, and the
 * 64 production/quality items were MOVE_TO_AUDIT: they are recorded by the auditor at
 * the site visit, not typed by the applicant into a form. Demanding them here refused
 * every real filing for fields no screen writes (Deep QA browser walk, 2026-09-06 —
 * sixteen 422 fields on a filing whose review page said ครบ).
 *
 * ส่วนที่ ๒ ข้อ ๑ writes the location as จังหวัด + อำเภอ/เขต + ตำบล/แขวง — three separate
 * fields (DTAM baseline census, review.md:113-115, all KEEP). An earlier v2 draft collapsed
 * them into the free-text `address` line and demanded no structured triple; but the
 * certificate NAMES where its farm is, building the Farm row from
 * farmData.province/district/subDistrict (certificate-service.resolveFarmForCertificate) and
 * refusing CERTIFICATE_FARM_LOCATION_MISSING when they are blank. So a filing that gave only
 * a free-text address passed submit + audit and then could NOT be certified (F-WALK-03,
 * walked to a certificate 2026-09-06). The structured triple is demanded here, at the submit
 * gate, so the v1-hard-lock refusal lands where the farmer can still fix it — not silently at
 * issuance. รหัสไปรษณีย์ stays optional (the Farm row carries a retired '00000' stand-in and
 * the certificate location gate does not read it).
 */
const canonicalStep5V2Schema = z.object({
    farm_name: requiredString('ชื่อสถานที่ปลูก'),
    address: requiredString('ที่อยู่สถานที่ปลูก'),
    province: requiredString('จังหวัด'),
    district: requiredString('อำเภอ/เขต'),
    sub_district: requiredString('ตำบล/แขวง'),
    total_area_size: requiredString('ขนาดพื้นที่ปลูก'),
    total_area_unit: totalAreaUnitSchema,
}).passthrough();

const CANONICAL_STEP_SCHEMAS = {
    2: canonicalStep2Schema,
    4: canonicalStep4Schema,
    5: canonicalStep5Schema,
    6: canonicalStep6Schema,
    7: canonicalStep7Schema,
};

/**
 * Which era's law judges this filing — read off the filing itself.
 *
 * Only the six-step กทล.๑ wizard writes the site block (siteName / siteAddress /
 * areaSqm), so its presence IS the marker. A legacy filing keeps every old demand:
 * this is a boundary, not a migration — the W14 lesson, one flow over. A filing that
 * carries both vocabularies is judged as v2, because the v2 keys are the ones its own
 * review page and its own generated กทล.๑ read.
 */
function isKatorlor1Filing(formData) {
    const farm = asObject(asObject(formData).farmData);
    return Boolean(firstNonEmpty(farm.siteName, farm.siteAddress, farm.areaSqm));
}

/** The step schemas for one filing, chosen by its era. */
function schemasFor(formData) {
    if (!isKatorlor1Filing(formData)) { return CANONICAL_STEP_SCHEMAS; }
    return {
        2: canonicalStep2Schema,
        4: canonicalStep4Schema,
        5: canonicalStep5V2Schema,
        // 6 and 7 (production, harvest/quality) are the auditor's to record on the
        // site visit — MOVE_TO_AUDIT. Deliberately absent, not empty-schema'd: an
        // empty schema would still print the step numbers into every error map.
    };
}

function collectErrors(result) {
    return result.error.issues.map((issue) => ({
        path: Array.isArray(issue.path) ? issue.path.join('.') : String(issue.path),
        message: issue.message,
        code: issue.code,
    }));
}

/**
 * Validate a CANONICAL application submission with rigorous Zod schemas.
 *
 * @param {object} formData — canonical formData (applicantData/farmData/…)
 * @param {Array}  documents — normalized documents ([{ uploaded, url, … }])
 * @returns {{ isValid: boolean, errorsByStep: object, missingFields: string[] }}
 */
function validateCanonicalSubmission(formData, documents) {
    const steps = normalizeCanonicalToSteps(formData);
    const errorsByStep = {};
    const missingFields = [];

    for (const [stepNo, schema] of Object.entries(schemasFor(formData))) {
        const result = schema.safeParse(steps[stepNo] || {});
        if (!result.success) {
            const errors = collectErrors(result);
            errorsByStep[stepNo] = errors;
            for (const err of errors) {
                missingFields.push(`step${stepNo}.${err.path}`);
            }
        }
    }

    // Step 8 — supporting documents (the documents/evidence step). Validated
    // against the normalized documents the route already computes, so this
    // mirrors preview-utils.normalizeDocuments rather than the raw formData.
    //
    // LEGACY filings only. A กทล.๑ filing's papers are judged by the requirements lens
    // (assertRequiredDocumentsPresent at every submit door — the B1 gate), which reads
    // the ApplicationDocument rows the v2 upload-in-context flow writes. This check reads
    // the OLD wizard's formData.documents store, which v2 never writes, so on a v2 filing
    // it is a second judge reading the wrong ledger: Deep QA walked a filing with all
    // seven papers attached and a clear review banner, and this line alone refused it.
    if (!isKatorlor1Filing(formData) && !hasUploadedDocument(documents)) {
        errorsByStep['8'] = [{ path: 'files', message: 'ต้องแนบเอกสารประกอบอย่างน้อย 1 ไฟล์', code: 'too_small' }];
        missingFields.push('step8.files');
    }

    return {
        isValid: Object.keys(errorsByStep).length === 0,
        errorsByStep,
        missingFields,
    };
}

module.exports = {
    // ส่งออกเพื่อให้ทะเบียนกฎและด่านเทียบกับคำชุดเดียวกันได้ ไม่ใช่พิมพ์ซ้ำ
    AREA_TYPES,
    AREA_TYPE_LABEL_TH,
    normalizeCanonicalToSteps,
    validateCanonicalSubmission,
    isKatorlor1Filing,
    CANONICAL_STEP_SCHEMAS,
};
