import { IdentityProvider, LoginIntent, UserRole } from '@gacp/contracts';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { database } from '@/lib/database.ts';
import { hmacField } from '@/lib/protected-fields.ts';
import { completeSignIn, SignInOutcome } from './sign-in.ts';

// ต่อฐานข้อมูล dev จริง (embedded PostgreSQL) แถวที่สร้างถูกลบท้าย test ทั้งหมด
const runId = `${Date.now()}-${process.pid}`;
const agencyBusinessId = `TEST-AGENCY-${runId}`;
const testNationalId = '1101700230708';
const createdUserIds: string[] = [];

const testAffiliation = {
  businessId: agencyBusinessId,
  agencyCode: '00001',
  agencyNameTh: 'หน่วยทดสอบ',
  position: null,
  positionType: null,
  licenseId: null,
};

const profile = {
  accountId: `acc-${runId}`,
  hashCid: null,
  providerId: '0111111111X21',
  nameTh: 'ทดสอบ เจ้าหน้าที่',
  affiliations: [testAffiliation],
};

beforeAll(async () => {
  await database.authorizedProviderAgency.create({
    data: { businessId: agencyBusinessId, agencyCode: '00001', nameTh: 'หน่วยทดสอบ' },
  });
});

afterAll(async () => {
  await database.platformOperatorMembership.deleteMany({
    where: { nationalIdHmac: hmacField(testNationalId) },
  });
  await database.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await database.authorizedProviderAgency.deleteMany({ where: { businessId: agencyBusinessId } });
  await database.$disconnect();
});

describe('completeSignIn', () => {
  it('ผู้ขอรับรองผ่าน Health ID ได้ APPLICANT อย่างเดียว', async () => {
    const result = await completeSignIn({
      provider: IdentityProvider.MORPHROM_HEALTH_ID,
      subject: `health-${runId}`,
      nationalId: null,
      hashCid: null,
      displayName: 'ผู้ขอทดสอบ',
      identityAssuranceLevel: null,
      intent: LoginIntent.APPLICANT,
      providerProfile: null,
    });
    createdUserIds.push(result.userId);
    expect(result.outcome).toBe(SignInOutcome.SIGNED_IN);
    expect(result.roles).toEqual([UserRole.APPLICANT]);
    expect(result.sessionToken).not.toBeNull();
  });

  it('เข้าซ้ำด้วยตัวตนเดิมได้ user เดิม ไม่สร้างซ้ำ', async () => {
    const input = {
      provider: IdentityProvider.MORPHROM_HEALTH_ID,
      subject: `health-again-${runId}`,
      nationalId: null,
      hashCid: null,
      displayName: 'ผู้ขอทดสอบ',
      identityAssuranceLevel: null,
      intent: LoginIntent.APPLICANT,
      providerProfile: null,
    } as const;
    const first = await completeSignIn(input);
    createdUserIds.push(first.userId);
    const second = await completeSignIn({ ...input, displayName: 'ผู้ขอทดสอบ (เปลี่ยนชื่อ)' });
    expect(second.userId).toBe(first.userId);
    const user = await database.user.findUnique({ where: { id: first.userId } });
    expect(user?.displayName).toBe('ผู้ขอทดสอบ (เปลี่ยนชื่อ)');
  });

  it('เจ้าหน้าที่กรมที่ไม่มี Provider ID ถูกปฏิเสธฝั่งกรมแต่ยังมี user', async () => {
    const result = await completeSignIn({
      provider: IdentityProvider.MORPHROM_HEALTH_ID,
      subject: `health-np-${runId}`,
      nationalId: null,
      hashCid: null,
      displayName: 'ไม่มี Provider',
      identityAssuranceLevel: null,
      intent: LoginIntent.CERTIFICATION_BODY_STAFF,
      providerProfile: null,
    });
    createdUserIds.push(result.userId);
    expect(result.outcome).toBe(SignInOutcome.NOT_PROVIDER);
    expect(result.sessionToken).toBeNull();
    expect(await database.user.findUnique({ where: { id: result.userId } })).not.toBeNull();
  });

  it('เจ้าหน้าที่กรมที่มี Provider ID สังกัดอนุญาต แต่ยังไม่มีบทบาท → NO_ROLE_YET และมี ProviderCredential', async () => {
    const subject = `health-p-${runId}`;
    const result = await completeSignIn({
      provider: IdentityProvider.MORPHROM_HEALTH_ID,
      subject,
      nationalId: null,
      hashCid: null,
      displayName: 'ทดสอบ เจ้าหน้าที่',
      identityAssuranceLevel: null,
      intent: LoginIntent.CERTIFICATION_BODY_STAFF,
      providerProfile: profile,
    });
    createdUserIds.push(result.userId);
    expect(result.outcome).toBe(SignInOutcome.NO_ROLE_YET);
    const credential = await database.providerCredential.findUnique({
      where: { userId: result.userId },
    });
    expect(credential?.providerId).toBe('0111111111X21');
    expect(credential?.agencyBusinessId).toBe(agencyBusinessId);

    // มอบบทบาทแล้วเข้าใหม่ → เข้าได้ และ APPLICANT ติดมาด้วยเสมอ
    await database.staffRoleAssignment.create({
      data: { userId: result.userId, role: UserRole.DOCUMENT_REVIEWER },
    });
    const again = await completeSignIn({
      provider: IdentityProvider.MORPHROM_HEALTH_ID,
      subject,
      nationalId: null,
      hashCid: null,
      displayName: 'ทดสอบ เจ้าหน้าที่',
      identityAssuranceLevel: null,
      intent: LoginIntent.CERTIFICATION_BODY_STAFF,
      providerProfile: profile,
    });
    expect(again.outcome).toBe(SignInOutcome.SIGNED_IN);
    expect(again.roles).toEqual([UserRole.APPLICANT, UserRole.DOCUMENT_REVIEWER]);
  });

  it('สังกัดที่กรมไม่อนุญาต → AGENCY_NOT_AUTHORIZED', async () => {
    const result = await completeSignIn({
      provider: IdentityProvider.MORPHROM_HEALTH_ID,
      subject: `health-other-agency-${runId}`,
      nationalId: null,
      hashCid: null,
      displayName: 'สังกัดอื่น',
      identityAssuranceLevel: null,
      intent: LoginIntent.CERTIFICATION_BODY_STAFF,
      providerProfile: {
        ...profile,
        affiliations: [{ ...testAffiliation, businessId: `OTHER-${runId}` }],
      },
    });
    createdUserIds.push(result.userId);
    expect(result.outcome).toBe(SignInOutcome.AGENCY_NOT_AUTHORIZED);
  });

  it('พนักงานบริษัทที่ไม่อยู่ในรายชื่อ → NOT_MEMBER; อยู่ในรายชื่อ + bootstrapAdmin → ได้ PLATFORM_OPERATOR_ADMIN', async () => {
    const rejected = await completeSignIn({
      provider: IdentityProvider.THAID,
      subject: `thaid-${runId}`,
      nationalId: testNationalId,
      hashCid: null,
      displayName: 'พนักงาน ทดสอบ',
      identityAssuranceLevel: '2.3',
      intent: LoginIntent.PLATFORM_OPERATOR_STAFF,
      providerProfile: null,
    });
    createdUserIds.push(rejected.userId);
    expect(rejected.outcome).toBe(SignInOutcome.NOT_MEMBER);

    await database.platformOperatorMembership.upsert({
      where: { nationalIdHmac: hmacField(testNationalId) },
      create: {
        nationalIdHmac: hmacField(testNationalId),
        displayName: 'พนักงาน ทดสอบ',
        bootstrapAdmin: true,
      },
      update: { revokedAt: null, bootstrapAdmin: true },
    });
    // เข้าด้วย ThaID อีกอุปกรณ์ (subject ใหม่) แต่เลขบัตรเดิม → คนเดียวกัน
    const accepted = await completeSignIn({
      provider: IdentityProvider.THAID,
      subject: `thaid-second-${runId}`,
      nationalId: testNationalId,
      hashCid: null,
      displayName: 'พนักงาน ทดสอบ',
      identityAssuranceLevel: '2.3',
      intent: LoginIntent.PLATFORM_OPERATOR_STAFF,
      providerProfile: null,
    });
    expect(accepted.userId).toBe(rejected.userId);
    expect(accepted.outcome).toBe(SignInOutcome.SIGNED_IN);
    expect(accepted.roles).toContain(UserRole.PLATFORM_OPERATOR_ADMIN);
    const membership = await database.platformOperatorMembership.findUnique({
      where: { nationalIdHmac: hmacField(testNationalId) },
    });
    expect(membership?.userId).toBe(accepted.userId);
  });
});
