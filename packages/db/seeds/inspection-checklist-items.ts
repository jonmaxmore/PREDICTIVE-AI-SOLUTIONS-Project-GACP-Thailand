import { InspectionChecklistCategory, type InspectionChecklistItem } from '@gacp/contracts';

// รายการตรวจ ณ แปลง ฉบับร่าง อิงโครง GACP (มกษ. 3502-2561, WHO GACP) + ข้อกำหนดกัญชา
// ต้องยืนยันข้อความและข้อ critical กับกรมก่อนเปิดใช้จริง (แผน §11 ข้อ 7) แก้ = ปิด effectiveTo แล้วเพิ่มแถวใหม่

const PLANT = 'cannabis';
const EFFECTIVE_FROM = '2026-09-09';
const SOURCE = 'ร่างอิง มกษ. 3502-2561 และ WHO GACP · รอยืนยันกับกรม';

type ItemInput = {
  readonly code: string;
  readonly category: InspectionChecklistCategory;
  readonly textTh: string;
  readonly guidanceTh?: string;
  readonly isCritical?: boolean;
  readonly requiresPhotoEvidence?: boolean;
};

function items(inputs: readonly ItemInput[]): InspectionChecklistItem[] {
  return inputs.map((input, index) => ({
    code: `CHECK_${input.code}`,
    plantCode: PLANT,
    category: input.category,
    sortOrder: (index + 1) * 10,
    textTh: input.textTh,
    guidanceTh: input.guidanceTh ?? null,
    isCritical: input.isCritical ?? false,
    requiresPhotoEvidence: input.requiresPhotoEvidence ?? input.isCritical ?? false,
    sourceTh: SOURCE,
    effectiveFrom: EFFECTIVE_FROM,
    effectiveTo: null,
  }));
}

const C = InspectionChecklistCategory;

export const inspectionChecklistItemSeeds: readonly InspectionChecklistItem[] = items([
  {
    code: 'SITE_MATCHES_APPLICATION',
    category: C.SITE_AND_ENVIRONMENT,
    textTh: 'ที่ตั้ง พิกัด และขนาดพื้นที่ตรงกับคำขอและเอกสารสิทธิ์',
    isCritical: true,
  },
  {
    code: 'SITE_NO_CONTAMINATION_RISK',
    category: C.SITE_AND_ENVIRONMENT,
    textTh: 'พื้นที่ไม่มีแหล่งปนเปื้อนใกล้เคียง (โรงงาน ถนนใหญ่ ที่ทิ้งขยะ น้ำเสีย)',
    requiresPhotoEvidence: true,
  },
  {
    code: 'SITE_HISTORY_KNOWN',
    category: C.SITE_AND_ENVIRONMENT,
    textTh: 'มีประวัติการใช้พื้นที่ย้อนหลังและไม่พบการใช้สารต้องห้าม',
  },

  {
    code: 'WATER_SOURCE_IDENTIFIED',
    category: C.WATER,
    textTh: 'ระบุแหล่งน้ำที่ใช้ปลูกชัดเจน และแหล่งน้ำไม่รับน้ำเสียโดยตรง',
    isCritical: true,
  },
  {
    code: 'WATER_QUALITY_RECORD',
    category: C.WATER,
    textTh: 'มีผลตรวจหรือบันทึกคุณภาพน้ำตามความเสี่ยงของแหล่งน้ำ',
  },

  {
    code: 'PLANTING_MATERIAL_SOURCE_RECORDED',
    category: C.PLANTING_MATERIAL,
    textTh: 'เมล็ดหรือส่วนขยายพันธุ์มีบันทึกแหล่งที่มาและตรงกับพันธุ์ในคำขอ',
    isCritical: true,
  },
  {
    code: 'PLANTING_MATERIAL_HEALTHY',
    category: C.PLANTING_MATERIAL,
    textTh: 'วัสดุขยายพันธุ์ปราศจากโรคและศัตรูพืชที่มองเห็นได้',
    requiresPhotoEvidence: true,
  },

  {
    code: 'CULTIVATION_FOLLOWS_SOP',
    category: C.CULTIVATION_PRACTICE,
    textTh: 'การปลูกและดูแลปฏิบัติตามคู่มือ SOP ที่ยื่น',
    isCritical: true,
  },
  {
    code: 'CULTIVATION_ACTIVITY_LOG',
    category: C.CULTIVATION_PRACTICE,
    textTh: 'มีบันทึกกิจกรรมการปลูก (วันที่ กิจกรรม ผู้ปฏิบัติ) ต่อเนื่อง',
  },

  {
    code: 'FERTILISER_APPROVED_ONLY',
    category: C.FERTILISER_AND_SOIL,
    textTh: 'ปุ๋ยและสารปรับปรุงดินที่ใช้เป็นชนิดที่อนุญาต และมีบันทึกการใช้',
  },
  {
    code: 'FERTILISER_STORAGE_SEPARATED',
    category: C.FERTILISER_AND_SOIL,
    textTh: 'ปุ๋ยเก็บแยกจากผลผลิตและวัสดุขยายพันธุ์',
    requiresPhotoEvidence: true,
  },

  {
    code: 'PLANT_PROTECTION_NO_PROHIBITED',
    category: C.PLANT_PROTECTION,
    textTh: 'ไม่ใช้สารป้องกันกำจัดศัตรูพืชที่ห้ามใช้ และมีบันทึกชนิด ปริมาณ วันที่ใช้ ระยะก่อนเก็บเกี่ยว',
    isCritical: true,
  },
  {
    code: 'PLANT_PROTECTION_PPE',
    category: C.PLANT_PROTECTION,
    textTh: 'ผู้ปฏิบัติงานมีอุปกรณ์ป้องกันส่วนบุคคลและได้รับการอบรมการใช้สาร',
  },

  {
    code: 'HARVEST_TIMING_RECORDED',
    category: C.HARVEST,
    textTh: 'บันทึกวันเก็บเกี่ยว น้ำหนัก และผู้เก็บเกี่ยวทุกครั้ง',
    isCritical: true,
  },
  {
    code: 'HARVEST_CLEAN_TOOLS',
    category: C.HARVEST,
    textTh: 'เครื่องมือและภาชนะเก็บเกี่ยวสะอาด ไม่ปนเปื้อน',
    requiresPhotoEvidence: true,
  },

  {
    code: 'POST_HARVEST_DRYING_CONTROLLED',
    category: C.POST_HARVEST_AND_PRIMARY_PROCESSING,
    textTh: 'การทำแห้งควบคุมอุณหภูมิและความชื้น มีบันทึก',
    requiresPhotoEvidence: true,
  },
  {
    code: 'POST_HARVEST_NO_CROSS_CONTAMINATION',
    category: C.POST_HARVEST_AND_PRIMARY_PROCESSING,
    textTh: 'พื้นที่แปรรูปเบื้องต้นแยกจากพื้นที่ปลูกและไม่ปนเปื้อนข้าม',
    isCritical: true,
  },

  {
    code: 'PACKAGING_FOOD_GRADE',
    category: C.PACKAGING_AND_LABELLING,
    textTh: 'บรรจุภัณฑ์สะอาด เหมาะกับสมุนไพร และไม่เคยใช้กับสารเคมี',
  },
  {
    code: 'LABEL_BATCH_IDENTIFIED',
    category: C.PACKAGING_AND_LABELLING,
    textTh: 'ฉลากระบุชื่อฟาร์ม รุ่นเก็บเกี่ยว วันที่ และน้ำหนัก',
    isCritical: true,
  },

  {
    code: 'STORAGE_CONDITIONS',
    category: C.STORAGE_AND_TRANSPORT,
    textTh: 'พื้นที่เก็บรักษาแห้ง สะอาด ป้องกันสัตว์และแมลง ควบคุมอุณหภูมิความชื้นตามสมควร',
    requiresPhotoEvidence: true,
  },
  {
    code: 'STORAGE_ACCESS_CONTROLLED',
    category: C.STORAGE_AND_TRANSPORT,
    textTh: 'พื้นที่เก็บรักษาผลผลิตกัญชาล็อกและควบคุมการเข้าถึง',
    isCritical: true,
  },

  {
    code: 'PERSONNEL_HYGIENE_FACILITIES',
    category: C.PERSONNEL_HYGIENE,
    textTh: 'มีที่ล้างมือ ห้องน้ำ และอุปกรณ์สุขอนามัยสำหรับผู้ปฏิบัติงาน',
  },
  {
    code: 'PERSONNEL_HEALTH_AND_TRAINING',
    category: C.PERSONNEL_HYGIENE,
    textTh: 'ผู้ปฏิบัติงานได้รับการอบรม GACP และไม่มีโรคติดต่อขณะปฏิบัติงาน',
  },

  {
    code: 'FACILITY_CLEAN_AND_MAINTAINED',
    category: C.FACILITIES_AND_EQUIPMENT,
    textTh: 'อาคาร โรงเรือน และเครื่องมือสะอาด บำรุงรักษา และมีบันทึกการทำความสะอาด',
    requiresPhotoEvidence: true,
  },
  {
    code: 'EQUIPMENT_CALIBRATION',
    category: C.FACILITIES_AND_EQUIPMENT,
    textTh: 'เครื่องชั่งและเครื่องวัดที่มีผลต่อคุณภาพได้รับการสอบเทียบตามกำหนด',
  },

  {
    code: 'RECORDS_COMPLETE',
    category: C.DOCUMENTATION_AND_TRACEABILITY,
    textTh: 'บันทึกทุกขั้นตอนครบและตรวจสอบย้อนกลับได้จากรุ่นเก็บเกี่ยวถึงแปลง',
    isCritical: true,
  },
  {
    code: 'RECORDS_RETENTION',
    category: C.DOCUMENTATION_AND_TRACEABILITY,
    textTh: 'เก็บบันทึกไว้อย่างน้อยตามระยะที่กรมกำหนด และเรียกดูได้ทันที',
  },
  {
    code: 'COMPLAINT_AND_RECALL_PROCEDURE',
    category: C.DOCUMENTATION_AND_TRACEABILITY,
    textTh: 'มีขั้นตอนรับข้อร้องเรียนและเรียกคืนผลผลิต',
  },

  {
    code: 'SECURITY_PERIMETER',
    category: C.SECURITY_AND_ACCESS_CONTROL,
    textTh: 'มีรั้วหรือแนวเขตและการควบคุมการเข้าออกพื้นที่ปลูกกัญชาตามมาตรการที่ยื่น',
    isCritical: true,
  },
  {
    code: 'SECURITY_SURVEILLANCE',
    category: C.SECURITY_AND_ACCESS_CONTROL,
    textTh: 'มีกล้องวงจรปิดหรือมาตรการเฝ้าระวังตามที่ระบุในมาตรการความปลอดภัย',
    requiresPhotoEvidence: true,
  },
  {
    code: 'SECURITY_RESIDUE_DISPOSAL',
    category: C.SECURITY_AND_ACCESS_CONTROL,
    textTh: 'ส่วนที่เหลือจากการผลิตถูกจัดการหรือทำลายตามวิธีที่ยื่น มีบันทึก',
    isCritical: true,
  },
]);
