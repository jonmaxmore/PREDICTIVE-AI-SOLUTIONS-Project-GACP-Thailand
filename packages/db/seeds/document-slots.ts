import {
  ACCEPTED_DOCUMENT_MIME_TYPES,
  DocumentSlotCode,
  type DocumentSlotDefinition,
  DocumentSlotGroup,
  SopSubItemCode,
} from '@gacp/contracts';

// ชุดช่องเอกสารตามแบบกัญชา กทล.1 ส่วนที่ ๓ + รายการตรวจของเจ้าหน้าที่ข้อ 1.1 (แผน §3, docs/glossary.md §4)
// หนึ่งช่อง = หนึ่งเอกสารที่กรมติ๊ก ทุกช่องมี "เอกสารนี้คืออะไร" และ "หาได้ที่ไหน" สำหรับผู้ขอรับรอง

const MEGABYTE = 1024 * 1024;
const DOCUMENT_MIME_TYPES = [
  ACCEPTED_DOCUMENT_MIME_TYPES.PDF,
  ACCEPTED_DOCUMENT_MIME_TYPES.JPEG,
  ACCEPTED_DOCUMENT_MIME_TYPES.PNG,
];
const PHOTO_MIME_TYPES = [
  ACCEPTED_DOCUMENT_MIME_TYPES.JPEG,
  ACCEPTED_DOCUMENT_MIME_TYPES.PNG,
  ACCEPTED_DOCUMENT_MIME_TYPES.WEBP,
];
const PLAN_MIME_TYPES = [ACCEPTED_DOCUMENT_MIME_TYPES.PDF, ACCEPTED_DOCUMENT_MIME_TYPES.DOCX];

type SlotInput = Omit<
  DocumentSlotDefinition,
  | 'acceptedMimeTypes'
  | 'maxFiles'
  | 'maxFileBytes'
  | 'requiresIssuedDate'
  | 'issuedWithinDays'
  | 'isLicense'
  | 'subItemCodes'
  | 'isSystemGenerated'
> &
  Partial<
    Pick<
      DocumentSlotDefinition,
      | 'acceptedMimeTypes'
      | 'maxFiles'
      | 'maxFileBytes'
      | 'requiresIssuedDate'
      | 'issuedWithinDays'
      | 'isLicense'
      | 'subItemCodes'
      | 'isSystemGenerated'
    >
  >;

function slot(input: SlotInput): DocumentSlotDefinition {
  return {
    acceptedMimeTypes: DOCUMENT_MIME_TYPES,
    maxFiles: 1,
    maxFileBytes: 10 * MEGABYTE,
    requiresIssuedDate: false,
    issuedWithinDays: null,
    isLicense: false,
    subItemCodes: null,
    isSystemGenerated: false,
    ...input,
  };
}

export const documentSlotSeeds: readonly DocumentSlotDefinition[] = [
  // ตัวตน (ทุกประเภทผู้ยื่น ทุกประเภทคำขอ)
  slot({
    code: DocumentSlotCode.NATIONAL_ID_COPY,
    group: DocumentSlotGroup.IDENTITY,
    formStep: 2,
    sortOrder: 10,
    labelTh: 'สำเนาบัตรประจำตัวประชาชน',
    whatIsItTh:
      'สำเนาหน้าบัตรประชาชนที่ยังไม่หมดอายุของผู้มีอำนาจลงนาม (ประธานวิสาหกิจ ผู้ขอรับรองบุคคลธรรมดา หรือกรรมการผู้มีอำนาจ) ลงนามรับรองสำเนาถูกต้อง',
    howToObtainTh: 'ถ่ายสำเนาจากบัตรจริง หรือใช้สำเนาอิเล็กทรอนิกส์จากแอป ThaID',
  }),
  slot({
    code: DocumentSlotCode.HOUSE_REGISTRATION_COPY,
    group: DocumentSlotGroup.IDENTITY,
    formStep: 2,
    sortOrder: 20,
    labelTh: 'สำเนาทะเบียนบ้าน',
    whatIsItTh: 'สำเนาทะเบียนบ้านหน้าแรกที่มีเลขรหัสประจำบ้าน และหน้าที่มีชื่อผู้มีอำนาจลงนาม แยกจากสำเนาบัตรประชาชน',
    howToObtainTh: 'ถ่ายสำเนาจากเล่มทะเบียนบ้าน หรือคัดสำเนาที่สำนักงานเขต/เทศบาล/อำเภอ',
  }),

  // คุณสมบัติตามประเภทผู้ขอรับรอง
  slot({
    code: DocumentSlotCode.COMMUNITY_ENTERPRISE_REGISTRATION,
    group: DocumentSlotGroup.QUALIFICATION,
    formStep: 2,
    sortOrder: 30,
    labelTh: 'หนังสือสำคัญแสดงการจดทะเบียนวิสาหกิจชุมชน',
    whatIsItTh: 'แบบ ท.ว.ช.2 หรือ ท.ว.ช.3 ที่สำนักงานเกษตรอำเภอออกให้ แสดงรหัสทะเบียน สวช.01 และชื่อวิสาหกิจ',
    howToObtainTh:
      'สำนักงานเกษตรอำเภอที่จดทะเบียนวิสาหกิจชุมชน หรือระบบสารสนเทศวิสาหกิจชุมชน (smce.doae.go.th)',
  }),
  slot({
    code: DocumentSlotCode.COMMUNITY_MEMBER_LIST,
    group: DocumentSlotGroup.QUALIFICATION,
    formStep: 2,
    sortOrder: 40,
    labelTh: 'บัญชีรายชื่อสมาชิกวิสาหกิจชุมชน',
    whatIsItTh: 'รายชื่อสมาชิกปัจจุบันฉบับที่ยื่นต่อสำนักงานเกษตรอำเภอ แยกจากหนังสือจดทะเบียน',
    howToObtainTh: 'ขอคัดสำเนาบัญชีรายชื่อสมาชิกล่าสุดที่สำนักงานเกษตรอำเภอ',
  }),
  slot({
    code: DocumentSlotCode.COMMUNITY_ASSIGNMENT_LETTER,
    group: DocumentSlotGroup.QUALIFICATION,
    formStep: 2,
    sortOrder: 50,
    labelTh: 'หนังสือมอบหมายให้ดำเนินกิจการแทนวิสาหกิจชุมชน',
    whatIsItTh: 'มติที่ประชุมหรือหนังสือที่ประธานลงนาม มอบหมายให้ดำเนินกิจการปลูกกัญชาในนามวิสาหกิจชุมชน',
    howToObtainTh: 'จัดทำจากมติที่ประชุมสมาชิก ลงนามโดยประธานและกรรมการตามข้อบังคับของวิสาหกิจ',
  }),
  slot({
    code: DocumentSlotCode.PRODUCER_SUPERVISION_LETTER,
    group: DocumentSlotGroup.QUALIFICATION,
    formStep: 2,
    sortOrder: 60,
    labelTh: 'หนังสือกำกับดูแลจากผู้รับอนุญาตผลิตยา',
    whatIsItTh:
      'หนังสือจากผู้รับอนุญาตผลิตยาแผนไทยหรือยาสมุนไพร ยืนยันว่ากำกับดูแลการปลูกของผู้ขอรับรองบุคคลธรรมดารายนี้',
    howToObtainTh: 'ขอจากสถานพยาบาลหรือผู้ผลิตยาที่มีใบอนุญาตผลิตยา ซึ่งรับผลผลิตของคุณ',
  }),
  slot({
    code: DocumentSlotCode.JURISTIC_REGISTRATION,
    group: DocumentSlotGroup.QUALIFICATION,
    formStep: 2,
    sortOrder: 70,
    labelTh: 'หนังสือรับรองการจดทะเบียนนิติบุคคล',
    whatIsItTh: 'หนังสือรับรองบริษัทหรือห้างหุ้นส่วนจากกรมพัฒนาธุรกิจการค้า ออกให้ไม่เกิน 6 เดือนก่อนวันยื่น',
    howToObtainTh: 'ขอผ่าน DBD e-Service (dbd.go.th) หรือสำนักงานพัฒนาธุรกิจการค้าจังหวัด',
    requiresIssuedDate: true,
    issuedWithinDays: 180,
  }),
  slot({
    code: DocumentSlotCode.JURISTIC_DIRECTOR_LIST,
    group: DocumentSlotGroup.QUALIFICATION,
    formStep: 2,
    sortOrder: 80,
    labelTh: 'บัญชีรายชื่อกรรมการหรือผู้ถือหุ้น',
    whatIsItTh: 'บัญชีรายชื่อกรรมการ (หรือ บอจ.5 สำหรับบริษัทจำกัด) ฉบับล่าสุด แยกจากหนังสือรับรอง',
    howToObtainTh: 'ขอผ่าน DBD e-Service พร้อมหนังสือรับรอง',
  }),
  slot({
    code: DocumentSlotCode.JURISTIC_AUTHORITY_LETTER,
    group: DocumentSlotGroup.QUALIFICATION,
    formStep: 2,
    sortOrder: 90,
    labelTh: 'หนังสือแสดงผู้มีอำนาจลงนาม',
    whatIsItTh: 'เอกสารแสดงว่าใครลงนามผูกพันนิติบุคคลได้ ตามเงื่อนไขในหนังสือรับรอง',
    howToObtainTh: 'ใช้หน้าเงื่อนไขการลงนามจากหนังสือรับรอง หรือมติกรรมการที่กำหนดผู้มีอำนาจ',
  }),

  // มอบอำนาจ (เมื่อผู้ยื่นเป็นผู้รับมอบอำนาจ)
  slot({
    code: DocumentSlotCode.POWER_OF_ATTORNEY,
    group: DocumentSlotGroup.POWER_OF_ATTORNEY,
    formStep: 2,
    sortOrder: 100,
    labelTh: 'หนังสือมอบอำนาจให้ยื่นคำขอ',
    whatIsItTh: 'ผู้มีอำนาจลงนามมอบอำนาจให้ผู้ยื่นดำเนินการยื่นคำขอรับรอง GACP ติดอากรแสตมป์ตามกฎหมาย',
    howToObtainTh:
      'ใช้แบบหนังสือมอบอำนาจทั่วไป ระบุขอบเขต "ยื่นคำขอรับรอง GACP" ลงนามทั้งผู้มอบและผู้รับมอบ พร้อมพยาน',
  }),
  slot({
    code: DocumentSlotCode.POA_GRANTOR_ID_COPY,
    group: DocumentSlotGroup.POWER_OF_ATTORNEY,
    formStep: 2,
    sortOrder: 110,
    labelTh: 'สำเนาบัตรประชาชนของผู้มอบอำนาจ',
    whatIsItTh: 'สำเนาบัตรของผู้ลงนามในหนังสือมอบอำนาจ ลงนามรับรองสำเนาถูกต้อง',
    howToObtainTh: 'ถ่ายสำเนาจากบัตรจริงของผู้มอบอำนาจ',
  }),

  // ที่ดินและสถานที่
  slot({
    code: DocumentSlotCode.LAND_RIGHTS_DOCUMENT,
    group: DocumentSlotGroup.LAND_AND_SITE,
    formStep: 3,
    sortOrder: 120,
    labelTh: 'สำเนาเอกสารสิทธิ์ที่ดิน',
    whatIsItTh: 'โฉนด น.ส.3 ส.ป.ก. หรือหนังสืออนุญาตใช้ที่ดินของรัฐ ทุกหน้าที่มีรายการจดทะเบียน เลขที่ต้องตรงกับที่กรอก',
    howToObtainTh: 'ถ่ายสำเนาจากฉบับเจ้าของที่ดิน หรือคัดสำเนาที่สำนักงานที่ดินจังหวัด/สาขา',
    maxFiles: 5,
  }),
  slot({
    code: DocumentSlotCode.LANDLORD_CONSENT_LETTER,
    group: DocumentSlotGroup.LAND_AND_SITE,
    formStep: 3,
    sortOrder: 130,
    labelTh: 'หนังสือยินยอมให้ใช้ที่ดินจากเจ้าของที่ดิน',
    whatIsItTh: 'เจ้าของที่ดินลงนามยินยอมให้ใช้ที่ดินเพื่อปลูกหรือแปรรูปกัญชาตามคำขอนี้ พร้อมระยะเวลา',
    howToObtainTh: 'ให้เจ้าของที่ดินลงนามในแบบหนังสือยินยอม พร้อมแนบสำเนาบัตรของผู้ให้ความยินยอมถ้ามี',
  }),
  slot({
    code: DocumentSlotCode.SITE_MAP_WITH_COORDINATES,
    group: DocumentSlotGroup.LAND_AND_SITE,
    formStep: 3,
    sortOrder: 140,
    labelTh: 'แผนที่แสดงที่ตั้ง พิกัด และเส้นทางเข้าถึง',
    whatIsItTh: 'แผนที่ที่เห็นถนนเข้าถึงและจุดพิกัดของแปลง ใช้ภาพจากแอปแผนที่ได้',
    howToObtainTh: 'บันทึกภาพจาก Google Maps หรือแอปแผนที่ พร้อมปักหมุดพิกัดที่กรอกไว้',
    acceptedMimeTypes: [...DOCUMENT_MIME_TYPES, ACCEPTED_DOCUMENT_MIME_TYPES.WEBP],
  }),
  slot({
    code: DocumentSlotCode.BUILDING_PLAN_AND_PHOTOS,
    group: DocumentSlotGroup.LAND_AND_SITE,
    formStep: 3,
    sortOrder: 150,
    labelTh: 'แปลนโรงเรือนและภาพถ่ายภายในภายนอก',
    whatIsItTh: 'แปลนแสดงขนาดห้องและระบบควบคุม พร้อมภาพถ่ายภายในและภายนอกอย่างละอย่างน้อย 1 ภาพ',
    howToObtainTh: 'แปลนจากผู้รับเหมาหรือวาดเองพร้อมระบุขนาด ภาพถ่ายจากมือถือ',
    acceptedMimeTypes: [...DOCUMENT_MIME_TYPES, ACCEPTED_DOCUMENT_MIME_TYPES.WEBP],
    maxFiles: 10,
  }),
  slot({
    code: DocumentSlotCode.FIELD_AND_SURROUNDINGS_PHOTOS,
    group: DocumentSlotGroup.LAND_AND_SITE,
    formStep: 3,
    sortOrder: 160,
    labelTh: 'ภาพถ่ายแปลงปลูกและบริเวณโดยรอบ',
    whatIsItTh: 'ภาพแปลงกลางแจ้งจาก 4 ทิศ และภาพบริเวณโดยรอบที่เห็นรั้วหรือแนวเขต',
    howToObtainTh: 'ถ่ายจากมือถือในวันที่อากาศแจ่มใส อย่างน้อย 2 ภาพ',
    acceptedMimeTypes: PHOTO_MIME_TYPES,
    maxFiles: 10,
  }),
  slot({
    code: DocumentSlotCode.PRODUCTION_SITE_PHOTOS,
    group: DocumentSlotGroup.LAND_AND_SITE,
    formStep: 3,
    sortOrder: 170,
    labelTh: 'ภาพถ่ายสถานที่ผลิตและเก็บเกี่ยว',
    whatIsItTh: 'พื้นที่เตรียมดินหรือปลูก พื้นที่เก็บเกี่ยว พื้นที่ทำแห้งและเก็บรักษา',
    howToObtainTh: 'ถ่ายจากมือถือให้เห็นแต่ละพื้นที่ชัดเจน',
    acceptedMimeTypes: PHOTO_MIME_TYPES,
    maxFiles: 10,
  }),

  // แผนงานและ SOP
  slot({
    code: DocumentSlotCode.PRODUCTION_AND_UTILISATION_PLAN,
    group: DocumentSlotGroup.PLANS,
    formStep: 5,
    sortOrder: 180,
    labelTh: 'แผนการผลิตและแผนการใช้ประโยชน์',
    whatIsItTh: 'ปฏิทินการปลูกต่อรอบ ปริมาณผลผลิตที่คาด และปลายทางของผลผลิต',
    howToObtainTh: 'เขียนเองตามหัวข้อที่ระบุ ไม่มีแบบฟอร์มบังคับ',
    acceptedMimeTypes: PLAN_MIME_TYPES,
  }),
  slot({
    code: DocumentSlotCode.SECURITY_MEASURES_PLAN,
    group: DocumentSlotGroup.PLANS,
    formStep: 5,
    sortOrder: 190,
    labelTh: 'มาตรการรักษาความปลอดภัยของสถานที่',
    whatIsItTh: 'รั้ว การควบคุมการเข้าออก กล้อง การเก็บรักษาผลผลิต และผู้รับผิดชอบ',
    howToObtainTh: 'เขียนเองตามหัวข้อที่ระบุ',
    acceptedMimeTypes: PLAN_MIME_TYPES,
  }),
  slot({
    code: DocumentSlotCode.RESIDUE_UTILISATION_PLAN,
    group: DocumentSlotGroup.PLANS,
    formStep: 5,
    sortOrder: 200,
    labelTh: 'วิธีนำส่วนที่เหลือจากการผลิตไปใช้ประโยชน์หรือทำลาย',
    whatIsItTh: 'ราก ลำต้น ใบที่ไม่ใช้ และเศษวัสดุ จะนำไปใช้อะไรหรือทำลายอย่างไร ใครควบคุม',
    howToObtainTh: 'เขียนเองตามหัวข้อที่ระบุ แยกจากมาตรการความปลอดภัย',
    acceptedMimeTypes: PLAN_MIME_TYPES,
  }),
  slot({
    code: DocumentSlotCode.SOP_MANUAL,
    group: DocumentSlotGroup.PLANS,
    formStep: 5,
    sortOrder: 210,
    labelTh: 'คู่มือการปฏิบัติงาน (SOP)',
    whatIsItTh: 'เล่มเดียวครอบคลุมทุกขั้นตอนตั้งแต่เตรียมพื้นที่จนถึงสุขาภิบาล เจ้าหน้าที่ตรวจทีละหัวข้อ',
    howToObtainTh: 'เขียนเองตามหัวข้อ 11 ข้อที่ระบบแสดง หรือปรับจากคู่มือ GACP ของกรม',
    acceptedMimeTypes: PLAN_MIME_TYPES,
    maxFileBytes: 20 * MEGABYTE,
    subItemCodes: Object.values(SopSubItemCode),
  }),

  // ใบอนุญาตสมุนไพรควบคุม (แนบตัวใบอนุญาตที่ออกแล้ว ไม่ใช่แบบคำขอ)
  slot({
    code: DocumentSlotCode.CONTROLLED_HERB_LICENSE_RESEARCH,
    group: DocumentSlotGroup.CONTROLLED_HERB_LICENSE,
    formStep: 5,
    sortOrder: 220,
    labelTh: 'ใบอนุญาตศึกษาวิจัยสมุนไพรควบคุม',
    whatIsItTh: 'ใบอนุญาตที่ออกจากคำขอ ภท.9 สำหรับการศึกษาวิจัยกัญชา',
    howToObtainTh:
      'ยื่นแบบ ภท.9 ที่สำนักงานสาธารณสุขจังหวัดที่สถานที่ตั้งอยู่ หรือกรมการแพทย์แผนไทยฯ สำหรับกรุงเทพมหานคร',
    requiresIssuedDate: true,
    isLicense: true,
    maxFiles: 2,
  }),
  slot({
    code: DocumentSlotCode.CONTROLLED_HERB_LICENSE_EXPORT,
    group: DocumentSlotGroup.CONTROLLED_HERB_LICENSE,
    formStep: 5,
    sortOrder: 230,
    labelTh: 'ใบอนุญาตส่งออกสมุนไพรควบคุม',
    whatIsItTh: 'ใบอนุญาตที่ออกจากคำขอ ภท.10 สำหรับการส่งออกกัญชา',
    howToObtainTh:
      'ยื่นแบบ ภท.10 ที่สำนักงานสาธารณสุขจังหวัดที่สถานที่ตั้งอยู่ หรือกรมการแพทย์แผนไทยฯ สำหรับกรุงเทพมหานคร เตรียมสำเนาบัตร ทะเบียนบ้าน หลักฐานสถานที่ และแผนการส่งออก',
    requiresIssuedDate: true,
    isLicense: true,
    maxFiles: 2,
  }),
  slot({
    code: DocumentSlotCode.CONTROLLED_HERB_LICENSE_COMMERCIAL,
    group: DocumentSlotGroup.CONTROLLED_HERB_LICENSE,
    formStep: 5,
    sortOrder: 240,
    labelTh: 'ใบอนุญาตจำหน่ายหรือแปรรูปสมุนไพรควบคุมเพื่อการค้า',
    whatIsItTh: 'ใบอนุญาตที่ออกจากคำขอ ภท.11 สำหรับการจำหน่ายหรือแปรรูปกัญชาเพื่อการค้า',
    howToObtainTh:
      'ยื่นแบบ ภท.11 ที่สำนักงานสาธารณสุขจังหวัดที่สถานที่ตั้งอยู่ หรือกรมการแพทย์แผนไทยฯ สำหรับกรุงเทพมหานคร',
    requiresIssuedDate: true,
    isLicense: true,
    maxFiles: 2,
  }),

  // ต่ออายุ
  slot({
    code: DocumentSlotCode.PREVIOUS_CERTIFICATE_ORIGINAL,
    group: DocumentSlotGroup.RENEWAL,
    formStep: 5,
    sortOrder: 250,
    labelTh: 'ใบรับรอง GACP ฉบับเดิม',
    whatIsItTh: 'ใบรับรองฉบับที่กำลังจะหมดอายุ ทั้งฉบับ',
    howToObtainTh: 'ดาวน์โหลดจากระบบนี้ถ้าออกผ่านระบบ หรือสแกนฉบับกระดาษ',
  }),
  slot({
    code: DocumentSlotCode.RENEWAL_CULTIVATION_PLAN,
    group: DocumentSlotGroup.RENEWAL,
    formStep: 5,
    sortOrder: 260,
    labelTh: 'แผนการปลูกรอบต่ออายุ',
    whatIsItTh: 'แผนการปลูกสำหรับรอบใบรับรองใหม่',
    howToObtainTh: 'เขียนเองตามหัวข้อที่ระบุ',
    acceptedMimeTypes: PLAN_MIME_TYPES,
  }),
  slot({
    code: DocumentSlotCode.RENEWAL_UTILISATION_PLAN,
    group: DocumentSlotGroup.RENEWAL,
    formStep: 5,
    sortOrder: 270,
    labelTh: 'แผนการใช้ประโยชน์รอบต่ออายุ',
    whatIsItTh: 'ปลายทางของผลผลิตในรอบใบรับรองใหม่',
    howToObtainTh: 'เขียนเองตามหัวข้อที่ระบุ',
    acceptedMimeTypes: PLAN_MIME_TYPES,
  }),
  slot({
    code: DocumentSlotCode.OPERATION_SUMMARY_REPORT,
    group: DocumentSlotGroup.RENEWAL,
    formStep: 5,
    sortOrder: 280,
    labelTh: 'รายงานสรุปผลการดำเนินงานรอบที่ผ่านมา',
    whatIsItTh: 'ผลผลิต การจำหน่าย ปัญหาที่พบ และการแก้ไข ตลอดอายุใบรับรองเดิม',
    howToObtainTh: 'สรุปจากบันทึกการปลูกของคุณ ระบบช่วยสรุปได้เมื่อใช้ระบบตรวจสอบย้อนกลับ',
    acceptedMimeTypes: PLAN_MIME_TYPES,
  }),

  // ใบแทน
  slot({
    code: DocumentSlotCode.POLICE_REPORT,
    group: DocumentSlotGroup.REPLACEMENT,
    formStep: 5,
    sortOrder: 290,
    labelTh: 'บันทึกประจำวันแจ้งความใบรับรองสูญหาย',
    whatIsItTh: 'บันทึกประจำวันจากสถานีตำรวจ ระบุว่าใบรับรอง GACP สูญหาย',
    howToObtainTh: 'แจ้งความที่สถานีตำรวจในท้องที่ หรือแจ้งความออนไลน์ผ่านระบบของสำนักงานตำรวจแห่งชาติ',
  }),
  slot({
    code: DocumentSlotCode.DAMAGED_CERTIFICATE,
    group: DocumentSlotGroup.REPLACEMENT,
    formStep: 5,
    sortOrder: 300,
    labelTh: 'ใบรับรองฉบับที่ชำรุด',
    whatIsItTh: 'ภาพหรือสแกนใบรับรองที่ชำรุด ให้เห็นเลขที่ใบรับรอง',
    howToObtainTh: 'ถ่ายภาพหรือสแกนฉบับที่ชำรุด',
    acceptedMimeTypes: [...DOCUMENT_MIME_TYPES, ACCEPTED_DOCUMENT_MIME_TYPES.WEBP],
  }),

  // ไม่บังคับ
  slot({
    code: DocumentSlotCode.WATER_TEST_RESULT,
    group: DocumentSlotGroup.OPTIONAL,
    formStep: 5,
    sortOrder: 310,
    labelTh: 'ผลตรวจคุณภาพน้ำ',
    whatIsItTh: 'ผลวิเคราะห์น้ำที่ใช้ปลูกจากห้องปฏิบัติการที่ได้รับการรับรอง',
    howToObtainTh:
      'ส่งตัวอย่างน้ำที่ห้องปฏิบัติการของกรมวิทยาศาสตร์การแพทย์ ศูนย์วิทยาศาสตร์การแพทย์ หรือห้องปฏิบัติการเอกชนที่ได้รับการรับรอง',
  }),
  slot({
    code: DocumentSlotCode.SOIL_TEST_RESULT,
    group: DocumentSlotGroup.OPTIONAL,
    formStep: 5,
    sortOrder: 320,
    labelTh: 'ผลตรวจคุณภาพดิน',
    whatIsItTh: 'ผลวิเคราะห์โลหะหนักและสารตกค้างในดิน',
    howToObtainTh: 'ส่งตัวอย่างดินที่กรมพัฒนาที่ดิน หรือห้องปฏิบัติการที่ได้รับการรับรอง',
  }),
  slot({
    code: DocumentSlotCode.LAB_CERTIFICATE,
    group: DocumentSlotGroup.OPTIONAL,
    formStep: 5,
    sortOrder: 330,
    labelTh: 'ใบรับรองผลวิเคราะห์ผลผลิต',
    whatIsItTh: 'ผลวิเคราะห์ผลผลิตรอบก่อน (COA) ถ้ามี',
    howToObtainTh: 'จากห้องปฏิบัติการที่วิเคราะห์ผลผลิตของคุณ',
    maxFiles: 5,
  }),
  slot({
    code: DocumentSlotCode.ADDITIONAL_DOCUMENTS,
    group: DocumentSlotGroup.OPTIONAL,
    formStep: 5,
    sortOrder: 340,
    labelTh: 'เอกสารเพิ่มเติม',
    whatIsItTh: 'สิ่งที่คุณอยากให้เจ้าหน้าที่เห็นเพิ่มเติม ไม่มีผลต่อการส่งคำขอ',
    howToObtainTh: null,
    acceptedMimeTypes: [
      ...DOCUMENT_MIME_TYPES,
      ...PLAN_MIME_TYPES,
      ACCEPTED_DOCUMENT_MIME_TYPES.WEBP,
    ],
    maxFiles: 5,
  }),

  // ระบบสร้าง
  slot({
    code: DocumentSlotCode.KATORLOR1_GENERATED,
    group: DocumentSlotGroup.GENERATED,
    formStep: 6,
    sortOrder: 900,
    labelTh: 'แบบกัญชา กทล.1 ที่ระบบประกอบ',
    whatIsItTh: 'แบบคำขอฉบับที่จะยื่นจริง ระบบประกอบจากข้อมูลที่กรอก อัปเดตเองเมื่อแก้ข้อมูล',
    howToObtainTh: null,
    acceptedMimeTypes: [ACCEPTED_DOCUMENT_MIME_TYPES.PDF],
    isSystemGenerated: true,
  }),
];
