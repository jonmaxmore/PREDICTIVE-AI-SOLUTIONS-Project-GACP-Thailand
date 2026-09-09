// interface เดียวของที่เก็บไฟล์ แอปไม่รู้ว่าข้างหลังเป็นดิสก์ S3 หรือ MinIO (สลับได้ตามหลักการ adapter)

export type StoredObject = {
  readonly bytes: Uint8Array;
  readonly contentType: string;
};

export interface FileStorage {
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<StoredObject>;
  delete(key: string): Promise<void>;
}

export class StoredObjectNotFoundError extends Error {
  readonly key: string;

  constructor(key: string) {
    super(`ไม่พบไฟล์ในที่เก็บ: ${key}`);
    this.name = 'StoredObjectNotFoundError';
    this.key = key;
  }
}

// key ต้องเป็นเส้นทางสัมพัทธ์ปลอดภัย: ตัวอักษร ตัวเลข / - _ . เท่านั้น ไม่มี .. และไม่เริ่มด้วย /
const SAFE_KEY_PATTERN = /^(?!\/)(?!.*(^|\/)\.\.(\/|$))[A-Za-z0-9/_.-]{1,512}$/;

export function assertSafeStorageKey(key: string): void {
  if (!SAFE_KEY_PATTERN.test(key)) {
    throw new RangeError(`key ของที่เก็บไฟล์ไม่ปลอดภัย: ${key}`);
  }
}

// key สุ่มต่อไฟล์ ไม่ใช้ชื่อไฟล์ของผู้ใช้ (ชื่อจริงเก็บในฐานข้อมูล) เพื่อไม่ให้เดาที่อยู่ไฟล์ได้
export function buildDocumentStorageKey(
  applicationId: string,
  slotCode: string,
  randomId: string,
): string {
  const key = `applications/${applicationId}/${slotCode.toLowerCase()}/${randomId}`;
  assertSafeStorageKey(key);
  return key;
}
