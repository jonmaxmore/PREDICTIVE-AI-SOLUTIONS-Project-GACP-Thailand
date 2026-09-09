import type { DocumentSlotCode, LicenseDeclarationStatus as LicenseStatus } from '@gacp/contracts';
import { LicenseDeclarationStatus } from '@gacp/contracts';

// "ช่องนี้มีเอกสารแล้วหรือยัง" สำหรับด่านส่ง (ขั้นที่ 6) และหน้าผู้ตรวจ ใช้กฎเดียวกันทั้งสองที่
// ช่องธรรมดา: มีไฟล์ปัจจุบันอย่างน้อยหนึ่งไฟล์
// ช่องใบอนุญาต: แนบใบอนุญาตแล้ว (HAVE + ไฟล์) หรือ ยื่นคำขอแล้วรอผล (APPLIED + หลักฐานการยื่น + เลขรับ)
// ยังไม่ได้ยื่น (NONE) หรือไม่แจ้งสถานะ = ยังไม่ครบ ระบบรับคำขอไม่ได้

export type AttachedDocumentSummary = {
  readonly slotCode: DocumentSlotCode;
  readonly fileCount: number;
};

export type LicenseDeclarationSummary = {
  readonly slotCode: DocumentSlotCode;
  readonly status: LicenseStatus;
  readonly receiptNumber: string | null;
};

export const LicenseSlotState = {
  ATTACHED: 'ATTACHED',
  PENDING_DECISION: 'PENDING_DECISION',
  NOT_FILED: 'NOT_FILED',
  UNDECLARED: 'UNDECLARED',
} as const;
export type LicenseSlotState = (typeof LicenseSlotState)[keyof typeof LicenseSlotState];

export function licenseSlotState(
  declaration: LicenseDeclarationSummary | undefined,
  fileCount: number,
): LicenseSlotState {
  if (!declaration) return LicenseSlotState.UNDECLARED;
  if (declaration.status === LicenseDeclarationStatus.HAVE) {
    return fileCount > 0 ? LicenseSlotState.ATTACHED : LicenseSlotState.UNDECLARED;
  }
  if (declaration.status === LicenseDeclarationStatus.APPLIED) {
    return fileCount > 0 && declaration.receiptNumber
      ? LicenseSlotState.PENDING_DECISION
      : LicenseSlotState.UNDECLARED;
  }
  return LicenseSlotState.NOT_FILED;
}

export function satisfiedSlotCodes(
  documents: readonly AttachedDocumentSummary[],
  licenseSlotCodes: ReadonlySet<DocumentSlotCode>,
  declarations: readonly LicenseDeclarationSummary[],
): ReadonlySet<DocumentSlotCode> {
  const fileCounts = new Map<DocumentSlotCode, number>();
  for (const document of documents) {
    fileCounts.set(
      document.slotCode,
      (fileCounts.get(document.slotCode) ?? 0) + document.fileCount,
    );
  }
  const declarationBySlot = new Map(
    declarations.map((declaration) => [declaration.slotCode, declaration]),
  );
  const satisfied = new Set<DocumentSlotCode>();
  for (const [slotCode, count] of fileCounts) {
    if (licenseSlotCodes.has(slotCode)) continue;
    if (count > 0) satisfied.add(slotCode);
  }
  for (const slotCode of licenseSlotCodes) {
    const state = licenseSlotState(declarationBySlot.get(slotCode), fileCounts.get(slotCode) ?? 0);
    if (state === LicenseSlotState.ATTACHED || state === LicenseSlotState.PENDING_DECISION) {
      satisfied.add(slotCode);
    }
  }
  return satisfied;
}
