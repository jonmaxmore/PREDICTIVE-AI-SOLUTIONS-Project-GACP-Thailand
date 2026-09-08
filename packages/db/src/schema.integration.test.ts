import {
  ActorKind,
  ApplicantType,
  ApplicationStatus,
  AreaType,
  CertificationScope,
  IdentityProvider,
  LandTenure,
  Purpose,
  RequestType,
  readEnv,
  UserRole,
} from '@gacp/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabaseClient, type DatabaseClient } from './client.ts';

// ตรวจว่าฐานข้อมูลจริง (หลัง migrate) ตรงกับ contracts ทุกชุดค่าปิด และชื่อทุกตารางทุกคอลัมน์เป็น snake_case
const SNAKE_CASE = /^[a-z][a-z0-9]*(_[a-z0-9]+)*$/;

const enumsInDatabase: ReadonlyArray<readonly [string, Record<string, string>]> = [
  ['application_status', ApplicationStatus],
  ['user_role', UserRole],
  ['applicant_type', ApplicantType],
  ['request_type', RequestType],
  ['certification_scope', CertificationScope],
  ['purpose', Purpose],
  ['area_type', AreaType],
  ['land_tenure', LandTenure],
  ['identity_provider', IdentityProvider],
  ['actor_kind', ActorKind],
];

let database: DatabaseClient;

beforeAll(() => {
  database = createDatabaseClient(readEnv().GACP_DATABASE_URL);
});

afterAll(async () => {
  await database.$disconnect();
});

describe('ฐานข้อมูลหลัง migrate', () => {
  it('เชื่อมต่อได้และ migration รากฐานถูกบันทึกแล้ว', async () => {
    const rows = await database.$queryRaw<Array<{ migrationName: string }>>`
      SELECT migration_name AS "migrationName"
      FROM _prisma_migrations
      WHERE finished_at IS NOT NULL
      ORDER BY started_at
    `;
    expect(rows.map((row) => row.migrationName)).toContain('20260908000000_foundation');
  });

  it.each(enumsInDatabase)(
    'enum %s ในฐานข้อมูลตรงกับ contracts ทั้งค่าและลำดับ',
    async (typeName, record) => {
      const rows = await database.$queryRaw<Array<{ label: string }>>`
        SELECT e.enumlabel AS "label"
        FROM pg_enum e
        JOIN pg_type t ON t.oid = e.enumtypid
        WHERE t.typname = ${typeName}
        ORDER BY e.enumsortorder
      `;
      expect(rows.map((row) => row.label)).toEqual(Object.keys(record));
    },
  );

  it('ทุกตารางและทุกคอลัมน์ใน public เป็น snake_case', async () => {
    const columns = await database.$queryRaw<Array<{ tableName: string; columnName: string }>>`
      SELECT table_name AS "tableName", column_name AS "columnName"
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name NOT LIKE '\\_prisma%'
    `;
    expect(columns.length).toBeGreaterThan(0);
    const offenders = columns
      .filter((column) => !SNAKE_CASE.test(column.tableName) || !SNAKE_CASE.test(column.columnName))
      .map((column) => `${column.tableName}.${column.columnName}`);
    expect(offenders).toEqual([]);
  });

  it('ตารางผู้ขอรับรองไม่มีคอลัมน์เลขบัตรประชาชนแบบ plaintext (PDPA)', async () => {
    const columns = await database.$queryRaw<Array<{ columnName: string }>>`
      SELECT column_name AS "columnName"
      FROM information_schema.columns
      WHERE table_schema = 'public' AND table_name = 'applicants' AND column_name LIKE 'national_id%'
    `;
    expect(columns.map((column) => column.columnName).sort()).toEqual([
      'national_id_encrypted',
      'national_id_hmac',
    ]);
  });
});
