/**
 * Application Step Zod Schemas
 *
 * Formal schema validation for GACP application wizard steps 1-9.
 * Replaces the custom `validateMasterSubmission()` with typed validation,
 * format checks, and clear bilingual error messages.
 *
 * Step 4 uses discriminated union for applicant types:
 *   - INDIVIDUAL (บุคคลธรรมดา)
 *   - COMMUNITY_ENTERPRISE (วิสาหกิจชุมชน)
 *   - LEGAL_ENTITY (นิติบุคคล)
 *
 * Steps 10-12 are system-driven (payment/success) and not validated here.
 *
 * @module validation/application-schemas
 */

const { z } = require('zod');
// F-G4-10 — the one Thai check-digit implementation in the repo. See
// packages/validation/src/thai-id-checksum.js for why it is CommonJS.
const { checkThaiId } = require('@gacp/validation/thai-id-checksum');

// Shared Primitives

/** Non-empty trimmed string */
const requiredString = (label) =>
    z.string({ message: `${label} จำเป็น` })
        .trim()
        .min(1, { message: `${label} จำเป็น` });

/** Optional trimmed string (can be empty/null/undefined) */
const optionalString = () => z.string().trim().optional().default('');

/** Positive number (area, coordinates, etc.) */
const positiveNumber = (label) =>
    z.coerce.number({ message: `${label} ต้องเป็นตัวเลข` })
        .nonnegative({ message: `${label} ต้องเป็นค่าบวก` });

/** ISO date string */
const dateString = (label) =>
    z.string({ message: `${label} จำเป็น` })
        .trim()
        .min(1, { message: `${label} จำเป็น` });

/**
 * A required Thai 13-digit ID: present AND passing the national check digit.
 *
 * F-G4-10 — `.min(13)` is a string-LENGTH floor, which is what this used to be:
 * it accepted 'abcdefghijklm', a 20-digit number, and every invented 13-digit
 * number. The certificate is minted from this data.
 */
const requiredThaiId = (label) =>
    requiredString(label).superRefine((value, ctx) => {
        const result = checkThaiId(value, { label });
        if (!result.ok) {
            ctx.addIssue({ code: z.ZodIssueCode.custom, message: result.message });
        }
    });

/** File attachment array (≥ minCount items) */
const fileArray = (minCount = 0) =>
    z.array(z.any()).min(minCount, { message: `ต้องแนบเอกสารอย่างน้อย ${minCount} ไฟล์` }).default([]);

// Step 1: ยินยอมและประเภทคำขอ (Consent & Request Type)

const step1Schema = z.object({
    operator_name: requiredString('ชื่อผู้ดำเนินการ'),
    tax_id: requiredString('เลขเสียภาษี/เลขบัตรประชาชน'),
    address_contact: requiredString('ที่อยู่ติดต่อ'),
    phone_no: requiredString('หมายเลขโทรศัพท์'),
    email: requiredString('อีเมล').email({ message: 'รูปแบบอีเมลไม่ถูกต้อง' }),
    operator_type: requiredString('ประเภทผู้ดำเนินการ'),
    // Optional fields
    service_type: optionalString(),
    previous_cert_number: optionalString(),
    consent_pdpa: z.any().optional(),
    files: fileArray(0),
}).passthrough().refine((data) => {
    const svc = String(data.service_type || '').toLowerCase();
    if (['renewal', 'replacement', 'amendment'].includes(svc)) {
        return !!String(data.previous_cert_number || '').trim();
    }
    return true;
}, {
    path: ['previous_cert_number'],
    message: 'เลขใบรับรองเดิมจำเป็นสำหรับการต่ออายุ/ทดแทน (Previous certificate number is required for renewal/replacement)',
});

// Step 2: ข้อมูลพืชและสายพันธุ์ (Plant & Strain Info)

const step2Schema = z.object({
    herb_type_id: requiredString('ชนิดพืชสมุนไพร'),
    botanical_name: requiredString('ชื่อทางพฤกษศาสตร์'),
    strain_name: requiredString('ชื่อสายพันธุ์'),
    material_source: requiredString('แหล่งที่มาของวัตถุดิบ'),
    source_location: requiredString('สถานที่แหล่งที่มา'),
    lot_number: requiredString('หมายเลข Lot'),
    // Optional fields
    common_name: optionalString(),
    quantity: z.any().optional(),
    files: fileArray(0),
}).passthrough();

// Step 3: วัตถุประสงค์และลักษณะพื้นที่ (Purpose & Site)

const step3Schema = z.object({
    certification_purpose: optionalString(),
    site_types: z.any().optional(),
    license_pdf_url: optionalString(),
    files: fileArray(0),
}).passthrough();

// Step 4: ข้อมูลผู้ยื่นคำขอ (Applicant Data — Polymorphic)

/** Branch: บุคคลธรรมดา (Individual) */
const individualSchema = z.object({
    applicant_type: z.literal('INDIVIDUAL'),
    first_name: requiredString('ชื่อ'),
    last_name: requiredString('นามสกุล'),
    id_card: requiredThaiId('เลขบัตรประชาชน'),
    phone: requiredString('หมายเลขโทรศัพท์'),
    email: requiredString('อีเมล'),
    files: fileArray(0),
}).passthrough();

/** Branch: วิสาหกิจชุมชน (Community Enterprise) */
const communitySchema = z.object({
    applicant_type: z.literal('COMMUNITY_ENTERPRISE'),
    community_name: requiredString('ชื่อวิสาหกิจชุมชน'),
    president_name: requiredString('ชื่อประธาน'),
    registration_svc01: requiredString('หมายเลขทะเบียน สวช.01'),
    registration_tvc3: optionalString(),
    house_registration_code: optionalString(),
    files: fileArray(0),
}).passthrough();

/** Branch: นิติบุคคล (Legal Entity) */
const legalEntitySchema = z.object({
    applicant_type: z.literal('LEGAL_ENTITY'),
    company_name: requiredString('ชื่อบริษัท/องค์กร'),
    registration_number: requiredString('เลขทะเบียนนิติบุคคล'),
    authorized_signatory: requiredString('ผู้มีอำนาจลงนาม'),
    coordinator_name: optionalString(),
    files: fileArray(0),
}).passthrough();

const APPLICANT_SCHEMAS = {
    INDIVIDUAL: individualSchema,
    COMMUNITY_ENTERPRISE: communitySchema,
    LEGAL_ENTITY: legalEntitySchema,
};

const VALID_APPLICANT_TYPES = Object.keys(APPLICANT_SCHEMAS);

/**
 * Step 4 uses manual discriminated union on `applicant_type`.
 * Routes to the correct branch schema or returns a clear error.
 */
const step4Schema = {
    safeParse(data) {
        const obj = data && typeof data === 'object' ? data : {};
        const applicantType = String(obj.applicant_type || '').trim();

        if (!applicantType) {
            return {
                success: false,
                error: {
                    issues: [{ path: ['applicant_type'], message: 'ประเภทผู้ยื่นคำขอ จำเป็น', code: 'invalid_type' }],
                },
            };
        }

        const schema = APPLICANT_SCHEMAS[applicantType];
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

// Step 5: สถานที่ปลูกและแปลง (Farm & Plot Info)

const step5Schema = z.object({
    plot_name: requiredString('ชื่อแปลง'),
    land_title_no: requiredString('เลขที่โฉนด'),
    area_rai: positiveNumber('ไร่'),
    area_ngan: positiveNumber('งาน'),
    area_sq_wa: positiveNumber('ตารางวา'),
    lat: positiveNumber('ละติจูด'),
    long: z.coerce.number({ message: 'ลองจิจูดต้องเป็นตัวเลข' }),
    surrounding_environment: requiredString('สภาพแวดล้อมโดยรอบ'),
    // Optional fields
    province: optionalString(),
    district: optionalString(),
    sub_district: optionalString(),
    files: fileArray(0),
}).passthrough();

// Step 6: การเพาะปลูก (Production Info)

const step6Schema = z.object({
    water_source_type: requiredString('ประเภทแหล่งน้ำ'),
    irrigation_method: requiredString('วิธีการให้น้ำ'),
    soil_preparation_method: requiredString('วิธีเตรียมดิน'),
    soil_analysis_date: dateString('วันที่วิเคราะห์ดิน'),
    water_analysis_date: dateString('วันที่วิเคราะห์น้ำ'),
    fertilizer_type: requiredString('ประเภทปุ๋ย'),
    fertilizer_schedule: requiredString('ตารางการให้ปุ๋ย'),
    pest_control_method: requiredString('วิธีควบคุมศัตรูพืช'),
    weed_control_method: requiredString('วิธีควบคุมวัชพืช'),
    input_usage_history: requiredString('ประวัติการใช้ปัจจัยการผลิต'),
    files: fileArray(0),
}).passthrough();

// Step 7: เก็บเกี่ยวและคุณภาพ (Harvest & Quality)

const step7Schema = z.object({
    harvest_criteria: requiredString('เกณฑ์การเก็บเกี่ยว'),
    harvest_method: requiredString('วิธีการเก็บเกี่ยว'),
    equipment_sanitation: requiredString('การทำความสะอาดอุปกรณ์'),
    harvest_time_of_day: requiredString('ช่วงเวลาเก็บเกี่ยว'),
    cleaning_method: requiredString('วิธีการทำความสะอาด'),
    drying_method: requiredString('วิธีการอบแห้ง'),
    sorting_criteria: requiredString('เกณฑ์การคัดแยก'),
    moisture_content_target: requiredString('เป้าหมายความชื้น'),
    packaging_material_type: requiredString('ประเภทวัสดุบรรจุ'),
    storage_condition: requiredString('สภาพการเก็บรักษา'),
    warehouse_pest_control: requiredString('การควบคุมศัตรูพืชในโรงเก็บ'),
    stock_management_system: requiredString('ระบบบริหารสต๊อก'),
    files: fileArray(0),
}).passthrough();

// Step 8: หลักฐานประกอบคำขอ (Documents/Evidence)

const step8Schema = z.object({
    files: fileArray(1),
}).passthrough();

// Step 9: ตรวจทานและส่ง (Review & Submit)

const step9Schema = z.object({
    traceability_code_format: requiredString('รูปแบบรหัสตามสอบ'),
    internal_audit_date: dateString('วันที่ตรวจประเมินภายใน'),
    sample_retention_period: requiredString('ระยะเวลาเก็บตัวอย่าง'),
    complaint_handling_procedure: requiredString('ขั้นตอนจัดการข้อร้องเรียน'),
    files: fileArray(0),
}).passthrough();

// Step Schema Map

const STEP_SCHEMAS = Object.freeze({
    1: step1Schema,
    2: step2Schema,
    3: step3Schema,
    4: step4Schema,
    5: step5Schema,
    6: step6Schema,
    7: step7Schema,
    8: step8Schema,
    9: step9Schema,
});

// Validation API

/**
 * Validate a single step's data against its Zod schema.
 *
 * @param {number} stepNumber — 1-9
 * @param {object} data — step form data
 * @returns {{ success: boolean, data?: object, errors?: Array<{ path: string, message: string }> }}
 */
function validateStep(stepNumber, data) {
    const schema = STEP_SCHEMAS[stepNumber];
    if (!schema) {
        return { success: true, data, errors: [] };
    }

    const result = schema.safeParse(data || {});
    if (result.success) {
        return { success: true, data: result.data, errors: [] };
    }

    const errors = result.error.issues.map((issue) => ({
        path: issue.path.join('.'),
        message: issue.message,
        code: issue.code,
    }));

    return { success: false, data: null, errors };
}

/**
 * Validate all 9 step data objects (on final submit).
 *
 * @param {object} stepsData — { "1": {...}, "2": {...}, ... "9": {...} }
 * @returns {{ isValid: boolean, validatedSteps: object, errorsByStep: object }}
 */
function validateAllSteps(stepsData) {
    const steps = stepsData && typeof stepsData === 'object' ? stepsData : {};
    const errorsByStep = {};
    const validatedSteps = {};

    for (let stepNo = 1; stepNo <= 9; stepNo++) {
        const key = String(stepNo);
        const stepData = steps[key] || {};
        const result = validateStep(stepNo, stepData);

        if (result.success) {
            validatedSteps[key] = result.data;
        } else {
            errorsByStep[key] = result.errors;
        }
    }

    return {
        isValid: Object.keys(errorsByStep).length === 0,
        validatedSteps,
        errorsByStep,
    };
}

module.exports = {
    STEP_SCHEMAS,
    step1Schema,
    step2Schema,
    step3Schema,
    step4Schema,
    step5Schema,
    step6Schema,
    step7Schema,
    step8Schema,
    step9Schema,
    validateStep,
    validateAllSteps,
};
