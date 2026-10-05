export interface ScheduleItem {
  certificateId: string;
  certificateNumber: string;
  farmName: string;
  reportType: string;
  reportTypeName: string;
  month: number;
  year: number;
  status: string;
  submissionId: string | null;
  submittedAt: string | null;
  isOverdue: boolean;
}

export interface ScheduleSummary {
  total: number;
  submitted: number;
  pending: number;
  overdue: number;
}

export interface CertificateInfo {
  id: string;
  certificateNumber: string;
  farmName: string;
  cropType: string;
  issuedDate: string;
  expiryDate: string;
}

export interface ScheduleData {
  certificates: CertificateInfo[];
  schedule: ScheduleItem[];
  summary: ScheduleSummary;
}

export const THAI_MONTHS = [
  'ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.',
  'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.',
];

export const REPORT_TYPE_INFO: Record<string, { icon: string; color: string }> = {
  PT27: { icon: '27', color: 'bg-blue-50 text-blue-700' },
  PT28: { icon: '28', color: 'bg-violet-50 text-violet-700' },
  PT29: { icon: '29', color: 'bg-amber-50 text-amber-700' },
  PT30: { icon: '30', color: 'bg-green-50 text-green-700' },
  PT31: { icon: '31', color: 'bg-red-50 text-red-700' },
  PT32: { icon: '32', color: 'bg-pink-50 text-pink-700' },
};

export interface ReportField {
  id: string;
  label: string;
  placeholder: string;
  type: 'text' | 'textarea' | 'number' | 'select';
  required?: boolean;
  options?: string[];
  suffix?: string;
  helpText?: string;
}

export const REPORT_FIELDS: Record<string, ReportField[]> = {
  PT27: [
    { id: 'herbName', label: 'ชื่อสมุนไพร', placeholder: 'เช่น ขมิ้นชัน, ฟ้าทะลายโจร, กระชายขาว', type: 'text', required: true },
    { id: 'herbPart', label: 'ส่วนที่ใช้', placeholder: 'เช่น เหง้า, ใบ, ราก, ทั้งต้น', type: 'text', required: true },
    { id: 'sourceType', label: 'แหล่งที่มา', placeholder: '', type: 'select', required: true, options: ['เพาะปลูกเอง', 'รวบรวมจากธรรมชาติ', 'ซื้อจากแหล่งอื่น', 'ได้รับบริจาค'] },
    { id: 'sourceDetail', label: 'รายละเอียดแหล่งที่มา', placeholder: 'ระบุชื่อฟาร์ม/สถานที่/ผู้จำหน่าย พร้อมที่อยู่', type: 'textarea', required: true },
    { id: 'quantityReceived', label: 'จำนวนที่ได้รับในเดือนนี้', placeholder: '0', type: 'number', required: true, suffix: 'กก.' },
    { id: 'quantityStored', label: 'จำนวนคงเหลือที่เก็บไว้', placeholder: '0', type: 'number', required: true, suffix: 'กก.' },
    { id: 'storageLocation', label: 'สถานที่เก็บรักษา', placeholder: 'ระบุอาคาร/ห้อง/สถานที่จัดเก็บ', type: 'text', required: true },
    { id: 'storageCondition', label: 'สภาพการเก็บรักษา', placeholder: '', type: 'select', options: ['อุณหภูมิห้อง', 'ห้องเย็น', 'ห้องควบคุมความชื้น', 'อื่น ๆ'] },
    { id: 'remarks', label: 'หมายเหตุ', placeholder: 'ข้อมูลเพิ่มเติม (ถ้ามี)', type: 'textarea' },
  ],
  PT28: [
    { id: 'herbName', label: 'ชื่อสมุนไพร', placeholder: 'เช่น ขมิ้นชัน, ฟ้าทะลายโจร', type: 'text', required: true },
    { id: 'herbPart', label: 'ส่วนที่ใช้', placeholder: 'เช่น เหง้า, ใบ, ราก', type: 'text', required: true },
    { id: 'usagePurpose', label: 'วัตถุประสงค์การใช้', placeholder: '', type: 'select', required: true, options: ['ผลิตยาสมุนไพร', 'แปรรูปเพื่อจำหน่าย', 'ศึกษาวิจัย', 'ใช้ในการรักษา', 'อื่น ๆ'] },
    { id: 'usageDetail', label: 'รายละเอียดการนำไปใช้', placeholder: 'อธิบายวิธีการใช้ เช่น ผลิตเป็นแคปซูล, สกัดน้ำมันหอมระเหย', type: 'textarea', required: true },
    { id: 'quantityUsed', label: 'จำนวนที่นำไปใช้', placeholder: '0', type: 'number', required: true, suffix: 'กก.' },
    { id: 'quantityRemaining', label: 'จำนวนคงเหลือ', placeholder: '0', type: 'number', required: true, suffix: 'กก.' },
    { id: 'productOutput', label: 'ผลผลิตที่ได้', placeholder: 'ระบุชื่อผลิตภัณฑ์และจำนวน', type: 'textarea' },
    { id: 'recipient', label: 'ผู้รับ/ผู้ใช้ประโยชน์', placeholder: 'ระบุชื่อบุคคล/หน่วยงานที่รับไปใช้', type: 'text' },
    { id: 'remarks', label: 'หมายเหตุ', placeholder: 'ข้อมูลเพิ่มเติม (ถ้ามี)', type: 'textarea' },
  ],
  PT29: [
    { id: 'herbName', label: 'ชื่อสมุนไพร', placeholder: 'ชื่อสมุนไพรที่แปรรูป/จำหน่าย', type: 'text', required: true },
    { id: 'processType', label: 'ประเภทการแปรรูป', placeholder: '', type: 'select', required: true, options: ['อบแห้ง', 'สกัด', 'บด/ป่น', 'ผลิตเป็นยา', 'อื่น ๆ'] },
    { id: 'quantityProcessed', label: 'จำนวนที่แปรรูป', placeholder: '0', type: 'number', required: true, suffix: 'กก.' },
    { id: 'quantitySold', label: 'จำนวนที่จำหน่าย', placeholder: '0', type: 'number', suffix: 'กก.' },
    { id: 'salesValue', label: 'มูลค่าการจำหน่าย', placeholder: '0', type: 'number', suffix: 'บาท' },
    { id: 'buyerInfo', label: 'ข้อมูลผู้ซื้อ', placeholder: 'ชื่อ ที่อยู่ของผู้ซื้อ', type: 'textarea' },
    { id: 'remarks', label: 'หมายเหตุ', placeholder: 'ข้อมูลเพิ่มเติม (ถ้ามี)', type: 'textarea' },
  ],
  PT30: [
    { id: 'researchTitle', label: 'ชื่อโครงการวิจัย', placeholder: 'ระบุชื่อโครงการวิจัย', type: 'text', required: true },
    { id: 'herbName', label: 'ชื่อสมุนไพรที่ใช้', placeholder: 'ชื่อสมุนไพร', type: 'text', required: true },
    { id: 'objective', label: 'วัตถุประสงค์การวิจัย', placeholder: 'อธิบายวัตถุประสงค์', type: 'textarea', required: true },
    { id: 'quantityUsed', label: 'จำนวนที่ใช้ในการวิจัย', placeholder: '0', type: 'number', suffix: 'กก.' },
    { id: 'progress', label: 'ความก้าวหน้าของการวิจัย', placeholder: 'สรุปความก้าวหน้าในเดือนนี้', type: 'textarea', required: true },
    { id: 'findings', label: 'ผลการวิจัย/ข้อค้นพบ', placeholder: 'ผลที่ได้ (ถ้ามี)', type: 'textarea' },
    { id: 'remarks', label: 'หมายเหตุ', placeholder: 'ข้อมูลเพิ่มเติม (ถ้ามี)', type: 'textarea' },
  ],
  PT31: [
    { id: 'herbName', label: 'ชื่อสมุนไพรที่ส่งออก', placeholder: 'ชื่อสมุนไพร', type: 'text', required: true },
    { id: 'destination', label: 'ประเทศปลายทาง', placeholder: 'ระบุประเทศ', type: 'text', required: true },
    { id: 'quantityExported', label: 'จำนวนที่ส่งออก', placeholder: '0', type: 'number', required: true, suffix: 'กก.' },
    { id: 'exportDate', label: 'วันที่ส่งออก', placeholder: 'วว/ดด/ปปปป', type: 'text', required: true },
    { id: 'exportPermitNo', label: 'เลขที่ใบอนุญาตส่งออก', placeholder: 'เลขที่ ภ.ท.10', type: 'text' },
    { id: 'buyer', label: 'ผู้รับ/ผู้ซื้อต่างประเทศ', placeholder: 'ชื่อบริษัท/บุคคล', type: 'text' },
    { id: 'remarks', label: 'หมายเหตุ', placeholder: 'ข้อมูลเพิ่มเติม (ถ้ามี)', type: 'textarea' },
  ],
  PT32: [
    { id: 'herbName', label: 'ชื่อสมุนไพร', placeholder: 'ชื่อสมุนไพรที่ส่งออก', type: 'text', required: true },
    { id: 'exportCertNo', label: 'เลขที่ใบรับรองส่งออก', placeholder: 'เลขที่เอกสาร', type: 'text', required: true },
    { id: 'exportValue', label: 'มูลค่าการส่งออก', placeholder: '0', type: 'number', required: true, suffix: 'บาท' },
    { id: 'exportValueForeign', label: 'มูลค่า (สกุลเงินต่างประเทศ)', placeholder: '0', type: 'number', suffix: 'USD' },
    { id: 'shippingMethod', label: 'วิธีการขนส่ง', placeholder: '', type: 'select', options: ['ทางเรือ', 'ทางอากาศ', 'ทางบก', 'ไปรษณีย์'] },
    { id: 'remarks', label: 'หมายเหตุ', placeholder: 'ข้อมูลเพิ่มเติม (ถ้ามี)', type: 'textarea' },
  ],
};

export interface ReportModalData {
  certificateId: string;
  certificateNumber: string;
  farmName: string;
  reportType: string;
  reportTypeName: string;
  month: number;
  year: number;
}
