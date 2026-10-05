'use strict';

/**
 * Dataset domain registry — สัญญา C05F680149 ภาคผนวก 4 ข้อ 3
 * "ชุดข้อมูลดิบ 1 ชุด (API/CSV) + คู่มือการใช้ชุดข้อมูล → Data Lake บพข."
 *
 * SINGLE SOURCE OF TRUTH for both:
 *   - the export endpoints (services/dataset-export-service.js) — the field
 *     allowlist below is the SELECT list, nothing else ever leaves the DB
 *   - the data-dictionary generator (คู่มือชุดข้อมูล: ความหมาย data field +
 *     หน่วยนับ ตามถ้อยคำสัญญา)
 *
 * นิยาม "ข้อมูลดิบ" ตามภาคผนวก 1 ข้อ 11: ข้อมูลจากการใช้งานอุปกรณ์/บันทึก
 * ปฏิบัติการที่ยังไม่ผ่านการวิเคราะห์/สังเคราะห์ → เลือกเฉพาะ operational
 * records/measurements. Privacy-by-design: ห้ามใส่คอลัมน์ PII ใน allowlist
 * (requestIp/userAgent/notes/qcNotes/photoUrl/actor ids) — มี unit guard คุม
 * และทุก field ถูกเช็คกับ Prisma DMMF ว่ามีจริง (กัน select-nonexistent-field).
 */

const DATASET_DOMAINS = [
    {
        key: 'cultivation-logs',
        model: 'CultivationLog',
        prismaModel: 'cultivationLog',
        thaiName: 'บันทึกกิจกรรมการเพาะปลูก',
        description: 'บันทึกกิจกรรมรายแปลง/รายรอบปลูกตาม GACP หมวดการจัดการการผลิต (ให้น้ำ ใส่ปุ๋ย กำจัดศัตรูพืช ฯลฯ) พร้อมสภาพอากาศขณะปฏิบัติงาน',
        where: {},
        fields: [
            { field: 'id', thaiName: 'รหัสรายการ', unit: null, description: 'UUID ของบันทึก' },
            { field: 'createdAt', thaiName: 'เวลาที่บันทึก', unit: 'ISO 8601', description: 'เวลาสร้างรายการในระบบ' },
            { field: 'cycleId', thaiName: 'รหัสรอบปลูก', unit: null, description: 'UUID อ้างอิงรอบการปลูก (PlantingCycle)' },
            { field: 'logDate', thaiName: 'วันที่ทำกิจกรรม', unit: 'ISO 8601', description: 'วันที่กิจกรรมเกิดขึ้นจริง' },
            { field: 'scope', thaiName: 'ขอบเขต', unit: null, description: 'CYCLE = ทั้งรอบปลูก / PLOT / PLANT' },
            { field: 'logType', thaiName: 'ประเภทกิจกรรม', unit: null, description: 'IRRIGATION, FERTILIZER, PESTICIDE, OBSERVATION, WEEDING, OTHER' },
            { field: 'plotId', thaiName: 'รหัสแปลงย่อย', unit: null, description: 'UUID แปลงย่อย (ถ้าระบุ)' },
            { field: 'productName', thaiName: 'ชื่อผลิตภัณฑ์ที่ใช้', unit: null, description: 'ชื่อปุ๋ย/สารที่ใช้ในกิจกรรม' },
            { field: 'quantity', thaiName: 'ปริมาณ', unit: 'ตามคอลัมน์ unit', description: 'ปริมาณที่ใช้' },
            { field: 'unit', thaiName: 'หน่วยของปริมาณ', unit: null, description: 'เช่น ลิตร, กก., ml' },
            { field: 'method', thaiName: 'วิธีการ', unit: null, description: 'เช่น หยอด ฉีดพ่น รดน้ำ' },
            { field: 'area', thaiName: 'พื้นที่', unit: 'ไร่', description: 'พื้นที่ที่ทำกิจกรรม' },
            { field: 'temperature', thaiName: 'อุณหภูมิ', unit: '°C', description: 'อุณหภูมิขณะทำกิจกรรม' },
            { field: 'humidity', thaiName: 'ความชื้นสัมพัทธ์', unit: '%', description: 'ความชื้นขณะทำกิจกรรม' },
            { field: 'weather', thaiName: 'สภาพอากาศ', unit: null, description: 'SUNNY, CLOUDY, RAINY' },
        ],
    },
    {
        key: 'care-logs',
        model: 'CareLog',
        prismaModel: 'careLog',
        thaiName: 'บันทึกการดูแลรายต้น',
        description: 'เหตุการณ์ดูแลรายต้น (รดน้ำ ใส่ปุ๋ย พ่น ตัดแต่ง ตรวจ) พร้อมค่าการเจริญเติบโตที่วัดได้',
        where: {},
        fields: [
            { field: 'id', thaiName: 'รหัสรายการ', unit: null, description: 'UUID ของบันทึก' },
            { field: 'createdAt', thaiName: 'เวลาที่บันทึก', unit: 'ISO 8601', description: 'เวลาสร้างรายการในระบบ' },
            { field: 'logType', thaiName: 'ประเภทการดูแล', unit: null, description: 'WATERING, FERTILIZING, SPRAYING, PRUNING, INSPECTION, OTHER' },
            { field: 'logDate', thaiName: 'วันที่ดูแล', unit: 'ISO 8601', description: 'วันที่เหตุการณ์เกิดขึ้นจริง' },
            { field: 'height', thaiName: 'ความสูงต้น', unit: 'ซม.', description: 'ความสูงที่วัดได้ ณ วันบันทึก' },
            { field: 'leafCount', thaiName: 'จำนวนใบ', unit: 'ใบ', description: 'จำนวนใบที่นับได้' },
            { field: 'healthScore', thaiName: 'คะแนนสุขภาพต้น', unit: 'ระดับ 1-5', description: '1 = แย่มาก … 5 = สมบูรณ์มาก' },
        ],
    },
    {
        key: 'harvest-batches',
        model: 'HarvestBatch',
        prismaModel: 'harvestBatch',
        thaiName: 'รุ่นเก็บเกี่ยว',
        description: 'ข้อมูลดิบการเก็บเกี่ยวและแปรรูปต่อรุ่นผลิต: น้ำหนักสด/แห้ง/สูญเสีย ความชื้น เกรด และพารามิเตอร์การอบแห้ง',
        where: { isDeleted: false },
        fields: [
            { field: 'id', thaiName: 'รหัสรุ่น', unit: null, description: 'UUID ของรุ่นเก็บเกี่ยว' },
            { field: 'batchNumber', thaiName: 'เลขรุ่นผลิต', unit: null, description: 'เลขรุ่นสำหรับตรวจสอบย้อนกลับ เช่น LOT-2025-001' },
            { field: 'cycleId', thaiName: 'รหัสรอบปลูก', unit: null, description: 'UUID รอบปลูกต้นทาง' },
            { field: 'farmId', thaiName: 'รหัสฟาร์ม', unit: null, description: 'UUID ฟาร์ม' },
            { field: 'plantCode', thaiName: 'รหัสพืช', unit: null, description: 'รหัสชนิดสมุนไพร เช่น CAN (กัญชา), TUR (ขมิ้นชัน)' },
            { field: 'harvestDate', thaiName: 'วันที่เก็บเกี่ยว', unit: 'ISO 8601', description: 'วันเก็บเกี่ยวจริง' },
            { field: 'freshWeight', thaiName: 'น้ำหนักสด', unit: 'กก.', description: 'น้ำหนักหลังเก็บเกี่ยวทันที' },
            { field: 'dryWeight', thaiName: 'น้ำหนักแห้ง', unit: 'กก.', description: 'น้ำหนักหลังอบ/ตากแห้ง' },
            { field: 'lossWeight', thaiName: 'น้ำหนักสูญเสีย', unit: 'กก.', description: 'ส่วนที่สูญเสียระหว่างแปรรูป' },
            { field: 'moistureContent', thaiName: 'ความชื้นผลผลิต', unit: '%', description: 'ความชื้นที่วัดได้หลังแปรรูป' },
            { field: 'qualityGrade', thaiName: 'เกรดคุณภาพ', unit: null, description: 'A, B, C, REJECT' },
            { field: 'isDried', thaiName: 'อบแห้งแล้ว', unit: 'boolean', description: 'สถานะการอบแห้ง' },
            { field: 'dryingMethod', thaiName: 'วิธีอบแห้ง', unit: null, description: 'SUN_DRY, OVEN_DRY, DEHUMIDIFIER' },
            { field: 'dryingTemp', thaiName: 'อุณหภูมิอบ', unit: '°C', description: 'อุณหภูมิที่ใช้อบแห้ง' },
            { field: 'dryingDuration', thaiName: 'ระยะเวลาอบ', unit: 'ชั่วโมง', description: 'จำนวนชั่วโมงที่อบ' },
            { field: 'qcPassed', thaiName: 'ผ่าน QC', unit: 'boolean', description: 'ผลตรวจคุณภาพภายในฟาร์ม' },
            { field: 'status', thaiName: 'สถานะรุ่น', unit: null, description: 'RECEIVED, DRYING, PROCESSED, PACKED, SOLD' },
            { field: 'createdAt', thaiName: 'เวลาที่บันทึก', unit: 'ISO 8601', description: 'เวลาสร้างรายการในระบบ' },
        ],
    },
    {
        key: 'drying-temperatures',
        model: 'DryingTemperature',
        prismaModel: 'dryingTemperature',
        thaiName: 'บันทึกอุณหภูมิห้องอบแห้ง',
        description: 'ค่าอุณหภูมิ-ความชื้นของกระบวนการอบแห้งตามช่วงเวลา (ข้อมูลเชิงเซนเซอร์/การอ่านค่าอุปกรณ์)',
        where: {},
        fields: [
            { field: 'id', thaiName: 'รหัสรายการ', unit: null, description: 'UUID ของบันทึก' },
            { field: 'farmId', thaiName: 'รหัสฟาร์ม', unit: null, description: 'UUID ฟาร์ม' },
            { field: 'temperature', thaiName: 'อุณหภูมิ', unit: '°C', description: 'ค่าอุณหภูมิที่อ่านได้' },
            { field: 'humidity', thaiName: 'ความชื้นสัมพัทธ์', unit: '%', description: 'ค่าความชื้นที่อ่านได้พร้อมกัน' },
            { field: 'timestamp', thaiName: 'เวลาที่อ่านค่า', unit: 'ISO 8601', description: 'เวลาที่ค่าถูกวัดจริง' },
            { field: 'createdAt', thaiName: 'เวลาที่บันทึก', unit: 'ISO 8601', description: 'เวลาบันทึกเข้าระบบ' },
        ],
    },
    {
        key: 'drying-humidities',
        model: 'DryingHumidity',
        prismaModel: 'dryingHumidity',
        thaiName: 'บันทึกความชื้นห้องอบแห้ง',
        description: 'ค่าความชื้นของกระบวนการอบแห้งตามช่วงเวลา (ข้อมูลเชิงเซนเซอร์/การอ่านค่าอุปกรณ์)',
        where: {},
        fields: [
            { field: 'id', thaiName: 'รหัสรายการ', unit: null, description: 'UUID ของบันทึก' },
            { field: 'farmId', thaiName: 'รหัสฟาร์ม', unit: null, description: 'UUID ฟาร์ม' },
            { field: 'humidity', thaiName: 'ความชื้นสัมพัทธ์', unit: '%', description: 'ค่าความชื้นที่อ่านได้' },
            { field: 'timestamp', thaiName: 'เวลาที่อ่านค่า', unit: 'ISO 8601', description: 'เวลาที่ค่าถูกวัดจริง' },
            { field: 'createdAt', thaiName: 'เวลาที่บันทึก', unit: 'ISO 8601', description: 'เวลาบันทึกเข้าระบบ' },
        ],
    },
    {
        key: 'trace-scans',
        model: 'TraceQrScan',
        prismaModel: 'traceQrScan',
        thaiName: 'เหตุการณ์สแกน QR ตรวจสอบย้อนกลับ',
        description: 'บันทึกการสแกน QR สาธารณะต่อรายการ trace (ตัดข้อมูลระบุตัวผู้สแกนออกทั้งหมด เก็บเฉพาะเหตุการณ์และผลการตรวจ)',
        where: {},
        fields: [
            { field: 'id', thaiName: 'รหัสเหตุการณ์', unit: null, description: 'UUID ของการสแกน' },
            { field: 'createdAt', thaiName: 'เวลาสแกน', unit: 'ISO 8601', description: 'เวลาที่เกิดการสแกน' },
            { field: 'qrSecurityId', thaiName: 'รหัส QR', unit: null, description: 'UUID ของรายการ QR ที่ถูกสแกน' },
            { field: 'requestPath', thaiName: 'เส้นทางที่เรียก', unit: null, description: 'path ของ endpoint ที่ถูกเรียก (ไม่มีข้อมูลผู้ใช้)' },
            { field: 'verified', thaiName: 'ผลการตรวจลายเซ็น', unit: 'boolean', description: 'true = โซ่แฮช+ลายเซ็นถูกต้อง ณ เวลาสแกน' },
        ],
    },
    {
        key: 'survey-responses',
        model: 'SurveyResponse',
        prismaModel: 'surveyResponse',
        thaiName: 'คำตอบแบบสำรวจความต้องการ (long format)',
        description: 'คำตอบดิบจากแบบสำรวจความต้องการ 4 ภาค (ต้นแบบที่ 2) 1 แถวต่อ 1 คำตอบต่อคำถาม; ข้อความผ่านการปิดบังเลขบัตรก่อนจัดเก็บแล้ว',
        where: {},
        longFormat: true, // flatten answers[] → one row per answer
        extraModels: ['SurveyAnswer'], // long-format row = SurveyResponse ∪ SurveyAnswer fields
        fields: [
            { field: 'responseId', thaiName: 'รหัสชุดคำตอบ', unit: null, description: 'UUID ของชุดคำตอบ (SurveyResponse)' },
            { field: 'templateId', thaiName: 'รหัสแบบสำรวจ', unit: null, description: 'UUID ของแบบสำรวจ' },
            { field: 'region', thaiName: 'ภูมิภาค', unit: null, description: 'NORTH, CENTRAL, NORTHEAST, SOUTH (4 ภาคตามสัญญา)' },
            { field: 'province', thaiName: 'จังหวัด', unit: null, description: 'จังหวัดของผู้ตอบ (ถ้าระบุ)' },
            { field: 'respondentType', thaiName: 'กลุ่มผู้ตอบ', unit: null, description: 'FARMER, EXPERT, DTAM_STAFF, OPERATOR' },
            { field: 'submittedAt', thaiName: 'เวลาส่งคำตอบ', unit: 'ISO 8601', description: 'เวลาที่ posted' },
            { field: 'questionId', thaiName: 'รหัสคำถาม', unit: null, description: 'UUID ของคำถาม' },
            { field: 'valueText', thaiName: 'คำตอบข้อความ', unit: null, description: 'คำตอบชนิดข้อความ/ตัวเลือก (masked แล้ว); MULTI_CHOICE เป็น JSON array string' },
            { field: 'valueNumber', thaiName: 'คำตอบตัวเลข', unit: 'ตามชนิดคำถาม', description: 'คำตอบชนิดคะแนน (1-5) หรือตัวเลข' },
        ],
    },
];

module.exports = { DATASET_DOMAINS };
