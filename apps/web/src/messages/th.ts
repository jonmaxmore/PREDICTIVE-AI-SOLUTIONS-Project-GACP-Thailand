import { UserRole } from '@gacp/contracts';

// ข้อความไทยทุกชิ้นบนหน้าจออยู่ที่นี่ ไม่อยู่ใน component
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
} as const;
