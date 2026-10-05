import { SERVICE_NAME } from '@/lib/pricing/fee-services';
/**
 * Status Mapping — เพิ่ม "next action" และ context ต่อยอดจาก workflow-states.ts
 *
 * ไม่ซ้ำ label/color ที่มีอยู่แล้ว — เพิ่มเฉพาะสิ่งที่ขาด:
 * - nextAction: บอกผู้ใช้ว่าต้องทำอะไร
 * - description: อธิบายสถานะปัจจุบัน
 * - icon: Lucide icon name
 * - urgency: ระดับความเร่งด่วน
 * - oldSystemRef: อ้างอิง status ระบบเก่า (herbctrl)
 *
 * Mapping อิงจาก 14 สถานะของระบบเก่า (herbctrl.dtam.moph.go.th)
 * + 17 workflow states ของระบบใหม่
 */

import type { WorkflowState } from '@/lib/constants/workflow-states';

export type StatusUrgency = 'none' | 'low' | 'medium' | 'high';

export interface StatusInfo {
  /** สิ่งที่ผู้ใช้ต้องทำตอนนี้ */
  nextAction: string;
  /** อธิบายสถานะปัจจุบัน */
  description: string;
  /** Lucide icon name */
  icon: string;
  /** ระดับความเร่งด่วน */
  urgency: StatusUrgency;
  /** อ้างอิง status ระบบเก่า (herbctrl) — สำหรับ dev reference */
  oldSystemRef?: string;
  /** URL path ที่ควรพาไป (ถ้ามี) */
  actionPath?: string;
  /** label ปุ่ม action */
  actionLabel?: string;
}

/**
 * Mapping: WorkflowState → StatusInfo
 *
 * อิงจาก 14 สถานะของระบบเก่า (herbctrl):
 * 1.  ลงทะเบียนและแนบเอกสารประกอบ → DRAFT
 * 2.  แจ้งชำระค่าธรรมเนียมคำขอ → PENDING_DOC_FEE
 * 3.  ชำระค่าคำขอเรียบร้อยแล้ว → DOC_FEE_PAID
 * 4.  อยู่ระหว่างการตรวจสอบเอกสาร → ASSIGNED_FOR_REVIEW
 * 5.  นัดตรวจสถานประกอบการ → AUDIT_CONFIRMED
 * 6.  ตรวจประเมินสถานประกอบการ → (AUDIT_CONFIRMED/CAR_PENDING)
 * 7.  ที่ตั้งสถานประกอบการไม่ถาวร → REJECTED (เหตุที่ตั้ง)
 * 8.  ได้รับการอนุมัติ → APPROVED
 * 9.  ไม่อนุมัติ → REJECTED
 * 10. ชำระค่าธรรมเนียมใบอนุญาต → PENDING_AUDIT_FEE
 * 11. ชำระค่าธรรมเนียมเรียบร้อยแล้ว → AUDIT_FEE_PAID
 * 12. ยกคำขอ (ไม่ชำระตามเวลา) → EXPIRED
 * 13. นัดหมายรับใบอนุญาต → (APPROVED)
 * 14. รับใบอนุญาตเรียบร้อยแล้ว → CERTIFIED
 */
export const STATUS_NEXT_ACTIONS: Record<WorkflowState, StatusInfo> = {
  DRAFT: {
    nextAction: 'กรอกข้อมูลให้ครบแล้วส่งคำขอ',
    description: 'คำขอยังอยู่ในร่าง ยังไม่ได้ส่ง',
    icon: 'FileEdit',
    urgency: 'medium',
    oldSystemRef: '1. ลงทะเบียนและแนบเอกสารประกอบ',
    actionLabel: 'แก้ไขคำขอ',
  },

  SUBMITTED: {
    nextAction: 'รอระบบตรวจสอบเบื้องต้นและแจ้งชำระค่าบริการ',
    description: 'คำขอถูกส่งแล้ว กำลังรอดำเนินการ',
    icon: 'Send',
    urgency: 'none',
    oldSystemRef: '1. ลงทะเบียนและแนบเอกสารประกอบ (ส่งแล้ว)',
  },

  PENDING_DOC_FEE: {
    nextAction: `ชำระ${SERVICE_NAME.PHASE_1} เพื่อเริ่มกระบวนการตรวจสอบ`,
    description: 'ต้องชำระค่าบริการก่อนเจ้าหน้าที่จะเริ่มตรวจเอกสาร',
    icon: 'CreditCard',
    urgency: 'high',
    oldSystemRef: '2. แจ้งชำระค่าธรรมเนียมคำขอ',
    actionLabel: 'ชำระเงิน',
  },

  DOC_FEE_PAID: {
    nextAction: 'รอเจ้าหน้าที่เริ่มตรวจเอกสาร ใช้เวลาประมาณ 3-5 วันทำการ',
    description: `ชำระ${SERVICE_NAME.PHASE_1}แล้ว กำลังรอเจ้าหน้าที่ตรวจสอบ`,
    icon: 'Clock',
    urgency: 'none',
    oldSystemRef: '3. ชำระค่าคำขอเรียบร้อยแล้ว',
  },

  ASSIGNED_FOR_REVIEW: {
    nextAction: 'รอเจ้าหน้าที่ตรวจสอบเอกสาร อาจมีการขอเอกสารเพิ่ม',
    description: 'เจ้าหน้าที่กำลังตรวจสอบเอกสารที่ยื่น',
    icon: 'Search',
    urgency: 'none',
    oldSystemRef: '4. อยู่ระหว่างการตรวจสอบเอกสาร',
  },

  REVISION_REQUESTED: {
    nextAction: 'แก้ไขเอกสารตามที่เจ้าหน้าที่แจ้ง แล้วส่งกลับ',
    description: 'เจ้าหน้าที่ขอให้แก้ไขเอกสารบางส่วน กรุณาดูรายละเอียดในหน้าคำขอ',
    icon: 'AlertCircle',
    urgency: 'high',
    oldSystemRef: '(ส่งกลับแก้ไข)',
    actionLabel: 'ดูรายการแก้ไข',
  },

  DOC_APPROVED: {
    nextAction: 'เอกสารผ่านแล้ว รอแจ้งชำระงวดที่ 2',
    description: 'เอกสารครบถ้วน กำลังรอขั้นตอนตรวจประเมินพื้นที่',
    icon: 'CheckCircle',
    urgency: 'none',
    oldSystemRef: '(เอกสารผ่าน → รอชำระค่าตรวจ)',
  },

  PENDING_AUDIT_FEE: {
    nextAction: 'ชำระค่าบริการ เพื่อนัดวันตรวจ',
    description: 'ต้องชำระค่าบริการ เพื่อดำเนินการนัดวันตรวจพื้นที่',
    icon: 'CreditCard',
    urgency: 'high',
    oldSystemRef: '10. ชำระค่าธรรมเนียมใบอนุญาต',
    actionLabel: 'ชำระเงิน',
  },

  AUDIT_FEE_PAID: {
    nextAction: 'รอเจ้าหน้าที่นัดวันตรวจประเมินแปลง',
    description: 'ชำระงวดที่ 2 แล้ว กำลังรอนัดวันตรวจแปลง',
    icon: 'Calendar',
    urgency: 'none',
    oldSystemRef: '11. ชำระค่าธรรมเนียมเรียบร้อยแล้ว',
  },

  AUDIT_CONFIRMED: {
    nextAction: 'เตรียมพื้นที่และเอกสารให้พร้อมก่อนวันตรวจประเมิน',
    description: 'นัดวันตรวจประเมินแล้ว กรุณาเตรียมตัวให้พร้อม',
    icon: 'MapPin',
    urgency: 'medium',
    oldSystemRef: '5. นัดตรวจสถานประกอบการ / 6. ตรวจประเมินสถานประกอบการ',
    actionLabel: 'ดูรายละเอียดนัดตรวจ',
  },

  CAR_PENDING: {
    nextAction: 'แก้ไขข้อบกพร่อง (CAR) ตามที่ผู้ตรวจแจ้ง แล้วส่งหลักฐาน',
    description: 'พบข้อบกพร่องจากการตรวจ ต้องแก้ไขและส่งหลักฐานกลับ',
    icon: 'AlertTriangle',
    urgency: 'high',
    oldSystemRef: '(ข้อบกพร่องจากการตรวจ)',
    actionLabel: 'ดูรายการ CAR',
  },

  CAR_REVIEWING: {
    nextAction: 'รอเจ้าหน้าที่ตรวจสอบหลักฐานการแก้ไข CAR',
    description: 'ส่งหลักฐานการแก้ไขแล้ว กำลังรอเจ้าหน้าที่ตรวจสอบ',
    icon: 'Clock',
    urgency: 'none',
    oldSystemRef: '(ตรวจ CAR)',
  },

  AUDIT_PASSED: {
    nextAction: 'ผ่านการตรวจประเมินแล้ว รอเจ้าหน้าที่อนุมัติ',
    description: 'ผ่านการตรวจประเมินเรียบร้อย กำลังรอการอนุมัติ',
    icon: 'ThumbsUp',
    urgency: 'none',
    oldSystemRef: '(ผ่านการตรวจ → รออนุมัติ)',
  },

  APPROVED: {
    nextAction: 'คำขอได้รับการอนุมัติแล้ว รอรับใบรับรอง GACP',
    description: 'คำขอผ่านการอนุมัติเรียบร้อยแล้ว',
    icon: 'Award',
    urgency: 'low',
    oldSystemRef: '8. ได้รับการอนุมัติ / 13. นัดหมายรับใบอนุญาต',
    actionLabel: 'ดูรายละเอียด',
  },

  CERTIFIED: {
    nextAction: 'ดาวน์โหลดใบรับรอง GACP และเริ่มส่งรายงานรายเดือน',
    description: 'ได้รับใบรับรอง GACP แล้ว ต้องส่งรายงานตามกำหนด',
    icon: 'BadgeCheck',
    urgency: 'low',
    oldSystemRef: '14. รับใบอนุญาตเรียบร้อยแล้ว',
    actionLabel: 'ดาวน์โหลดใบรับรอง',
  },

  REJECTED: {
    nextAction: 'ดูเหตุผลที่ไม่อนุมัติ สามารถยื่นคำขอใหม่ได้',
    description: 'คำขอไม่ได้รับการอนุมัติ สามารถดูเหตุผลและยื่นใหม่ได้',
    icon: 'XCircle',
    urgency: 'medium',
    oldSystemRef: '7. ที่ตั้งสถานประกอบการไม่ถาวร / 9. ไม่อนุมัติ',
    actionLabel: 'ดูเหตุผล',
  },

  EXPIRED: {
    nextAction: 'คำขอหมดอายุเนื่องจากไม่ดำเนินการตามเวลา สามารถยื่นใหม่ได้',
    description: 'คำขอถูกยกเลิกอัตโนมัติเนื่องจากหมดเวลาดำเนินการ',
    icon: 'Timer',
    urgency: 'none',
    oldSystemRef: '12. ยกคำขอ (ไม่ชำระตามเวลา)',
    actionLabel: 'ยื่นคำขอใหม่',
  },

  CANCEL_EXPIRED: {
    nextAction: 'คำขอถูกยกเลิกเนื่องจากหมดเวลาแก้ไข สามารถยื่นคำขอใหม่ได้',
    description: 'คำขอถูกยกเลิกอัตโนมัติเนื่องจากไม่แก้ไขภายใน 5 วันทำการ',
    icon: 'XCircle',
    urgency: 'none',
    actionLabel: 'ยื่นคำขอใหม่',
  },
};

// Helper functions

/** ดึง next action text สำหรับ status ที่กำหนด */
export function getNextAction(status: string): string {
  const info = STATUS_NEXT_ACTIONS[status as WorkflowState];
  return info?.nextAction ?? 'ดูรายละเอียดในหน้าคำขอ';
}

/** ดึง StatusInfo ทั้ง object */
export function getStatusInfo(status: string): StatusInfo {
  return (
    STATUS_NEXT_ACTIONS[status as WorkflowState] ?? {
      nextAction: 'ดูรายละเอียดในหน้าคำขอ',
      description: '',
      icon: 'Info',
      urgency: 'none' as StatusUrgency,
    }
  );
}

/** ตรวจว่า status ต้องให้ผู้ใช้ทำอะไร (user action required) */
export function isUserActionRequired(status: string): boolean {
  const info = STATUS_NEXT_ACTIONS[status as WorkflowState];
  return info?.urgency === 'high' || info?.urgency === 'medium';
}

/** ดึง status ทั้งหมดที่ต้องให้ผู้ใช้ทำอะไร */
export function getActionRequiredStatuses(): WorkflowState[] {
  return (Object.entries(STATUS_NEXT_ACTIONS) as [WorkflowState, StatusInfo][])
    .filter(([, info]) => info.urgency === 'high' || info.urgency === 'medium')
    .map(([state]) => state);
}
