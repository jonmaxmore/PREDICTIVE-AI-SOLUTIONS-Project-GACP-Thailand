/**
 * GACP Platform - Plant Density Configuration
 * การตั้งค่าความหนาแน่นของการปลูกพืชตามวิธีการปลูก
 *
 * ใช้สำหรับ:
 * - คำนวณจำนวนต้นสูงสุดที่อนุญาตให้สร้าง QR Code (PlantUnit)
 * - ควบคุม quota ตามพื้นที่และวิธีปลูกที่ได้รับอนุญาต
 *
 * อ้างอิง:
 * - มาตรฐาน GACP สากล (WHO Guidelines)
 * - ข้อมูลจาก Emerald Harvest, Advanced Nutrients
 * - ปรับให้เหมาะกับพืชกัญชาในประเทศไทย
 *
 * พื้นที่ทั้งหมดในระบบใช้หน่วยตารางเมตร (ตร.ม.) เท่านั้น
 *
 * The GACP tables are published per rai, so `plantsPerRai` is kept beside each
 * rate for anyone checking this file against them. It is documentation. The
 * arithmetic uses `plantsPerSqm`, and nothing here converts units — a unit
 * conversion in this file is what let the same stored row mean 1,600 square
 * metres to one caller and one square metre to another.
 */
const { localYear } = require('../utils/working-days');

const PLANT_DENSITY = {
  // ความหนาแน่นตามวิธีการปลูก (ต้น/ตร.ม.)
  DENSITY_RATES: {
    // ในร่มระบบควบคุม - ปลูกได้หนาแน่นสุด
    INDOOR: {
      plantsPerSqm: 8,
      plantsPerRai: 12800, // 8 × 1600
      description: 'ระบบควบคุมสภาพแวดล้อม ปลูกได้หนาแน่น',
      spacingCm: 35, // ระยะห่างระหว่างต้น (ซม.)
    },
    INDOOR_CONTROLLED: {
      plantsPerSqm: 8,
      plantsPerRai: 12800,
      description: 'ระบบควบคุมสภาพแวดล้อม ปลูกได้หนาแน่น',
      spacingCm: 35,
    },

    // โรงเรือน - กึ่งควบคุม
    GREENHOUSE: {
      plantsPerSqm: 5,
      plantsPerRai: 8000, // 5 × 1600
      description: 'โรงเรือนกึ่งควบคุม',
      spacingCm: 45,
    },

    // กลางแจ้ง - ต้นใหญ่ ระยะห่างมาก
    OUTDOOR: {
      plantsPerSqm: 2.5,
      plantsPerRai: 4000, // 2.5 × 1600
      description: 'กลางแจ้ง ต้นไม้มีขนาดใหญ่',
      spacingCm: 60,
    },

    // ค่า default สำหรับกรณีไม่ระบุวิธีปลูก
    DEFAULT: {
      plantsPerSqm: 2.5,
      plantsPerRai: 4000,
      description: 'ค่าเริ่มต้น (กลางแจ้ง)',
      spacingCm: 60,
    },
  },

  // ประเภทสถานะต้นไม้
  PLANT_STATUS: {
    GROWING: 'GROWING', // กำลังเจริญเติบโต
    HARVESTED: 'HARVESTED', // เก็บเกี่ยวแล้ว
    DIED: 'DIED', // ตาย
    REMOVED: 'REMOVED', // ถูกกำจัด
  },

  // ประเภทบันทึกการดูแล
  CARE_LOG_TYPES: {
    WATERING: { code: 'WATERING', label: 'รดน้ำ', labelEN: 'Watering' },
    FERTILIZING: { code: 'FERTILIZING', label: 'ใส่ปุ๋ย', labelEN: 'Fertilizing' },
    SPRAYING: { code: 'SPRAYING', label: 'ฉีดยา/พ่นสาร', labelEN: 'Spraying' },
    PRUNING: { code: 'PRUNING', label: 'ตัดแต่งกิ่ง', labelEN: 'Pruning' },
    INSPECTION: { code: 'INSPECTION', label: 'ตรวจสอบ', labelEN: 'Inspection' },
    TRANSPLANT: { code: 'TRANSPLANT', label: 'ย้ายปลูก', labelEN: 'Transplant' },
    OTHER: { code: 'OTHER', label: 'อื่น ๆ', labelEN: 'Other' },
  },

  // คะแนนสุขภาพ
  HEALTH_SCORES: {
    1: { score: 1, label: 'แย่มาก', labelEN: 'Very Poor', color: 'red' },
    2: { score: 2, label: 'แย่', labelEN: 'Poor', color: 'orange' },
    3: { score: 3, label: 'ปานกลาง', labelEN: 'Average', color: 'yellow' },
    4: { score: 4, label: 'ดี', labelEN: 'Good', color: 'lime' },
    5: { score: 5, label: 'ดีมาก', labelEN: 'Excellent', color: 'green' },
  },

  // QR Code Settings
  QR_SETTINGS: {
    PREFIX: 'UNIT', // รหัสนำหน้า QR
  },
};

module.exports = {
  PLANT_DENSITY,

  // Helper Functions

  /**
   * คำนวณจำนวนต้นสูงสุดจากพื้นที่ (ตร.ม.) และวิธีปลูก
   *
   * This used to take a unit, defaulting to rai, while shared/area-utils
   * defaulted the same absent value to square metres. The plant cap therefore
   * depended on which module was asked, and the two answers differed by a
   * factor of 1,600. The parameter is gone: the caller converts once, at the
   * point where it reads the stored row, and passes square metres.
   *
   * @param {number|string} areaSqm - พื้นที่ (ตร.ม.)
   * @param {string} cultivationType - วิธีปลูก (INDOOR, GREENHOUSE, OUTDOOR)
   * @returns {number} จำนวนต้นสูงสุด
   */
  calculateMaxPlants: (areaSqm, cultivationType = 'OUTDOOR') => {
    const area = Number(areaSqm);
    if (!Number.isFinite(area) || area <= 0) {
      return 0;
    }

    // An unrecognised method gets the outdoor rate, the most restrictive one.
    // Guessing high would authorise eight plants per square metre on the
    // strength of a typo.
    const densityKey = String(cultivationType || '').toUpperCase();
    const density =
      PLANT_DENSITY.DENSITY_RATES[densityKey] || PLANT_DENSITY.DENSITY_RATES.DEFAULT;

    return Math.floor(area * density.plantsPerSqm);
  },

  /**
   * หา density rate ตามวิธีปลูก
   * @param {string} cultivationType - วิธีปลูก
   * @returns {object} density config
   */
  getDensityRate: cultivationType => {
    const key = cultivationType?.toUpperCase() || 'DEFAULT';
    return PLANT_DENSITY.DENSITY_RATES[key] || PLANT_DENSITY.DENSITY_RATES.DEFAULT;
  },

  /**
   * สร้างรหัสต้นไม้
   * @param {string} cycleId - รหัสรอบการปลูก
   * @param {number} index - ลำดับต้นไม้
   * @returns {string} รหัสต้นไม้
   */
  generatePlantCode: (cycleId, index) => {
    const year = localYear(); // Bangkok year
    const suffix = cycleId.slice(-4).toUpperCase();
    const paddedIndex = String(index).padStart(5, '0');
    return `${PLANT_DENSITY.QR_SETTINGS.PREFIX}-${year}-${suffix}-${paddedIndex}`;
  },

  /**
   * ตรวจสอบประเภท Care Log
   * @param {string} logType - ประเภท
   * @returns {boolean} valid หรือไม่
   */
  isValidCareLogType: logType => {
    return Object.keys(PLANT_DENSITY.CARE_LOG_TYPES).includes(logType?.toUpperCase());
  },

  /**
   * ตรวจสอบคะแนนสุขภาพ
   * @param {number} score - คะแนน
   * @returns {boolean} valid หรือไม่
   */
  isValidHealthScore: score => {
    return score >= 1 && score <= 5;
  },

  /**
   * หาข้อมูล Care Log Type
   * @param {string} logType - ประเภท
   * @returns {object|null} ข้อมูล
   */
  getCareLogType: logType => {
    return PLANT_DENSITY.CARE_LOG_TYPES[logType?.toUpperCase()] || null;
  },

  /**
   * หาข้อมูลคะแนนสุขภาพ
   * @param {number} score - คะแนน
   * @returns {object|null} ข้อมูล
   */
  getHealthScore: score => {
    return PLANT_DENSITY.HEALTH_SCORES[score] || null;
  },
};
