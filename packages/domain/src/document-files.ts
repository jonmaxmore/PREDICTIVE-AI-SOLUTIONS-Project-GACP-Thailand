import type { DocumentSlotDefinition } from '@gacp/contracts';

// ตรวจไฟล์ที่อัปโหลดจากเนื้อจริง (magic bytes) ไม่เชื่อชื่อไฟล์หรือ MIME ที่เบราว์เซอร์แจ้ง (หลักการข้อ 8)

export const DetectedFileKind = {
  PDF: 'application/pdf',
  JPEG: 'image/jpeg',
  PNG: 'image/png',
  WEBP: 'image/webp',
  ZIP_OFFICE: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
} as const;
export type DetectedFileKind = (typeof DetectedFileKind)[keyof typeof DetectedFileKind];

function startsWith(bytes: Uint8Array, signature: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + signature.length) return false;
  return signature.every((value, index) => bytes[offset + index] === value);
}

// คืนชนิดจากลายเซ็นของไฟล์ หรือ null เมื่อไม่รู้จัก (DOCX คือ zip ที่ประกาศเป็น docx จึงตรวจได้แค่ระดับ zip)
export function detectFileKind(bytes: Uint8Array): DetectedFileKind | null {
  if (startsWith(bytes, [0x25, 0x50, 0x44, 0x46, 0x2d])) return DetectedFileKind.PDF; // %PDF-
  if (startsWith(bytes, [0xff, 0xd8, 0xff])) return DetectedFileKind.JPEG;
  if (startsWith(bytes, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
    return DetectedFileKind.PNG;
  if (
    startsWith(bytes, [0x52, 0x49, 0x46, 0x46]) &&
    startsWith(bytes, [0x57, 0x45, 0x42, 0x50], 8)
  ) {
    return DetectedFileKind.WEBP; // RIFF....WEBP
  }
  if (startsWith(bytes, [0x50, 0x4b, 0x03, 0x04])) return DetectedFileKind.ZIP_OFFICE;
  return null;
}

export const UploadRejectionCode = {
  EMPTY_FILE: 'EMPTY_FILE',
  TOO_LARGE: 'TOO_LARGE',
  MIME_NOT_ALLOWED: 'MIME_NOT_ALLOWED',
  CONTENT_MISMATCH: 'CONTENT_MISMATCH',
  TOO_MANY_FILES: 'TOO_MANY_FILES',
  ISSUED_DATE_REQUIRED: 'ISSUED_DATE_REQUIRED',
  SYSTEM_GENERATED_SLOT: 'SYSTEM_GENERATED_SLOT',
} as const;
export type UploadRejectionCode = (typeof UploadRejectionCode)[keyof typeof UploadRejectionCode];

export type UploadCandidate = {
  readonly declaredMimeType: string;
  readonly byteSize: number;
  readonly head: Uint8Array; // ไบต์แรก ๆ ของไฟล์ (อย่างน้อย 16 ไบต์)
  readonly issuedOn: string | null;
};

export type UploadValidation =
  | { readonly ok: true; readonly mimeType: string }
  | { readonly ok: false; readonly code: UploadRejectionCode };

// ท่ออัปโหลดเดียวเรียกฟังก์ชันนี้ก่อนเก็บไฟล์ทุกครั้ง
export function validateUpload(
  slot: DocumentSlotDefinition,
  candidate: UploadCandidate,
  currentFileCount: number,
): UploadValidation {
  if (slot.isSystemGenerated) return { ok: false, code: UploadRejectionCode.SYSTEM_GENERATED_SLOT };
  if (candidate.byteSize <= 0) return { ok: false, code: UploadRejectionCode.EMPTY_FILE };
  if (candidate.byteSize > slot.maxFileBytes)
    return { ok: false, code: UploadRejectionCode.TOO_LARGE };
  if (currentFileCount >= slot.maxFiles)
    return { ok: false, code: UploadRejectionCode.TOO_MANY_FILES };
  if (!slot.acceptedMimeTypes.includes(candidate.declaredMimeType)) {
    return { ok: false, code: UploadRejectionCode.MIME_NOT_ALLOWED };
  }
  const detected = detectFileKind(candidate.head);
  if (detected === null || detected !== candidate.declaredMimeType) {
    return { ok: false, code: UploadRejectionCode.CONTENT_MISMATCH };
  }
  if (slot.requiresIssuedDate && candidate.issuedOn === null) {
    return { ok: false, code: UploadRejectionCode.ISSUED_DATE_REQUIRED };
  }
  return { ok: true, mimeType: detected };
}
