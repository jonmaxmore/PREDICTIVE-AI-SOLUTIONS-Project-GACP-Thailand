import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildDocumentStorageKey, StoredObjectNotFoundError } from './file-storage.ts';
import { LocalDiskStorage } from './local-disk-storage.ts';

let rootDir: string;
let storage: LocalDiskStorage;

beforeAll(async () => {
  rootDir = await mkdtemp(join(tmpdir(), 'gacp-storage-'));
  storage = new LocalDiskStorage(rootDir);
});

afterAll(async () => {
  await rm(rootDir, { recursive: true, force: true });
});

describe('LocalDiskStorage', () => {
  it('เก็บ อ่าน และลบไฟล์พร้อมชนิดไฟล์', async () => {
    const key = buildDocumentStorageKey(
      '0f4a3c2e-1111-4222-8333-444455556666',
      'LAND_RIGHTS_DOCUMENT',
      'abc123',
    );
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]);
    await storage.put(key, bytes, 'application/pdf');
    const stored = await storage.get(key);
    expect([...stored.bytes]).toEqual([...bytes]);
    expect(stored.contentType).toBe('application/pdf');
    await storage.delete(key);
    await expect(storage.get(key)).rejects.toBeInstanceOf(StoredObjectNotFoundError);
  });

  it('ปฏิเสธ key ที่ชี้ออกนอกที่เก็บ', async () => {
    await expect(
      storage.put('../escape', new Uint8Array([1]), 'text/plain'),
    ).rejects.toBeInstanceOf(RangeError);
    await expect(storage.get('/absolute')).rejects.toBeInstanceOf(RangeError);
    expect(() => buildDocumentStorageKey('id', 'SLOT', '../x')).toThrow(RangeError);
  });
});
