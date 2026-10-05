/**
 * Master Data Constants
 * =====================
 * Centralized business constants used across controllers and services.
 * Change values here to update fees, pricing, scoring, etc. system-wide.
 *
 * Changing these values affects production billing and certification logic.
 */

// ─── GACP Certification Fees (THB) ───────────────────────────────────────────
const GACP_FEES = Object.freeze({
    /** ค่าตรวจเอกสาร per cultivation type */
    DOCUMENT_REVIEW: 5_000,
    /** ค่าตรวจพื้นที่ per cultivation type */
    SITE_INSPECTION: 25_000,
    /** Total per cultivation type (document + site) */
    PER_TYPE_TOTAL: 30_000,
    /** Platform service fee percentage */
    PLATFORM_FEE_PERCENT: 10,
});

// ─── QR Code Pricing Tiers ──────────────────────────────────────────────────
const QR_PRICING_TIERS = Object.freeze([
    { min: 1, max: 100, pricePerQR: 5 },
    { min: 101, max: 500, pricePerQR: 4 },
    { min: 501, max: 1_000, pricePerQR: 3 },
    { min: 1_001, max: 999_999, pricePerQR: 2 },
]);

// ─── GACP Scoring Levels ────────────────────────────────────────────────────
const SCORING_LEVELS = Object.freeze([
    { level: 'excellent', minScore: 90, maxScore: 100, label: 'ยอดเยี่ยม', color: '#4CAF50' },
    { level: 'good', minScore: 80, maxScore: 89, label: 'ดี', color: '#8BC34A' },
    { level: 'pass', minScore: 70, maxScore: 79, label: 'ผ่าน', color: '#FFC107' },
    { level: 'fail', minScore: 0, maxScore: 69, label: 'ไม่ผ่าน', color: '#F44336' },
]);

// ─── GACP Scoring Categories + Weights ──────────────────────────────────────
const GACP_CATEGORIES = Object.freeze([
    { id: 'site-selection', name: 'การเลือกสถานที่', nameTH: 'การเลือกสถานที่', weight: 10 },
    { id: 'seed-material', name: 'เมล็ดพันธุ์และวัสดุขยายพันธุ์', nameTH: 'เมล็ดพันธุ์และวัสดุขยายพันธุ์', weight: 15 },
    { id: 'cultivation', name: 'การปลูกและการดูแลรักษา', nameTH: 'การปลูกและการดูแลรักษา', weight: 25 },
    { id: 'harvest', name: 'การเก็บเกี่ยว', nameTH: 'การเก็บเกี่ยว', weight: 15 },
    { id: 'post-harvest', name: 'การจัดการหลังเก็บเกี่ยว', nameTH: 'การจัดการหลังเก็บเกี่ยว', weight: 15 },
    { id: 'personnel', name: 'บุคลากรและการฝึกอบรม', nameTH: 'บุคลากรและการฝึกอบรม', weight: 10 },
    { id: 'documentation', name: 'เอกสารและการบันทึก', nameTH: 'เอกสารและการบันทึก', weight: 10 },
]);

// ─── Cultivation Methods ────────────────────────────────────────────────────
const CULTIVATION_METHODS = Object.freeze([
    { id: 'outdoor', name: 'ปลูกกลางแจ้ง', nameEn: 'Outdoor', icon: '🌞', yieldMultiplier: 1.0 },
    { id: 'greenhouse', name: 'โรงเรือน', nameEn: 'Greenhouse', icon: '🏠', yieldMultiplier: 1.2 },
    { id: 'indoor', name: 'ฟาร์มแบบปิด', nameEn: 'Indoor Controlled', icon: '🏭', yieldMultiplier: 1.5 },
]);

const SUB_CULTIVATION_METHODS = Object.freeze([
    { id: 'none', name: 'ไม่มี', nameEn: 'None', applicableTo: ['outdoor', 'greenhouse', 'indoor'] },
    { id: 'vertical', name: 'ฟาร์มแนวตั้ง', nameEn: 'Vertical Farm', applicableTo: ['greenhouse', 'indoor'] },
    { id: 'hydroponic', name: 'ไฮโดรโปนิกส์', nameEn: 'Hydroponic', applicableTo: ['greenhouse', 'indoor'] },
]);

module.exports = {
    GACP_FEES,
    QR_PRICING_TIERS,
    SCORING_LEVELS,
    GACP_CATEGORIES,
    CULTIVATION_METHODS,
    SUB_CULTIVATION_METHODS,
};
