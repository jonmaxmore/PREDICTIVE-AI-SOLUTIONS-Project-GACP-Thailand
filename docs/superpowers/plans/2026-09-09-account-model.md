# Account Model (Health ID · Provider ID · ThaID) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** เปลี่ยนโมเดลบัญชีจาก 7 บทบาท + provider เดียว เป็น 3 ฝั่ง (ผู้รับบริการ / เจ้าหน้าที่กรม / บริษัท) 9 บทบาท ล็อกอิน 3 ทาง (Health ID, Provider ID ต่อจาก Health ID, ThaID) พร้อมกติกา "เครดิตของฝั่ง → บทบาทที่ถือได้" ที่บังคับใน domain

**Architecture:** `User` = บุคคลหนึ่งคน มีตัวตนหลายทาง (`UserIdentity`) เชื่อมด้วย HMAC เลขบัตร · เครดิตสองแบบเปิดทางให้บทบาทสองฝั่ง (`ProviderCredential` จาก Provider ID ของ MOPH, `PlatformOperatorMembership` จากรายชื่อพนักงานบริษัท) · บทบาทมีผล = บทบาทที่ถูกมอบ ∩ บทบาทที่เครดิตอนุญาต คำนวณตอนล็อกอินใน `completeSignIn()` · ThaID ผ่าน `openid-client` v6 (OIDC) · Health ID/Provider ID ผ่าน `fetch` ตามคู่มือ MOPH (OAuth2 ธรรมดา) · ทุก client อยู่หลัง interface และมี fake สำหรับ test · เส้นทางจัดกลุ่มตามฝั่ง

**Tech Stack:** Next.js 16.3 (App Router, Route Handlers, Server Actions), openid-client 6.8, jose 6.2, Zod 4, Prisma 7.10 (multi-file schema, SQL migration แก้มือ), Vitest 5, Biome 2.5, Node 24

**Spec:** `docs/superpowers/specs/2026-09-09-account-model-design.md` (อนุมัติ 2026-09-09) · ADR: `docs/adr/0004-account-model.md`

## Global Constraints

- ชื่อทุกชื่อตาม `docs/glossary.md`: หนึ่งแนวคิดหนึ่งชื่อ ไม่ย่อ ค่าในชุดปิด `UPPER_SNAKE_CASE` และค่า = ชื่อ ประกาศด้วย `as const` + `z.enum(enumValues(...))` · ไฟล์ `kebab-case` · ตาราง/คอลัมน์ `snake_case` ผ่าน `@map`/`@@map`
- คำต้องห้าม (`scripts/check-glossary.ts`) รวม `organization` → **ใช้ `agency` (หน่วยงาน/สังกัด) ในชื่อของเราทั้งหมด** ชื่อ `AuthorizedProviderOrganization` ใน spec §7 จึงเป็น `AuthorizedProviderAgency` · บรรทัดที่ต้องอ่าน field `organization` ของ MOPH ใส่คอมเมนต์ `glossary-allow` ท้ายบรรทัด
- ชื่อที่เลิกใช้และห้ามปรากฏในโค้ดใหม่: `FINANCE_OFFICER`, `SYSTEM_ADMIN` (ยกเว้น migration SQL ที่แปลงค่าเดิม ใส่ `-- glossary-allow`)
- TypeScript 5.9 `erasableSyntaxOnly` (ไม่มี `enum`), import ระบุ `.ts`/`.tsx`, `exactOptionalPropertyTypes` เปิดอยู่ (prop ที่รับ `undefined` ต้องเขียน `| undefined`)
- ข้อความไทยทุกชิ้นอยู่ใน `apps/web/src/messages/th.ts` เท่านั้น ใช้ "คุณ" ไม่มี em dash ไม่โชว์ raw enum
- PDPA: เลขบัตรประชาชนและ `sub` ของ IdP เก็บเป็น HMAC (`hmacField`) เท่านั้น ไม่ลง log · ไม่เก็บ access token ของ MOPH/DOPA หลังจบ request · dev login เปิดได้เฉพาะ `development`/`test`
- คำสั่งรัน: `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm ...` จากราก repo `C:\Users\charo\Documents\GitHub\GACP` · ฐานข้อมูลพัฒนาต้องรันอยู่ (`corepack pnpm --filter @gacp/db db:dev`) · ทุก task จบด้วย `corepack pnpm exec biome check --write .` และ typecheck ของแพ็กเกจที่แก้
- Commit เป็น Conventional Commits ภาษาไทย ปิดท้ายด้วย `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` · ทำงานบน branch `feat/account-model` (มีอยู่แล้ว มี spec + ADR commit แรก)

---

## File map

| ไฟล์ | หน้าที่ | Task |
|---|---|---|
| `packages/contracts/src/enums.ts` | `UserRole` 9 ค่า, `RoleSide`, `roleSideOf`, `ROLES_BY_SIDE`, `IdentityProvider` 3 ค่า, `LoginIntent` | 1 |
| `packages/contracts/src/identity.ts` (ใหม่) | schema ของ claims ThaID และ profile Provider ID ที่เราเก็บ (normalized) | 1 |
| `packages/contracts/src/env.ts` | env ใหม่ 10 ตัว + กฎบังคับใน demo/staging/production | 1 |
| `packages/contracts/src/index.ts` | export ชื่อใหม่ | 1 |
| `scripts/check-glossary.ts`, `docs/glossary.md` | คำต้องห้ามใหม่, ข้าม `prisma/migrations/`, §2 บทบาท 9 แบบ, คำใหม่ | 1 |
| `packages/db/prisma/schema/identity.prisma` | enums, `User.nationalIdHmac`, `UserIdentity.identityAssuranceLevel/verifiedAt`, 3 model ใหม่ | 2 |
| `packages/db/prisma/migrations/2026090912xxxx_account_model/migration.sql` | แปลง enum แบบไม่ทิ้งข้อมูล + ตารางใหม่ | 2 |
| `packages/db/src/schema.integration.test.ts` | ตารางใหม่มีอยู่และ unique ถูกต้อง | 2 |
| `packages/domain/src/account-access.ts` (+ test) | `permittedRolesFor`, `effectiveRoles`, `canAssignRole` | 3 |
| `apps/web/src/lib/identity/thaid-client.ts` | `ThaidClient` interface + `OpenIdThaidClient` (openid-client) | 4 |
| `apps/web/src/lib/identity/morphrom-client.ts` | `MorphromClient` interface + `HttpMorphromClient` (Health ID + Provider ID) | 4 |
| `apps/web/src/lib/identity/fake-identity-clients.ts` (+ tests) | `FakeThaidClient`, `FakeMorphromClient` สำหรับ test | 4 |
| `apps/web/src/lib/identity/identity-clients.ts` | เลือก client จริงหรือ fake ตาม env (singleton) | 4 |
| `apps/web/src/lib/identity/login-state.ts` | cookie ชั่วคราว (state, nonce, PKCE verifier, intent) เข้ารหัสด้วย jose | 5 |
| `apps/web/src/lib/identity/sign-in.ts` (+ test) | `completeSignIn()`: upsert user/identity/credential, บทบาทมีผล, session | 5 |
| `apps/web/src/app/auth/thaid/start/route.ts`, `.../thaid/callback/route.ts` | ThaID OIDC | 5 |
| `apps/web/src/app/auth/morphrom/start/route.ts`, `.../morphrom/callback/route.ts` | Health ID + Provider ID | 5 |
| `apps/web/src/app/auth/outcome/page.tsx` | หน้าผลลัพธ์เมื่อเข้าไม่ได้ (ไม่มี Provider ID, สังกัดไม่อนุญาต, ไม่อยู่ในรายชื่อ, ยังไม่มีบทบาท) | 5 |
| `apps/web/src/lib/current-user.ts`, `apps/web/src/app/auth/login/actions.ts` | ใช้ `completeSignIn`, dev login สร้างเครดิตของฝั่ง | 5 |
| `apps/web/src/lib/roles.ts`, `apps/web/src/proxy.ts`, `apps/web/src/app/{certification-body,platform-operator}/...` | เส้นทางตามฝั่ง, หน้าล็อกอินบริษัท | 6 |
| `apps/web/src/messages/th.ts`, `apps/web/src/components/role-shell.tsx`, `apps/web/src/app/auth/login/page.tsx` | ป้าย 9 บทบาท 3 ฝั่ง, ปุ่มล็อกอิน 3 ทาง, สีฝั่ง | 6 |
| `apps/web/src/app/platform-operator/admin/{page.tsx,actions.ts}` | รายชื่อพนักงาน, บทบาทฝั่งบริษัท, ตั้งผู้ดูแลกรม | 7 |
| `apps/web/src/app/certification-body/admin/{page.tsx,actions.ts}` | หน่วยงานที่อนุญาต, บทบาทฝั่งกรม | 7 |
| `apps/web/src/lib/audit.ts` | `recordAudit()` เขียน `audit_logs` | 7 |
| `packages/db/scripts/platform-operator-bootstrap.ts` | คำสั่งเพิ่มผู้ดูแลระบบคนแรกของบริษัท | 8 |
| `docs/adr/0001-principles.md`, `docs/superpowers/specs/...`, แผน `fizzy-orbiting-kay.md`, memory | ถ้อยคำและสถานะ | 9 |

---

### Task 1: contracts — บทบาท 9 แบบ ฝั่ง ผู้ให้บริการยืนยันตัวตน env และ glossary

**Files:**
- Modify: `packages/contracts/src/enums.ts`
- Create: `packages/contracts/src/identity.ts`
- Modify: `packages/contracts/src/env.ts`, `packages/contracts/src/env.test.ts`, `packages/contracts/src/enums.test.ts`, `packages/contracts/src/index.ts`
- Modify: `scripts/check-glossary.ts`, `docs/glossary.md`

**Interfaces:**
- Produces: `UserRole` (9), `RoleSide`, `roleSideOf(role): RoleSide`, `ROLES_BY_SIDE`, `IdentityProvider` (`THAID | MORPHROM_HEALTH_ID | DEV_LOCAL`), `LoginIntent`, `thaidIdentityClaimsSchema`/`ThaidIdentityClaims`, `providerAffiliationSchema`, `morphromProviderProfileSchema`/`MorphromProviderProfile`, env keys ใน §8 ของ spec

- [ ] **Step 1: เขียน test ที่ล้มก่อน (enums)**

แทนที่ block `describe('ชุดค่าปิด', ...)` ใน `packages/contracts/src/enums.test.ts` ด้วย:

```ts
import { describe, expect, it } from 'vitest';
import {
  ApplicantType,
  ApplicationStatus,
  AreaType,
  CertificationScope,
  FeeStage,
  IdentityProvider,
  LandTenure,
  LoginIntent,
  Purpose,
  RequestType,
  ROLES_BY_SIDE,
  RoleSide,
  roleSideOf,
  TERMINAL_APPLICATION_STATUSES,
  UserRole,
} from './enums.ts';

const closedSets: ReadonlyArray<readonly [string, Record<string, string>]> = [
  ['UserRole', UserRole],
  ['RoleSide', RoleSide],
  ['LoginIntent', LoginIntent],
  ['IdentityProvider', IdentityProvider],
  ['ApplicantType', ApplicantType],
  ['RequestType', RequestType],
  ['CertificationScope', CertificationScope],
  ['Purpose', Purpose],
  ['AreaType', AreaType],
  ['LandTenure', LandTenure],
  ['FeeStage', FeeStage],
  ['ApplicationStatus', ApplicationStatus],
];

describe('ชุดค่าปิด', () => {
  it('ทุกค่าเท่ากับชื่อและเป็น UPPER_SNAKE_CASE', () => {
    for (const [setName, record] of closedSets) {
      for (const [key, value] of Object.entries(record)) {
        expect(value, `${setName}.${key}`).toBe(key);
        expect(key, `${setName}.${key}`).toMatch(/^[A-Z][A-Z0-9_]*$/);
      }
    }
  });

  it('มี 9 บทบาท 3 ฝั่ง และทุกบทบาทอยู่ฝั่งเดียว', () => {
    expect(Object.keys(UserRole)).toHaveLength(9);
    expect(Object.keys(RoleSide)).toHaveLength(3);
    const seen = new Set<string>();
    for (const roles of Object.values(ROLES_BY_SIDE)) {
      for (const role of roles) {
        expect(seen.has(role), role).toBe(false);
        seen.add(role);
      }
    }
    expect(seen.size).toBe(9);
    expect(roleSideOf(UserRole.APPLICANT)).toBe(RoleSide.APPLICANT);
    expect(roleSideOf(UserRole.DISPATCHER)).toBe(RoleSide.CERTIFICATION_BODY);
    expect(roleSideOf(UserRole.CERTIFICATION_BODY_FINANCE_OFFICER)).toBe(RoleSide.CERTIFICATION_BODY);
    expect(roleSideOf(UserRole.PLATFORM_OPERATOR_ADMIN)).toBe(RoleSide.PLATFORM_OPERATOR);
  });

  it('ผู้ให้บริการยืนยันตัวตนคือ ThaID, Health ID ของหมอพร้อม และ dev เท่านั้น', () => {
    expect(Object.keys(IdentityProvider)).toEqual(['THAID', 'MORPHROM_HEALTH_ID', 'DEV_LOCAL']);
  });

  it('สถานะคำขอมี 12 สถานะในเส้นงาน + 5 ปลายทาง', () => {
    expect(Object.keys(ApplicationStatus)).toHaveLength(17);
    expect(TERMINAL_APPLICATION_STATUSES.size).toBe(5);
    expect(TERMINAL_APPLICATION_STATUSES.has(ApplicationStatus.CERTIFIED)).toBe(false);
  });
});
```

- [ ] **Step 2: รัน test ให้เห็นว่าล้ม**

Run: `cd packages/contracts && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec vitest run src/enums.test.ts`
Expected: FAIL (`RoleSide` is not exported / `toHaveLength(9)` ได้ 7)

- [ ] **Step 3: แก้ `enums.ts`**

แทนที่ block `UserRole` (บรรทัด 4-15) ด้วย:

```ts
// บทบาทผู้ใช้ 9 แบบ 3 ฝั่ง (docs/glossary.md §2) หนึ่งคนถือได้หลายบทบาท ไม่มีบทบาทผสม
// ลำดับต้องตรงกับ enum user_role ในฐานข้อมูล (ทดสอบใน packages/db)
export const UserRole = {
  APPLICANT: 'APPLICANT',
  DOCUMENT_REVIEWER: 'DOCUMENT_REVIEWER',
  DISPATCHER: 'DISPATCHER',
  FIELD_INSPECTOR: 'FIELD_INSPECTOR',
  CERTIFICATE_APPROVER: 'CERTIFICATE_APPROVER',
  CERTIFICATION_BODY_ADMIN: 'CERTIFICATION_BODY_ADMIN',
  CERTIFICATION_BODY_FINANCE_OFFICER: 'CERTIFICATION_BODY_FINANCE_OFFICER',
  PLATFORM_OPERATOR_ADMIN: 'PLATFORM_OPERATOR_ADMIN',
  PLATFORM_OPERATOR_FINANCE_OFFICER: 'PLATFORM_OPERATOR_FINANCE_OFFICER',
} as const;
export type UserRole = (typeof UserRole)[keyof typeof UserRole];
export const userRoleSchema = z.enum(enumValues(UserRole));

// ฝั่งของบทบาท: ผู้รับบริการ · เจ้าหน้าที่กรม (CertificationBody) · บริษัทผู้ให้บริการแพลตฟอร์ม (PlatformOperator)
export const RoleSide = {
  APPLICANT: 'APPLICANT',
  CERTIFICATION_BODY: 'CERTIFICATION_BODY',
  PLATFORM_OPERATOR: 'PLATFORM_OPERATOR',
} as const;
export type RoleSide = (typeof RoleSide)[keyof typeof RoleSide];
export const roleSideSchema = z.enum(enumValues(RoleSide));

export const ROLES_BY_SIDE: Readonly<Record<RoleSide, readonly UserRole[]>> = {
  [RoleSide.APPLICANT]: [UserRole.APPLICANT],
  [RoleSide.CERTIFICATION_BODY]: [
    UserRole.DOCUMENT_REVIEWER,
    UserRole.DISPATCHER,
    UserRole.FIELD_INSPECTOR,
    UserRole.CERTIFICATE_APPROVER,
    UserRole.CERTIFICATION_BODY_ADMIN,
    UserRole.CERTIFICATION_BODY_FINANCE_OFFICER,
  ],
  [RoleSide.PLATFORM_OPERATOR]: [
    UserRole.PLATFORM_OPERATOR_ADMIN,
    UserRole.PLATFORM_OPERATOR_FINANCE_OFFICER,
  ],
};

export function roleSideOf(role: UserRole): RoleSide {
  for (const [side, roles] of Object.entries(ROLES_BY_SIDE) as [RoleSide, readonly UserRole[]][]) {
    if (roles.includes(role)) return side;
  }
  throw new RangeError(`ไม่รู้ฝั่งของบทบาท ${role}`);
}

// ความตั้งใจตอนกดล็อกอิน กำหนดว่าหลังพิสูจน์ตัวตนแล้วต้องตรวจเครดิตของฝั่งไหนต่อ
export const LoginIntent = {
  APPLICANT: 'APPLICANT',
  CERTIFICATION_BODY_STAFF: 'CERTIFICATION_BODY_STAFF',
  PLATFORM_OPERATOR_STAFF: 'PLATFORM_OPERATOR_STAFF',
} as const;
export type LoginIntent = (typeof LoginIntent)[keyof typeof LoginIntent];
export const loginIntentSchema = z.enum(enumValues(LoginIntent));
```

และแทนที่ block `IdentityProvider` ท้ายไฟล์ด้วย:

```ts
// วิธีที่บุคคลพิสูจน์ตัวตน: ThaID (กรมการปกครอง) · Health ID ของหมอพร้อม (MOPH) · dev เท่านั้น
// Provider ID ไม่ใช่ provider แยก แต่เป็นเครดิต (ProviderCredential) ที่ต่อจาก Health ID
export const IdentityProvider = {
  THAID: 'THAID',
  MORPHROM_HEALTH_ID: 'MORPHROM_HEALTH_ID',
  DEV_LOCAL: 'DEV_LOCAL',
} as const;
export type IdentityProvider = (typeof IdentityProvider)[keyof typeof IdentityProvider];
export const identityProviderSchema = z.enum(enumValues(IdentityProvider));
```

- [ ] **Step 4: สร้าง `packages/contracts/src/identity.ts`**

```ts
import { z } from 'zod';

// สิ่งที่เราเก็บจากผู้ให้บริการยืนยันตัวตน เฉพาะ field ที่ใช้ ไม่เก็บ token
// ThaID: claims ใน id_token ตาม scope openid pid name given_name family_name ial
export const thaidIdentityClaimsSchema = z.object({
  sub: z.string().min(1),
  pid: z.string().regex(/^\d{13}$/).optional(),
  name: z.string().min(1).optional(),
  given_name: z.string().min(1).optional(), // glossary-allow ชื่อ claim มาตรฐาน OIDC
  family_name: z.string().min(1).optional(), // glossary-allow ชื่อ claim มาตรฐาน OIDC
  ial: z.string().min(1).optional(),
});
export type ThaidIdentityClaims = z.infer<typeof thaidIdentityClaimsSchema>;

// สังกัดหนึ่งรายการจาก profile ของ Provider ID (MOPH เรียก organization เราเรียก agency ตาม glossary)
export const providerAffiliationSchema = z.object({
  businessId: z.string().min(1),
  agencyCode: z.string().min(1).nullable(),
  agencyNameTh: z.string().min(1).nullable(),
  position: z.string().min(1).nullable(),
  positionType: z.string().min(1).nullable(),
  licenseId: z.string().min(1).nullable(),
});
export type ProviderAffiliation = z.infer<typeof providerAffiliationSchema>;

// profile ของ Provider ID หลัง normalize (ไม่มี token, ไม่มีที่อยู่)
export const morphromProviderProfileSchema = z.object({
  accountId: z.string().min(1),
  hashCid: z.string().min(1).nullable(),
  providerId: z.string().min(1),
  nameTh: z.string().min(1).nullable(),
  affiliations: z.array(providerAffiliationSchema),
});
export type MorphromProviderProfile = z.infer<typeof morphromProviderProfileSchema>;

// ผลการเข้าสู่ระบบด้วย Health ID ที่ต้องรู้เพื่อสร้างตัวตน
export const morphromHealthIdIdentitySchema = z.object({
  accountId: z.string().min(1),
  displayName: z.string().min(1).nullable(),
  hashCid: z.string().min(1).nullable(),
});
export type MorphromHealthIdIdentity = z.infer<typeof morphromHealthIdIdentitySchema>;
```

- [ ] **Step 5: เขียน test env ที่ล้มก่อน** เพิ่มใน `packages/contracts/src/env.test.ts` (ใช้ `validEnv` ที่มีอยู่แล้วในไฟล์):

```ts
describe('ผู้ให้บริการยืนยันตัวตน', () => {
  const identityKeys = [
    'GACP_PUBLIC_BASE_URL',
    'GACP_THAID_ISSUER_URL',
    'GACP_THAID_CLIENT_ID',
    'GACP_THAID_CLIENT_SECRET',
    'GACP_MORPHROM_HEALTH_ID_BASE_URL',
    'GACP_MORPHROM_HEALTH_ID_CLIENT_ID',
    'GACP_MORPHROM_HEALTH_ID_CLIENT_SECRET',
    'GACP_MORPHROM_PROVIDER_ID_BASE_URL',
    'GACP_MORPHROM_PROVIDER_ID_CLIENT_ID',
    'GACP_MORPHROM_PROVIDER_ID_SECRET_KEY',
  ] as const;

  it('development ไม่บังคับ client ของ ThaID และหมอพร้อม', () => {
    expect(() => parseEnv({ ...validEnv, GACP_ENV: 'development' })).not.toThrow();
  });

  it('demo บังคับครบทั้ง 10 ตัว', () => {
    expect(() =>
      parseEnv({ ...validEnv, GACP_ENV: 'demo', GACP_STORAGE_DRIVER: 's3', ...s3Env }),
    ).toThrow(/GACP_THAID_CLIENT_ID/);
    const complete = Object.fromEntries(identityKeys.map((key) => [key, key.endsWith('_URL') ? 'https://example.test' : 'x']));
    expect(() =>
      parseEnv({ ...validEnv, GACP_ENV: 'demo', GACP_STORAGE_DRIVER: 's3', ...s3Env, ...complete }),
    ).not.toThrow();
  });
});
```

(ถ้าไฟล์ยังไม่มี `s3Env` ให้ประกาศไว้บนสุดของไฟล์: `const s3Env = { GACP_STORAGE_S3_ENDPOINT: 'https://example.test/s3', GACP_STORAGE_S3_REGION: 'ap-southeast-1', GACP_STORAGE_S3_BUCKET: 'gacp', GACP_STORAGE_S3_ACCESS_KEY_ID: 'k', GACP_STORAGE_S3_SECRET_ACCESS_KEY: 's' };` ถ้ามีอยู่แล้วชื่ออื่น ใช้ชื่อนั้น)

- [ ] **Step 6: แก้ `env.ts`** แทนที่สามบรรทัด `GACP_THAID_*` ด้วย:

```ts
    // ผู้ให้บริการยืนยันตัวตน (spec 2026-09-09 §8) บังคับครบใน demo/staging/production
    GACP_PUBLIC_BASE_URL: z.url().optional(),
    GACP_THAID_ISSUER_URL: z.url().optional(),
    GACP_THAID_CLIENT_ID: z.string().min(1).optional(),
    GACP_THAID_CLIENT_SECRET: z.string().min(1).optional(),
    GACP_MORPHROM_HEALTH_ID_BASE_URL: z.url().optional(),
    GACP_MORPHROM_HEALTH_ID_CLIENT_ID: z.string().min(1).optional(),
    GACP_MORPHROM_HEALTH_ID_CLIENT_SECRET: z.string().min(1).optional(),
    GACP_MORPHROM_PROVIDER_ID_BASE_URL: z.url().optional(),
    GACP_MORPHROM_PROVIDER_ID_CLIENT_ID: z.string().min(1).optional(),
    GACP_MORPHROM_PROVIDER_ID_SECRET_KEY: z.string().min(1).optional(),
```

และเพิ่มใน `superRefine` ก่อนบล็อก Stripe:

```ts
    if (env.GACP_ENV !== RuntimeEnvironment.DEVELOPMENT && env.GACP_ENV !== RuntimeEnvironment.TEST) {
      const missingIdentity = (
        [
          'GACP_PUBLIC_BASE_URL',
          'GACP_THAID_ISSUER_URL',
          'GACP_THAID_CLIENT_ID',
          'GACP_THAID_CLIENT_SECRET',
          'GACP_MORPHROM_HEALTH_ID_BASE_URL',
          'GACP_MORPHROM_HEALTH_ID_CLIENT_ID',
          'GACP_MORPHROM_HEALTH_ID_CLIENT_SECRET',
          'GACP_MORPHROM_PROVIDER_ID_BASE_URL',
          'GACP_MORPHROM_PROVIDER_ID_CLIENT_ID',
          'GACP_MORPHROM_PROVIDER_ID_SECRET_KEY',
        ] as const
      ).filter((key) => env[key] === undefined);
      for (const key of missingIdentity) {
        context.addIssue({
          code: 'custom',
          path: [key],
          message: 'demo/staging/production ต้องตั้งค่าผู้ให้บริการยืนยันตัวตนให้ครบ (ThaID + Health ID + Provider ID)',
        });
      }
    }
```

- [ ] **Step 7: export ใน `index.ts`** เพิ่มใน block `./enums.ts`: `identityProviderSchema, LoginIntent, loginIntentSchema, ROLES_BY_SIDE, RoleSide, roleSideOf, roleSideSchema` และเพิ่ม block ใหม่:

```ts
export {
  type MorphromHealthIdIdentity,
  type MorphromProviderProfile,
  morphromHealthIdIdentitySchema,
  morphromProviderProfileSchema,
  type ProviderAffiliation,
  providerAffiliationSchema,
  type ThaidIdentityClaims,
  thaidIdentityClaimsSchema,
} from './identity.ts';
```

- [ ] **Step 8: glossary** ใน `scripts/check-glossary.ts`:
  - เปลี่ยน `{ pattern: /\bsuperuser\b/i, useInstead: 'SYSTEM_ADMIN' }` เป็น `useInstead: 'PLATFORM_OPERATOR_ADMIN / CERTIFICATION_BODY_ADMIN'`
  - เพิ่ม `{ pattern: /\bFINANCE_OFFICER\b/, useInstead: 'PLATFORM_OPERATOR_FINANCE_OFFICER / CERTIFICATION_BODY_FINANCE_OFFICER' }` และ `{ pattern: /\bSYSTEM_ADMIN\b/, useInstead: 'PLATFORM_OPERATOR_ADMIN / CERTIFICATION_BODY_ADMIN' }` (ระวัง `\bFINANCE_OFFICER\b` จับ `PLATFORM_OPERATOR_FINANCE_OFFICER` ไม่ได้เพราะ `_` เป็นตัวอักษรของ `\w` จึงไม่มี word boundary ตรงนั้น ถูกต้องตามต้องการ)
  - เพิ่ม `const SKIPPED_PATH_PREFIXES = ['packages/db/prisma/migrations/'];` และใน `main()` ก่อน `checkForbiddenTerms` ใส่ `if (SKIPPED_PATH_PREFIXES.some((prefix) => repoPath.startsWith(prefix))) continue;` พร้อมคอมเมนต์ `// migration ที่ apply แล้วแก้ไม่ได้ (checksum) คำต้องห้ามในนั้นเป็นประวัติ`
  - ใน `docs/glossary.md` §2 แทนตารางบทบาทด้วย 9 แถวจาก spec §4 (คอลัมน์ ค่า/ไทย/ทำอะไร) และเพิ่มบรรทัดใต้ตาราง: `` ฝั่ง `RoleSide` = `APPLICANT` · `CERTIFICATION_BODY` · `PLATFORM_OPERATOR` (`roleSideOf`, `ROLES_BY_SIDE`) · ชื่อเดิม `FINANCE_OFFICER` `SYSTEM_ADMIN` เลิกใช้ `` · §1 เพิ่มแถว: `ProviderCredential` (เครดิตเจ้าหน้าที่ผู้ให้บริการจาก Provider ID พร้อมสังกัด), `AuthorizedProviderAgency` (สังกัดที่กรมรับเป็นเจ้าหน้าที่กรม), `PlatformOperatorMembership` (รายชื่อพนักงานบริษัท), `LoginIntent`, `ThaidClient` / `MorphromClient` (adapter ของผู้ให้บริการยืนยันตัวตน) · §6 เพิ่ม `FINANCE_OFFICER` `SYSTEM_ADMIN` `organization`(มีอยู่แล้ว) พร้อมหมายเหตุว่า field `organization` ของ MOPH ต้องใส่ `glossary-allow`

- [ ] **Step 9: รัน test และ check**

Run: `cd packages/contracts && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec vitest run && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec tsc -p tsconfig.json --noEmit`
Expected: PASS ทั้งหมด (th.ts ของ web จะแดงชั่วคราวจนถึง Task 6 ไม่ต้อง typecheck web ในขั้นนี้)
Run: `cd ../.. && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec biome check --write packages/contracts scripts docs && corepack pnpm glossary`
Expected: glossary จะรายงานคำต้องห้าม `SYSTEM_ADMIN`/`FINANCE_OFFICER` ในไฟล์ของ web และ domain ที่ยังไม่แก้ (แก้ใน Task 3 และ 6) ให้จดจำนวนไว้ ไม่ต้องแก้ตอนนี้

- [ ] **Step 10: Commit**

```bash
git add packages/contracts scripts/check-glossary.ts docs/glossary.md
git commit -m "feat(contracts): บทบาท 9 แบบ 3 ฝั่ง, ตัวตน Health ID/ThaID, env ของผู้ให้บริการยืนยันตัวตน

- UserRole 9 ค่า (เลิก FINANCE_OFFICER/SYSTEM_ADMIN) + RoleSide/roleSideOf/ROLES_BY_SIDE + LoginIntent
- IdentityProvider: MORPHROM → MORPHROM_HEALTH_ID (Provider ID เป็นเครดิต ไม่ใช่ provider)
- identity.ts: claims ThaID และ profile Provider ID ที่เก็บ (agency แทน organization ตาม glossary)
- env: 10 ตัวของ ThaID/Health ID/Provider ID บังคับใน demo/staging/production

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 2: db — schema, migration แบบไม่ทิ้งข้อมูล และ integration test

**Files:**
- Modify: `packages/db/prisma/schema/identity.prisma`
- Create: `packages/db/prisma/migrations/<timestamp>_account_model/migration.sql`
- Modify: `packages/db/src/schema.integration.test.ts`

**Interfaces:**
- Consumes: ลำดับ `UserRole` และ `IdentityProvider` จาก Task 1 (ทดสอบตรงลำดับ)
- Produces: Prisma models `ProviderCredential`, `AuthorizedProviderAgency`, `PlatformOperatorMembership`, ฟิลด์ `User.nationalIdHmac`, `UserIdentity.identityAssuranceLevel`, `UserIdentity.verifiedAt`

- [ ] **Step 1: เขียน integration test ที่ล้มก่อน** เพิ่มใน `describe('ฐานข้อมูลหลัง migrate')`:

```ts
  it('มีตารางเครดิตของฝั่งและรายชื่อบริษัท พร้อม unique ที่ถูกต้อง', async () => {
    const rows = await database.$queryRaw<Array<{ tableName: string; constraintName: string }>>`
      SELECT tc.table_name AS "tableName", tc.constraint_name AS "constraintName"
      FROM information_schema.table_constraints tc
      WHERE tc.table_schema = 'public'
        AND tc.constraint_type = 'UNIQUE'
        AND tc.table_name IN ('provider_credentials', 'authorized_provider_agencies', 'platform_operator_memberships', 'users')
    `;
    const names = rows.map((row) => row.constraintName).sort();
    expect(names).toEqual(
      [
        'authorized_provider_agencies_business_id_key',
        'platform_operator_memberships_national_id_hmac_key',
        'provider_credentials_user_id_key',
        'users_national_id_hmac_key',
      ].sort(),
    );
  });
```

- [ ] **Step 2: รันให้ล้ม**

Run: `cd packages/db && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec vitest run --config vitest.integration.config.ts src/schema.integration.test.ts`
Expected: FAIL ที่ `user_role` (ค่าไม่ตรง 9) และตารางใหม่ไม่มี

- [ ] **Step 3: แก้ `identity.prisma`** — แทน enum ทั้งสองและเพิ่มฟิลด์/model:

```prisma
enum UserRole {
  APPLICANT
  DOCUMENT_REVIEWER
  DISPATCHER
  FIELD_INSPECTOR
  CERTIFICATE_APPROVER
  CERTIFICATION_BODY_ADMIN
  CERTIFICATION_BODY_FINANCE_OFFICER
  PLATFORM_OPERATOR_ADMIN
  PLATFORM_OPERATOR_FINANCE_OFFICER

  @@map("user_role")
}

enum IdentityProvider {
  THAID
  MORPHROM_HEALTH_ID
  DEV_LOCAL

  @@map("identity_provider")
}
```

ใน `model User` เพิ่มหลัง `displayName`:

```prisma
  nationalIdHmac String?   @unique @map("national_id_hmac") // HMAC เลขบัตร เชื่อมตัวตนหลายทางของคนเดียว ไม่มี plaintext
```

และเพิ่ม relation `providerCredential ProviderCredential?` และ `platformOperatorMembership PlatformOperatorMembership?` ใต้ `applicantMembers`

ใน `model UserIdentity` เพิ่มหลัง `subjectHmac`:

```prisma
  identityAssuranceLevel String?   @map("identity_assurance_level") // ial จาก ThaID เช่น 2.3
  verifiedAt             DateTime? @map("verified_at") @db.Timestamptz(6)
```

ท้ายไฟล์เพิ่ม 3 model:

```prisma
// เครดิต "เจ้าหน้าที่ผู้ให้บริการ" จาก Provider ID ของ MOPH ตรวจซ้ำทุกครั้งที่ล็อกอิน (spec 2026-09-09 §7)
model ProviderCredential {
  id                 String    @id @default(uuid()) @db.Uuid
  userId             String    @unique @map("user_id") @db.Uuid
  providerId         String    @map("provider_id") // 13 หลักจาก MOPH
  agencyBusinessId   String?   @map("agency_business_id")
  agencyCode         String?   @map("agency_code") // hcode
  agencyNameTh       String?   @map("agency_name_th")
  position           String?
  positionType       String?   @map("position_type")
  licenseId          String?   @map("license_id")
  profileHash        String    @map("profile_hash") // sha256 ของ profile ที่ normalize แล้ว ไว้ตรวจการเปลี่ยนแปลง
  verifiedAt         DateTime  @default(now()) @map("verified_at") @db.Timestamptz(6)
  lastVerifiedAt     DateTime  @default(now()) @map("last_verified_at") @db.Timestamptz(6)
  revokedAt          DateTime? @map("revoked_at") @db.Timestamptz(6) // MOPH ตอบว่าไม่มี Provider ID แล้ว

  user User @relation(fields: [userId], references: [id], onDelete: Cascade)

  @@index([agencyBusinessId])
  @@map("provider_credentials")
}

// สังกัดที่กรมรับเป็นเจ้าหน้าที่กรม (กรมฯ, สสจ.) จัดการโดย CERTIFICATION_BODY_ADMIN
model AuthorizedProviderAgency {
  id          String    @id @default(uuid()) @db.Uuid
  businessId  String    @unique @map("business_id")
  agencyCode  String?   @map("agency_code")
  nameTh      String    @map("name_th")
  addedById   String?   @map("added_by_id") @db.Uuid
  addedAt     DateTime  @default(now()) @map("added_at") @db.Timestamptz(6)
  revokedAt   DateTime? @map("revoked_at") @db.Timestamptz(6)
  revokedById String?   @map("revoked_by_id") @db.Uuid

  @@map("authorized_provider_agencies")
}

// รายชื่อพนักงานบริษัทที่เข้าฝั่ง PlatformOperator ได้ (ThaID + เลขบัตรตรง) จัดการโดย PLATFORM_OPERATOR_ADMIN
model PlatformOperatorMembership {
  id             String    @id @default(uuid()) @db.Uuid
  nationalIdHmac String    @unique @map("national_id_hmac")
  displayName    String    @map("display_name")
  userId         String?   @unique @map("user_id") @db.Uuid // ผูกเมื่อล็อกอินครั้งแรก
  bootstrapAdmin Boolean   @default(false) @map("bootstrap_admin") // คนแรกจากคำสั่ง bootstrap ได้ PLATFORM_OPERATOR_ADMIN ทันที
  addedById      String?   @map("added_by_id") @db.Uuid
  addedAt        DateTime  @default(now()) @map("added_at") @db.Timestamptz(6)
  revokedAt      DateTime? @map("revoked_at") @db.Timestamptz(6)
  revokedById    String?   @map("revoked_by_id") @db.Uuid

  user User? @relation(fields: [userId], references: [id], onDelete: SetNull)

  @@map("platform_operator_memberships")
}
```

- [ ] **Step 4: สร้าง migration แล้วแก้ SQL ให้แปลงค่าเดิม**

Run: `cd packages/db && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec prisma migrate dev --create-only --name account_model`
จากนั้นเปิด `migration.sql` ที่สร้าง แทนที่ส่วน `AlterEnum` ของ `user_role` และ `identity_provider` ทั้งหมดด้วย (คงส่วน CREATE TABLE/ALTER TABLE ของตารางใหม่ที่ Prisma สร้างไว้):

```sql
-- glossary-allow: แปลงค่าเดิมของ enum โดยไม่ทิ้งข้อมูล (FINANCE_OFFICER → PLATFORM_OPERATOR_FINANCE_OFFICER, SYSTEM_ADMIN → PLATFORM_OPERATOR_ADMIN)
BEGIN;
CREATE TYPE "user_role_new" AS ENUM ('APPLICANT', 'DOCUMENT_REVIEWER', 'DISPATCHER', 'FIELD_INSPECTOR', 'CERTIFICATE_APPROVER', 'CERTIFICATION_BODY_ADMIN', 'CERTIFICATION_BODY_FINANCE_OFFICER', 'PLATFORM_OPERATOR_ADMIN', 'PLATFORM_OPERATOR_FINANCE_OFFICER');
ALTER TABLE "staff_role_assignments" ALTER COLUMN "role" TYPE "user_role_new"
  USING (CASE "role"::text WHEN 'FINANCE_OFFICER' THEN 'PLATFORM_OPERATOR_FINANCE_OFFICER' WHEN 'SYSTEM_ADMIN' THEN 'PLATFORM_OPERATOR_ADMIN' ELSE "role"::text END)::"user_role_new"; -- glossary-allow
ALTER TABLE "document_access_logs" ALTER COLUMN "role" TYPE "user_role_new"
  USING (CASE "role"::text WHEN 'FINANCE_OFFICER' THEN 'PLATFORM_OPERATOR_FINANCE_OFFICER' WHEN 'SYSTEM_ADMIN' THEN 'PLATFORM_OPERATOR_ADMIN' ELSE "role"::text END)::"user_role_new"; -- glossary-allow
ALTER TABLE "audit_logs" ALTER COLUMN "actor_role" TYPE "user_role_new"
  USING (CASE "actor_role"::text WHEN 'FINANCE_OFFICER' THEN 'PLATFORM_OPERATOR_FINANCE_OFFICER' WHEN 'SYSTEM_ADMIN' THEN 'PLATFORM_OPERATOR_ADMIN' ELSE "actor_role"::text END)::"user_role_new"; -- glossary-allow
ALTER TABLE "application_status_transitions" ALTER COLUMN "actor_role" TYPE "user_role_new"
  USING (CASE "actor_role"::text WHEN 'FINANCE_OFFICER' THEN 'PLATFORM_OPERATOR_FINANCE_OFFICER' WHEN 'SYSTEM_ADMIN' THEN 'PLATFORM_OPERATOR_ADMIN' ELSE "actor_role"::text END)::"user_role_new"; -- glossary-allow
ALTER TYPE "user_role" RENAME TO "user_role_old";
ALTER TYPE "user_role_new" RENAME TO "user_role";
DROP TYPE "user_role_old";
COMMIT;

ALTER TYPE "identity_provider" RENAME VALUE 'MORPHROM' TO 'MORPHROM_HEALTH_ID';
```

ตรวจว่า SQL ที่เหลือมี: `ALTER TABLE "users" ADD COLUMN "national_id_hmac" TEXT;` + `CREATE UNIQUE INDEX "users_national_id_hmac_key"`, `ALTER TABLE "user_identities" ADD COLUMN "identity_assurance_level" TEXT, ADD COLUMN "verified_at" TIMESTAMPTZ(6);`, CREATE TABLE ทั้งสาม พร้อม unique index และ foreign key

- [ ] **Step 5: apply และ generate**

Run: `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec prisma migrate deploy && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec prisma generate`
Expected: `1 migration applied` · ไม่มี error เรื่อง cast

- [ ] **Step 6: รัน integration test ให้ผ่าน**

Run: `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec vitest run --config vitest.integration.config.ts`
Expected: PASS รวม `enum user_role ... ตรงกับ contracts ทั้งค่าและลำดับ` และ test ตารางใหม่

- [ ] **Step 7: typecheck + commit**

Run: `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec tsc -p tsconfig.json --noEmit`

```bash
git add packages/db
git commit -m "feat(db): บัญชี 3 ฝั่ง: บทบาท 9 แบบ, Health ID, provider_credentials, authorized_provider_agencies, platform_operator_memberships

- migration แปลงค่า user_role เดิมโดยไม่ทิ้งข้อมูล และเปลี่ยน MORPHROM → MORPHROM_HEALTH_ID
- users.national_id_hmac เชื่อมตัวตนหลายทางของคนเดียว, user_identities.identity_assurance_level

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 3: domain — กติกาเครดิต → บทบาท

**Files:**
- Create: `packages/domain/src/account-access.ts`, `packages/domain/src/account-access.test.ts`
- Modify: `packages/domain/src/index.ts`, `packages/domain/src/application-workflow.ts` (ถ้ามีการอ้าง `UserRole.FINANCE_OFFICER`/`SYSTEM_ADMIN` ให้เปลี่ยนเป็นชื่อฝั่งบริษัท), test ที่อ้างชื่อเดิม

**Interfaces:**
- Produces:
  ```ts
  export type AccountCredentials = {
    readonly providerCredentialActive: boolean;     // มี ProviderCredential และ revokedAt เป็น null
    readonly providerAgencyAuthorized: boolean;     // สังกัดอยู่ใน AuthorizedProviderAgency ที่ยังไม่ถูกถอด
    readonly platformOperatorMembershipActive: boolean; // มี membership และ revokedAt เป็น null
  };
  export function permittedRolesFor(credentials: AccountCredentials): ReadonlySet<UserRole>;
  export function effectiveRoles(assigned: readonly UserRole[], credentials: AccountCredentials): UserRole[];
  export const RoleAssignmentRejection = { ACTOR_NOT_ALLOWED, TARGET_CREDENTIAL_MISSING, LAST_ADMIN_OF_SIDE } as const;
  export function canAssignRole(actorRoles, targetRole, targetCredentials): { ok: true } | { ok: false; code: RoleAssignmentRejection };
  export function canRevokeRole(actorRoles, targetRole, remainingHoldersOfRole: number): { ok: true } | { ok: false; code };
  ```

- [ ] **Step 1: test ที่ล้มก่อน** `account-access.test.ts`:

```ts
import { UserRole } from '@gacp/contracts';
import { describe, expect, it } from 'vitest';
import {
  type AccountCredentials,
  canAssignRole,
  canRevokeRole,
  effectiveRoles,
  permittedRolesFor,
  RoleAssignmentRejection,
} from './account-access.ts';

const none: AccountCredentials = {
  providerCredentialActive: false,
  providerAgencyAuthorized: false,
  platformOperatorMembershipActive: false,
};
const certificationBodyStaff: AccountCredentials = { ...none, providerCredentialActive: true, providerAgencyAuthorized: true };
const providerWithoutAgency: AccountCredentials = { ...none, providerCredentialActive: true };
const platformOperatorStaff: AccountCredentials = { ...none, platformOperatorMembershipActive: true };

describe('permittedRolesFor', () => {
  it('ทุกคนที่พิสูจน์ตัวตนแล้วเป็นผู้ขอรับรองได้', () => {
    expect([...permittedRolesFor(none)]).toEqual([UserRole.APPLICANT]);
  });
  it('Provider ID ที่สังกัดได้รับอนุญาตเปิดบทบาทฝั่งกรมทั้ง 6', () => {
    const roles = permittedRolesFor(certificationBodyStaff);
    expect(roles.has(UserRole.DOCUMENT_REVIEWER)).toBe(true);
    expect(roles.has(UserRole.CERTIFICATION_BODY_ADMIN)).toBe(true);
    expect(roles.has(UserRole.PLATFORM_OPERATOR_ADMIN)).toBe(false);
    expect(roles.size).toBe(7);
  });
  it('Provider ID ที่สังกัดไม่อยู่ในรายการ ไม่เปิดบทบาทฝั่งกรม', () => {
    expect([...permittedRolesFor(providerWithoutAgency)]).toEqual([UserRole.APPLICANT]);
  });
  it('รายชื่อบริษัทเปิดบทบาทฝั่งบริษัททั้ง 2', () => {
    const roles = permittedRolesFor(platformOperatorStaff);
    expect(roles.has(UserRole.PLATFORM_OPERATOR_FINANCE_OFFICER)).toBe(true);
    expect(roles.has(UserRole.DISPATCHER)).toBe(false);
    expect(roles.size).toBe(3);
  });
});

describe('effectiveRoles', () => {
  it('คือบทบาทที่ถูกมอบตัดกับที่เครดิตอนุญาต เรียงตามลำดับ UserRole', () => {
    expect(
      effectiveRoles([UserRole.PLATFORM_OPERATOR_ADMIN, UserRole.DISPATCHER, UserRole.DOCUMENT_REVIEWER], certificationBodyStaff),
    ).toEqual([UserRole.DOCUMENT_REVIEWER, UserRole.DISPATCHER]);
  });
  it('Provider ID หลุด บทบาทฝั่งกรมหายทั้งหมด', () => {
    expect(effectiveRoles([UserRole.DOCUMENT_REVIEWER], { ...certificationBodyStaff, providerCredentialActive: false })).toEqual([]);
  });
  it('ไม่ต้องมอบ APPLICANT ก็ได้บทบาทนี้เสมอ', () => {
    expect(effectiveRoles([], none)).toEqual([UserRole.APPLICANT]);
  });
});

describe('canAssignRole', () => {
  it('ผู้ดูแลกรมมอบบทบาทฝั่งกรมให้คนที่มีเครดิตได้', () => {
    expect(canAssignRole([UserRole.CERTIFICATION_BODY_ADMIN], UserRole.FIELD_INSPECTOR, certificationBodyStaff)).toEqual({ ok: true });
  });
  it('ผู้ดูแลกรมมอบบทบาทให้คนที่ไม่มี Provider ID ไม่ได้', () => {
    expect(canAssignRole([UserRole.CERTIFICATION_BODY_ADMIN], UserRole.FIELD_INSPECTOR, none)).toEqual({
      ok: false,
      code: RoleAssignmentRejection.TARGET_CREDENTIAL_MISSING,
    });
  });
  it('ผู้ดูแลบริษัทมอบบทบาทฝั่งบริษัท และตั้งผู้ดูแลกรมได้ แต่มอบบทบาทกรมอื่นไม่ได้', () => {
    expect(canAssignRole([UserRole.PLATFORM_OPERATOR_ADMIN], UserRole.PLATFORM_OPERATOR_FINANCE_OFFICER, platformOperatorStaff)).toEqual({ ok: true });
    expect(canAssignRole([UserRole.PLATFORM_OPERATOR_ADMIN], UserRole.CERTIFICATION_BODY_ADMIN, certificationBodyStaff)).toEqual({ ok: true });
    expect(canAssignRole([UserRole.PLATFORM_OPERATOR_ADMIN], UserRole.DOCUMENT_REVIEWER, certificationBodyStaff)).toEqual({
      ok: false,
      code: RoleAssignmentRejection.ACTOR_NOT_ALLOWED,
    });
  });
  it('บทบาทที่ไม่ใช่ผู้ดูแลมอบอะไรไม่ได้ และ APPLICANT มอบไม่ได้', () => {
    expect(canAssignRole([UserRole.DISPATCHER], UserRole.DOCUMENT_REVIEWER, certificationBodyStaff).ok).toBe(false);
    expect(canAssignRole([UserRole.CERTIFICATION_BODY_ADMIN], UserRole.APPLICANT, certificationBodyStaff).ok).toBe(false);
  });
});

describe('canRevokeRole', () => {
  it('ถอดผู้ดูแลระบบคนสุดท้ายของฝั่งไม่ได้', () => {
    expect(canRevokeRole([UserRole.CERTIFICATION_BODY_ADMIN], UserRole.CERTIFICATION_BODY_ADMIN, 1)).toEqual({
      ok: false,
      code: RoleAssignmentRejection.LAST_ADMIN_OF_SIDE,
    });
    expect(canRevokeRole([UserRole.CERTIFICATION_BODY_ADMIN], UserRole.CERTIFICATION_BODY_ADMIN, 2)).toEqual({ ok: true });
    expect(canRevokeRole([UserRole.PLATFORM_OPERATOR_ADMIN], UserRole.PLATFORM_OPERATOR_ADMIN, 1).ok).toBe(false);
  });
});
```

- [ ] **Step 2: รันให้ล้ม** `cd packages/domain && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec vitest run src/account-access.test.ts` → FAIL (module not found)

- [ ] **Step 3: เขียน `account-access.ts`**

```ts
import { ROLES_BY_SIDE, RoleSide, roleSideOf, UserRole } from '@gacp/contracts';

// กติกา "เครดิตของฝั่ง → บทบาทที่ถือได้" (spec 2026-09-09 §4) ทุกประตูของระบบใช้ฟังก์ชันชุดนี้ ไม่มีที่อื่นตัดสิน

export type AccountCredentials = {
  readonly providerCredentialActive: boolean;
  readonly providerAgencyAuthorized: boolean;
  readonly platformOperatorMembershipActive: boolean;
};

export function permittedRolesFor(credentials: AccountCredentials): ReadonlySet<UserRole> {
  const permitted = new Set<UserRole>(ROLES_BY_SIDE[RoleSide.APPLICANT]);
  if (credentials.providerCredentialActive && credentials.providerAgencyAuthorized) {
    for (const role of ROLES_BY_SIDE[RoleSide.CERTIFICATION_BODY]) permitted.add(role);
  }
  if (credentials.platformOperatorMembershipActive) {
    for (const role of ROLES_BY_SIDE[RoleSide.PLATFORM_OPERATOR]) permitted.add(role);
  }
  return permitted;
}

// บทบาทมีผล = (ที่ถูกมอบ ∪ APPLICANT) ∩ ที่เครดิตอนุญาต เรียงตามลำดับ UserRole เพื่อให้ session คงที่
export function effectiveRoles(
  assigned: readonly UserRole[],
  credentials: AccountCredentials,
): UserRole[] {
  const permitted = permittedRolesFor(credentials);
  const wanted = new Set<UserRole>([UserRole.APPLICANT, ...assigned]);
  return Object.values(UserRole).filter((role) => wanted.has(role) && permitted.has(role));
}

export const RoleAssignmentRejection = {
  ACTOR_NOT_ALLOWED: 'ACTOR_NOT_ALLOWED',
  TARGET_CREDENTIAL_MISSING: 'TARGET_CREDENTIAL_MISSING',
  LAST_ADMIN_OF_SIDE: 'LAST_ADMIN_OF_SIDE',
} as const;
export type RoleAssignmentRejection =
  (typeof RoleAssignmentRejection)[keyof typeof RoleAssignmentRejection];

export type RoleAssignmentDecision =
  | { readonly ok: true }
  | { readonly ok: false; readonly code: RoleAssignmentRejection };

const ADMIN_ROLE_OF_SIDE: Readonly<Record<RoleSide, UserRole | null>> = {
  [RoleSide.APPLICANT]: null,
  [RoleSide.CERTIFICATION_BODY]: UserRole.CERTIFICATION_BODY_ADMIN,
  [RoleSide.PLATFORM_OPERATOR]: UserRole.PLATFORM_OPERATOR_ADMIN,
};

// ใครมอบบทบาทอะไรได้: ผู้ดูแลของฝั่งมอบบทบาทฝั่งตนเอง · ผู้ดูแลบริษัทตั้งผู้ดูแลกรมได้ (เริ่มระบบ/กู้คืน) · APPLICANT มอบไม่ได้
function actorMayAssign(actorRoles: readonly UserRole[], targetRole: UserRole): boolean {
  const targetSide = roleSideOf(targetRole);
  if (targetSide === RoleSide.APPLICANT) return false;
  if (actorRoles.includes(ADMIN_ROLE_OF_SIDE[targetSide] as UserRole)) return true;
  return (
    targetRole === UserRole.CERTIFICATION_BODY_ADMIN &&
    actorRoles.includes(UserRole.PLATFORM_OPERATOR_ADMIN)
  );
}

export function canAssignRole(
  actorRoles: readonly UserRole[],
  targetRole: UserRole,
  targetCredentials: AccountCredentials,
): RoleAssignmentDecision {
  if (!actorMayAssign(actorRoles, targetRole)) {
    return { ok: false, code: RoleAssignmentRejection.ACTOR_NOT_ALLOWED };
  }
  if (!permittedRolesFor(targetCredentials).has(targetRole)) {
    return { ok: false, code: RoleAssignmentRejection.TARGET_CREDENTIAL_MISSING };
  }
  return { ok: true };
}

// ถอดบทบาท: สิทธิ์เหมือนการมอบ และห้ามถอดผู้ดูแลระบบคนสุดท้ายของฝั่ง
export function canRevokeRole(
  actorRoles: readonly UserRole[],
  targetRole: UserRole,
  remainingHoldersOfRole: number,
): RoleAssignmentDecision {
  if (!actorMayAssign(actorRoles, targetRole)) {
    return { ok: false, code: RoleAssignmentRejection.ACTOR_NOT_ALLOWED };
  }
  const isAdminRole = Object.values(ADMIN_ROLE_OF_SIDE).includes(targetRole);
  if (isAdminRole && remainingHoldersOfRole <= 1) {
    return { ok: false, code: RoleAssignmentRejection.LAST_ADMIN_OF_SIDE };
  }
  return { ok: true };
}
```

- [ ] **Step 4: export** เพิ่มใน `packages/domain/src/index.ts`:

```ts
export {
  type AccountCredentials,
  canAssignRole,
  canRevokeRole,
  effectiveRoles,
  permittedRolesFor,
  type RoleAssignmentDecision,
  RoleAssignmentRejection,
} from './account-access.ts';
```

- [ ] **Step 5: แก้ชื่อเดิมใน domain** `grep -rn "FINANCE_OFFICER\|SYSTEM_ADMIN" packages/domain/src` แล้วเปลี่ยน `UserRole.FINANCE_OFFICER` → `UserRole.PLATFORM_OPERATOR_FINANCE_OFFICER` และ `UserRole.SYSTEM_ADMIN` → `UserRole.PLATFORM_OPERATOR_ADMIN` (ถ้ามีใน `application-workflow.ts`/test)

- [ ] **Step 6: รัน test + typecheck + commit**

Run: `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec vitest run && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec tsc -p tsconfig.json --noEmit`
Expected: PASS ทั้งหมด (รวม test เดิม)

```bash
git add packages/domain
git commit -m "feat(domain): กติกาเครดิตของฝั่ง → บทบาท (effectiveRoles, canAssignRole, canRevokeRole)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 4: web — ThaidClient และ MorphromClient (interface, implementation จริง, fake)

**Files:**
- Create: `apps/web/src/lib/identity/thaid-client.ts`, `apps/web/src/lib/identity/morphrom-client.ts`, `apps/web/src/lib/identity/fake-identity-clients.ts`, `apps/web/src/lib/identity/identity-clients.ts`
- Test: `apps/web/src/lib/identity/morphrom-client.test.ts`, `apps/web/src/lib/identity/fake-identity-clients.test.ts`

**Interfaces:**
- Consumes: env keys จาก Task 1, `thaidIdentityClaimsSchema`, `morphromProviderProfileSchema`, `MorphromHealthIdIdentity`
- Produces:
  ```ts
  export type ThaidAuthorizationStart = { readonly url: URL; readonly state: string; readonly nonce: string; readonly pkceCodeVerifier: string | null };
  export interface ThaidClient {
    startAuthorization(redirectUri: string): Promise<ThaidAuthorizationStart>;
    completeAuthorization(callbackUrl: URL, checks: { state: string; nonce: string; pkceCodeVerifier: string | null }): Promise<ThaidIdentityClaims>;
  }
  export type ProviderLookup = { readonly kind: 'PROVIDER'; readonly profile: MorphromProviderProfile } | { readonly kind: 'NOT_PROVIDER' };
  export interface MorphromClient {
    authorizationUrl(redirectUri: string, state: string): URL;
    exchangeCode(code: string, redirectUri: string): Promise<{ accessToken: string; identity: MorphromHealthIdIdentity }>;
    lookupProvider(healthIdAccessToken: string): Promise<ProviderLookup>;
  }
  export function identityClients(): { thaid: ThaidClient; morphrom: MorphromClient }  // singleton จาก env หรือ fake ใน test
  ```

- [ ] **Step 1: test ของ HttpMorphromClient ที่ล้มก่อน** (`morphrom-client.test.ts`) ใช้ `fetch` ปลอมผ่าน parameter:

```ts
import { describe, expect, it } from 'vitest';
import { HttpMorphromClient } from './morphrom-client.ts';

const options = {
  healthIdBaseUrl: 'https://uat-moph.id.th',
  healthIdClientId: 'health-client',
  healthIdClientSecret: 'health-secret',
  providerIdBaseUrl: 'https://uat-provider.id.th',
  providerIdClientId: 'provider-client',
  providerIdSecretKey: 'provider-secret',
};

function fakeFetch(routes: Record<string, (init: RequestInit | undefined) => Response>): typeof fetch {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const handler = Object.entries(routes).find(([prefix]) => url.startsWith(prefix))?.[1];
    if (!handler) throw new Error(`ไม่มี route ปลอมสำหรับ ${url}`);
    return handler(init);
  }) as typeof fetch;
}

describe('HttpMorphromClient', () => {
  it('สร้าง URL ล็อกอิน Health ID ตามคู่มือ MOPH', () => {
    const client = new HttpMorphromClient(options, fakeFetch({}));
    const url = client.authorizationUrl('https://app.test/auth/morphrom/callback', 'state-1');
    expect(url.origin + url.pathname).toBe('https://uat-moph.id.th/oauth/redirect');
    expect(url.searchParams.get('client_id')).toBe('health-client');
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('state')).toBe('state-1');
  });

  it('แลก code เป็น access token และ account_id', async () => {
    const client = new HttpMorphromClient(
      options,
      fakeFetch({
        'https://uat-moph.id.th/api/v1/token': () =>
          Response.json({ status: 'success', data: { access_token: 'health-token', token_type: 'Bearer', expires_in: 100, account_id: '1659' } }),
      }),
    );
    const result = await client.exchangeCode('code-1', 'https://app.test/auth/morphrom/callback');
    expect(result.accessToken).toBe('health-token');
    expect(result.identity.accountId).toBe('1659');
  });

  it('ไม่มี Provider ID เมื่อ MOPH ตอบ 400', async () => {
    const client = new HttpMorphromClient(
      options,
      fakeFetch({
        'https://uat-provider.id.th/api/v1/services/token': () =>
          Response.json({ status: 400, message: 'This user has not provider id' }, { status: 400 }),
      }),
    );
    expect(await client.lookupProvider('health-token')).toEqual({ kind: 'NOT_PROVIDER' });
  });

  it('มี Provider ID: อ่าน profile และ normalize สังกัด', async () => {
    const client = new HttpMorphromClient(
      options,
      fakeFetch({
        'https://uat-provider.id.th/api/v1/services/token': () =>
          Response.json({ status: 200, data: { access_token: 'provider-token', account_id: '1659' } }),
        'https://uat-provider.id.th/api/v1/services/profile': () =>
          Response.json({
            status: 200,
            data: {
              account_id: '1659',
              hash_cid: 'abc',
              provider_id: '0111111111X21',
              name_th: 'หมอพร้อม สงบสุข',
              organization: [{ business_id: '9876', hcode: '12345', hname_th: 'กรมการแพทย์แผนไทยฯ', position: 'นักวิชาการ', position_type: 'นักวิชาการ', license_id: null }], // glossary-allow field ของ MOPH
            },
          }),
      }),
    );
    const result = await client.lookupProvider('health-token');
    expect(result.kind).toBe('PROVIDER');
    if (result.kind !== 'PROVIDER') return;
    expect(result.profile.providerId).toBe('0111111111X21');
    expect(result.profile.affiliations[0]).toEqual({
      businessId: '9876',
      agencyCode: '12345',
      agencyNameTh: 'กรมการแพทย์แผนไทยฯ',
      position: 'นักวิชาการ',
      positionType: 'นักวิชาการ',
      licenseId: null,
    });
  });
});
```

- [ ] **Step 2: รันให้ล้ม** `cd apps/web && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec vitest run src/lib/identity` → FAIL (module not found)

- [ ] **Step 3: เขียน `morphrom-client.ts`**

```ts
import 'server-only';
import {
  type MorphromHealthIdIdentity,
  type MorphromProviderProfile,
  morphromProviderProfileSchema,
} from '@gacp/contracts';
import { z } from 'zod';

// Health ID (OAuth2 ธรรมดา) + Provider ID (เครดิตเจ้าหน้าที่) ตามคู่มือ MOPH 1 ก.ค. 2567 ไม่มี type ของ MOPH รั่วออกนอกไฟล์นี้

export type ProviderLookup =
  | { readonly kind: 'PROVIDER'; readonly profile: MorphromProviderProfile }
  | { readonly kind: 'NOT_PROVIDER' };

export interface MorphromClient {
  authorizationUrl(redirectUri: string, state: string): URL;
  exchangeCode(
    code: string,
    redirectUri: string,
  ): Promise<{ readonly accessToken: string; readonly identity: MorphromHealthIdIdentity }>;
  lookupProvider(healthIdAccessToken: string): Promise<ProviderLookup>;
}

export type HttpMorphromClientOptions = {
  readonly healthIdBaseUrl: string;
  readonly healthIdClientId: string;
  readonly healthIdClientSecret: string;
  readonly providerIdBaseUrl: string;
  readonly providerIdClientId: string;
  readonly providerIdSecretKey: string;
};

const tokenResponseSchema = z.object({
  data: z.object({ access_token: z.string().min(1), account_id: z.string().min(1) }),
});

const providerTokenResponseSchema = z.object({
  data: z.object({ access_token: z.string().min(1) }),
});

// รูปตอบกลับของ MOPH ใช้ชื่อ field ของเขา แปลงเป็นชื่อของเราทันที
const rawProfileSchema = z.object({
  data: z.object({
    account_id: z.string().min(1),
    hash_cid: z.string().min(1).nullable().optional(),
    provider_id: z.string().min(1),
    name_th: z.string().min(1).nullable().optional(),
    organization: z // glossary-allow field ของ MOPH
      .array(
        z.object({
          business_id: z.string().min(1),
          hcode: z.string().min(1).nullable().optional(),
          hname_th: z.string().min(1).nullable().optional(),
          position: z.string().min(1).nullable().optional(),
          position_type: z.string().min(1).nullable().optional(),
          license_id: z.string().min(1).nullable().optional(),
        }),
      )
      .default([]),
  }),
});

export class MorphromRequestError extends Error {
  readonly status: number;
  constructor(step: string, status: number) {
    super(`MOPH ${step} ตอบ ${status}`);
    this.name = 'MorphromRequestError';
    this.status = status;
  }
}

export class HttpMorphromClient implements MorphromClient {
  constructor(
    private readonly options: HttpMorphromClientOptions,
    private readonly fetchImplementation: typeof fetch = fetch,
  ) {}

  authorizationUrl(redirectUri: string, state: string): URL {
    const url = new URL('/oauth/redirect', this.options.healthIdBaseUrl);
    url.searchParams.set('client_id', this.options.healthIdClientId);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('state', state);
    return url;
  }

  async exchangeCode(code: string, redirectUri: string) {
    const body = new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: this.options.healthIdClientId,
      client_secret: this.options.healthIdClientSecret,
    });
    const response = await this.fetchImplementation(new URL('/api/v1/token', this.options.healthIdBaseUrl), {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body,
    });
    if (!response.ok) throw new MorphromRequestError('token', response.status);
    const parsed = tokenResponseSchema.parse(await response.json());
    return {
      accessToken: parsed.data.access_token,
      identity: { accountId: parsed.data.account_id, displayName: null, hashCid: null },
    };
  }

  async lookupProvider(healthIdAccessToken: string): Promise<ProviderLookup> {
    const tokenResponse = await this.fetchImplementation(
      new URL('/api/v1/services/token', this.options.providerIdBaseUrl),
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          client_id: this.options.providerIdClientId,
          secret_key: this.options.providerIdSecretKey,
          token_by: 'HealthID',
          token: healthIdAccessToken,
        }),
      },
    );
    if (tokenResponse.status === 400 || tokenResponse.status === 404) return { kind: 'NOT_PROVIDER' };
    if (!tokenResponse.ok) throw new MorphromRequestError('provider token', tokenResponse.status);
    const providerToken = providerTokenResponseSchema.parse(await tokenResponse.json()).data.access_token;

    const profileResponse = await this.fetchImplementation(
      new URL('/api/v1/services/profile', this.options.providerIdBaseUrl),
      {
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${providerToken}`,
          'client-id': this.options.providerIdClientId,
          'secret-key': this.options.providerIdSecretKey,
        },
      },
    );
    if (profileResponse.status === 404) return { kind: 'NOT_PROVIDER' };
    if (!profileResponse.ok) throw new MorphromRequestError('provider profile', profileResponse.status);
    const raw = rawProfileSchema.parse(await profileResponse.json()).data;
    const profile = morphromProviderProfileSchema.parse({
      accountId: raw.account_id,
      hashCid: raw.hash_cid ?? null,
      providerId: raw.provider_id,
      nameTh: raw.name_th ?? null,
      affiliations: raw.organization.map((entry) => ({ // glossary-allow field ของ MOPH
        businessId: entry.business_id,
        agencyCode: entry.hcode ?? null,
        agencyNameTh: entry.hname_th ?? null,
        position: entry.position ?? null,
        positionType: entry.position_type ?? null,
        licenseId: entry.license_id ?? null,
      })),
    });
    return { kind: 'PROVIDER', profile };
  }
}
```

- [ ] **Step 4: เขียน `thaid-client.ts`** (openid-client v6, ตาม discovery ของ DOPA: code flow, ES256, client_secret_post)

```ts
import 'server-only';
import { type ThaidIdentityClaims, thaidIdentityClaimsSchema } from '@gacp/contracts';
import * as oidc from 'openid-client';

// ThaID = OpenID Connect ของกรมการปกครอง (discovery https://imauth.bora.dopa.go.th หรือ sandbox imauthsbx)
// ทำตามตัวอย่าง Relying Party ของ ETDA: code flow + state + ตรวจ id_token ด้วย JWKS เพิ่ม nonce และ PKCE เมื่อเซิร์ฟเวอร์รองรับ

export const THAID_SCOPE = 'openid pid name given_name family_name ial'; // glossary-allow ชื่อ scope มาตรฐาน OIDC

export type ThaidAuthorizationStart = {
  readonly url: URL;
  readonly state: string;
  readonly nonce: string;
  readonly pkceCodeVerifier: string | null;
};

export type ThaidAuthorizationChecks = {
  readonly state: string;
  readonly nonce: string;
  readonly pkceCodeVerifier: string | null;
};

export interface ThaidClient {
  startAuthorization(redirectUri: string): Promise<ThaidAuthorizationStart>;
  completeAuthorization(callbackUrl: URL, checks: ThaidAuthorizationChecks): Promise<ThaidIdentityClaims>;
}

export type OpenIdThaidClientOptions = {
  readonly issuerUrl: string;
  readonly clientId: string;
  readonly clientSecret: string;
};

export class OpenIdThaidClient implements ThaidClient {
  private configuration: Promise<oidc.Configuration> | undefined;

  constructor(private readonly options: OpenIdThaidClientOptions) {}

  private config(): Promise<oidc.Configuration> {
    this.configuration ??= oidc.discovery(
      new URL(this.options.issuerUrl),
      this.options.clientId,
      undefined,
      oidc.ClientSecretPost(this.options.clientSecret),
    );
    return this.configuration;
  }

  async startAuthorization(redirectUri: string): Promise<ThaidAuthorizationStart> {
    const config = await this.config();
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const parameters: Record<string, string> = {
      redirect_uri: redirectUri,
      scope: THAID_SCOPE,
      state,
      nonce,
    };
    let pkceCodeVerifier: string | null = null;
    if (config.serverMetadata().supportsPKCE()) {
      pkceCodeVerifier = oidc.randomPKCECodeVerifier();
      parameters.code_challenge = await oidc.calculatePKCECodeChallenge(pkceCodeVerifier);
      parameters.code_challenge_method = 'S256';
    }
    return { url: oidc.buildAuthorizationUrl(config, parameters), state, nonce, pkceCodeVerifier };
  }

  async completeAuthorization(callbackUrl: URL, checks: ThaidAuthorizationChecks): Promise<ThaidIdentityClaims> {
    const config = await this.config();
    const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
      expectedState: checks.state,
      expectedNonce: checks.nonce,
      ...(checks.pkceCodeVerifier ? { pkceCodeVerifier: checks.pkceCodeVerifier } : {}),
    });
    const claims = thaidIdentityClaimsSchema.parse(tokens.claims());
    // ไม่เก็บ access/refresh token: ยกเลิกทิ้งทันทีหลังอ่าน claims (ล้มเหลวได้โดยไม่กระทบการล็อกอิน)
    await oidc.tokenRevocation(config, tokens.access_token).catch(() => undefined);
    return claims;
  }
}
```

- [ ] **Step 5: เขียน `fake-identity-clients.ts`** (ใช้ใน test และใน `GACP_ENV=test`)

```ts
import type { MorphromProviderProfile, ThaidIdentityClaims } from '@gacp/contracts';
import type { MorphromClient, ProviderLookup } from './morphrom-client.ts';
import type { ThaidAuthorizationChecks, ThaidAuthorizationStart, ThaidClient } from './thaid-client.ts';

// client ปลอมสำหรับ test: ตอบตามที่ตั้งไว้ ไม่มี HTTP
export class FakeThaidClient implements ThaidClient {
  constructor(private readonly claims: ThaidIdentityClaims) {}

  async startAuthorization(redirectUri: string): Promise<ThaidAuthorizationStart> {
    const url = new URL('https://thaid.test/authorize');
    url.searchParams.set('redirect_uri', redirectUri);
    return { url, state: 'fake-state', nonce: 'fake-nonce', pkceCodeVerifier: null };
  }

  async completeAuthorization(callbackUrl: URL, checks: ThaidAuthorizationChecks): Promise<ThaidIdentityClaims> {
    if (callbackUrl.searchParams.get('state') !== checks.state) throw new Error('state ไม่ตรง');
    return this.claims;
  }
}

export class FakeMorphromClient implements MorphromClient {
  constructor(
    private readonly accountId: string,
    private readonly provider: MorphromProviderProfile | null,
  ) {}

  authorizationUrl(redirectUri: string, state: string): URL {
    const url = new URL('https://healthid.test/oauth/redirect');
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('state', state);
    return url;
  }

  async exchangeCode() {
    return {
      accessToken: 'fake-health-token',
      identity: { accountId: this.accountId, displayName: null, hashCid: this.provider?.hashCid ?? null },
    };
  }

  async lookupProvider(): Promise<ProviderLookup> {
    return this.provider ? { kind: 'PROVIDER', profile: this.provider } : { kind: 'NOT_PROVIDER' };
  }
}
```

test `fake-identity-clients.test.ts` สั้น ๆ: `FakeMorphromClient('1', null).lookupProvider()` → `{ kind: 'NOT_PROVIDER' }` และ `FakeThaidClient` โยน error เมื่อ state ไม่ตรง

- [ ] **Step 6: เขียน `identity-clients.ts`** (singleton จาก env; ใน `test` ใช้ fake ที่ตั้งค่าผ่าน `setIdentityClientsForTest`)

```ts
import 'server-only';
import { readEnv, RuntimeEnvironment } from '@gacp/contracts';
import { HttpMorphromClient, type MorphromClient } from './morphrom-client.ts';
import { OpenIdThaidClient, type ThaidClient } from './thaid-client.ts';

export type IdentityClients = { readonly thaid: ThaidClient; readonly morphrom: MorphromClient };

const globalStore = globalThis as unknown as { gacpIdentityClients?: IdentityClients };

export class IdentityProviderNotConfiguredError extends Error {
  constructor(name: string) {
    super(`ยังไม่ได้ตั้งค่า ${name} ใน .env.local (ใช้ dev login ระหว่างรอ client จากหน่วยงาน)`);
    this.name = 'IdentityProviderNotConfiguredError';
  }
}

function fromEnv(): IdentityClients {
  const env = readEnv();
  if (
    !env.GACP_THAID_ISSUER_URL || !env.GACP_THAID_CLIENT_ID || !env.GACP_THAID_CLIENT_SECRET ||
    !env.GACP_MORPHROM_HEALTH_ID_BASE_URL || !env.GACP_MORPHROM_HEALTH_ID_CLIENT_ID || !env.GACP_MORPHROM_HEALTH_ID_CLIENT_SECRET ||
    !env.GACP_MORPHROM_PROVIDER_ID_BASE_URL || !env.GACP_MORPHROM_PROVIDER_ID_CLIENT_ID || !env.GACP_MORPHROM_PROVIDER_ID_SECRET_KEY
  ) {
    throw new IdentityProviderNotConfiguredError('ThaID / Health ID / Provider ID');
  }
  return {
    thaid: new OpenIdThaidClient({ issuerUrl: env.GACP_THAID_ISSUER_URL, clientId: env.GACP_THAID_CLIENT_ID, clientSecret: env.GACP_THAID_CLIENT_SECRET }),
    morphrom: new HttpMorphromClient({
      healthIdBaseUrl: env.GACP_MORPHROM_HEALTH_ID_BASE_URL,
      healthIdClientId: env.GACP_MORPHROM_HEALTH_ID_CLIENT_ID,
      healthIdClientSecret: env.GACP_MORPHROM_HEALTH_ID_CLIENT_SECRET,
      providerIdBaseUrl: env.GACP_MORPHROM_PROVIDER_ID_BASE_URL,
      providerIdClientId: env.GACP_MORPHROM_PROVIDER_ID_CLIENT_ID,
      providerIdSecretKey: env.GACP_MORPHROM_PROVIDER_ID_SECRET_KEY,
    }),
  };
}

export function identityClients(): IdentityClients {
  globalStore.gacpIdentityClients ??= fromEnv();
  return globalStore.gacpIdentityClients;
}

// test เท่านั้น: แทน client จริงด้วย fake
export function setIdentityClientsForTest(clients: IdentityClients): void {
  if (readEnv().GACP_ENV !== RuntimeEnvironment.TEST) throw new Error('ใช้ได้เฉพาะ GACP_ENV=test');
  globalStore.gacpIdentityClients = clients;
}

export function identityProvidersConfigured(): boolean {
  const env = readEnv();
  return Boolean(env.GACP_THAID_ISSUER_URL && env.GACP_MORPHROM_HEALTH_ID_BASE_URL && env.GACP_MORPHROM_PROVIDER_ID_BASE_URL);
}
```

- [ ] **Step 7: รัน test ให้ผ่าน + typecheck เฉพาะไฟล์ใหม่**

Run: `COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec vitest run src/lib/identity` → PASS (5 tests)
(web ทั้งแอปยังไม่ typecheck ผ่านจนถึง Task 6 เพราะชื่อบทบาทเดิมใน th.ts/roles.ts)

- [ ] **Step 8: Commit**

```bash
git add apps/web/src/lib/identity
git commit -m "feat(web): ThaidClient (OpenID Connect) และ MorphromClient (Health ID + Provider ID) พร้อม fake สำหรับ test

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 5: web — flow ล็อกอิน 3 ทาง, completeSignIn, dev login สร้างเครดิต

**Files:**
- Create: `apps/web/src/lib/identity/login-state.ts`, `apps/web/src/lib/identity/sign-in.ts`, `apps/web/src/lib/identity/sign-in.test.ts`
- Create: `apps/web/src/app/auth/thaid/start/route.ts`, `apps/web/src/app/auth/thaid/callback/route.ts`, `apps/web/src/app/auth/morphrom/start/route.ts`, `apps/web/src/app/auth/morphrom/callback/route.ts`, `apps/web/src/app/auth/outcome/page.tsx`
- Modify: `apps/web/src/lib/session.ts` (payload เพิ่ม `identityProvider`), `apps/web/src/lib/current-user.ts`, `apps/web/src/app/auth/login/actions.ts`

**Interfaces:**
- Consumes: `identityClients()`, `effectiveRoles`, `permittedRolesFor` (Task 3), Prisma models (Task 2), `hmacField`, `sealSession`
- Produces:
  ```ts
  export const SignInOutcome = { SIGNED_IN, NOT_PROVIDER, AGENCY_NOT_AUTHORIZED, NOT_MEMBER, NO_ROLE_YET } as const;
  export type SignInInput = { provider: IdentityProvider; subject: string; nationalId: string | null; hashCid: string | null; displayName: string; identityAssuranceLevel: string | null; intent: LoginIntent; providerProfile: MorphromProviderProfile | null };
  export function completeSignIn(input: SignInInput): Promise<{ outcome: SignInOutcome; sessionToken: string | null; roles: UserRole[]; userId: string }>;
  export function homePathForIntent(intent: LoginIntent, roles: readonly UserRole[]): string   // ใช้ roleHomePath จาก Task 6
  ```
  cookie ชั่วคราว: `LOGIN_STATE_COOKIE_NAME = 'gacp_login_state'` payload `{ intent, provider, state, nonce, pkceCodeVerifier, redirectUri, next }` อายุ 10 นาที

- [ ] **Step 1: test ของ completeSignIn ที่ล้มก่อน** (integration กับฐานข้อมูล dev, ใช้ `GACP_ENV=test`; วางไว้ที่ `sign-in.test.ts` และเพิ่ม `"test:integration": "vitest run --config vitest.integration.config.ts"` ให้ web พร้อมไฟล์ config ที่ include `src/**/*.integration.test.ts` แล้วเปลี่ยนชื่อไฟล์เป็น `sign-in.integration.test.ts`)

```ts
import { IdentityProvider, LoginIntent, UserRole } from '@gacp/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database } from '@/lib/database.ts';
import { hmacField } from '@/lib/protected-fields.ts';
import { completeSignIn, SignInOutcome } from './sign-in.ts';

const agencyBusinessId = `TEST-AGENCY-${Date.now()}`;
const profile = {
  accountId: `acc-${Date.now()}`,
  hashCid: null,
  providerId: '0111111111X21',
  nameTh: 'ทดสอบ เจ้าหน้าที่',
  affiliations: [{ businessId: agencyBusinessId, agencyCode: '00001', agencyNameTh: 'หน่วยทดสอบ', position: null, positionType: null, licenseId: null }],
};

beforeAll(async () => {
  await database.authorizedProviderAgency.create({ data: { businessId: agencyBusinessId, agencyCode: '00001', nameTh: 'หน่วยทดสอบ' } });
});
afterAll(async () => {
  await database.authorizedProviderAgency.deleteMany({ where: { businessId: agencyBusinessId } });
  await database.$disconnect();
});

describe('completeSignIn', () => {
  it('ผู้ขอรับรองผ่าน Health ID ได้ APPLICANT อย่างเดียว', async () => {
    const result = await completeSignIn({
      provider: IdentityProvider.MORPHROM_HEALTH_ID, subject: `health-${Date.now()}`, nationalId: null, hashCid: null,
      displayName: 'ผู้ขอทดสอบ', identityAssuranceLevel: null, intent: LoginIntent.APPLICANT, providerProfile: null,
    });
    expect(result.outcome).toBe(SignInOutcome.SIGNED_IN);
    expect(result.roles).toEqual([UserRole.APPLICANT]);
    expect(result.sessionToken).not.toBeNull();
  });

  it('เจ้าหน้าที่กรมที่ไม่มี Provider ID ถูกปฏิเสธฝั่งกรมแต่ยังมี user', async () => {
    const result = await completeSignIn({
      provider: IdentityProvider.MORPHROM_HEALTH_ID, subject: `health-np-${Date.now()}`, nationalId: null, hashCid: null,
      displayName: 'ไม่มี Provider', identityAssuranceLevel: null, intent: LoginIntent.CERTIFICATION_BODY_STAFF, providerProfile: null,
    });
    expect(result.outcome).toBe(SignInOutcome.NOT_PROVIDER);
    expect(result.sessionToken).toBeNull();
  });

  it('เจ้าหน้าที่กรมที่มี Provider ID สังกัดอนุญาต แต่ยังไม่มีบทบาท → NO_ROLE_YET และมี ProviderCredential', async () => {
    const subject = `health-p-${Date.now()}`;
    const result = await completeSignIn({
      provider: IdentityProvider.MORPHROM_HEALTH_ID, subject, nationalId: null, hashCid: null,
      displayName: 'ทดสอบ เจ้าหน้าที่', identityAssuranceLevel: null, intent: LoginIntent.CERTIFICATION_BODY_STAFF, providerProfile: profile,
    });
    expect(result.outcome).toBe(SignInOutcome.NO_ROLE_YET);
    const credential = await database.providerCredential.findUnique({ where: { userId: result.userId } });
    expect(credential?.providerId).toBe('0111111111X21');
    expect(credential?.agencyBusinessId).toBe(agencyBusinessId);
  });

  it('พนักงานบริษัทที่ไม่อยู่ในรายชื่อ → NOT_MEMBER; อยู่ในรายชื่อ + bootstrapAdmin → ได้ PLATFORM_OPERATOR_ADMIN', async () => {
    const nationalId = '1101700230708';
    const rejected = await completeSignIn({
      provider: IdentityProvider.THAID, subject: `thaid-${Date.now()}`, nationalId, hashCid: null,
      displayName: 'พนักงาน ทดสอบ', identityAssuranceLevel: '2.3', intent: LoginIntent.PLATFORM_OPERATOR_STAFF, providerProfile: null,
    });
    expect(rejected.outcome).toBe(SignInOutcome.NOT_MEMBER);

    await database.platformOperatorMembership.upsert({
      where: { nationalIdHmac: hmacField(nationalId) },
      create: { nationalIdHmac: hmacField(nationalId), displayName: 'พนักงาน ทดสอบ', bootstrapAdmin: true },
      update: { revokedAt: null, bootstrapAdmin: true },
    });
    const accepted = await completeSignIn({
      provider: IdentityProvider.THAID, subject: `thaid-${Date.now()}`, nationalId, hashCid: null,
      displayName: 'พนักงาน ทดสอบ', identityAssuranceLevel: '2.3', intent: LoginIntent.PLATFORM_OPERATOR_STAFF, providerProfile: null,
    });
    expect(accepted.outcome).toBe(SignInOutcome.SIGNED_IN);
    expect(accepted.roles).toContain(UserRole.PLATFORM_OPERATOR_ADMIN);
  });
});
```

- [ ] **Step 2: รันให้ล้ม** `cd apps/web && GACP_ENV=test COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec vitest run --config vitest.integration.config.ts` → FAIL (module not found)

- [ ] **Step 3: เขียน `login-state.ts`**

```ts
import 'server-only';
import { type IdentityProvider, type LoginIntent, loginIntentSchema, readEnv } from '@gacp/contracts';
import { EncryptJWT, jwtDecrypt } from 'jose';
import { cookies } from 'next/headers';
import { z } from 'zod';

// cookie ชั่วคราวระหว่าง redirect ไป IdP และกลับ: กัน CSRF (state) และเก็บ nonce/PKCE verifier ฝั่ง server เท่านั้น
export const LOGIN_STATE_COOKIE_NAME = 'gacp_login_state';
const LOGIN_STATE_TTL_SECONDS = 10 * 60;

const loginStateSchema = z.object({
  intent: loginIntentSchema,
  provider: z.enum(['THAID', 'MORPHROM_HEALTH_ID']),
  state: z.string().min(1),
  nonce: z.string().min(1).nullable(),
  pkceCodeVerifier: z.string().min(1).nullable(),
  redirectUri: z.url(),
  next: z.string().nullable(),
});
export type LoginState = z.infer<typeof loginStateSchema>;

async function key(): Promise<Uint8Array> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`login-state:${readEnv().GACP_SESSION_SECRET}`));
  return new Uint8Array(digest);
}

export async function storeLoginState(state: LoginState): Promise<void> {
  const token = await new EncryptJWT(loginStateSchema.parse(state))
    .setProtectedHeader({ alg: 'dir', enc: 'A256GCM' })
    .setIssuedAt()
    .setExpirationTime(`${LOGIN_STATE_TTL_SECONDS}s`)
    .encrypt(await key());
  const cookieStore = await cookies();
  cookieStore.set(LOGIN_STATE_COOKIE_NAME, token, {
    httpOnly: true, sameSite: 'lax', secure: process.env.NODE_ENV === 'production', path: '/auth', maxAge: LOGIN_STATE_TTL_SECONDS,
  });
}

// อ่านแล้วลบทันที (ใช้ได้ครั้งเดียว) คืน undefined เมื่อไม่มี หมดอายุ หรือถูกแก้
export async function takeLoginState(expectedProvider: IdentityProvider): Promise<LoginState | undefined> {
  const cookieStore = await cookies();
  const token = cookieStore.get(LOGIN_STATE_COOKIE_NAME)?.value;
  cookieStore.delete(LOGIN_STATE_COOKIE_NAME);
  if (!token) return undefined;
  try {
    const { payload } = await jwtDecrypt(token, await key());
    const parsed = loginStateSchema.safeParse(payload);
    if (!parsed.success || parsed.data.provider !== expectedProvider) return undefined;
    return parsed.data;
  } catch {
    return undefined;
  }
}
```

- [ ] **Step 4: เขียน `sign-in.ts`**

```ts
import 'server-only';
import { createHash } from 'node:crypto';
import {
  type IdentityProvider,
  LoginIntent,
  type MorphromProviderProfile,
  RoleSide,
  roleSideOf,
  UserRole,
} from '@gacp/contracts';
import { type AccountCredentials, effectiveRoles } from '@gacp/domain';
import { database } from '@/lib/database.ts';
import { hmacField } from '@/lib/protected-fields.ts';
import { sealSession } from '@/lib/session.ts';

// จุดเดียวที่เปลี่ยน "พิสูจน์ตัวตนสำเร็จ" เป็น User + เครดิต + บทบาทมีผล + session (spec 2026-09-09 §6)

export const SignInOutcome = {
  SIGNED_IN: 'SIGNED_IN',
  NOT_PROVIDER: 'NOT_PROVIDER',
  AGENCY_NOT_AUTHORIZED: 'AGENCY_NOT_AUTHORIZED',
  NOT_MEMBER: 'NOT_MEMBER',
  NO_ROLE_YET: 'NO_ROLE_YET',
} as const;
export type SignInOutcome = (typeof SignInOutcome)[keyof typeof SignInOutcome];

export type SignInInput = {
  readonly provider: IdentityProvider;
  readonly subject: string;
  readonly nationalId: string | null;
  readonly hashCid: string | null;
  readonly displayName: string;
  readonly identityAssuranceLevel: string | null;
  readonly intent: LoginIntent;
  readonly providerProfile: MorphromProviderProfile | null;
};

export type SignInResult = {
  readonly outcome: SignInOutcome;
  readonly sessionToken: string | null;
  readonly roles: UserRole[];
  readonly userId: string;
};

// หา/สร้าง User จากตัวตน: ลำดับ 1) identity เดิม 2) เลขบัตรเดียวกัน (คนเดียวกันมาคนละทาง) 3) สร้างใหม่
async function upsertUser(input: SignInInput): Promise<string> {
  const subjectHmac = hmacField(input.subject);
  const nationalIdHmac = input.nationalId ? hmacField(input.nationalId) : null;
  const now = new Date();
  return database.$transaction(async (transaction) => {
    const identity = await transaction.userIdentity.findUnique({
      // biome-ignore lint/style/useNamingConvention: ชื่อ compound unique key ที่ Prisma สร้าง
      where: { provider_subjectHmac: { provider: input.provider, subjectHmac } },
    });
    let userId = identity?.userId;
    if (!userId && nationalIdHmac) {
      userId = (await transaction.user.findUnique({ where: { nationalIdHmac } }))?.id;
    }
    if (!userId) {
      userId = (await transaction.user.create({ data: { displayName: input.displayName, nationalIdHmac } })).id;
    } else {
      await transaction.user.update({
        where: { id: userId },
        data: { displayName: input.displayName, ...(nationalIdHmac ? { nationalIdHmac } : {}) },
      });
    }
    if (identity) {
      await transaction.userIdentity.update({
        where: { id: identity.id },
        data: { lastLoginAt: now, verifiedAt: now, identityAssuranceLevel: input.identityAssuranceLevel },
      });
    } else {
      await transaction.userIdentity.create({
        data: { userId, provider: input.provider, subjectHmac, lastLoginAt: now, verifiedAt: now, identityAssuranceLevel: input.identityAssuranceLevel },
      });
    }
    return userId;
  });
}

// บันทึกผลตรวจ Provider ID: มี profile = upsert เครดิต; ไม่มี = ทำเครื่องหมายว่าถูกถอน (ถ้าเคยมี)
async function recordProviderLookup(userId: string, profile: MorphromProviderProfile | null): Promise<AccountCredentials['providerAgencyAuthorized']> {
  if (!profile) {
    await database.providerCredential.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: new Date() } });
    return false;
  }
  const authorized = await database.authorizedProviderAgency.findMany({
    where: { businessId: { in: profile.affiliations.map((entry) => entry.businessId) }, revokedAt: null },
    select: { businessId: true },
  });
  const authorizedIds = new Set(authorized.map((entry) => entry.businessId));
  const chosen = profile.affiliations.find((entry) => authorizedIds.has(entry.businessId)) ?? profile.affiliations[0] ?? null;
  const profileHash = createHash('sha256').update(JSON.stringify(profile)).digest('hex');
  const row = {
    providerId: profile.providerId,
    agencyBusinessId: chosen?.businessId ?? null,
    agencyCode: chosen?.agencyCode ?? null,
    agencyNameTh: chosen?.agencyNameTh ?? null,
    position: chosen?.position ?? null,
    positionType: chosen?.positionType ?? null,
    licenseId: chosen?.licenseId ?? null,
    profileHash,
    lastVerifiedAt: new Date(),
    revokedAt: null,
  };
  await database.providerCredential.upsert({ where: { userId }, create: { userId, ...row }, update: row });
  return chosen !== null && authorizedIds.has(chosen.businessId);
}

async function credentialsOf(userId: string, nationalIdHmac: string | null): Promise<AccountCredentials> {
  const [credential, membership] = await Promise.all([
    database.providerCredential.findUnique({ where: { userId } }),
    nationalIdHmac ? database.platformOperatorMembership.findUnique({ where: { nationalIdHmac } }) : null,
  ]);
  let providerAgencyAuthorized = false;
  if (credential?.agencyBusinessId && !credential.revokedAt) {
    providerAgencyAuthorized =
      (await database.authorizedProviderAgency.count({ where: { businessId: credential.agencyBusinessId, revokedAt: null } })) > 0;
  }
  return {
    providerCredentialActive: credential !== null && credential.revokedAt === null,
    providerAgencyAuthorized,
    platformOperatorMembershipActive: membership !== null && membership.revokedAt === null,
  };
}

// ผูก membership กับ user ครั้งแรก และมอบ PLATFORM_OPERATOR_ADMIN ให้คนจากคำสั่ง bootstrap
async function linkMembership(userId: string, nationalIdHmac: string): Promise<void> {
  const membership = await database.platformOperatorMembership.findUnique({ where: { nationalIdHmac } });
  if (!membership || membership.revokedAt) return;
  if (membership.userId !== userId) {
    await database.platformOperatorMembership.update({ where: { id: membership.id }, data: { userId } });
  }
  if (membership.bootstrapAdmin) {
    const existing = await database.staffRoleAssignment.findFirst({ where: { userId, role: UserRole.PLATFORM_OPERATOR_ADMIN, revokedAt: null } });
    if (!existing) await database.staffRoleAssignment.create({ data: { userId, role: UserRole.PLATFORM_OPERATOR_ADMIN } });
  }
}

export async function completeSignIn(input: SignInInput): Promise<SignInResult> {
  const userId = await upsertUser(input);
  const nationalIdHmac = input.nationalId ? hmacField(input.nationalId) : null;

  if (input.intent === LoginIntent.CERTIFICATION_BODY_STAFF) {
    const authorized = await recordProviderLookup(userId, input.providerProfile);
    if (!input.providerProfile) return { outcome: SignInOutcome.NOT_PROVIDER, sessionToken: null, roles: [], userId };
    if (!authorized) return { outcome: SignInOutcome.AGENCY_NOT_AUTHORIZED, sessionToken: null, roles: [], userId };
  }
  if (input.intent === LoginIntent.PLATFORM_OPERATOR_STAFF) {
    if (!nationalIdHmac) return { outcome: SignInOutcome.NOT_MEMBER, sessionToken: null, roles: [], userId };
    await linkMembership(userId, nationalIdHmac);
  }

  const assignments = await database.staffRoleAssignment.findMany({ where: { userId, revokedAt: null }, select: { role: true } });
  const credentials = await credentialsOf(userId, nationalIdHmac);
  const roles = effectiveRoles(assignments.map((entry) => entry.role), credentials);

  if (input.intent === LoginIntent.PLATFORM_OPERATOR_STAFF && !credentials.platformOperatorMembershipActive) {
    return { outcome: SignInOutcome.NOT_MEMBER, sessionToken: null, roles, userId };
  }
  const wantedSide = input.intent === LoginIntent.CERTIFICATION_BODY_STAFF ? RoleSide.CERTIFICATION_BODY
    : input.intent === LoginIntent.PLATFORM_OPERATOR_STAFF ? RoleSide.PLATFORM_OPERATOR : RoleSide.APPLICANT;
  if (wantedSide !== RoleSide.APPLICANT && !roles.some((role) => roleSideOf(role) === wantedSide)) {
    return { outcome: SignInOutcome.NO_ROLE_YET, sessionToken: null, roles, userId };
  }

  await database.session.create({ data: { userId, expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000) } });
  const sessionToken = await sealSession({ sub: `${input.provider.toLowerCase()}:${hmacField(input.subject)}`, displayName: input.displayName, roles, identityProvider: input.provider });
  return { outcome: SignInOutcome.SIGNED_IN, sessionToken, roles, userId };
}
```

- [ ] **Step 5: session payload** ใน `session.ts` เพิ่ม `identityProvider: identityProviderSchema` ใน `sessionPayloadSchema` (import จาก contracts) · dev login ใส่ `identityProvider: IdentityProvider.DEV_LOCAL`

- [ ] **Step 6: `current-user.ts`** เปลี่ยน `providerOf()` ให้แมป `sub` ที่ขึ้นด้วย `thaid:` → `THAID`, `morphrom_health_id:` → `MORPHROM_HEALTH_ID`, อื่น ๆ → `DEV_LOCAL` และใช้ `session.identityProvider` เป็นหลักถ้ามี · ส่วน find/create identity คงเดิม (subjectHmac = `hmacField(session.sub)` เดิม ยังใช้ได้กับ dev login)

- [ ] **Step 7: route handlers**

`app/auth/thaid/start/route.ts`:

```ts
import { IdentityProvider, LoginIntent, loginIntentSchema, readEnv } from '@gacp/contracts';
import { NextResponse } from 'next/server';
import { identityClients } from '@/lib/identity/identity-clients.ts';
import { storeLoginState } from '@/lib/identity/login-state.ts';

function baseUrl(request: Request): string {
  return readEnv().GACP_PUBLIC_BASE_URL ?? new URL(request.url).origin;
}

// biome-ignore lint/style/useNamingConvention: Next.js กำหนดชื่อ Route Handler ตาม HTTP method
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const intent = loginIntentSchema.catch(LoginIntent.APPLICANT).parse(url.searchParams.get('intent') ?? LoginIntent.APPLICANT);
  const redirectUri = `${baseUrl(request)}/auth/thaid/callback`;
  const start = await identityClients().thaid.startAuthorization(redirectUri);
  await storeLoginState({
    intent, provider: IdentityProvider.THAID, state: start.state, nonce: start.nonce,
    pkceCodeVerifier: start.pkceCodeVerifier, redirectUri, next: url.searchParams.get('next'),
  });
  return NextResponse.redirect(start.url, { status: 302 });
}
```

`app/auth/thaid/callback/route.ts`:

```ts
import { IdentityProvider } from '@gacp/contracts';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { identityClients } from '@/lib/identity/identity-clients.ts';
import { takeLoginState } from '@/lib/identity/login-state.ts';
import { completeSignIn, SignInOutcome } from '@/lib/identity/sign-in.ts';
import { homePathForIntent, outcomePath } from '@/lib/roles.ts';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '@/lib/session.ts';

// biome-ignore lint/style/useNamingConvention: Next.js กำหนดชื่อ Route Handler ตาม HTTP method
export async function GET(request: Request): Promise<NextResponse> {
  const loginState = await takeLoginState(IdentityProvider.THAID);
  if (!loginState) return NextResponse.redirect(new URL(outcomePath('STATE_MISMATCH'), request.url));
  const callbackUrl = new URL(request.url);
  callbackUrl.protocol = new URL(loginState.redirectUri).protocol;
  callbackUrl.host = new URL(loginState.redirectUri).host;
  const claims = await identityClients().thaid.completeAuthorization(callbackUrl, {
    state: loginState.state, nonce: loginState.nonce ?? '', pkceCodeVerifier: loginState.pkceCodeVerifier,
  });
  const displayName = claims.name ?? [claims.given_name, claims.family_name].filter(Boolean).join(' ') || 'ผู้ใช้ ThaID'; // glossary-allow ชื่อ claim OIDC
  const result = await completeSignIn({
    provider: IdentityProvider.THAID, subject: claims.sub, nationalId: claims.pid ?? null, hashCid: null,
    displayName, identityAssuranceLevel: claims.ial ?? null, intent: loginState.intent, providerProfile: null,
  });
  if (result.outcome !== SignInOutcome.SIGNED_IN || !result.sessionToken) {
    return NextResponse.redirect(new URL(outcomePath(result.outcome), request.url));
  }
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, result.sessionToken, sessionCookieOptions);
  return NextResponse.redirect(new URL(loginState.next ?? homePathForIntent(loginState.intent, result.roles), request.url));
}
```

`app/auth/morphrom/start/route.ts` เหมือน thaid/start แต่ใช้ `identityClients().morphrom.authorizationUrl(redirectUri, state)` โดย `state = crypto.randomUUID()`, `nonce: null`, `pkceCodeVerifier: null`, `provider: IdentityProvider.MORPHROM_HEALTH_ID`, redirectUri `/auth/morphrom/callback`

`app/auth/morphrom/callback/route.ts`:

```ts
import { IdentityProvider, LoginIntent } from '@gacp/contracts';
import { cookies } from 'next/headers';
import { NextResponse } from 'next/server';
import { identityClients } from '@/lib/identity/identity-clients.ts';
import { takeLoginState } from '@/lib/identity/login-state.ts';
import { completeSignIn, SignInOutcome } from '@/lib/identity/sign-in.ts';
import { homePathForIntent, outcomePath } from '@/lib/roles.ts';
import { SESSION_COOKIE_NAME, sessionCookieOptions } from '@/lib/session.ts';

// biome-ignore lint/style/useNamingConvention: Next.js กำหนดชื่อ Route Handler ตาม HTTP method
export async function GET(request: Request): Promise<NextResponse> {
  const url = new URL(request.url);
  const loginState = await takeLoginState(IdentityProvider.MORPHROM_HEALTH_ID);
  const code = url.searchParams.get('code');
  if (!loginState || !code || url.searchParams.get('state') !== loginState.state) {
    return NextResponse.redirect(new URL(outcomePath('STATE_MISMATCH'), request.url));
  }
  const { morphrom } = identityClients();
  const { accessToken, identity } = await morphrom.exchangeCode(code, loginState.redirectUri);
  const lookup = loginState.intent === LoginIntent.CERTIFICATION_BODY_STAFF ? await morphrom.lookupProvider(accessToken) : null;
  const profile = lookup?.kind === 'PROVIDER' ? lookup.profile : null;
  const result = await completeSignIn({
    provider: IdentityProvider.MORPHROM_HEALTH_ID, subject: identity.accountId, nationalId: null, hashCid: profile?.hashCid ?? identity.hashCid,
    displayName: profile?.nameTh ?? identity.displayName ?? 'ผู้ใช้ Health ID', identityAssuranceLevel: null,
    intent: loginState.intent, providerProfile: profile,
  });
  if (result.outcome !== SignInOutcome.SIGNED_IN || !result.sessionToken) {
    return NextResponse.redirect(new URL(outcomePath(result.outcome), request.url));
  }
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, result.sessionToken, sessionCookieOptions);
  return NextResponse.redirect(new URL(loginState.next ?? homePathForIntent(loginState.intent, result.roles), request.url));
}
```

`app/auth/outcome/page.tsx`: อ่าน `searchParams.code` (`NOT_PROVIDER | AGENCY_NOT_AUTHORIZED | NOT_MEMBER | NO_ROLE_YET | STATE_MISMATCH`) แสดงหัวข้อ/คำอธิบายจาก `messages.signInOutcome[code]` (เพิ่มใน Task 6) พร้อมลิงก์กลับหน้าล็อกอินที่เหมาะ (บริษัท → `/platform-operator/login`)

- [ ] **Step 8: dev login สร้างเครดิตของฝั่ง** ใน `auth/login/actions.ts` หลัง parse: หา/สร้าง user ผ่าน `completeSignIn` ไม่ได้ (ไม่มี IdP) จึงทำเองใน dev เท่านั้น:

```ts
  // dev: สร้าง User + เครดิตของฝั่งที่บทบาทนั้นต้องมี เพื่อให้หน้าผู้ดูแลระบบและกติกา domain ทดสอบได้จริง
  const subject = `dev-local:${role.toLowerCase()}`;
  const subjectHmac = hmacField(subject);
  const user = await database.userIdentity.findUnique({ where: { provider_subjectHmac: { provider: IdentityProvider.DEV_LOCAL, subjectHmac } }, include: { user: true } }) // biome-ignore lint/style/useNamingConvention: compound unique ของ Prisma
    .then((identity) => identity?.user ?? database.user.create({ data: { displayName, identities: { create: { provider: IdentityProvider.DEV_LOCAL, subjectHmac, lastLoginAt: new Date() } } } }));
  const side = roleSideOf(role);
  if (side === RoleSide.CERTIFICATION_BODY) {
    await database.authorizedProviderAgency.upsert({ where: { businessId: 'DEV-AGENCY' }, create: { businessId: 'DEV-AGENCY', agencyCode: '00000', nameTh: 'หน่วยงานทดสอบ (dev)' }, update: { revokedAt: null } });
    await database.providerCredential.upsert({ where: { userId: user.id }, create: { userId: user.id, providerId: `DEV${role.slice(0, 10)}`, agencyBusinessId: 'DEV-AGENCY', agencyCode: '00000', agencyNameTh: 'หน่วยงานทดสอบ (dev)', profileHash: 'dev' }, update: { revokedAt: null, lastVerifiedAt: new Date() } });
  }
  if (side === RoleSide.PLATFORM_OPERATOR) {
    const nationalIdHmac = hmacField(`dev-national-id:${role}`);
    await database.user.update({ where: { id: user.id }, data: { nationalIdHmac } });
    await database.platformOperatorMembership.upsert({ where: { nationalIdHmac }, create: { nationalIdHmac, displayName, userId: user.id }, update: { revokedAt: null, userId: user.id } });
  }
  if (role !== UserRole.APPLICANT) {
    const assigned = await database.staffRoleAssignment.findFirst({ where: { userId: user.id, role, revokedAt: null } });
    if (!assigned) await database.staffRoleAssignment.create({ data: { userId: user.id, role } });
  }
  const token = await sealSession({ sub: subject, displayName, roles: [role], identityProvider: IdentityProvider.DEV_LOCAL });
```

(`displayName` และ `role` มาจาก `parsed.data` เดิม; import `database`, `hmacField`, `IdentityProvider`, `RoleSide`, `roleSideOf`, `UserRole` เพิ่ม)

- [ ] **Step 9: รัน integration test ให้ผ่าน** `GACP_ENV=test COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec vitest run --config vitest.integration.config.ts` → PASS 4 tests (ต้องมี `.env.local` ชี้ฐานข้อมูล dev; `GACP_ENV=test` ทำให้ `readEnv()` ไม่บังคับ client จริง)

- [ ] **Step 10: Commit**

```bash
git add apps/web/src/lib apps/web/src/app/auth apps/web/vitest.integration.config.ts apps/web/package.json
git commit -m "feat(web): ล็อกอิน 3 ทาง (ThaID, Health ID, Provider ID) และ completeSignIn ที่คำนวณบทบาทมีผลจากเครดิตของฝั่ง

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 6: web — เส้นทางตามฝั่ง, proxy, หน้าล็อกอิน 2 หน้า, ข้อความ 9 บทบาท

**Files:**
- Modify: `apps/web/src/lib/roles.ts`, `apps/web/src/proxy.ts`, `apps/web/src/messages/th.ts`, `apps/web/src/components/role-shell.tsx`, `apps/web/src/components/role-home.tsx`, `apps/web/src/app/auth/login/page.tsx`, `apps/web/src/app/page.tsx`
- Move (git mv): `app/document-reviewer` → `app/certification-body/document-reviewer`, `app/dispatcher` → `app/certification-body/dispatcher`, `app/field-inspector` → `app/certification-body/field-inspector`, `app/certificate-approver` → `app/certification-body/certificate-approver`, `app/finance-officer` → `app/platform-operator/finance-officer`, `app/system-admin` → `app/platform-operator/admin`
- Create: `app/certification-body/admin/page.tsx` (RoleHome ชั่วคราว จน Task 7), `app/certification-body/finance-officer/page.tsx`, `app/platform-operator/login/page.tsx`
- Test: `apps/web/src/lib/roles.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const ROLE_HOME_PATHS: Record<UserRole, string>;               // '/applicant', '/certification-body/document-reviewer', ..., '/platform-operator/admin'
  export function roleHomePath(role: UserRole): string;
  export function roleForPathname(pathname: string): UserRole | undefined;   // เทียบ prefix ยาวสุดก่อน
  export function loginPathForPathname(pathname: string): string;            // '/platform-operator/*' → '/platform-operator/login' อื่น ๆ → '/auth/login'
  export function homePathForIntent(intent: LoginIntent, roles: readonly UserRole[]): string;
  export function outcomePath(code: string): string;                          // `/auth/outcome?code=${code}`
  export const SIDE_TONE: Record<RoleSide, 'applicant' | 'officer' | 'operator'>;
  ```

- [ ] **Step 1: test ที่ล้มก่อน** `roles.test.ts`:

```ts
import { LoginIntent, UserRole } from '@gacp/contracts';
import { describe, expect, it } from 'vitest';
import { homePathForIntent, loginPathForPathname, roleForPathname, roleHomePath } from './roles.ts';

describe('เส้นทางตามฝั่ง', () => {
  it('หน้าหลักของบทบาทจัดกลุ่มตามฝั่ง', () => {
    expect(roleHomePath(UserRole.APPLICANT)).toBe('/applicant');
    expect(roleHomePath(UserRole.DOCUMENT_REVIEWER)).toBe('/certification-body/document-reviewer');
    expect(roleHomePath(UserRole.CERTIFICATION_BODY_ADMIN)).toBe('/certification-body/admin');
    expect(roleHomePath(UserRole.PLATFORM_OPERATOR_FINANCE_OFFICER)).toBe('/platform-operator/finance-officer');
  });
  it('หา role จาก pathname โดยเทียบ prefix ที่ยาวสุด', () => {
    expect(roleForPathname('/certification-body/admin/agencies')).toBe(UserRole.CERTIFICATION_BODY_ADMIN);
    expect(roleForPathname('/platform-operator/admin')).toBe(UserRole.PLATFORM_OPERATOR_ADMIN);
    expect(roleForPathname('/platform-operator/login')).toBeUndefined();
    expect(roleForPathname('/applicant/applications/x/steps/2')).toBe(UserRole.APPLICANT);
    expect(roleForPathname('/verify/GACP-TH-2569-000001')).toBeUndefined();
  });
  it('หน้าล็อกอินของฝั่งบริษัทแยกจากหน้าสาธารณะ', () => {
    expect(loginPathForPathname('/platform-operator/admin')).toBe('/platform-operator/login');
    expect(loginPathForPathname('/certification-body/dispatcher')).toBe('/auth/login');
  });
  it('หลังล็อกอินไปหน้าหลักของบทบาทแรกในฝั่งที่ตั้งใจ', () => {
    expect(homePathForIntent(LoginIntent.CERTIFICATION_BODY_STAFF, [UserRole.APPLICANT, UserRole.DISPATCHER])).toBe('/certification-body/dispatcher');
    expect(homePathForIntent(LoginIntent.APPLICANT, [UserRole.APPLICANT])).toBe('/applicant');
  });
});
```

- [ ] **Step 2: รันให้ล้ม** `cd apps/web && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec vitest run src/lib/roles.test.ts`

- [ ] **Step 3: เขียน `roles.ts` ใหม่**

```ts
import { type LoginIntent, ROLES_BY_SIDE, RoleSide, roleSideOf, UserRole } from '@gacp/contracts';

// เส้นทางจัดกลุ่มตามฝั่ง (spec 2026-09-09 §5): /applicant · /certification-body/<บทบาท> · /platform-operator/<บทบาท>
export const ROLE_HOME_PATHS: Readonly<Record<UserRole, string>> = {
  [UserRole.APPLICANT]: '/applicant',
  [UserRole.DOCUMENT_REVIEWER]: '/certification-body/document-reviewer',
  [UserRole.DISPATCHER]: '/certification-body/dispatcher',
  [UserRole.FIELD_INSPECTOR]: '/certification-body/field-inspector',
  [UserRole.CERTIFICATE_APPROVER]: '/certification-body/certificate-approver',
  [UserRole.CERTIFICATION_BODY_ADMIN]: '/certification-body/admin',
  [UserRole.CERTIFICATION_BODY_FINANCE_OFFICER]: '/certification-body/finance-officer',
  [UserRole.PLATFORM_OPERATOR_ADMIN]: '/platform-operator/admin',
  [UserRole.PLATFORM_OPERATOR_FINANCE_OFFICER]: '/platform-operator/finance-officer',
};

export const PLATFORM_OPERATOR_LOGIN_PATH = '/platform-operator/login';
export const PUBLIC_LOGIN_PATH = '/auth/login';

const ROLES_BY_PATH_LENGTH = (Object.entries(ROLE_HOME_PATHS) as [UserRole, string][]).sort(
  (left, right) => right[1].length - left[1].length,
);

export function roleHomePath(role: UserRole): string {
  return ROLE_HOME_PATHS[role];
}

export function roleForPathname(pathname: string): UserRole | undefined {
  if (pathname === PLATFORM_OPERATOR_LOGIN_PATH) return undefined;
  const match = ROLES_BY_PATH_LENGTH.find(([, path]) => pathname === path || pathname.startsWith(`${path}/`));
  return match?.[0];
}

export function loginPathForPathname(pathname: string): string {
  return pathname.startsWith('/platform-operator') ? PLATFORM_OPERATOR_LOGIN_PATH : PUBLIC_LOGIN_PATH;
}

const SIDE_OF_INTENT: Readonly<Record<LoginIntent, RoleSide>> = {
  APPLICANT: RoleSide.APPLICANT,
  CERTIFICATION_BODY_STAFF: RoleSide.CERTIFICATION_BODY,
  PLATFORM_OPERATOR_STAFF: RoleSide.PLATFORM_OPERATOR,
};

export function homePathForIntent(intent: LoginIntent, roles: readonly UserRole[]): string {
  const side = SIDE_OF_INTENT[intent];
  const first = ROLES_BY_SIDE[side].find((role) => roles.includes(role)) ?? roles[0] ?? UserRole.APPLICANT;
  return roleHomePath(first);
}

export function outcomePath(code: string): string {
  return `/auth/outcome?code=${encodeURIComponent(code)}`;
}

export const SIDE_TONE: Readonly<Record<RoleSide, 'applicant' | 'officer' | 'operator'>> = {
  [RoleSide.APPLICANT]: 'applicant',
  [RoleSide.CERTIFICATION_BODY]: 'officer',
  [RoleSide.PLATFORM_OPERATOR]: 'operator',
};

export function sideToneOf(role: UserRole): 'applicant' | 'officer' | 'operator' {
  return SIDE_TONE[roleSideOf(role)];
}
```

- [ ] **Step 4: `proxy.ts`** เปลี่ยน matcher เป็น `['/applicant/:path*', '/certification-body/:path*', '/platform-operator/:path*']` และแทน `loginUrl` ด้วย `new URL(loginPathForPathname(request.nextUrl.pathname), request.url)` · ให้ `/platform-operator/login` ผ่านโดยไม่ตรวจ (roleForPathname คืน undefined อยู่แล้ว)

- [ ] **Step 5: ย้ายโฟลเดอร์**

```bash
cd apps/web/src/app
mkdir -p certification-body platform-operator
git mv document-reviewer certification-body/document-reviewer
git mv dispatcher certification-body/dispatcher
git mv field-inspector certification-body/field-inspector
git mv certificate-approver certification-body/certificate-approver
git mv finance-officer platform-operator/finance-officer
git mv system-admin platform-operator/admin
```

แก้ `page.tsx` ที่ย้ายมา: `platform-operator/finance-officer/page.tsx` → `UserRole.PLATFORM_OPERATOR_FINANCE_OFFICER`, `platform-operator/admin/page.tsx` → `UserRole.PLATFORM_OPERATOR_ADMIN` · สร้าง `certification-body/admin/page.tsx` และ `certification-body/finance-officer/page.tsx` แบบเดียวกัน (`RoleHome` ด้วย `CERTIFICATION_BODY_ADMIN` / `CERTIFICATION_BODY_FINANCE_OFFICER`) · หน้า admin ทั้งสองจะถูกแทนใน Task 7

- [ ] **Step 6: `messages/th.ts`** แทน `roleLabels` และ `roleHomeIntro` ด้วย 9 ค่า และเพิ่ม:

```ts
export const roleLabels: Record<UserRole, string> = {
  [UserRole.APPLICANT]: 'ผู้ขอรับรอง',
  [UserRole.DOCUMENT_REVIEWER]: 'ผู้ตรวจเอกสาร',
  [UserRole.DISPATCHER]: 'ผู้จัดคิวงาน',
  [UserRole.FIELD_INSPECTOR]: 'ผู้ตรวจประเมินแปลง',
  [UserRole.CERTIFICATE_APPROVER]: 'ผู้อนุมัติออกใบรับรอง',
  [UserRole.CERTIFICATION_BODY_ADMIN]: 'ผู้ดูแลระบบของกรม',
  [UserRole.CERTIFICATION_BODY_FINANCE_OFFICER]: 'เจ้าหน้าที่การเงินของกรม',
  [UserRole.PLATFORM_OPERATOR_ADMIN]: 'ผู้ดูแลระบบของบริษัท',
  [UserRole.PLATFORM_OPERATOR_FINANCE_OFFICER]: 'เจ้าหน้าที่การเงินของบริษัท',
};

export const roleSideLabels: Record<RoleSide, string> = {
  [RoleSide.APPLICANT]: 'ผู้ขอรับรอง',
  [RoleSide.CERTIFICATION_BODY]: 'เจ้าหน้าที่กรม',
  [RoleSide.PLATFORM_OPERATOR]: 'บริษัทผู้ให้บริการแพลตฟอร์ม',
};
```

`roleHomeIntro` 9 ค่า (ของกรม admin: 'บทบาทเจ้าหน้าที่กรม สังกัดที่รับเป็นเจ้าหน้าที่ และบันทึกการเข้าถึงเอกสาร (ไม่มีสิทธิ์เงินและการตัดสินคำขอ)', กรม finance: 'ค่าธรรมเนียมส่วนของกรมที่เก็บได้ และการยืนยันรับงวดนำส่ง ดูอย่างเดียว', บริษัท admin: 'รายชื่อพนักงานบริษัท บทบาทฝั่งบริษัท และการตั้งผู้ดูแลระบบให้กรม (ไม่มีสิทธิ์เงินและการตัดสินคำขอ)', บริษัท finance: 'ยอดรับชำระ ใบเสร็จ การคืนเงิน และงวดนำส่งค่าธรรมเนียมให้กรม ไม่มีปุ่มเปลี่ยนสถานะคำขอ')

เพิ่มใน `messages`:

```ts
  login: {
    title: 'เข้าสู่ระบบ',
    applicantTitle: 'ผู้ขอรับรอง',
    applicantLead: 'ใช้บัญชี Health ID ของหมอพร้อม หรือ ThaID ของกรมการปกครอง ระบบไม่เก็บรหัสผ่านของคุณ',
    healthId: 'เข้าสู่ระบบด้วย Health ID',
    thaid: 'เข้าสู่ระบบด้วย ThaID',
    staffTitle: 'สำหรับเจ้าหน้าที่กรม',
    staffLead: 'ใช้บัญชี Health ID ที่มี Provider ID ในสังกัดที่กรมอนุญาต',
    providerId: 'เข้าด้วย Provider ID',
    notConfigured: 'ยังไม่ได้เชื่อมต่อผู้ให้บริการยืนยันตัวตนบนเครื่องนี้ (รอ client จากสำนักสุขภาพดิจิทัลและกรมการปกครอง)',
    platformOperatorTitle: 'บริษัทผู้ให้บริการแพลตฟอร์ม',
    platformOperatorLead: 'สำหรับพนักงานบริษัทที่อยู่ในรายชื่อเท่านั้น เข้าสู่ระบบด้วย ThaID',
    devTitle: 'เข้าสู่ระบบแบบทดสอบ (เฉพาะเครื่องพัฒนา)',
    devDescription: 'เลือกบทบาทเพื่อดูหน้าจอของบทบาทนั้น ระบบสร้างเครดิตของฝั่งนั้นให้ ไม่มีการตรวจสอบตัวตนจริง และเปิดใช้ไม่ได้ใน production',
    displayNameLabel: 'ชื่อที่จะแสดง',
    displayNamePlaceholder: 'เช่น สมพร ตัวอย่างดี',
    roleLabel: 'บทบาท',
    submit: 'เข้าสู่ระบบ',
    displayNameRequired: 'กรุณากรอกชื่อที่จะแสดง แล้วลองอีกครั้ง',
    roleRequired: 'กรุณาเลือกบทบาท แล้วลองอีกครั้ง',
  },
  signInOutcome: {
    NOT_PROVIDER: { title: 'บัญชีนี้ไม่มี Provider ID', body: 'บัญชี Health ID ของคุณยังไม่ได้รับ Provider ID จากหน่วยงาน สมัครที่ provider.id.th โดยให้หน่วยงานรับรอง แล้วกลับมาเข้าใหม่ ระหว่างนี้คุณใช้ระบบในฐานะผู้ขอรับรองได้' },
    AGENCY_NOT_AUTHORIZED: { title: 'สังกัดของคุณยังไม่อยู่ในรายการของกรม', body: 'Provider ID ของคุณใช้ได้ แต่สังกัดยังไม่ได้รับอนุญาตให้เป็นเจ้าหน้าที่กรมในระบบนี้ ติดต่อผู้ดูแลระบบของกรมเพื่อเพิ่มสังกัด' },
    NOT_MEMBER: { title: 'คุณไม่อยู่ในรายชื่อพนักงานบริษัท', body: 'เข้าฝั่งบริษัทได้เฉพาะคนที่ผู้ดูแลระบบของบริษัทเพิ่มไว้ ติดต่อผู้ดูแลระบบของบริษัท' },
    NO_ROLE_YET: { title: 'ยืนยันตัวตนสำเร็จ รอการมอบบทบาท', body: 'ระบบรู้จักคุณแล้ว แต่ผู้ดูแลระบบยังไม่ได้มอบบทบาท เมื่อได้รับบทบาทแล้วให้เข้าสู่ระบบอีกครั้ง' },
    STATE_MISMATCH: { title: 'การเข้าสู่ระบบไม่สมบูรณ์', body: 'ลิงก์หมดอายุหรือถูกเปิดจากอุปกรณ์อื่น กรุณาเริ่มเข้าสู่ระบบใหม่' },
    backToLogin: 'กลับหน้าเข้าสู่ระบบ',
  },
```

- [ ] **Step 7: หน้าล็อกอินสาธารณะ** `auth/login/page.tsx`: การ์ด "ผู้ขอรับรอง" มีลิงก์ปุ่ม `href="/auth/morphrom/start?intent=APPLICANT"` (Health ID) และ `href="/auth/thaid/start?intent=APPLICANT"` (ThaID) · การ์ด "สำหรับเจ้าหน้าที่กรม" ปุ่ม `href="/auth/morphrom/start?intent=CERTIFICATION_BODY_STAFF"` · ถ้า `identityProvidersConfigured()` เป็น false ให้ปุ่มเป็น `aria-disabled` พร้อมข้อความ `messages.login.notConfigured` · ส่วน dev login เดิมคงไว้ แต่ `<select>` แสดง 9 บทบาทจัดกลุ่มด้วย `<optgroup label={roleSideLabels[side]}>` ตาม `ROLES_BY_SIDE` · แปะ `next` เป็น query ให้ start route

- [ ] **Step 8: หน้าล็อกอินบริษัท** `platform-operator/login/page.tsx`: หัว "บริษัทผู้ให้บริการแพลตฟอร์ม" + lead + ปุ่มเดียว `href="/auth/thaid/start?intent=PLATFORM_OPERATOR_STAFF"` (+ dev login เฉพาะบทบาทฝั่งบริษัทเมื่อเปิด dev) · ถ้ามี session ที่มีบทบาทฝั่งบริษัทอยู่แล้ว redirect ไปหน้าหลัก

- [ ] **Step 9: `role-shell.tsx`** รับ `role` แล้วเลือกสี chip ตาม `sideToneOf(role)`: applicant `bg-leaf-tint text-leaf`, officer `bg-officer-tint text-officer`, operator `bg-navy text-white` และแสดง `roleSideLabels[roleSideOf(role)]` ตัวเล็กหน้าชื่อบทบาท · ปุ่มออกจากระบบ redirect ไป `loginPathForPathname` ของหน้าปัจจุบัน (ส่ง `?from=` ให้ `/auth/logout` แล้ว route ใช้ `loginPathForPathname(from)`)

- [ ] **Step 10: `app/page.tsx`** ใช้ `roleHomePath(session.roles[0])` เหมือนเดิม (ชื่อฟังก์ชันไม่เปลี่ยน)

- [ ] **Step 11: ตรวจทั้งแอป**

Run: `cd /c/Users/charo/Documents/GitHub/GACP && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec biome check --write . && cd apps/web && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec tsc --noEmit && COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm exec vitest run && cd ../.. && corepack pnpm glossary`
Expected: ทั้งหมดผ่าน glossary ok (ไม่มี `SYSTEM_ADMIN`/`FINANCE_OFFICER` เหลือนอก migration)

- [ ] **Step 12: เดินในเบราว์เซอร์** เปิด dev server → `/auth/login` เห็น 3 ปุ่ม (ปิดเทาถ้าไม่ตั้งค่า) + dev login 9 บทบาท 3 กลุ่ม → เข้าเป็น `CERTIFICATION_BODY_ADMIN` → ไป `/certification-body/admin` ได้ · เข้า `/platform-operator/admin` → 403 · `/platform-operator/login` มีแค่ ThaID

- [ ] **Step 13: Commit**

```bash
git add -A apps/web/src
git commit -m "feat(web): เส้นทางตามฝั่ง (/certification-body, /platform-operator), หน้าล็อกอิน 3 ทาง, ป้าย 9 บทบาท

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 7: web — หน้าผู้ดูแลระบบ 2 ฝั่ง + audit

**Files:**
- Create: `apps/web/src/lib/audit.ts`, `apps/web/src/lib/account-admin.ts` (query + คำนวณเครดิตของ user), `apps/web/src/app/platform-operator/admin/actions.ts`, `apps/web/src/app/certification-body/admin/actions.ts`
- Replace: `apps/web/src/app/platform-operator/admin/page.tsx`, `apps/web/src/app/certification-body/admin/page.tsx`
- Modify: `apps/web/src/messages/th.ts` (ข้อความ `admin.*`)

**Interfaces:**
- Consumes: `canAssignRole`, `canRevokeRole`, `permittedRolesFor` (Task 3), models (Task 2), `requireUserWithRole`
- Produces:
  ```ts
  // lib/audit.ts
  export function recordAudit(input: { actorUserId: string; actorRole: UserRole; action: string; targetType: string; targetId: string; diff?: Record<string, unknown> }): Promise<void>;
  // lib/account-admin.ts
  export function accountCredentialsOf(userId: string): Promise<AccountCredentials>;
  export function listStaffUsers(side: RoleSide): Promise<StaffUserRow[]>;   // ผู้ใช้ที่มีเครดิตของฝั่ง + บทบาทที่ถืออยู่
  // actions (ฝั่งบริษัท)
  addPlatformOperatorMembership(formData)   // nationalId + displayName → HMAC ทันที
  revokePlatformOperatorMembership(formData) // membershipId
  assignRole(formData) / revokeRole(formData) // userId + role ใช้ canAssignRole/canRevokeRole
  // actions (ฝั่งกรม)
  addAuthorizedProviderAgency(formData) / revokeAuthorizedProviderAgency(formData)
  assignRole(formData) / revokeRole(formData)  // ชุดเดียวกัน แต่ actor ต่างฝั่ง
  ```

- [ ] **Step 1: `lib/audit.ts`**

```ts
import 'server-only';
import { ActorKind, type UserRole } from '@gacp/contracts';
import { database } from '@/lib/database.ts';

// ทุกการเพิ่ม/ถอดคน สังกัด และบทบาท ต้องมีแถวใน audit_logs (append-only)
export async function recordAudit(input: {
  readonly actorUserId: string;
  readonly actorRole: UserRole;
  readonly action: string;
  readonly targetType: string;
  readonly targetId: string;
  readonly diff?: Record<string, unknown> | undefined;
}): Promise<void> {
  await database.auditLog.create({
    data: {
      actorKind: ActorKind.USER,
      actorUserId: input.actorUserId,
      actorRole: input.actorRole,
      action: input.action,
      targetType: input.targetType,
      targetId: input.targetId,
      ...(input.diff ? { diff: input.diff } : {}),
    },
  });
}
```

- [ ] **Step 2: `lib/account-admin.ts`**

```ts
import 'server-only';
import { ROLES_BY_SIDE, RoleSide, type UserRole } from '@gacp/contracts';
import type { AccountCredentials } from '@gacp/domain';
import { database } from '@/lib/database.ts';

export async function accountCredentialsOf(userId: string): Promise<AccountCredentials> {
  const user = await database.user.findUnique({
    where: { id: userId },
    include: { providerCredential: true, platformOperatorMembership: true },
  });
  const credential = user?.providerCredential ?? null;
  const agencyAuthorized =
    credential?.agencyBusinessId && !credential.revokedAt
      ? (await database.authorizedProviderAgency.count({ where: { businessId: credential.agencyBusinessId, revokedAt: null } })) > 0
      : false;
  return {
    providerCredentialActive: credential !== null && credential.revokedAt === null,
    providerAgencyAuthorized: agencyAuthorized,
    platformOperatorMembershipActive: user?.platformOperatorMembership !== null && user?.platformOperatorMembership?.revokedAt === null,
  };
}

export type StaffUserRow = {
  readonly userId: string;
  readonly displayName: string;
  readonly detail: string; // ฝั่งกรม: provider id + สังกัด · ฝั่งบริษัท: สถานะรายชื่อ
  readonly roles: readonly UserRole[];
  readonly credentialActive: boolean;
};

// ผู้ใช้ที่มีเครดิตของฝั่งนั้น พร้อมบทบาทที่ถืออยู่ (สำหรับหน้ามอบบทบาท)
export async function listStaffUsers(side: RoleSide): Promise<StaffUserRow[]> {
  const sideRoles = ROLES_BY_SIDE[side];
  if (side === RoleSide.CERTIFICATION_BODY) {
    const credentials = await database.providerCredential.findMany({
      include: { user: { include: { staffRoleAssignments: { where: { revokedAt: null } } } } },
      orderBy: { verifiedAt: 'asc' },
    });
    return credentials.map((credential) => ({
      userId: credential.userId,
      displayName: credential.user.displayName,
      detail: `Provider ID ${credential.providerId} · ${credential.agencyNameTh ?? 'ไม่ทราบสังกัด'}`,
      roles: credential.user.staffRoleAssignments.map((entry) => entry.role).filter((role) => sideRoles.includes(role)),
      credentialActive: credential.revokedAt === null,
    }));
  }
  const memberships = await database.platformOperatorMembership.findMany({
    include: { user: { include: { staffRoleAssignments: { where: { revokedAt: null } } } } },
    orderBy: { addedAt: 'asc' },
  });
  return memberships.map((membership) => ({
    userId: membership.userId ?? membership.id,
    displayName: membership.displayName,
    detail: membership.userId ? 'เข้าสู่ระบบแล้ว' : 'ยังไม่เคยเข้าสู่ระบบ',
    roles: membership.user?.staffRoleAssignments.map((entry) => entry.role).filter((role) => sideRoles.includes(role)) ?? [],
    credentialActive: membership.revokedAt === null,
  }));
}
```

- [ ] **Step 3: actions ฝั่งบริษัท** `platform-operator/admin/actions.ts` (`'use server'`):

```ts
'use server';

import { isValidThaiNationalId, UserRole, userRoleSchema } from '@gacp/contracts';
import { canAssignRole, canRevokeRole } from '@gacp/domain';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { accountCredentialsOf } from '@/lib/account-admin.ts';
import { recordAudit } from '@/lib/audit.ts';
import { requireUserWithRole } from '@/lib/current-user.ts';
import { database } from '@/lib/database.ts';
import { hmacField } from '@/lib/protected-fields.ts';

const PAGE = '/platform-operator/admin';
const text = (formData: FormData, name: string) => String(formData.get(name) ?? '').trim();

export async function addPlatformOperatorMembership(formData: FormData): Promise<void> {
  const actor = await requireUserWithRole(UserRole.PLATFORM_OPERATOR_ADMIN, PAGE);
  const nationalId = text(formData, 'nationalId').replace(/[\s-]/g, '');
  const displayName = text(formData, 'displayName');
  if (!isValidThaiNationalId(nationalId) || displayName.length === 0) redirect(`${PAGE}?error=invalid`);
  const nationalIdHmac = hmacField(nationalId); // เลขบัตรไม่ถูกเก็บและไม่ลง log
  const membership = await database.platformOperatorMembership.upsert({
    where: { nationalIdHmac },
    create: { nationalIdHmac, displayName, addedById: actor.id },
    update: { displayName, revokedAt: null, revokedById: null, addedById: actor.id, addedAt: new Date() },
  });
  await recordAudit({ actorUserId: actor.id, actorRole: UserRole.PLATFORM_OPERATOR_ADMIN, action: 'PLATFORM_OPERATOR_MEMBERSHIP_ADDED', targetType: 'PlatformOperatorMembership', targetId: membership.id });
  revalidatePath(PAGE);
}

export async function revokePlatformOperatorMembership(formData: FormData): Promise<void> {
  const actor = await requireUserWithRole(UserRole.PLATFORM_OPERATOR_ADMIN, PAGE);
  const membershipId = z.uuid().parse(text(formData, 'membershipId'));
  const membership = await database.platformOperatorMembership.findUnique({ where: { id: membershipId } });
  if (!membership || membership.userId === actor.id) redirect(`${PAGE}?error=self`);
  await database.$transaction([
    database.platformOperatorMembership.update({ where: { id: membershipId }, data: { revokedAt: new Date(), revokedById: actor.id } }),
    ...(membership.userId
      ? [database.staffRoleAssignment.updateMany({ where: { userId: membership.userId, revokedAt: null, role: { in: [UserRole.PLATFORM_OPERATOR_ADMIN, UserRole.PLATFORM_OPERATOR_FINANCE_OFFICER] } }, data: { revokedAt: new Date(), revokedById: actor.id } })]
      : []),
  ]);
  await recordAudit({ actorUserId: actor.id, actorRole: UserRole.PLATFORM_OPERATOR_ADMIN, action: 'PLATFORM_OPERATOR_MEMBERSHIP_REVOKED', targetType: 'PlatformOperatorMembership', targetId: membershipId });
  revalidatePath(PAGE);
}

// ใช้ร่วมกันทั้งสองฝั่ง: actorRole บอกว่าใครกด ส่วนกติกาอยู่ใน domain
export async function assignRoleAs(actorRole: UserRole, page: string, formData: FormData): Promise<void> {
  const actor = await requireUserWithRole(actorRole, page);
  const userId = z.uuid().parse(text(formData, 'userId'));
  const role = userRoleSchema.parse(text(formData, 'role'));
  const decision = canAssignRole(actor.roles, role, await accountCredentialsOf(userId));
  if (!decision.ok) redirect(`${page}?error=${decision.code}`);
  const existing = await database.staffRoleAssignment.findFirst({ where: { userId, role, revokedAt: null } });
  if (!existing) {
    const created = await database.staffRoleAssignment.create({ data: { userId, role, assignedById: actor.id } });
    await recordAudit({ actorUserId: actor.id, actorRole, action: 'ROLE_ASSIGNED', targetType: 'StaffRoleAssignment', targetId: created.id, diff: { userId, role } });
  }
  revalidatePath(page);
}

export async function revokeRoleAs(actorRole: UserRole, page: string, formData: FormData): Promise<void> {
  const actor = await requireUserWithRole(actorRole, page);
  const userId = z.uuid().parse(text(formData, 'userId'));
  const role = userRoleSchema.parse(text(formData, 'role'));
  const holders = await database.staffRoleAssignment.count({ where: { role, revokedAt: null } });
  const decision = canRevokeRole(actor.roles, role, holders);
  if (!decision.ok) redirect(`${page}?error=${decision.code}`);
  const revoked = await database.staffRoleAssignment.updateMany({ where: { userId, role, revokedAt: null }, data: { revokedAt: new Date(), revokedById: actor.id } });
  if (revoked.count > 0) {
    await recordAudit({ actorUserId: actor.id, actorRole, action: 'ROLE_REVOKED', targetType: 'StaffRoleAssignment', targetId: userId, diff: { role } });
  }
  revalidatePath(page);
}

export async function assignRole(formData: FormData): Promise<void> {
  await assignRoleAs(UserRole.PLATFORM_OPERATOR_ADMIN, PAGE, formData);
}
export async function revokeRole(formData: FormData): Promise<void> {
  await revokeRoleAs(UserRole.PLATFORM_OPERATOR_ADMIN, PAGE, formData);
}
```

(ย้าย `assignRoleAs`/`revokeRoleAs` ไปไว้ใน `lib/account-admin.ts` เพื่อให้ฝั่งกรม import ได้ ไม่ export จากไฟล์ `'use server'` โดยตรง)

- [ ] **Step 4: actions ฝั่งกรม** `certification-body/admin/actions.ts`: `addAuthorizedProviderAgency` (businessId, agencyCode, nameTh → upsert, audit `AUTHORIZED_PROVIDER_AGENCY_ADDED`), `revokeAuthorizedProviderAgency` (agencyId → revokedAt, audit), `assignRole`/`revokeRole` เรียก `assignRoleAs(UserRole.CERTIFICATION_BODY_ADMIN, '/certification-body/admin', formData)`

- [ ] **Step 5: หน้า `platform-operator/admin/page.tsx`** (ใน `RoleShell`): ตาราง 1 รายชื่อพนักงาน (ชื่อ, สถานะเข้าสู่ระบบ, บทบาทที่ถือ, ปุ่ม "ถอด") + ฟอร์มเพิ่ม (ชื่อ, เลขบัตร 13 หลัก inputMode numeric, hint ว่าเก็บเป็นรหัสไม่กลับคืน) · ตาราง 2 "มอบบทบาทฝั่งบริษัท": ต่อคนมี `<select name="role">` จาก `ROLES_BY_SIDE[PLATFORM_OPERATOR]` + ปุ่มมอบ และปุ่มถอดต่อบทบาทที่ถือ · การ์ด 3 "ตั้งผู้ดูแลระบบให้กรม": รายชื่อผู้ใช้ที่มี `ProviderCredential` (จาก `listStaffUsers(RoleSide.CERTIFICATION_BODY)`) + ปุ่ม "ตั้งเป็นผู้ดูแลระบบของกรม" (assignRole ด้วย role `CERTIFICATION_BODY_ADMIN`) · แสดง error จาก `?error=` ผ่าน `messages.admin.errors[code]`

- [ ] **Step 6: หน้า `certification-body/admin/page.tsx`**: ตาราง 1 สังกัดที่อนุญาต (`businessId`, `agencyCode`, `nameTh`, ปุ่มถอด) + ฟอร์มเพิ่ม · ตาราง 2 เจ้าหน้าที่ที่มี Provider ID (จาก `listStaffUsers(RoleSide.CERTIFICATION_BODY)`): ชื่อ, Provider ID + สังกัด, เครดิตใช้ได้/ถูกถอน, บทบาทที่ถือ, `<select>` จาก `ROLES_BY_SIDE[CERTIFICATION_BODY]` + ปุ่มมอบ/ถอด

- [ ] **Step 7: ข้อความ** เพิ่ม `messages.admin`: `membershipsTitle`, `addMembership`, `nationalIdLabel`, `nationalIdHint`, `agenciesTitle`, `addAgency`, `businessIdLabel`, `agencyCodeLabel`, `agencyNameLabel`, `rolesTitle`, `assign`, `revoke`, `setCertificationBodyAdmin`, `credentialActive`, `credentialRevoked`, `signedIn`, `neverSignedIn`, `errors: { invalid, self, ACTOR_NOT_ALLOWED, TARGET_CREDENTIAL_MISSING, LAST_ADMIN_OF_SIDE }`

- [ ] **Step 8: ทดสอบในเบราว์เซอร์ด้วย dev login**: เข้า `PLATFORM_OPERATOR_ADMIN` → เพิ่มพนักงาน (เลขบัตรทดสอบ `1101700230708`) → มอบ `PLATFORM_OPERATOR_FINANCE_OFFICER` ให้ตัวเอง → ตั้ง dev user ที่มี Provider ID เป็น `CERTIFICATION_BODY_ADMIN` → ถอดผู้ดูแลบริษัทคนสุดท้าย ต้องได้ error `LAST_ADMIN_OF_SIDE` · เข้า `CERTIFICATION_BODY_ADMIN` → เพิ่มสังกัด → มอบ `DOCUMENT_REVIEWER` ให้ dev user ฝั่งกรม · ตรวจ `audit_logs` มีแถวทุกการกระทำ (script node ใน scratchpad)

- [ ] **Step 9: typecheck + biome + commit**

```bash
git add apps/web/src
git commit -m "feat(web): หน้าผู้ดูแลระบบ 2 ฝั่ง: รายชื่อพนักงานบริษัท สังกัดที่อนุญาต และการมอบบทบาทตามกติกา domain พร้อม audit

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---
### Task 8: db — คำสั่ง bootstrap ผู้ดูแลระบบคนแรกของบริษัท

**Files:**
- Create: `packages/db/scripts/platform-operator-bootstrap.ts`
- Modify: `packages/db/package.json` (script `platform-operator:bootstrap`), `package.json` ราก (script `db:platform-operator:bootstrap`)

**Interfaces:**
- Consumes: `PlatformOperatorMembership` (Task 2), `isValidThaiNationalId` (contracts), `GACP_DATA_HMAC_KEY`
- Produces: แถว membership ที่ `bootstrapAdmin = true`; การมอบ `PLATFORM_OPERATOR_ADMIN` เกิดใน `completeSignIn` (Task 5) เมื่อคนนั้นล็อกอิน ThaID ครั้งแรก

- [ ] **Step 1: เขียนสคริปต์**

```ts
// เพิ่มผู้ดูแลระบบคนแรกของบริษัท: รับเลขบัตรจาก stdin (ไม่ผ่าน argument ไม่ลง log) เก็บเป็น HMAC เท่านั้น
// รัน: pnpm --filter @gacp/db platform-operator:bootstrap  แล้วพิมพ์ "ชื่อที่จะแสดง<TAB>เลขบัตร 13 หลัก" หนึ่งบรรทัด
import { createHmac } from 'node:crypto';
import { createInterface } from 'node:readline';
import { config as loadDotenv } from 'dotenv';

loadDotenv({ path: '../../.env.local', quiet: true });
loadDotenv({ path: '../../.env', quiet: true });

const { isValidThaiNationalId, readEnv } = await import('@gacp/contracts');
const { createDatabaseClient } = await import('../src/client.ts');

const env = readEnv();
const lines = createInterface({ input: process.stdin, terminal: false });
console.info('พิมพ์: ชื่อที่จะแสดง<TAB>เลขบัตรประชาชน 13 หลัก แล้วกด Enter');
const firstLine: string = await new Promise((resolve) => lines.once('line', resolve));
lines.close();

const [displayName, rawNationalId] = firstLine.split('\t').map((part) => part.trim());
const nationalId = (rawNationalId ?? '').replace(/[\s-]/g, '');
if (!displayName || !isValidThaiNationalId(nationalId)) {
  console.error('รูปแบบไม่ถูกต้อง ต้องเป็น ชื่อ<TAB>เลขบัตร 13 หลักที่ checksum ถูก');
  process.exit(1);
}
const nationalIdHmac = createHmac('sha256', Buffer.from(env.GACP_DATA_HMAC_KEY, 'hex')).update(nationalId, 'utf8').digest('hex');

const database = createDatabaseClient(env.GACP_DATABASE_DIRECT_URL);
try {
  const membership = await database.platformOperatorMembership.upsert({
    where: { nationalIdHmac },
    create: { nationalIdHmac, displayName, bootstrapAdmin: true },
    update: { displayName, bootstrapAdmin: true, revokedAt: null, revokedById: null },
  });
  console.info(`เพิ่ม ${membership.displayName} ในรายชื่อบริษัทแล้ว (id ${membership.id}) เมื่อล็อกอินด้วย ThaID ครั้งแรกจะได้บทบาทผู้ดูแลระบบของบริษัททันที`);
} finally {
  await database.$disconnect();
}
```

(HMAC ที่นี่ต้องให้ผลเท่ากับ `hmacField()` ของ web: ทั้งคู่ใช้ `createHmac('sha256', Buffer.from(GACP_DATA_HMAC_KEY, 'hex'))` บน utf8 → hex)

- [ ] **Step 2: scripts** ใน `packages/db/package.json` เพิ่ม `"platform-operator:bootstrap": "node scripts/platform-operator-bootstrap.ts"` และใน `package.json` ราก `"db:platform-operator:bootstrap": "pnpm --filter @gacp/db platform-operator:bootstrap"`

- [ ] **Step 3: ทดสอบกับฐาน dev** `printf 'ผู้ดูแล ทดสอบ\t1101700230708\n' | COREPACK_ENABLE_DOWNLOAD_PROMPT=0 corepack pnpm --filter @gacp/db platform-operator:bootstrap` → ข้อความสำเร็จ · รันซ้ำ → upsert ไม่สร้างแถวซ้ำ · ป้อนเลขผิด checksum → exit 1

- [ ] **Step 4: Commit**

```bash
git add packages/db/scripts/platform-operator-bootstrap.ts packages/db/package.json package.json
git commit -m "feat(db): คำสั่ง bootstrap ผู้ดูแลระบบคนแรกของบริษัท (เลขบัตรจาก stdin เก็บเป็น HMAC)

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 9: เอกสาร แผน และ memory

**Files:**
- Modify: `docs/adr/0001-principles.md` (ข้อ 5, 13), `docs/adr/0004-account-model.md` (สถานะ → ยอมรับ), `docs/superpowers/specs/2026-09-09-account-model-design.md` (§7, §8, §13: `AuthorizedProviderOrganization` → `AuthorizedProviderAgency`), `.env.example`, `C:\Users\charo\.claude\plans\fizzy-orbiting-kay.md` (§1.2 ข้อ 5, §2, §6.5, §10b, §11), memory `project_gacp_v2_rebuild.md`

- [ ] **Step 1: ADR 0001** ข้อ 5 → "Auth production: ผู้รับบริการ = Health ID (หมอพร้อม) หรือ ThaID · เจ้าหน้าที่กรม = Provider ID ต่อจาก Health ID · บริษัทผู้ให้บริการแพลตฟอร์ม = ThaID + รายชื่อพนักงาน · local login เฉพาะ development (ดู ADR 0004)" · ข้อ 13 เปลี่ยน `` `FINANCE_OFFICER` ดูแค่ยอด `` เป็น `` `PLATFORM_OPERATOR_FINANCE_OFFICER` ออกเอกสารเงิน `CERTIFICATION_BODY_FINANCE_OFFICER` ดูยอดและยืนยันงวดนำส่ง ``
- [ ] **Step 2: ADR 0004** สถานะ "ยอมรับ · อนุมัติ 2026-09-09" และ spec: แทนทุก `AuthorizedProviderOrganization` ด้วย `AuthorizedProviderAgency` และ `organizationBusinessId`/`organizationCode`/`organizationNameTh` ด้วย `agencyBusinessId`/`agencyCode`/`agencyNameTh` พร้อมหมายเหตุใน §7 ว่าเปลี่ยนเพราะ glossary ห้ามคำ organization
- [ ] **Step 3: `.env.example`** เพิ่ม 10 ตัวแปรของ §8 พร้อมค่า UAT/sandbox เป็นคอมเมนต์ (`# GACP_THAID_ISSUER_URL=https://imauthsbx.bora.dopa.go.th` ฯลฯ) และคำอธิบายว่าขอ client จากใคร
- [ ] **Step 4: แผน `fizzy-orbiting-kay.md`**: §1.2 ข้อ 5 ถ้อยคำเดียวกับ ADR 0001 · §2 "นอก" ตัด "นำส่งกรม" ออกจาก "ไม่ทำเลย" และเพิ่มใน M4 "บันทึกงวดนำส่ง + ยืนยันรับ" · §6.5 แทนตาราง 7 บทบาทด้วย 9 บทบาท 3 ฝั่ง (คัดจาก spec §4) และ route ใหม่ · §10b เพิ่ม "M2b บัญชี 3 ฝั่ง เสร็จ <วันที่> (commit …)" · §11 เพิ่มข้อ 13 "กรมรับรองพนักงานบริษัทเป็น Provider ID หรือไม่ (ถ้าจำเป็น)" และข้อ 14 "PKCE ของ DOPA / field profile Health ID"
- [ ] **Step 5: memory** อัปเดต `project_gacp_v2_rebuild.md`: บทบาท 9 แบบ, ล็อกอิน 3 ทาง, ชื่อไฟล์หลัก (`lib/identity/*`, `account-access.ts`), คำสั่ง bootstrap, สิ่งที่ต้องขอจาก MOPH/DOPA, สถานะ client (ยังไม่มี = ใช้ dev login) และ `MEMORY.md` hook
- [ ] **Step 6: Commit**

```bash
git add docs .env.example
git commit -m "docs: ADR 0001/0004, spec แก้ชื่อ AuthorizedProviderAgency, .env.example ของ ThaID/Health ID/Provider ID

Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>"
```

---

### Task 10: ตรวจรวม merge และ migrate demo

- [ ] **Step 1: ตรวจทั้ง repo** `corepack pnpm check && corepack pnpm test && corepack pnpm test:integration` (ฐาน dev รันอยู่) → เขียวทั้งหมด
- [ ] **Step 2: เดินในเบราว์เซอร์ครบ 3 ทางเข้า 9 บทบาท** ด้วย dev login: (1) `/auth/login` → ผู้ขอรับรอง → `/applicant` ใช้งานฟอร์ม M2 ได้เหมือนเดิม (2) เจ้าหน้าที่กรม 6 บทบาท เข้าหน้าของตนได้ และเข้า `/platform-operator/*` ได้ 403 (3) `/platform-operator/login` → บริษัท 2 บทบาท เข้าหน้าของตนได้ และเข้า `/certification-body/*` ได้ 403 (4) ผู้ใช้ที่ไม่มี session เปิด `/platform-operator/admin` → redirect `/platform-operator/login` (5) หน้า `/auth/outcome?code=NOT_PROVIDER` แสดงข้อความ
- [ ] **Step 3: merge** `git checkout main && git merge --no-ff feat/account-model -m "merge: บัญชี 3 ฝั่ง Health ID · Provider ID · ThaID (feat/account-model)"` แล้ว `git branch -d feat/account-model` และ `git push origin main`
- [ ] **Step 4: migrate Supabase demo** ใน `packages/db`: อ่าน URL demo จาก `.env.local` แบบ mask (วิธีเดียวกับ M2) → `GACP_DATABASE_URL=… GACP_DATABASE_DIRECT_URL=… corepack pnpm exec prisma migrate deploy` → ต้องเห็น `account_model` applied
- [ ] **Step 5: ตอบ operator** สรุปเป็นตาราง: อะไรใช้ได้แล้ว (dev login 9 บทบาท 3 ทางเข้า, กติกาบัญชี → บทบาท, หน้าผู้ดูแล 2 ฝั่ง, bootstrap) · อะไรรอหน่วยงาน (client MOPH/DOPA) · ข้อเปิด §11

---

## Self-review (ทำแล้ว 2026-09-09)

**Spec coverage**
| spec | task |
|---|---|
| §3 โมเดล User หนึ่งคน เชื่อมด้วย HMAC เลขบัตร | 2 (`users.national_id_hmac`), 5 (`upsertUser`) |
| §4 บทบาท 9 แบบ + กติกาเครดิต → บทบาท + ใครมอบได้ + ห้ามถอดผู้ดูแลคนสุดท้าย | 1, 3, 7 |
| §5 ทางเข้าและเส้นทางตามฝั่ง, proxy, สีฝั่ง | 6 |
| §6 flow A (Health ID + Provider ID), B (ThaID), C (ial) | 4, 5 |
| §7 โมเดลข้อมูล + migration ไม่ทิ้งข้อมูล | 2 |
| §8 contracts/domain/env/adapter + fake | 1, 3, 4 |
| §9 bootstrap + หน้าผู้ดูแลขั้นต่ำ + เลิกชื่อเดิม | 7, 8, 1 (glossary) |
| §10 สิ่งที่หน่วยงานต้องจัดหา | 9 (.env.example, แผน) |
| §11 ข้อเปิด | 9 (แผน §11) |
| §12 การทดสอบ | ทุก task มี test; browser walkthrough ใน 6, 7, 10 |

**Placeholder scan**: ไม่มี TBD/TODO · ทุก step มีโค้ดหรือคำสั่งจริง · หน้าผู้ดูแลระบบ (Task 7 step 5-6) ระบุองค์ประกอบครบแต่ให้ผู้ทำเขียน JSX ตามแบบ primitives ของ M2 (`Card`, `TextInput`, `Tag`) เพราะไม่มี logic ใหม่นอก actions

**Type consistency**: `AccountCredentials` (Task 3) ใช้ตรงกันใน `sign-in.ts` และ `account-admin.ts` · `SignInOutcome` ใน `sign-in.ts` ตรงกับ key ของ `messages.signInOutcome` และ `outcomePath()` · `homePathForIntent`/`outcomePath`/`loginPathForPathname` ประกาศใน Task 6 ถูกใช้ใน Task 5 (Task 5 จึงต้องรันหลัง Task 6 หรือสร้าง `roles.ts` ก่อน: **ลำดับทำจริง 1 → 2 → 3 → 4 → 6 → 5 → 7 → 8 → 9 → 10**) · `hmacField` ของ web และ HMAC ใน bootstrap ใช้กุญแจและ encoding เดียวกัน
