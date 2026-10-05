/**
 * ═══════════════════════════════════════════════════════════════
 * GACP Audit Validators — Shared deep-validation functions
 * ═══════════════════════════════════════════════════════════════
 *
 * ใช้ร่วมกับ mega-runner สำหรับ deep validation mode
 * ทุก agent ใช้ validators เหล่านี้ตรวจสอบ business logic
 * ไม่ใช่แค่ HTTP status codes
 *
 * Official GACP Workflow (ถูกต้อง 100%):
 *   Submit + Pay Phase1 → Scheduler → Reviewer → Approve
 *   → Pay Phase2 → Scheduler → Auditor → Certificate
 */

// ─── Response Schema Validator ──────────────────────────────
// ตรวจว่า response body มี field ที่กำหนดครบ
function validateResponseSchema(data, expectedFields) {
  if (!data || typeof data !== 'object') {
    return { valid: false, missing: expectedFields, detail: 'Response is null or not an object' };
  }
  const missing = [];
  for (const field of expectedFields) {
    const value = field.split('.').reduce((obj, key) => obj?.[key], data);
    if (value === undefined || value === null) {
      missing.push(field);
    }
  }
  return {
    valid: missing.length === 0,
    missing,
    detail: missing.length === 0 ? 'All fields present' : `Missing: ${missing.join(', ')}`,
  };
}

// ─── Array Data Validator ───────────────────────────────────
// ตรวจว่า response เป็น array และมีจำนวน record ขั้นต่ำ
function validateArrayData(data, minCount = 1, label = 'items') {
  if (Array.isArray(data)) {
    return {
      valid: data.length >= minCount,
      count: data.length,
      detail: data.length >= minCount
        ? `${data.length} ${label} found`
        : `Only ${data.length} ${label} (min: ${minCount})`,
    };
  }
  // Sometimes data is nested under a key like data.data or data.items
  if (data && typeof data === 'object') {
    const possibleArrays = ['data', 'items', 'results', 'records', 'list'];
    for (const key of possibleArrays) {
      if (Array.isArray(data[key])) {
        return {
          valid: data[key].length >= minCount,
          count: data[key].length,
          detail: data[key].length >= minCount
            ? `${data[key].length} ${label} found (in .${key})`
            : `Only ${data[key].length} ${label} (min: ${minCount})`,
        };
      }
    }
  }
  return { valid: false, count: 0, detail: `Expected array of ${label}, got ${typeof data}` };
}

// ─── Workflow Sequence Validator ─────────────────────────────
// ตรวจ Official Flow (ลำดับขั้นตอนที่ถูกต้อง):
//   1. Submit + Pay Phase1
//   2. Scheduler รับ Job
//   3. Scheduler จ่ายงาน → Reviewer
//   4. Reviewer ตรวจเอกสาร
//   5. Reviewer Approve → แจ้ง Health จ่ายงวด 2
//   6. Health จ่ายเงินงวด 2
//   7. Scheduler รับ Job รอบ 2
//   8. Scheduler นัดหมาย Health + Auditor
//   9. Auditor ลงตรวจพื้นที่
//  10. Certificate ออกใบรับรอง
const OFFICIAL_WORKFLOW_STEPS = [
  'SUBMITTED',
  'PAYMENT_PHASE1',
  'SCHEDULER_ASSIGN_REVIEWER',
  'DOCUMENT_REVIEW',
  'REVIEW_APPROVED',
  'PAYMENT_PHASE2',
  'SCHEDULER_ASSIGN_AUDITOR',
  'SITE_INSPECTION',
  'AUDIT_DECISION',
  'CERTIFICATE_ISSUED',
];

function validateWorkflowSequence(currentStatus, expectedPhase) {
  const currentIdx = OFFICIAL_WORKFLOW_STEPS.indexOf(currentStatus);
  const expectedIdx = OFFICIAL_WORKFLOW_STEPS.indexOf(expectedPhase);
  if (currentIdx === -1) {
    return { valid: false, detail: `Unknown status: ${currentStatus}` };
  }
  if (expectedIdx === -1) {
    return { valid: false, detail: `Unknown phase: ${expectedPhase}` };
  }
  return {
    valid: currentIdx <= expectedIdx,
    detail: `Status: ${currentStatus} (step ${currentIdx + 1}/${OFFICIAL_WORKFLOW_STEPS.length})`,
    steps: OFFICIAL_WORKFLOW_STEPS,
  };
}

// ─── SLA Compliance Validator ────────────────────────────────
// ตรวจว่า SLA ของแต่ละ role ตรงตามที่กำหนด
const CANONICAL_SLA = {
  Reviewer: { days: 3, label: 'ผู้ตรวจเอกสาร', phase: 'Document Review' },
  Auditor: { days: 14, label: 'ผู้ตรวจประเมิน', phase: 'Site Inspection' },
  Scheduler: { days: 3, label: 'ผู้จัดตาราง', phase: 'Scheduling' },
  Accountant: { days: 1, label: 'เจ้าหน้าที่บัญชี', phase: 'Payment Verification' },
  Admin: { days: null, label: 'ผู้ดูแลระบบ', phase: 'Platform Management' },
};

function validateSLACompliance(role, actualDays) {
  const sla = CANONICAL_SLA[role];
  if (!sla) {
    return { valid: false, detail: `Unknown role: ${role}` };
  }
  if (sla.days === null) {
    return { valid: true, detail: `${role} (${sla.label}): No SLA target` };
  }
  return {
    valid: actualDays <= sla.days,
    detail: `${role} (${sla.label}): ${actualDays}d vs SLA ${sla.days}d`,
    target: sla.days,
    actual: actualDays,
  };
}

// ─── Master Data Completeness Validator ──────────────────────
// ตรวจว่า master data ครบถ้วนตาม minimum requirements
const MASTER_DATA_REQUIREMENTS = {
  plants: { min: 0, label: 'พืชสมุนไพร' },          // May be empty if no plants seeded
  locations: { min: 1, label: 'จังหวัด/สถานที่' },
  standards: { min: 0, label: 'มาตรฐาน GACP' },     // May be empty if no standards seeded
  gacpCategories: { min: 1, label: 'หมวดหมู่ GACP' },
  cultivationMethods: { min: 1, label: 'วิธีการเพาะปลูก' },
  soilTypes: { min: 1, label: 'ชนิดดิน' },
  documentSlots: { min: 1, label: 'ช่องเอกสาร' },
  fees: { min: 0, label: 'ตารางค่าธรรมเนียม' },     // Uses non-array structure
};

function validateMasterDataCompleteness(dataMap) {
  const results = [];
  let allValid = true;
  for (const [key, req] of Object.entries(MASTER_DATA_REQUIREMENTS)) {
    const data = dataMap[key];
    const count = Array.isArray(data) ? data.length : (data?.length || 0);
    const valid = count >= req.min;
    if (!valid) allValid = false;
    results.push({ key, label: req.label, valid, count, min: req.min });
  }
  return {
    valid: allValid,
    results,
    detail: allValid
      ? `All ${results.length} master data sets complete`
      : `Missing: ${results.filter(r => !r.valid).map(r => r.label).join(', ')}`,
  };
}

// ─── DTAM Form Mapping Validator ─────────────────────────────
// ตรวจว่า form fields ตรงตาม official กทล.1
const OFFICIAL_FORM_FIELDS = {
  applicantType: { required: true, validValues: ['INDIVIDUAL', 'ENTERPRISE', 'JURISTIC', 'COOPERATIVE'] },
  farmName: { required: true },
  cultivationMethod: { required: true, validValues: ['outdoor', 'indoor', 'greenhouse'] },
  plantCount: { required: true, type: 'number' },
};

function validateFormMapping(formData) {
  const issues = [];
  for (const [field, spec] of Object.entries(OFFICIAL_FORM_FIELDS)) {
    const value = formData[field];
    if (spec.required && (value === undefined || value === null || value === '')) {
      issues.push(`Missing required field: ${field}`);
      continue;
    }
    if (spec.validValues && !spec.validValues.includes(value)) {
      issues.push(`Invalid ${field}: "${value}" (valid: ${spec.validValues.join(', ')})`);
    }
    if (spec.type === 'number' && typeof value !== 'number') {
      issues.push(`${field} must be number, got ${typeof value}`);
    }
  }
  return {
    valid: issues.length === 0,
    issues,
    detail: issues.length === 0 ? 'Form mapping valid' : issues.join('; '),
  };
}

// ─── HTML Page Structure Validator ───────────────────────────
// ตรวจ HTML page structure: title, meta viewport, heading hierarchy
function validatePageStructure(html) {
  const checks = [];
  // Has <title>
  const hasTitle = /<title[^>]*>.+<\/title>/is.test(html);
  checks.push({ check: 'title', valid: hasTitle });
  // Has meta viewport
  const hasViewport = /meta[^>]*viewport/i.test(html);
  checks.push({ check: 'viewport', valid: hasViewport });
  // Has charset
  const hasCharset = /charset/i.test(html);
  checks.push({ check: 'charset', valid: hasCharset });
  // Has lang attribute
  const hasLang = /<html[^>]*lang=/i.test(html);
  checks.push({ check: 'lang', valid: hasLang });
  // Not empty body
  const hasContent = html.length > 200;
  checks.push({ check: 'content', valid: hasContent });

  const allValid = checks.every(c => c.valid);
  const failed = checks.filter(c => !c.valid).map(c => c.check);
  return {
    valid: allValid,
    checks,
    detail: allValid ? 'Page structure OK' : `Missing: ${failed.join(', ')}`,
  };
}

// ─── Pricing Calculation Validator ───────────────────────────
// ตรวจว่าค่าคำนวณ pricing ถูกต้อง
function validatePricingResult(result) {
  if (!result || typeof result !== 'object') {
    return { valid: false, detail: 'No pricing data' };
  }
  // Check that result has numeric fee value
  const fee = result.totalFee || result.fee || result.total || result.amount;
  if (typeof fee !== 'number' || fee <= 0) {
    return { valid: false, detail: `Invalid fee: ${fee}` };
  }
  return {
    valid: true,
    detail: `Fee calculated: ${fee} THB`,
    fee,
  };
}

// ─── Error Response Format Validator ─────────────────────────
// ตรวจว่า error response มี format ที่ถูกต้อง
function validateErrorFormat(data, expectedStatus) {
  // Accept various error formats
  const hasMessage = data?.message || data?.error?.message || data?.error;
  return {
    valid: !!hasMessage,
    detail: hasMessage
      ? `Error format OK: ${typeof hasMessage === 'string' ? hasMessage.slice(0, 50) : 'structured'}`
      : 'Missing error message in response',
  };
}

// ─── Export all validators ───────────────────────────────────
module.exports = {
  validateResponseSchema,
  validateArrayData,
  validateWorkflowSequence,
  validateSLACompliance,
  validateMasterDataCompleteness,
  validateFormMapping,
  validatePageStructure,
  validatePricingResult,
  validateErrorFormat,
  // Constants for reference
  OFFICIAL_WORKFLOW_STEPS,
  CANONICAL_SLA,
  MASTER_DATA_REQUIREMENTS,
  OFFICIAL_FORM_FIELDS,
};
