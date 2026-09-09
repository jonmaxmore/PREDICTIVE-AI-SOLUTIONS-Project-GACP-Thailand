import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, resolve, sep } from 'node:path';
import {
  assertSafeStorageKey,
  type FileStorage,
  type StoredObject,
  StoredObjectNotFoundError,
} from './file-storage.ts';

// ดิสก์ในเครื่องสำหรับ dev/test เท่านั้น (env ห้ามใช้นอก development/test) เก็บชนิดไฟล์ในไฟล์ .meta ข้างกัน
export class LocalDiskStorage implements FileStorage {
  private readonly rootDir: string;

  constructor(rootDir: string) {
    this.rootDir = resolve(rootDir);
  }

  private pathFor(key: string): string {
    assertSafeStorageKey(key);
    const target = resolve(this.rootDir, key);
    if (!target.startsWith(this.rootDir + sep)) {
      throw new RangeError(`key ชี้ออกนอกที่เก็บไฟล์: ${key}`);
    }
    return target;
  }

  async put(key: string, bytes: Uint8Array, contentType: string): Promise<void> {
    const target = this.pathFor(key);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes);
    await writeFile(`${target}.meta`, JSON.stringify({ contentType }), 'utf8');
  }

  async get(key: string): Promise<StoredObject> {
    const target = this.pathFor(key);
    try {
      const [bytes, meta] = await Promise.all([
        readFile(target),
        readFile(`${target}.meta`, 'utf8'),
      ]);
      const { contentType } = JSON.parse(meta) as { contentType: string };
      return { bytes: new Uint8Array(bytes), contentType };
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT')
        throw new StoredObjectNotFoundError(key);
      throw error;
    }
  }

  async delete(key: string): Promise<void> {
    const target = this.pathFor(key);
    await rm(target, { force: true });
    await rm(`${target}.meta`, { force: true });
  }
}
