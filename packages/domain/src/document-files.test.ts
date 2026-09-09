import type { DocumentSlotDefinition } from '@gacp/contracts';
import { DocumentSlotCode, DocumentSlotGroup } from '@gacp/contracts';
import { describe, expect, it } from 'vitest';
import { detectFileKind, UploadRejectionCode, validateUpload } from './document-files.ts';

const pdfHead = new Uint8Array([
  0x25, 0x50, 0x44, 0x46, 0x2d, 0x31, 0x2e, 0x37, 0x0a, 0, 0, 0, 0, 0, 0, 0,
]);
const pngHead = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0x0d, 0x49, 0x48, 0x44, 0x52,
]);
const webpHead = new Uint8Array([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50, 0x56, 0x50, 0x38, 0x20,
]);
const textHead = new TextEncoder().encode('hello world, not a document');

const slot: DocumentSlotDefinition = {
  code: DocumentSlotCode.LAND_RIGHTS_DOCUMENT,
  group: DocumentSlotGroup.LAND_AND_SITE,
  formStep: 3,
  sortOrder: 1,
  labelTh: 'สำเนาเอกสารสิทธิ์ที่ดิน',
  whatIsItTh: 'ทดสอบ',
  howToObtainTh: null,
  acceptedMimeTypes: ['application/pdf', 'image/png'],
  maxFiles: 2,
  maxFileBytes: 1_000,
  requiresIssuedDate: false,
  issuedWithinDays: null,
  isLicense: false,
  subItemCodes: null,
  isSystemGenerated: false,
};

describe('detectFileKind', () => {
  it('รู้จัก PDF PNG WEBP และไม่รู้จักข้อความธรรมดา', () => {
    expect(detectFileKind(pdfHead)).toBe('application/pdf');
    expect(detectFileKind(pngHead)).toBe('image/png');
    expect(detectFileKind(webpHead)).toBe('image/webp');
    expect(detectFileKind(textHead)).toBeNull();
  });
});

describe('validateUpload', () => {
  const candidate = {
    declaredMimeType: 'application/pdf',
    byteSize: 500,
    head: pdfHead,
    issuedOn: null,
  };

  it('รับไฟล์ที่ชนิดตรงกับเนื้อและอยู่ในขนาด', () => {
    expect(validateUpload(slot, candidate, 0)).toEqual({ ok: true, mimeType: 'application/pdf' });
  });

  it('ปฏิเสธเมื่อเนื้อไฟล์ไม่ตรงกับชนิดที่แจ้ง (เปลี่ยนนามสกุลไม่ช่วย)', () => {
    expect(validateUpload(slot, { ...candidate, head: textHead }, 0)).toEqual({
      ok: false,
      code: UploadRejectionCode.CONTENT_MISMATCH,
    });
    expect(validateUpload(slot, { ...candidate, head: pngHead }, 0)).toEqual({
      ok: false,
      code: UploadRejectionCode.CONTENT_MISMATCH,
    });
  });

  it('ปฏิเสธชนิดที่ช่องไม่รับ ขนาดเกิน ไฟล์ว่าง และจำนวนไฟล์เกิน', () => {
    expect(
      validateUpload(slot, { ...candidate, declaredMimeType: 'image/webp', head: webpHead }, 0),
    ).toEqual({
      ok: false,
      code: UploadRejectionCode.MIME_NOT_ALLOWED,
    });
    expect(validateUpload(slot, { ...candidate, byteSize: 1_001 }, 0)).toEqual({
      ok: false,
      code: UploadRejectionCode.TOO_LARGE,
    });
    expect(validateUpload(slot, { ...candidate, byteSize: 0 }, 0)).toEqual({
      ok: false,
      code: UploadRejectionCode.EMPTY_FILE,
    });
    expect(validateUpload(slot, candidate, 2)).toEqual({
      ok: false,
      code: UploadRejectionCode.TOO_MANY_FILES,
    });
  });

  it('ช่องที่ต้องมีวันที่ออกเอกสารปฏิเสธเมื่อไม่ระบุ และช่องระบบสร้างรับอัปโหลดไม่ได้', () => {
    expect(validateUpload({ ...slot, requiresIssuedDate: true }, candidate, 0)).toEqual({
      ok: false,
      code: UploadRejectionCode.ISSUED_DATE_REQUIRED,
    });
    expect(
      validateUpload(
        { ...slot, requiresIssuedDate: true },
        { ...candidate, issuedOn: '2026-09-01' },
        0,
      ),
    ).toEqual({
      ok: true,
      mimeType: 'application/pdf',
    });
    expect(validateUpload({ ...slot, isSystemGenerated: true }, candidate, 0)).toEqual({
      ok: false,
      code: UploadRejectionCode.SYSTEM_GENERATED_SLOT,
    });
  });
});
