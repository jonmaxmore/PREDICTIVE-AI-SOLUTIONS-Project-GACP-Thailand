/**
 * Master Data Controller
 * Serves system configuration and static options to frontend
 * 
 * API-First Design: All configurable data comes from here
 * This allows changing fees, options, etc without frontend deployment
 */

const {
    GACP_FEES,
    QR_PRICING_TIERS,
    CULTIVATION_METHODS,
    SUB_CULTIVATION_METHODS,
} = require('../constants/master-data-constants');
const { CERTIFICATION_PURPOSES } = require('../shared/certification-purposes');

/** วัตถุประสงค์ที่เลือกได้ — สามคำที่มีใบอนุญาต ภ.ท. รองรับ (มติ operator 2026-10-05) */
const purposeOptions = () => Object.values(CERTIFICATION_PURPOSES).map((purpose) => ({ ...purpose }));

const getMasterData = async (req, res) => {
    try {
        const data = {
            // Certification Purposes (วัตถุประสงค์การขอรับรอง)
            purposes: purposeOptions(),

            // Cultivation Methods (รูปแบบการปลูก - 3 หลัก)
            cultivationMethods: [
                {
                    id: 'outdoor',
                    name: 'ปลูกกลางแจ้ง',
                    nameEn: 'Outdoor',
                    icon: '🌞',
                    description: 'ปลูกในแปลงกลางแจ้ง อาศัยแสงแดดธรรมชาติ',
                    pros: ['ต้นทุนต่ำ', 'เหมาะกับพื้นที่กว้าง', 'แสงธรรมชาติเต็มที่'],
                    cons: ['ควบคุมสภาพแวดล้อมยาก', 'เสี่ยงต่อศัตรูพืช', 'ขึ้นกับสภาพอากาศ'],
                    yieldMultiplier: 1.0,
                },
                {
                    id: 'greenhouse',
                    name: 'โรงเรือน',
                    nameEn: 'Greenhouse',
                    icon: '🏠',
                    description: 'ปลูกในโรงเรือนที่มีหลังคาโปร่งแสง',
                    pros: ['ควบคุมสภาพแวดล้อมได้บางส่วน', 'ป้องกันฝนและแมลง', 'ปลูกได้ตลอดปี'],
                    cons: ['ต้นทุนสูงกว่ากลางแจ้ง', 'ต้องมีระบบระบายอากาศ'],
                    yieldMultiplier: 1.2,
                },
                {
                    id: 'indoor',
                    name: 'ฟาร์มแบบปิด',
                    nameEn: 'Indoor Controlled',
                    icon: '🏭',
                    description: 'ปลูกในอาคารปิดที่ควบคุมสภาพแวดล้อมทั้งหมด',
                    pros: ['ควบคุมทุกปัจจัยได้', 'คุณภาพสม่ำเสมอ', 'ปลอดภัยจากศัตรูพืช'],
                    cons: ['ต้นทุนสูงมาก', 'ค่าไฟฟ้าสูง', 'ต้องการความชำนาญ'],
                    yieldMultiplier: 1.5,
                },
            ],

            // Sub Cultivation Methods (รูปแบบเสริม)
            subCultivationMethods: [
                {
                    id: 'none',
                    name: 'ไม่มี',
                    nameEn: 'None',
                    icon: '➖',
                    description: 'ใช้วิธีการปลูกปกติ',
                    applicableTo: ['outdoor', 'greenhouse', 'indoor'],
                },
                {
                    id: 'vertical',
                    name: 'ฟาร์มแนวตั้ง',
                    nameEn: 'Vertical Farm',
                    icon: '🗼',
                    description: 'ปลูกเป็นชั้น ๆ ในแนวตั้ง ประหยัดพื้นที่',
                    applicableTo: ['greenhouse', 'indoor'],
                },
                {
                    id: 'hydroponic',
                    name: 'ไฮโดรโปนิกส์',
                    nameEn: 'Hydroponic',
                    icon: '💧',
                    description: 'ปลูกในน้ำยาธาตุอาหารโดยไม่ใช้ดิน',
                    applicableTo: ['greenhouse', 'indoor'],
                },
            ],

            // GACP Fees (ค่าธรรมเนียม - ควบคุมจาก Backend)
            fees: {
                documentReview: GACP_FEES.DOCUMENT_REVIEW,
                siteInspection: GACP_FEES.SITE_INSPECTION,
                perTypeTotal: GACP_FEES.PER_TYPE_TOTAL,
                platformFeePercent: GACP_FEES.PLATFORM_FEE_PERCENT,
                notes: {
                    th: 'ฟาร์มที่มีหลายรูปแบบการปลูกจะแยกเป็นหลายเคสและหลายบิล',
                    en: 'Farms with multiple cultivation types will be split into separate cases and bills',
                },
            },

            // QR Code Pricing (อัตราค่า QR ตามจำนวน)
            qrPricing: [
                { min: 1, max: 100, pricePerQR: 5 },
                { min: 101, max: 500, pricePerQR: 4 },
                { min: 501, max: 1000, pricePerQR: 3 },
                { min: 1001, max: 999999, pricePerQR: 2 },
            ],

            // Existing Data (Retained from original)

            // Soil Types
            soilTypes: [
                { id: 'LOAM', label: 'ดินร่วน', labelEN: 'Loam' },
                { id: 'CLAY', label: 'ดินเหนียว', labelEN: 'Clay' },
                { id: 'SANDY', label: 'ดินทราย', labelEN: 'Sandy' },
                { id: 'PEAT', label: 'ดินอินทรีย์', labelEN: 'Peat' },
                { id: 'OTHER', label: 'อื่น ๆ', labelEN: 'Other' },
            ],

            // Water Sources
            waterSources: [
                { id: 'RAIN', label: 'น้ำฝน', labelEN: 'Rain Water' },
                { id: 'RIVER', label: 'แม่น้ำ/ลำคลอง', labelEN: 'River/Canal' },
                { id: 'WELL', label: 'น้ำบาดาล', labelEN: 'Ground Water' },
                { id: 'TAP', label: 'น้ำประปา', labelEN: 'Tap Water' },
                { id: 'IRRIGATION', label: 'ระบบชลประทาน', labelEN: 'Irrigation System' },
            ],

            // Cultivation Systems (Legacy - kept for backwards compatibility)
            cultivationSystems: [
                { id: 'OUTDOOR', label: 'กลางแจ้ง', labelEN: 'Outdoor' },
                { id: 'INDOOR', label: 'ในโรงเรือน (Indoor)', labelEN: 'Indoor' },
                { id: 'GREENHOUSE', label: 'โรงเรือน (Greenhouse)', labelEN: 'Greenhouse' },
            ],

            // Plot Types (Zoning)
            plotTypes: [
                { id: 'INDOOR', label: 'โรงเรือนปิด (Indoor)', icon: '🏠' },
                { id: 'GREENHOUSE', label: 'โรงเรือน (Greenhouse)', icon: '🏡' },
                { id: 'OUTDOOR', label: 'กลางแจ้ง (Outdoor)', icon: '🌤️' },
            ],

            // Plant Parts
            plantParts: [
                { id: 'SEED', label: 'เมล็ด', labelEN: 'Seed' },
                { id: 'STEM', label: 'ลำต้น', labelEN: 'Stem' },
                { id: 'FLOWER', label: 'ช่อดอก', labelEN: 'Flower' },
                { id: 'LEAF', label: 'ใบ', labelEN: 'Leaf' },
                { id: 'ROOT', label: 'ราก/หัว', labelEN: 'Root/Tuber' },
                { id: 'OTHER', label: 'อื่น ๆ', labelEN: 'Other' },
            ],

            // Ownership Types
            ownershipTypes: [
                { id: 'OWN', label: 'เจ้าของ', labelEN: 'Owner' },
                { id: 'RENT', label: 'เช่า', labelEN: 'Renter' },
                { id: 'CONSENT', label: 'ได้รับยินยอม', labelEN: 'Consent' },
            ],

            // Applicant Types
            applicantTypes: [
                { id: 'INDIVIDUAL', label: 'บุคคลธรรมดา', labelEN: 'Individual', icon: '👤' },
                { id: 'COMMUNITY', label: 'วิสาหกิจชุมชน', labelEN: 'Community Enterprise', icon: '👥' },
                { id: 'JURISTIC', label: 'นิติบุคคล', labelEN: 'Juristic Person', icon: '🏢' },
            ],

            // API Version
            _version: '2.1.0',
            _lastUpdated: new Date().toISOString(),
        };

        res.json({
            success: true,
            data: data,
        });
    } catch (error) {
        logger.error('Master Data Error:', error);
        res.status(500).json({ success: false, error: 'Failed to fetch master data' });
    }
};

// Individual endpoint getters for more granular API access
const getFees = async (req, res) => {
    res.json({
        success: true,
        data: {
            documentReview: GACP_FEES.DOCUMENT_REVIEW,
            siteInspection: GACP_FEES.SITE_INSPECTION,
            perTypeTotal: GACP_FEES.PER_TYPE_TOTAL,
            platformFeePercent: GACP_FEES.PLATFORM_FEE_PERCENT,
        },
    });
};

const getCultivationMethods = async (req, res) => {
    res.json({
        success: true,
        data: {
            main: CULTIVATION_METHODS,
            sub: SUB_CULTIVATION_METHODS,
        },
    });
};

const getPurposes = async (req, res) => {
    res.json({
        success: true,
        data: purposeOptions(),
    });
};

const getQrPricing = async (req, res) => {
    res.json({
        success: true,
        data: QR_PRICING_TIERS,
    });
};

// Location endpoints (provinces/districts for cascading dropdowns)
const thaiLocations = require('../data/thai-locations');
const logger = require('../shared/logger');

const getLocations = async (req, res) => {
    try {
        res.json({ success: true, data: thaiLocations.getProvinces() });
    } catch (err) {
        logger.error('getLocations:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch provinces' });
    }
};

const getDistricts = async (req, res) => {
    try {
        const id = parseInt(req.params.provinceId, 10);
        res.json({ success: true, data: thaiLocations.getDistrictsByProvince(id) });
    } catch (err) {
        logger.error('getDistricts:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch districts' });
    }
};

/**
 * ตำบล/แขวง for an อำเภอ, each carrying its postal code.
 *
 * The postal code travels with the subdistrict so the form can prefill it on
 * selection. It must stay editable: 174 of Thailand's 955 postal codes span
 * more than one district, so this is a good answer, not the only answer.
 */
const getSubDistricts = async (req, res) => {
    try {
        const id = parseInt(req.params.districtId, 10);
        res.json({ success: true, data: thaiLocations.getSubDistrictsByDistrict(id) });
    } catch (err) {
        logger.error('getSubDistricts:', err);
        res.status(500).json({ success: false, error: 'Failed to fetch sub-districts' });
    }
};

module.exports = {
    getMasterData,
    getFees,
    getCultivationMethods,
    getPurposes,
    getQrPricing,
    getLocations,
    getDistricts,
    getSubDistricts,
};

