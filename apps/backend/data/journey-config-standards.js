const GACP_CATEGORIES = [
    { id: 1, nameTH: 'ข้อมูลทั่วไป', nameEN: 'General Information', steps: [1, 2, 3] },
    { id: 2, nameTH: 'พื้นที่เพาะปลูก', nameEN: 'Cultivation Area', steps: [4] },
    { id: 3, nameTH: 'แหล่งน้ำและคุณภาพน้ำ', nameEN: 'Water Source and Quality', steps: [4] },
    { id: 4, nameTH: 'วัสดุปลูกและเมล็ดพันธุ์', nameEN: 'Planting Materials and Seeds', steps: [5] },
    { id: 5, nameTH: 'การจัดการการผลิต', nameEN: 'Production Management', steps: [5, 6] },
    { id: 6, nameTH: 'การป้องกันและกำจัดศัตรูพืช (IPM)', nameEN: 'Integrated Pest Management', steps: [5] },
    { id: 7, nameTH: 'การเก็บเกี่ยว', nameEN: 'Harvesting', steps: [7] },
    { id: 8, nameTH: 'การจัดการหลังเก็บเกี่ยว', nameEN: 'Post-Harvest Management', steps: [7] },
    { id: 9, nameTH: 'บุคลากรและสุขอนามัย', nameEN: 'Personnel and Hygiene', steps: [2, 4] },
    { id: 10, nameTH: 'อุปกรณ์และเครื่องมือ', nameEN: 'Equipment and Tools', steps: [5] },
    { id: 11, nameTH: 'การบันทึกข้อมูล', nameEN: 'Record Keeping', steps: [6] },
    { id: 12, nameTH: 'ความปลอดภัย', nameEN: 'Security', steps: [4] },
    { id: 13, nameTH: 'การควบคุมคุณภาพ', nameEN: 'Quality Control', steps: [7] },
    { id: 14, nameTH: 'เอกสารและ SOP', nameEN: 'Documents and SOP', steps: [8] },
];

// ENVIRONMENT CHECKLIST (สำหรับ Step 4)
const ENVIRONMENT_CHECKLIST = [
    { id: 'no_waste_dump', nameTH: 'พื้นที่ไม่เคยเป็นที่ทิ้งขยะ/สารเคมี', nameEN: 'Not former waste/chemical dump', required: true, gacpCategory: 2 },
    { id: 'no_contamination', nameTH: 'ไม่อยู่ใกล้แหล่งปนเปื้อน (โรงงาน/โรงพยาบาล/คอกสัตว์)', nameEN: 'Not near contamination sources', required: true, gacpCategory: 2 },
    { id: 'no_chemicals_3y', nameTH: 'ไม่เคยใช้สารเคมีเข้มข้นในช่วง 3 ปี', nameEN: 'No intensive chemicals in last 3 years', required: false, gacpCategory: 2 },
    { id: 'suitable_environment', nameTH: 'สภาพแวดล้อมเหมาะสมสำหรับการปลูกพืชสมุนไพร', nameEN: 'Suitable environment for herb cultivation', required: true, gacpCategory: 2 },
];

// WATER SOURCES
const WATER_SOURCES = [
    { id: 'WELL', nameTH: 'บ่อบาดาล', nameEN: 'Well' },
    { id: 'RAIN', nameTH: 'น้ำฝน', nameEN: 'Rainwater' },
    { id: 'RIVER', nameTH: 'แม่น้ำ/ลำคลอง', nameEN: 'River/Canal' },
    { id: 'TAP', nameTH: 'น้ำประปา', nameEN: 'Tap Water' },
    { id: 'POND', nameTH: 'สระ/อ่างเก็บน้ำ', nameEN: 'Pond/Reservoir' },
];

// GACP STEP MAPPING (ข้อมูลที่ต้องกรอกต่อ Step)
const GACP_STEP_REQUIREMENTS = {
    // Step 4: Farm
    4: {
        gacpCategories: [2, 3, 9, 12],
        fields: ['farmName', 'address', 'totalArea', 'landOwnership', 'waterSource', 'security'],
        documents: ['land_title', 'farm_map', 'water_quality_report'],
        docRequired: ['land_title', 'farm_map'],
        docOptional: ['water_quality_report'],
    },
    // Step 5: Plots
    5: {
        gacpCategories: [4, 5, 6, 10],
        fields: ['plotName', 'plotArea', 'gps', 'cultivationSystem', 'seedSource', 'ipmPlan'],
        documents: ['soil_analysis_report', 'seed_certificate'],
        docRequired: [],
        docOptional: ['soil_analysis_report', 'seed_certificate'],
    },
    // Step 6: Lots
    6: {
        gacpCategories: [5, 11],
        fields: ['lotCode', 'plotId', 'plantCount', 'plantingDate'],
        documents: ['production_plan'],
        docRequired: [],
        docOptional: ['production_plan'],
    },
    // Step 7: Harvest & QC
    7: {
        gacpCategories: [7, 8, 13],
        fields: ['harvestMethod', 'dryingMethod', 'storage', 'qcPlan'],
        documents: ['sop_cultivation', 'sop_quality_control'],
        docRequired: ['sop_cultivation'],
        docOptional: ['sop_quality_control'],
    },
    // Step 8: Documents
    8: {
        gacpCategories: [14],
        fields: [],
        documents: [], // Will be calculated dynamically
        docRequired: [],
        docOptional: [],
    },
};

// SOIL TYPES (สำหรับ Step 5)
const SOIL_TYPES = [
    { id: 'clay', nameTH: 'ดินเหนียว', nameEN: 'Clay' },
    { id: 'loam', nameTH: 'ดินร่วน', nameEN: 'Loam' },
    { id: 'sandy_loam', nameTH: 'ดินร่วนปนทราย', nameEN: 'Sandy Loam' },
    { id: 'sandy', nameTH: 'ดินทราย', nameEN: 'Sandy' },
    { id: 'peat', nameTH: 'ดินพีท', nameEN: 'Peat' },
    { id: 'organic', nameTH: 'ดินอินทรีย์', nameEN: 'Organic' },
    { id: 'hydroponic', nameTH: 'ไฮโดรโปนิกส์ (ไม่ใช้ดิน)', nameEN: 'Hydroponic (Soilless)' },
];

// SEED SOURCES (สำหรับ Step 5)
const SEED_SOURCES = [
    { id: 'own', nameTH: 'เพาะเอง', nameEN: 'Self-propagated' },
    { id: 'certified', nameTH: 'ซื้อจากร้านพันธุ์พืชรับรอง', nameEN: 'Certified Seed Shop' },
    { id: 'government', nameTH: 'จากหน่วยงานราชการ', nameEN: 'Government Agency' },
    { id: 'research', nameTH: 'จากสถาบันวิจัย', nameEN: 'Research Institute' },
    { id: 'import', nameTH: 'นำเข้าจากต่างประเทศ', nameEN: 'Imported' },
];

// IPM METHODS (สำหรับ Step 5)
const IPM_METHODS = [
    { id: 'biological', nameTH: 'การควบคุมทางชีวภาพ', nameEN: 'Biological Control', description: 'ใช้แมลงศัตรูธรรมชาติ เช่น ตัวห้ำ ตัวเบียน' },
    { id: 'cultural', nameTH: 'การจัดการทางเขตกรรม', nameEN: 'Cultural Control', description: 'หมุนเวียนพืช ปลูกพืชคลุมดิน' },
    { id: 'mechanical', nameTH: 'การควบคุมโดยกล', nameEN: 'Mechanical Control', description: 'กับดัก กาว ตาข่าย' },
    { id: 'physical', nameTH: 'การควบคุมทางกายภาพ', nameEN: 'Physical Control', description: 'คลุมพลาสติก ใช้ความร้อน' },
    { id: 'botanical', nameTH: 'สารสกัดจากพืช', nameEN: 'Botanical Pesticides', description: 'สะเดา หางไหล ขมิ้น' },
    { id: 'organic', nameTH: 'สารอินทรีย์อนุญาต', nameEN: 'Approved Organic Substances', description: 'ตามรายการที่กรมวิชาการเกษตรอนุญาต' },
];

// HELPER FUNCTIONS

/**
 * Get journey config by purpose and method
 */

module.exports = {
    GACP_CATEGORIES,
    ENVIRONMENT_CHECKLIST,
    WATER_SOURCES,
    GACP_STEP_REQUIREMENTS,
    SOIL_TYPES,
    SEED_SOURCES,
    IPM_METHODS,
};
