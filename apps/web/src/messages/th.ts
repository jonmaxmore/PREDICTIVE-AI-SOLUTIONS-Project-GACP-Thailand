import {
  ApplicantType,
  type ApplicationFormStep,
  AreaType,
  CertificationScope,
  type DocumentSlotCode,
  FeeStage,
  LandTenure,
  LicenseDeclarationStatus,
  MaterialOrigin,
  PlantMaterialKind,
  Purpose,
  RequestType,
  SopSubItemCode,
  UserRole,
} from '@gacp/contracts';
import { LicenseSlotState, UploadRejectionCode } from '@gacp/domain';

// ข้อความไทยทุกชิ้นบนหน้าจออยู่ที่นี่ ไม่อยู่ใน component ไม่โชว์ raw enum ให้ผู้ใช้เห็น

export const requestTypeLabels: Record<RequestType, string> = {
  [RequestType.NEW]: 'ขอรับรองครั้งแรก',
  [RequestType.RENEWAL]: 'ต่ออายุใบรับรอง',
  [RequestType.REPLACEMENT]: 'ขอใบแทน',
};

export const requestTypeDescriptions: Record<RequestType, string> = {
  [RequestType.NEW]: 'ยังไม่เคยมีใบรับรอง GACP สำหรับสถานที่นี้',
  [RequestType.RENEWAL]: 'ใบเดิมใกล้หมดอายุ ใช้ชุดเอกสารต่ออายุ',
  [RequestType.REPLACEMENT]: 'ใบเดิมสูญหายหรือชำรุด',
};

export const certificationScopeLabels: Record<CertificationScope, string> = {
  [CertificationScope.CULTIVATION]: 'แหล่งปลูกและเก็บเกี่ยว',
  [CertificationScope.PROCESSING]: 'แปรรูปเบื้องต้น',
};

export const certificationScopeDescriptions: Record<CertificationScope, string> = {
  [CertificationScope.CULTIVATION]: 'รับรองการปลูก ดูแล และเก็บเกี่ยวกัญชา ณ สถานที่ปลูก',
  [CertificationScope.PROCESSING]:
    'ตัดแต่ง ทำแห้ง บรรจุ ณ สถานที่แปรรูป (ต้องมีใบอนุญาตจำหน่ายหรือแปรรูปเพื่อการค้า)',
};

export const applicantTypeLabels: Record<ApplicantType, string> = {
  [ApplicantType.COMMUNITY_ENTERPRISE]: 'วิสาหกิจชุมชน',
  [ApplicantType.INDIVIDUAL]: 'บุคคลธรรมดา',
  [ApplicantType.JURISTIC_PERSON]: 'นิติบุคคล',
};

export const applicantTypeDescriptions: Record<ApplicantType, string> = {
  [ApplicantType.COMMUNITY_ENTERPRISE]: 'ข้อ ๑.๑ · มีรหัสทะเบียน สวช.01 ประธานเป็นผู้ลงนาม',
  [ApplicantType.INDIVIDUAL]: 'ข้อ ๑.๒ · ต้องมีหนังสือกำกับจากผู้รับอนุญาตผลิตยา',
  [ApplicantType.JURISTIC_PERSON]: 'ข้อ ๑.๓ · หนังสือรับรองบริษัทออกไม่เกิน 6 เดือน',
};

export const areaTypeLabels: Record<AreaType, string> = {
  [AreaType.OUTDOOR]: 'กลางแจ้ง',
  [AreaType.INDOOR]: 'อาคารหรือโรงเรือนระบบปิด',
  [AreaType.GREENHOUSE]: 'โรงเรือนทั่วไป',
  [AreaType.OTHER]: 'อื่น ๆ',
};

// ชื่อสั้นสำหรับบรรทัดในใบเสนอราคาและป้ายกำกับ
export const areaTypeShortLabels: Record<AreaType, string> = {
  [AreaType.OUTDOOR]: 'กลางแจ้ง',
  [AreaType.INDOOR]: 'โรงเรือนระบบปิด',
  [AreaType.GREENHOUSE]: 'โรงเรือนทั่วไป',
  [AreaType.OTHER]: 'อื่น ๆ',
};

export const landTenureLabels: Record<LandTenure, string> = {
  [LandTenure.OWNED]: 'เป็นเจ้าของ',
  [LandTenure.STATE_PERMITTED]: 'ได้รับอนุญาตให้ใช้ที่ดินของรัฐ',
  [LandTenure.RENTED]: 'เช่าที่ดิน',
  [LandTenure.OWNER_PERMITTED]: 'ขอใช้ที่ดินของผู้อื่นโดยไม่เช่า',
};

export const purposeLabels: Record<Purpose, string> = {
  [Purpose.MEDICAL]: 'เพื่อประโยชน์ทางการแพทย์',
  [Purpose.EXPORT]: 'เพื่อการส่งออก',
};

export const plantMaterialKindLabels: Record<PlantMaterialKind, string> = {
  [PlantMaterialKind.SEED]: 'เมล็ด',
  [PlantMaterialKind.OTHER_PART]: 'ส่วนอื่นที่ไม่ใช่เมล็ด',
  [PlantMaterialKind.PROCESSING_PART]: 'ส่วนที่ใช้แปรรูป',
};

export const materialOriginLabels: Record<MaterialOrigin, string> = {
  [MaterialOrigin.DOMESTIC]: 'ในประเทศ',
  [MaterialOrigin.IMPORTED]: 'นำเข้า',
};

export const licenseDeclarationStatusLabels: Record<LicenseDeclarationStatus, string> = {
  [LicenseDeclarationStatus.HAVE]: 'แนบใบอนุญาตแล้ว',
  [LicenseDeclarationStatus.APPLIED]: 'ยื่นคำขอแล้วรอผล',
  [LicenseDeclarationStatus.NONE]: 'ยังไม่ได้ยื่น',
};

// สถานะการ์ดใบอนุญาตที่ระบบตัดสินจากสถานะที่แจ้ง + ไฟล์ที่แนบ (domain licenseSlotState)
export const licenseSlotStateLabels: Record<LicenseSlotState, string> = {
  [LicenseSlotState.ATTACHED]: 'แนบใบอนุญาตแล้ว',
  [LicenseSlotState.PENDING_DECISION]: 'ยื่นคำขอแล้วรอผล',
  [LicenseSlotState.NOT_FILED]: 'ยังไม่ได้ยื่น',
  [LicenseSlotState.UNDECLARED]: 'ยังไม่ได้แจ้งสถานะ',
};

// ชื่อแบบคำขอของกรมที่ใบอนุญาตแต่ละช่องมาจาก (ภท. เป็นชื่อแบบคำขอ ไม่ใช่ชื่อช่อง)
export const controlledHerbLicenseFormLabels: Partial<Record<DocumentSlotCode, string>> = {
  CONTROLLED_HERB_LICENSE_RESEARCH: 'จากคำขอ ภท.9',
  CONTROLLED_HERB_LICENSE_EXPORT: 'จากคำขอ ภท.10',
  CONTROLLED_HERB_LICENSE_COMMERCIAL: 'จากคำขอ ภท.11',
};

export const feeStageLabels: Record<FeeStage, string> = {
  [FeeStage.DOCUMENT_REVIEW]: 'งวดที่ 1',
  [FeeStage.ONSITE_INSPECTION]: 'งวดที่ 2',
};

export const sopSubItemLabels: Record<SopSubItemCode, string> = {
  [SopSubItemCode.SITE_PREPARATION]: 'การเตรียมพื้นที่',
  [SopSubItemCode.PLANTING]: 'การปลูก',
  [SopSubItemCode.CROP_CARE]: 'การดูแลรักษา',
  [SopSubItemCode.PEST_MANAGEMENT]: 'การจัดการศัตรูพืช',
  [SopSubItemCode.FERTILISER_AND_SOIL_AMENDMENT]: 'ปุ๋ยและสารปรับปรุงดิน',
  [SopSubItemCode.HARVEST]: 'การเก็บเกี่ยว',
  [SopSubItemCode.STORAGE]: 'การเก็บรักษา',
  [SopSubItemCode.PRIMARY_PROCESSING]: 'การแปรรูปเบื้องต้น',
  [SopSubItemCode.PERSONNEL_HYGIENE]: 'สุขอนามัยบุคลากร',
  [SopSubItemCode.TRACEABILITY]: 'การตามสอบ',
  [SopSubItemCode.SITE_SANITATION]: 'สุขาภิบาลสถานที่',
};

export const formStepTitles: Record<ApplicationFormStep, string> = {
  1: 'ประเภทคำขอและผู้ยื่น',
  2: 'ตัวตนผู้ขอรับรอง',
  3: 'สถานที่และที่ดิน',
  4: 'พันธุ์และวัตถุประสงค์',
  5: 'แผนงาน SOP และใบอนุญาต',
  6: 'ตรวจทานและส่ง',
};

export const formStepRailLabels: Record<ApplicationFormStep, readonly [string, string]> = {
  1: ['ประเภทคำขอ', 'และผู้ยื่น'],
  2: ['ตัวตน', ''],
  3: ['สถานที่', 'และที่ดิน'],
  4: ['พันธุ์และ', 'วัตถุประสงค์'],
  5: ['แผนงาน SOP', 'ใบอนุญาต'],
  6: ['ตรวจทาน', 'และส่ง'],
};

export const uploadRejectionMessages: Record<UploadRejectionCode, string> = {
  [UploadRejectionCode.EMPTY_FILE]: 'ไฟล์ว่าง กรุณาเลือกไฟล์ที่มีข้อมูล',
  [UploadRejectionCode.TOO_LARGE]: 'ไฟล์ใหญ่เกินขนาดที่ช่องนี้รับได้',
  [UploadRejectionCode.MIME_NOT_ALLOWED]: 'ช่องนี้ไม่รับไฟล์ชนิดนี้ ดูชนิดที่รับได้ใต้ช่อง',
  [UploadRejectionCode.CONTENT_MISMATCH]:
    'เนื้อไฟล์ไม่ตรงกับชนิดที่ระบุ (เช่น เปลี่ยนนามสกุลไฟล์) กรุณาบันทึกไฟล์ใหม่จากโปรแกรมต้นทาง',
  [UploadRejectionCode.TOO_MANY_FILES]: 'ช่องนี้มีไฟล์ครบจำนวนแล้ว ลบไฟล์เดิมก่อนเพิ่มไฟล์ใหม่',
  [UploadRejectionCode.ISSUED_DATE_REQUIRED]: 'ช่องนี้ต้องระบุวันที่ออกเอกสาร',
  [UploadRejectionCode.SYSTEM_GENERATED_SLOT]: 'เอกสารนี้ระบบสร้างให้เอง ไม่ต้องอัปโหลด',
};

export const roleLabels: Record<UserRole, string> = {
  [UserRole.APPLICANT]: 'ผู้ขอรับรอง',
  [UserRole.FINANCE_OFFICER]: 'เจ้าหน้าที่การเงิน',
  [UserRole.DISPATCHER]: 'ผู้จัดคิวงาน',
  [UserRole.DOCUMENT_REVIEWER]: 'ผู้ตรวจเอกสาร',
  [UserRole.FIELD_INSPECTOR]: 'ผู้ตรวจประเมินแปลง',
  [UserRole.CERTIFICATE_APPROVER]: 'ผู้อนุมัติออกใบรับรอง',
  [UserRole.SYSTEM_ADMIN]: 'ผู้ดูแลระบบ',
};

export const roleHomeIntro: Record<UserRole, string> = {
  [UserRole.APPLICANT]: 'คำขอรับรอง GACP ของคุณและการชำระเงินจะอยู่ที่นี่',
  [UserRole.FINANCE_OFFICER]: 'ยอดรับชำระ ใบเสร็จ และการคืนเงิน ดูยอดเท่านั้น ไม่มีปุ่มเปลี่ยนสถานะคำขอ',
  [UserRole.DISPATCHER]: 'คิวคำขอที่รอมอบให้ผู้ตรวจเอกสารและผู้ตรวจประเมินแปลง',
  [UserRole.DOCUMENT_REVIEWER]: 'เคสที่ได้รับมอบให้ตรวจเอกสารตามแบบ กทล.1 รายช่อง',
  [UserRole.FIELD_INSPECTOR]: 'นัดตรวจและบันทึกหลักฐาน ณ แปลงปลูก',
  [UserRole.CERTIFICATE_APPROVER]: 'รายงานตรวจที่รอการอนุมัติออกใบรับรอง',
  [UserRole.SYSTEM_ADMIN]: 'ผู้ใช้ บทบาท และกติกาที่เป็นข้อมูล (ไม่มีสิทธิ์เงินและการตัดสินคำขอ)',
};

export const messages = {
  appName: 'GACP',
  appTagline: 'ระบบรับรองมาตรฐานแหล่งผลิต เก็บเกี่ยว และแปรรูปพืชกัญชา',
  login: {
    title: 'เข้าสู่ระบบ',
    thaidNotReady:
      'การเข้าสู่ระบบด้วย ThaID และหมอพร้อมยังไม่เปิดใช้ ระบบรอการเชื่อมต่อจากหน่วยงานผู้ให้บริการยืนยันตัวตน',
    devTitle: 'เข้าสู่ระบบแบบทดสอบ (เฉพาะเครื่องพัฒนา)',
    devDescription: 'เลือกบทบาทเพื่อดูหน้าจอของบทบาทนั้น ไม่มีการตรวจสอบตัวตนจริง และเปิดใช้ไม่ได้ใน production',
    displayNameLabel: 'ชื่อที่จะแสดง',
    displayNamePlaceholder: 'เช่น สมพร ตัวอย่างดี',
    roleLabel: 'บทบาท',
    submit: 'เข้าสู่ระบบ',
    displayNameRequired: 'กรุณากรอกชื่อที่จะแสดง แล้วลองอีกครั้ง',
    roleRequired: 'กรุณาเลือกบทบาท แล้วลองอีกครั้ง',
  },
  shell: {
    signedInAs: 'เข้าสู่ระบบในนาม',
    logout: 'ออกจากระบบ',
    roleBadge: 'บทบาท',
  },
  emptyState: {
    title: 'ยังไม่มีรายการในขั้นนี้',
    description: 'เมื่องานส่วนนี้พร้อมใช้ รายการจะแสดงที่นี่',
  },
  forbidden: {
    title: 'บทบาทของคุณไม่มีสิทธิ์เข้าหน้านี้',
    description: 'กลับไปหน้าหลักของบทบาทคุณ หรือออกจากระบบแล้วเข้าใหม่ด้วยบทบาทที่ถูกต้อง',
    backHome: 'กลับหน้าหลัก',
  },
  notFound: {
    title: 'ไม่พบหน้าที่ต้องการ',
    description: 'ตรวจสอบลิงก์อีกครั้ง หรือกลับไปหน้าหลัก',
  },
  verify: {
    title: 'ตรวจสอบใบรับรอง',
    notIssuedYet: 'ยังไม่มีใบรับรองเลขที่นี้ในระบบ',
    notIssuedDescription:
      'ถ้าคุณได้รับใบรับรองที่อ้างเลขนี้ กรุณาติดต่อกรมการแพทย์แผนไทยและการแพทย์ทางเลือกเพื่อยืนยัน',
  },
  applicantHome: {
    title: 'คำขอรับรองของคุณ',
    intro: 'คำขอรับรอง GACP ของคุณและการชำระเงินจะอยู่ที่นี่',
    startNew: 'เริ่มคำขอใหม่',
    startNewHint: 'กรอกได้ทีละขั้น ระบบบันทึกร่างอัตโนมัติ กลับมาทำต่อได้ทุกเมื่อ',
    noApplications: 'คุณยังไม่มีคำขอ',
    columns: {
      reference: 'เลขคำขอ',
      requestType: 'ประเภท',
      status: 'สถานะ',
      updatedAt: 'แก้ไขล่าสุด',
    },
    continueDraft: 'ทำต่อ',
    open: 'เปิดดู',
    newTitle: 'เริ่มคำขอใหม่',
    newLead: 'ตอบ 4 คำถามในขั้นนี้ ระบบจะสร้างร่างคำขอและบอกว่าต้องเตรียมเอกสารอะไรบ้าง',
    notEditableNotice: 'คำขอนี้ยื่นแล้ว แก้ไขในฟอร์มไม่ได้ ถ้าเจ้าหน้าที่ขอเอกสารเพิ่ม ระบบจะเปิดช่องนั้นให้',
    plantColumn: 'พืช',
  },
  applicationStatus: {
    DRAFT: 'ร่าง',
    AWAITING_DOCUMENT_REVIEW_FEE: 'รอชำระค่าตรวจเอกสาร',
    SUBMITTED: 'ยื่นแล้ว รอมอบผู้ตรวจ',
    UNDER_DOCUMENT_REVIEW: 'อยู่ระหว่างตรวจเอกสาร',
    REVISION_REQUESTED: 'รอคุณส่งเอกสารเพิ่ม',
    DOCUMENTS_ACCEPTED: 'รับคำขอแล้ว',
    AWAITING_INSPECTION_FEE: 'รอชำระค่าตรวจประเมิน ณ แปลง',
    AWAITING_INSPECTION: 'รอมอบผู้ตรวจแปลง',
    INSPECTION_SCHEDULED: 'นัดตรวจแปลงแล้ว',
    UNDER_INSPECTION: 'อยู่ระหว่างตรวจแปลง',
    AWAITING_APPROVAL: 'รอการอนุมัติ',
    CERTIFIED: 'ได้รับใบรับรอง',
    REJECTED: 'ไม่รับคำขอ',
    NOT_CERTIFIED: 'ไม่ผ่านการรับรอง',
    WITHDRAWN: 'ถอนคำขอ',
    REVOKED: 'ใบรับรองถูกเพิกถอน',
    EXPIRED: 'ใบรับรองหมดอายุ',
  },
  form: {
    applicationLabel: 'คำขอรับรอง GACP',
    draftLabel: 'ร่าง',
    autosaved: 'บันทึกอัตโนมัติแล้ว',
    saving: 'กำลังบันทึก',
    stepOf: (step: number) => `ขั้นที่ ${step}`,
    back: 'กลับ',
    backToStep: (step: number, title: string) => `กลับขั้นที่ ${step} ${title}`,
    nextToStep: (step: number, title: string) => `ไปขั้นที่ ${step} ${title}`,
    saveAndExit: 'บันทึกร่างและออก',
    required: 'บังคับ',
    optional: 'ไม่บังคับ',
    notFilled: 'ยังไม่ได้กรอก',
    lockedFromAccount: 'จากบัญชีที่พิสูจน์ตัวตนแล้ว แก้ไม่ได้ในฟอร์ม',
    chooseOneOrMore: 'เลือกได้มากกว่าหนึ่ง',
    inThisStep: 'ในขั้นนี้',
    fieldsProgress: (done: number, total: number) => `ช่องกรอก ${done}/${total}`,
    documentsProgress: (done: number, total: number) => `เอกสาร ${done}/${total}`,
    becauseYouChose: 'เพราะคุณเลือก',
    whatSystemWillAsk: 'สิ่งที่ระบบจะขอ จากคำตอบของคุณ',
    whyTheseDocuments: 'ทำไมต้องขอเอกสารเหล่านี้',
    privacyTitle: 'ความเป็นส่วนตัวของคุณ',
    privacyBody:
      'ไฟล์เก็บในพื้นที่ปิด เปิดดูได้เฉพาะคุณและเจ้าหน้าที่ที่ได้รับมอบเคส ทุกการเปิดดูของเจ้าหน้าที่ถูกบันทึก และคุณดูบันทึกนั้นได้',
    missingBeforeSubmit: (count: number) => `ยังขาด ${count} รายการ แนบทีหลังได้ ระบบจะเตือนอีกครั้งที่ขั้นที่ 6`,
    autosavedAt: (time: string) => `บันทึกอัตโนมัติแล้ว ${time}`,
    newDraftLabel: 'คำขอใหม่ ยังไม่บันทึก',
    railMissing: (count: number) => `ขาด ${count} รายการ`,
    requiredBeforeSubmit: 'ต้องกรอกก่อนส่ง',
    perFormat: 'ต่อรูปแบบการปลูก',
    noFeeSchedule: 'ยังไม่มีตารางอัตราค่าธรรมเนียมสำหรับประเภทคำขอนี้ ระบบจะเปิดให้ยืนยันเมื่อกรมประกาศอัตรา',
    fieldsMissingList: (labels: string) => `ช่องกรอก · ขาด ${labels}`,
    fieldsComplete: 'ช่องกรอกครบ',
    documentsMissingList: (labels: string) => `เอกสาร · ขาด ${labels}`,
    documentsComplete: 'เอกสารครบ',
    noDocumentsInStep: 'ไม่มีเอกสารแนบในขั้นนี้',
    everyone: 'ทุกราย',
    step1: {
      requestTypeTitle: 'ประเภทคำขอ',
      requestTypeLead:
        'คำตอบในขั้นนี้กำหนดว่าระบบจะขอเอกสารอะไรบ้างในขั้นถัดไป ระบบขอเฉพาะที่กรมบังคับในกรณีของคุณ',
      scopeTitle: 'ขอบข่ายการรับรอง',
      scopeHint: 'ต้องการทั้งสองขอบข่าย ยื่นคำขอแยกฉบับ ระบบจะคัดลอกข้อมูลตัวตนและสถานที่ให้ ไม่ต้องกรอกซ้ำ',
      plantTitle: 'พืชที่ขอรับรอง',
      plantHint: 'พืชอื่นจะเปิดให้เลือกเมื่อกรมประกาศแบบคำขอของพืชนั้น',
      applicantTypeTitle: 'ประเภทผู้ขอรับรอง',
      applicantTypeLead:
        'ตามแบบ กทล.1 ส่วนที่ ๑ เลือกได้หนึ่งแบบ ชื่อของผู้ขอรับรองจะเป็นชื่อเดียวที่ปรากฏบนแบบคำขอ ใบเสร็จ และใบรับรอง',
      attorneyLabel: 'ผู้ยื่นคำขอนี้เป็นผู้รับมอบอำนาจ ไม่ใช่ประธานหรือผู้มีอำนาจลงนามเอง',
      attorneyHint: (name: string) =>
        `คุณ (${name}) ยื่นแทนผู้ขอรับรอง ระบบจะขอหนังสือมอบอำนาจและสำเนาบัตรของผู้มอบในขั้นที่ 2 และพิมพ์ชื่อคุณเป็นผู้ยื่นในแบบ กทล.1`,
      previousCertificateLabel: 'เลขที่ใบรับรองเดิม',
      estimateTitle: 'ค่าใช้จ่ายโดยประมาณ',
      estimateHint: 'รวมภาษีมูลค่าเพิ่มแล้ว ยอดจริงคูณตามจำนวนรูปแบบการปลูกที่คุณเลือกในขั้นที่ 3 และล็อกราคา ณ วันยื่น',
      previousCertificateHint: 'กรอกเมื่อขอต่ออายุหรือขอใบแทน',
      helpTitle: 'ต้องการความช่วยเหลือ',
      helpBody:
        'ทุกช่องมีคำอธิบาย "เอกสารนี้คืออะไร" และ "หาได้ที่ไหน" · บันทึกร่างอัตโนมัติทุกครั้งที่กรอก กลับมาทำต่อได้ทุกเมื่อ',
      whatSystemWillAskHint: 'รายการนี้ปรับตามคำตอบทันที และเป็นรายการเดียวกับที่เจ้าหน้าที่ใช้ตรวจ',
      whatSystemWillAskPending: 'รายการเอกสารจะแสดงเมื่อคุณเริ่มคำขอ',
    },
    step2: {
      identityTitle: {
        COMMUNITY_ENTERPRISE: 'ข้อมูลวิสาหกิจชุมชน',
        INDIVIDUAL: 'ข้อมูลผู้ขอรับรองบุคคลธรรมดา',
        JURISTIC_PERSON: 'ข้อมูลนิติบุคคล',
      } satisfies Record<ApplicantType, string>,
      identityReference: {
        COMMUNITY_ENTERPRISE: 'กทล.1 ส่วนที่ ๑ ข้อ ๑.๑',
        INDIVIDUAL: 'กทล.1 ส่วนที่ ๑ ข้อ ๑.๒',
        JURISTIC_PERSON: 'กทล.1 ส่วนที่ ๑ ข้อ ๑.๓',
      } satisfies Record<ApplicantType, string>,
      identityLead: 'ชื่อนี้จะเป็นชื่อสถานที่ปลูก ชื่อบนใบเสร็จรับเงิน และชื่อบนใบรับรอง',
      legalName: {
        COMMUNITY_ENTERPRISE: 'ชื่อวิสาหกิจชุมชน',
        INDIVIDUAL: 'ชื่อและนามสกุล',
        JURISTIC_PERSON: 'ชื่อนิติบุคคล',
      } satisfies Record<ApplicantType, string>,
      registrationNumber: {
        COMMUNITY_ENTERPRISE: 'รหัสทะเบียน สวช.01',
        INDIVIDUAL: '',
        JURISTIC_PERSON: 'เลขทะเบียนนิติบุคคล (เลขประจำตัวผู้เสียภาษี)',
      } satisfies Record<ApplicantType, string>,
      representativeName: {
        COMMUNITY_ENTERPRISE: 'ชื่อประธานวิสาหกิจ',
        INDIVIDUAL: '',
        JURISTIC_PERSON: 'ผู้มีอำนาจลงนาม',
      } satisfies Record<ApplicantType, string>,
      nationalId: {
        COMMUNITY_ENTERPRISE: 'เลขประจำตัวประชาชนของประธาน',
        INDIVIDUAL: 'เลขประจำตัวประชาชน',
        JURISTIC_PERSON: '',
      } satisfies Record<ApplicantType, string>,
      nationalIdHint: 'เก็บแบบเข้ารหัส แสดงบางส่วนบนหน้าจอ และไม่พิมพ์บนเอกสารการเงิน',
      nationalIdKeep: (masked: string) => `บันทึกไว้แล้ว ${masked} กรอกใหม่เฉพาะเมื่อต้องการเปลี่ยน`,
      nationalIdPlaceholder: 'เลข 13 หลัก',
      nationality: 'สัญชาติของประธาน',
      houseRegistrationNo: 'เลขรหัสประจำบ้าน (ตามทะเบียนบ้านที่จดทะเบียน)',
      houseRegistrationHint: 'เลข 11 หลักอยู่มุมบนขวาของทะเบียนบ้าน',
      address: 'ที่อยู่ตามทะเบียนบ้าน',
      addressLine: 'บ้านเลขที่ หมู่ ซอย ถนน',
      subdistrict: 'ตำบล/แขวง',
      district: 'อำเภอ/เขต',
      province: 'จังหวัด',
      postalCode: 'รหัสไปรษณีย์',
      mobilePhone: 'โทรศัพท์มือถือ',
      email: 'อีเมล',
      lineId: 'Line ID',
      attorneyTitle: 'ผู้ยื่นคำขอ (ผู้รับมอบอำนาจ)',
      attorneyBecause: 'เพราะคุณติ๊กผู้รับมอบอำนาจในขั้นที่ 1',
      attorneyName: 'ชื่อผู้ยื่น',
      attorneyPosition: 'ตำแหน่งหรือความเกี่ยวข้อง',
      documentsTitle: 'เอกสารตัวตนและคุณสมบัติ',
      documentsLead: 'แนบครั้งเดียวที่นี่ หนึ่งช่องคือหนึ่งเอกสารตามที่กรมติ๊ก กดชื่อไฟล์เพื่อเปิดดูในหน้าได้ทันที',
      whyBody:
        'กทล.1 ส่วนที่ ๓ และรายการตรวจของเจ้าหน้าที่ข้อ 1.1 กำหนดเอกสารตัวตนสำหรับทุกประเภทคำขอ และเอกสารคุณสมบัติตามประเภทผู้ขอรับรอง เอกสารมอบอำนาจขอเพราะคุณยื่นแทนผู้มีอำนาจลงนาม',
    },
    step3: {
      siteTitle: 'สถานที่ปลูก',
      siteReference: 'กทล.1 ส่วนที่ ๒ ข้อ ๑',
      siteLead:
        'สถานที่หนึ่งแห่งต่อคำขอหนึ่งฉบับ ชื่อสถานที่ใช้ชื่อเดียวกับผู้ขอรับรองเสมอ เพื่อให้ตรวจสอบย้อนหลังได้ทุกเอกสาร',
      siteName: 'ชื่อสถานที่ปลูก',
      siteNameLocked: 'ใช้ชื่อผู้ขอรับรองจากขั้นที่ 2 โดยอัตโนมัติ ชื่อนี้จะพิมพ์บนใบรับรอง',
      siteNamePending: 'จะแสดงเมื่อคุณกรอกชื่อผู้ขอรับรองในขั้นที่ 2',
      siteAddressLine: 'บ้านเลขที่ หมู่ ซอย ถนน',
      sitePhone: 'โทรศัพท์ติดต่อสถานที่',
      coordinates: 'พิกัดภูมิศาสตร์ของแปลง',
      latitude: 'ละติจูด',
      longitude: 'ลองจิจูด',
      coordinatesHint: 'พิกัดใช้ในการนัดตรวจแปลง ไม่เผยแพร่สาธารณะ',
      areaSquareMetres: 'ขนาดพื้นที่ที่ขอรับรอง (ตารางเมตร)',
      plantsPerCycle: 'จำนวนต้นต่อรอบ',
      cyclesPerYear: 'จำนวนรอบต่อปี',
      landTitle: 'ที่ดินและเอกสารสิทธิ์',
      landReference: 'กทล.1 ส่วนที่ ๒ ข้อ ๒',
      landDocumentType: 'ประเภทเอกสารสิทธิ์',
      landDocumentTypePlaceholder: 'เช่น โฉนดที่ดิน (น.ส.4 จ.), น.ส.3 ก., ส.ป.ก. 4-01',
      landDocumentNumber: 'เลขที่เอกสาร',
      landVolume: 'เล่ม',
      landPage: 'หน้า',
      landIssuedBy: 'ออกโดย',
      landTenure: 'การถือครองที่ดิน',
      landlordName: 'ชื่อเจ้าของที่ดินผู้ให้เช่าหรือผู้ยินยอม',
      leaseEndsOn: 'สัญญาเช่าหรือความยินยอมสิ้นสุด',
      areaTypesTitle: 'ลักษณะพื้นที่ปลูก',
      areaTypeOther: 'ระบุลักษณะพื้นที่อื่น',
      formatsNote: (count: number, stage1Amount: string | null) =>
        stage1Amount
          ? `คุณเลือก ${count} รูปแบบการปลูก ค่าธรรมเนียมและค่าบริการคิดต่อรูปแบบ งวดที่ 1 โดยประมาณ ${stage1Amount} ดูยอดจริงที่ขั้นที่ 6`
          : `คุณเลือก ${count} รูปแบบการปลูก ค่าธรรมเนียมและค่าบริการคิดต่อรูปแบบ ดูยอดจริงที่ขั้นที่ 6`,
      useCurrentLocation: 'ใช้ตำแหน่งปัจจุบัน',
      locationUnavailable: 'เบราว์เซอร์ไม่ให้ตำแหน่ง กรอกพิกัดเองจากแอปแผนที่',
      consentBy: (name: string) => `ผู้ให้ความยินยอม ${name}`,
      landNumberMustMatch: (number: string) => `เลขที่ในเอกสารต้องตรงกับที่กรอก ${number}`,
      plantsPerCycleUnit: 'ต้น / รอบ',
      cyclesPerYearUnit: 'รอบ / ปี',
      documentsTitle: 'เอกสารของขั้นนี้ ปรับตามคำตอบข้างบน',
      documentsLead: (count: number, reasons: string) =>
        `ตอนนี้ขอ ${count} ช่อง เพราะคุณเลือก ${reasons}`,
      documentsLeadNoChoice: 'เลือกการถือครองและลักษณะพื้นที่ก่อน ระบบจะบอกว่าต้องแนบอะไร',
      noOverAsking: 'ถ้าคุณเปลี่ยนคำตอบ ระบบจะเลิกขอเอกสารที่ไม่เกี่ยวทันที ไม่มีการขอเกินกรณีของคุณ',
      whySiteNameLocked: 'ชื่อสถานที่ทำไมล็อก',
      whySiteNameLockedBody:
        'ใบรับรอง GACP ระบุชื่อผู้ถือและชื่อสถานที่ กรมและผู้ซื้อต้องตรวจย้อนหลังได้ว่าเป็นรายเดียวกัน จึงใช้ชื่อเดียวกันในทุกเอกสาร',
    },
    step4: {
      purposesTitle: 'วัตถุประสงค์ของการปลูก',
      purposesReference: 'กทล.1 ส่วนที่ ๒',
      exportNote:
        'คุณเลือก ส่งออก ระบบจะขอใบอนุญาตส่งออกสมุนไพรควบคุม (จากคำขอ ภท.10) ในขั้นที่ 5 ถ้ายังไม่มี ยื่นคำขอ GACP ต่อได้ แต่ใบรับรองจะออกได้เมื่อแนบใบอนุญาตแล้ว',
      materialsTitle: 'พันธุ์และส่วนของพืชที่ใช้',
      materialsReference: 'กทล.1 ส่วนที่ ๒ ข้อ ๓',
      materialsLead: 'ระบุทุกพันธุ์ที่จะปลูกในรอบที่ขอรับรอง ใบรับรองจะระบุพันธุ์ตามที่ยื่น',
      kind: 'ชนิด',
      varietyName: 'ชื่อพันธุ์หรือสายพันธุ์',
      source: 'แหล่งที่มา',
      origin: 'ที่มา',
      originCountry: 'ประเทศต้นทาง',
      quantity: 'ปริมาณ',
      unit: 'หน่วย',
      addMaterial: 'เพิ่มรายการ',
      removeMaterial: 'ลบ',
      noMaterials: 'ยังไม่มีรายการ เพิ่มพันธุ์แรกของคุณด้านล่าง',
      addMaterialTitle: 'เพิ่มพันธุ์หรือส่วนของพืช',
      materialInvalid: 'กรอกชื่อพันธุ์และแหล่งที่มาก่อนเพิ่มรายการ',
      summary: (purposes: number, materials: number) =>
        `วัตถุประสงค์ ${purposes} ข้อ · พันธุ์ ${materials} รายการ`,
      complete: 'ครบ',
      importedTitle: 'พันธุ์นำเข้า',
      importedBody: 'ระบุประเทศต้นทางและผู้จำหน่าย เจ้าหน้าที่จะตรวจเอกสารนำเข้าในวันตรวจแปลง ไม่ต้องแนบตอนยื่น',
      appendixNote: (count: number, rows: number) =>
        `มี ${count} รายการ เกินช่องในแบบ กทล.1 ที่มี ${rows} รายการ ระบบจะสร้าง ภาคผนวก ก แนบท้ายแบบให้อัตโนมัติ คุณไม่ต้องทำเอกสารเพิ่ม`,
      noUploads: 'ขั้นนี้กรอกอย่างเดียว ไม่มีเอกสารแนบ ตามแบบจริง',
      declarationReminderTitle: 'โปรดทราบก่อนยื่น',
      declarationReminderBody:
        'คำรับรองข้อ ๓ ในขั้นที่ 6: คุณจะไม่เปลี่ยนพื้นที่ เมล็ดพันธุ์ หรือส่วนที่ใช้ โดยไม่ยื่นคำขอใหม่ ใบรับรองระบุพันธุ์และขอบข่ายตามที่ยื่นในวันนี้',
    },
    step5: {
      plansTitle: 'แผนงาน',
      plansReference: 'กทล.1 ส่วนที่ ๓ (A5 A6)',
      plansLead: 'บังคับทุกราย แผนงานคือเอกสารที่คุณเขียนเอง ไม่มีแบบฟอร์มบังคับ แต่ต้องครอบคลุมหัวข้อที่ระบุ',
      sopTitle: 'คู่มือการปฏิบัติงาน (SOP)',
      sopReference: 'กทล.1 ส่วนที่ ๓ (A8)',
      sopSubItemsTitle: 'หัวข้อที่เจ้าหน้าที่จะตรวจใน SOP ของคุณ',
      licensesTitle: 'ใบอนุญาตสมุนไพรควบคุม (กัญชา)',
      licensesLead:
        'แนบตัวใบอนุญาตที่ออกแล้ว ไม่ใช่แบบคำขอ ถ้ายังไม่ได้รับ เลือกสถานะให้ตรงความจริง ระบบจะบอกว่าต้องทำอะไรต่อ',
      licenseStatusLabel: 'สถานะใบอนุญาตนี้',
      licenseNumber: 'เลขที่ใบอนุญาต',
      issuedOn: 'วันที่ออก',
      expiresOn: 'วันหมดอายุ',
      receiptNumber: 'เลขรับคำขอ',
      filedWith: 'หน่วยงานที่ยื่น',
      filedOn: 'วันที่ยื่นคำขอ',
      expectedDecisionOn: 'วันที่คาดว่าจะได้รับใบอนุญาต',
      appliedNote:
        'คุณยื่นคำขอ GACP ต่อได้ เจ้าหน้าที่จะบันทึกเป็น "ขอเอกสารเพิ่ม" พร้อมกำหนดวันตาม เมื่อได้รับใบอนุญาตให้กลับมาแนบที่ช่องนี้ ใบรับรอง GACP จะออกได้เมื่อแนบใบอนุญาตแล้วเท่านั้น',
      noneNote: 'รับคำขอ GACP ไม่ได้จนกว่าจะแนบใบอนุญาต หรือหลักฐานการยื่นคำขอ',
      attachLicenseFile: 'แนบไฟล์ใบอนุญาต',
      attachReceiptFile: 'แนบหลักฐานการยื่นคำขอ (ใบรับคำขอ)',
      licenseUndeclared: 'เลือกสถานะใบอนุญาตนี้ก่อน ระบบจะบอกว่าต้องแนบอะไร',
      licenseFileMissing: 'แจ้งสถานะแล้ว ยังไม่ได้แนบไฟล์ประกอบ',
      requiredDocuments: 'เอกสารบังคับ',
      optionalTitle: 'ไม่บังคับ ช่วยให้วันตรวจแปลงเร็วขึ้น',
      optionalLead: 'ไม่มีผลต่อการส่งคำขอ แนบได้ถ้ามี',
      licenseKindsTitle: 'ใบอนุญาตสมุนไพรควบคุมมี 3 แบบ',
      licenseKinds: [
        ['ภท.9', 'ศึกษาวิจัย'],
        ['ภท.10', 'ส่งออก · ขอเมื่อเลือกวัตถุประสงค์ส่งออก'],
        ['ภท.11', 'จำหน่ายหรือแปรรูปเพื่อการค้า · ขอเมื่อขอบข่ายเป็นแปรรูป'],
      ],
      licenseKindsHint:
        'ระบบขอเฉพาะใบที่เกี่ยวกับกรณีของคุณ เงื่อนไขอ้างอิงประกาศกระทรวงสาธารณสุขเรื่องสมุนไพรควบคุม (กัญชา) ฉบับที่มีผล',
      whySopSingleTitle: 'ทำไม SOP เป็นช่องเดียว',
      whySopSingleBody:
        'กรมติ๊ก SOP เป็นรายการเดียว แต่ตรวจเป็นหัวข้อ เจ้าหน้าที่จึงติ๊กหัวข้อย่อยในเล่มของคุณ และขอแก้เฉพาะหัวข้อที่ขาด ไม่ต้องส่งเล่มใหม่ทั้งชุดถ้าไม่จำเป็น',
    },
    step6: {
      title: 'ตรวจทานและส่ง',
      blockedTitle: (count: number) => `ยังส่งไม่ได้ เหลือ ${count} รายการ`,
      blockedLead: 'แก้ให้ครบแล้วกลับมาที่หน้านี้ ระบบจำทุกอย่างที่คุณกรอกไว้แล้ว',
      readyTitle: 'ข้อมูลและเอกสารครบตามแบบ กทล.1 แล้ว',
      goFix: (step: number) => `ไปแก้ที่ขั้น ${step}`,
      fieldMissing: (label: string) => `${label} ยังไม่ได้กรอก`,
      documentMissing: (label: string) => `${label} ยังไม่ได้แนบ`,
      comingSoon: 'การยืนยันคำรับรองและใบเสนอราคางวดที่ 1 จะเปิดใช้ในขั้นถัดไปของการพัฒนา',
      readyTag: 'พร้อมส่ง',
      blockedTag: 'ยังส่งไม่ได้',
      serverTruth: 'ทุกอย่างบนหน้านี้อ่านจากระบบ ไม่ใช่จากหน้าจอที่คุณกรอก',
      kindField: 'ช่องกรอก',
      kindDocument: 'เอกสาร',
      goFill: (step: number) => `ไปกรอกที่ขั้น ${step}`,
      goAttach: (step: number) => `ไปแนบที่ขั้น ${step}`,
      katorlorTitle: 'แบบกัญชา กทล.1 ที่ระบบประกอบให้',
      katorlorSubtitle: 'คำขอรับใบรับรองแหล่งผลิต (ปลูก) การเก็บเกี่ยวและแปรรูปพืชกัญชา · อัปเดตเองเมื่อคุณแก้ข้อมูล',
      katorlorDraftTag: 'ร่าง รอข้อมูลครบ',
      katorlorReadyTag: 'ข้อมูลครบ รอยืนยัน',
      part1: 'ส่วนที่ ๑',
      part2: 'ส่วนที่ ๒',
      part3: 'ส่วนที่ ๓',
      attorneyApplicant: (name: string) => `ผู้ยื่น ${name} (ผู้รับมอบอำนาจ)`,
      attachments: (done: number, total: number) => `เอกสารแนบ ${done}/${total} รายการ`,
      materialsWithAppendix: (count: number) => `พันธุ์ ${count} รายการ (ภาคผนวก ก)`,
      materialsCount: (count: number) => `พันธุ์ ${count} รายการ`,
      estimateTitle: 'ยอดงวดที่ 1 โดยประมาณ',
      formatsCount: (count: number) => `${count} รูปแบบการปลูก`,
      vatLine: (percent: string) => `ภาษีมูลค่าเพิ่ม ${percent}%`,
      netTotal: 'ยอดรวมสุทธิ',
      estimateHint: 'อัตราวันนี้ ล็อกเมื่อคุณกดยืนยัน ใบเสนอราคาจะออกอัตโนมัติ',
      estimateNeedsFormats: 'เลือกลักษณะพื้นที่ปลูกในขั้นที่ 3 ก่อน ระบบจึงคำนวณยอดได้',
      afterConfirmTitle: 'หลังกดยืนยันจะเกิดอะไร',
      afterConfirmSteps: [
        'ระบบล็อกราคาและออกใบเสนอราคางวดที่ 1',
        'คุณชำระผ่าน Stripe (พร้อมเพย์หรือบัตร) ใบเสร็จรับเงินออกเอง',
        'คำขอเข้าระบบทันที และเข้าคิวผู้จัดคิวงานเพื่อมอบผู้ตรวจเอกสาร',
        'ผู้ตรวจเอกสารแจ้งผลภายใน 30 วัน ขอเอกสารเพิ่มเป็นรายช่องได้',
      ],
      confirmButton: (amount: string) => `ยืนยันและไปชำระเงินงวดที่ 1 · ${amount}`,
      confirmButtonNoAmount: 'ยืนยันและไปชำระเงินงวดที่ 1',
      confirmLocked: (count: number) => `ปุ่มจะเปิดเมื่อแก้ครบ ${count} รายการข้างบน`,
      notJudgeable: 'ยังไม่มีชุดกฎเอกสารที่มีผลสำหรับพืชนี้ ระบบรับคำขอไม่ได้จนกว่ากรมจะประกาศ',
    },
  },
  documentCard: {
    attached: 'แนบแล้ว',
    attachedCount: (count: number) => `${count} ไฟล์`,
    notAttached: 'ยังไม่ได้แนบ',
    view: 'เปิดดูในหน้า',
    replace: 'แทนที่',
    addFile: 'เพิ่มไฟล์',
    remove: 'ลบ',
    chooseFile: 'เลือกไฟล์',
    choosePhoto: 'เลือกภาพ',
    dropHint: 'ลากไฟล์มาวาง หรือเลือกไฟล์',
    limits: (types: string, sizeMb: number, maxFiles: number) =>
      maxFiles > 1
        ? `${types} · ไม่เกิน ${sizeMb} MB ต่อไฟล์ · สูงสุด ${maxFiles} ไฟล์`
        : `${types} · ไม่เกิน ${sizeMb} MB · 1 ไฟล์`,
    howToObtain: 'หาได้ที่ไหน',
    issuedOn: 'วันที่ออกเอกสาร',
    issuedWithin: (days: number) => `ต้องออกไม่เกิน ${days} วันก่อนวันยื่น`,
    uploadedOn: 'อัปโหลด',
    issuedOnValue: (date: string) => `วันที่ออก ${date}`,
    issuedOnFirst: 'ระบุวันที่ออกเอกสารก่อน แล้วจึงเลือกไฟล์',
    uploading: 'กำลังอัปโหลด',
    confirmRemove: 'ลบไฟล์นี้ออกจากคำขอ',
    maxFilesReached: 'ครบจำนวนไฟล์แล้ว',
    optional: 'ไม่บังคับ',
    viewerTitle: 'เปิดดูเอกสาร',
    viewerClose: 'ปิด',
    viewerUnsupported: 'ไฟล์ชนิดนี้แสดงในหน้าไม่ได้ ดาวน์โหลดเพื่อเปิดด้วยโปรแกรมภายนอก',
    download: 'ดาวน์โหลด',
    mimeLabels: {
      'application/pdf': 'PDF',
      'image/jpeg': 'JPG',
      'image/png': 'PNG',
      'image/webp': 'WEBP',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'DOCX',
    } as Record<string, string>,
  },
  errors: {
    notFound: 'ไม่พบคำขอนี้ หรือคุณไม่มีสิทธิ์เข้าถึง',
    invalidInput: 'ข้อมูลไม่ถูกต้อง ตรวจสอบช่องที่ขีดเส้นแดง',
    uploadFailed: 'อัปโหลดไม่สำเร็จ',
    slotNotApplicable: 'ช่องนี้ไม่อยู่ในรายการเอกสารของคำขอนี้',
  },
} as const;
