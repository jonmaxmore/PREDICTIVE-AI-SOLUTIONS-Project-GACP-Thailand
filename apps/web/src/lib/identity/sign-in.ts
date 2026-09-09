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
import { effectiveRoles } from '@gacp/domain';
import { database } from '@/lib/database.ts';
import { accountCredentialsOf } from '@/lib/identity/account-credentials.ts';
import { hmacField } from '@/lib/protected-fields.ts';
import { sideOfIntent } from '@/lib/roles.ts';
import { SESSION_TTL_SECONDS, sealSession } from '@/lib/session.ts';

// จุดเดียวที่เปลี่ยน "พิสูจน์ตัวตนสำเร็จ" เป็น User + เครดิตของฝั่ง + บทบาทมีผล + session (spec 2026-09-09 §6)
// เลขบัตรและ subject ของผู้ให้บริการยืนยันตัวตนถูกเก็บเป็น HMAC เท่านั้น และไม่ถูก log

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

// หา/สร้าง User จากตัวตน: 1) identity เดิม 2) เลขบัตรเดียวกัน (คนเดียวกันมาคนละทาง) 3) สร้างใหม่
async function upsertUser(input: SignInInput): Promise<string> {
  const subjectHmac = hmacField(input.subject);
  const nationalIdHmac = input.nationalId ? hmacField(input.nationalId) : null;
  const now = new Date();
  return database.$transaction(async (transaction) => {
    const identity = await transaction.userIdentity.findUnique({
      // biome-ignore lint/style/useNamingConvention: ชื่อ compound unique key ที่ Prisma สร้างจาก @@unique([provider, subjectHmac])
      where: { provider_subjectHmac: { provider: input.provider, subjectHmac } },
    });
    let userId = identity?.userId;
    if (!userId && nationalIdHmac) {
      userId = (await transaction.user.findUnique({ where: { nationalIdHmac } }))?.id;
    }
    if (userId) {
      await transaction.user.update({
        where: { id: userId },
        data: { displayName: input.displayName, ...(nationalIdHmac ? { nationalIdHmac } : {}) },
      });
    } else {
      userId = (
        await transaction.user.create({ data: { displayName: input.displayName, nationalIdHmac } })
      ).id;
    }
    if (identity) {
      await transaction.userIdentity.update({
        where: { id: identity.id },
        data: {
          lastLoginAt: now,
          verifiedAt: now,
          identityAssuranceLevel: input.identityAssuranceLevel,
        },
      });
    } else {
      await transaction.userIdentity.create({
        data: {
          userId,
          provider: input.provider,
          subjectHmac,
          lastLoginAt: now,
          verifiedAt: now,
          identityAssuranceLevel: input.identityAssuranceLevel,
        },
      });
    }
    return userId;
  });
}

// บันทึกผลตรวจ Provider ID ครั้งนี้: มี profile = upsert เครดิต (เลือกสังกัดที่กรมอนุญาตก่อน)
// ไม่มี profile = ทำเครื่องหมายว่าถูกถอน (ถ้าเคยมี) คืนค่าว่าสังกัดที่เลือกได้รับอนุญาตหรือไม่
async function recordProviderLookup(
  userId: string,
  profile: MorphromProviderProfile | null,
): Promise<boolean> {
  if (!profile) {
    await database.providerCredential.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return false;
  }
  const authorized = await database.authorizedProviderAgency.findMany({
    where: {
      businessId: { in: profile.affiliations.map((entry) => entry.businessId) },
      revokedAt: null,
    },
    select: { businessId: true },
  });
  const authorizedIds = new Set(authorized.map((entry) => entry.businessId));
  const chosen =
    profile.affiliations.find((entry) => authorizedIds.has(entry.businessId)) ??
    profile.affiliations[0] ??
    null;
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
  await database.providerCredential.upsert({
    where: { userId },
    create: { userId, ...row },
    update: row,
  });
  return chosen !== null && authorizedIds.has(chosen.businessId);
}

// ผูก membership ของบริษัทกับ user ครั้งแรกที่พบ และมอบ PLATFORM_OPERATOR_ADMIN ให้คนที่ตั้งจากคำสั่ง bootstrap
async function linkPlatformOperatorMembership(
  userId: string,
  nationalIdHmac: string,
): Promise<void> {
  const membership = await database.platformOperatorMembership.findUnique({
    where: { nationalIdHmac },
  });
  if (!membership || membership.revokedAt) return;
  if (membership.userId !== userId) {
    await database.platformOperatorMembership.update({
      where: { id: membership.id },
      data: { userId },
    });
  }
  if (membership.bootstrapAdmin) {
    const existing = await database.staffRoleAssignment.findFirst({
      where: { userId, role: UserRole.PLATFORM_OPERATOR_ADMIN, revokedAt: null },
    });
    if (!existing) {
      await database.staffRoleAssignment.create({
        data: { userId, role: UserRole.PLATFORM_OPERATOR_ADMIN },
      });
    }
  }
}

function rejected(outcome: SignInOutcome, userId: string, roles: UserRole[] = []): SignInResult {
  return { outcome, sessionToken: null, roles, userId };
}

export async function completeSignIn(input: SignInInput): Promise<SignInResult> {
  const userId = await upsertUser(input);
  const nationalIdHmac = input.nationalId ? hmacField(input.nationalId) : null;

  if (input.intent === LoginIntent.CERTIFICATION_BODY_STAFF) {
    const authorized = await recordProviderLookup(userId, input.providerProfile);
    if (!input.providerProfile) return rejected(SignInOutcome.NOT_PROVIDER, userId);
    if (!authorized) return rejected(SignInOutcome.AGENCY_NOT_AUTHORIZED, userId);
  }
  if (input.intent === LoginIntent.PLATFORM_OPERATOR_STAFF) {
    if (!nationalIdHmac) return rejected(SignInOutcome.NOT_MEMBER, userId);
    await linkPlatformOperatorMembership(userId, nationalIdHmac);
  }

  const assignments = await database.staffRoleAssignment.findMany({
    where: { userId, revokedAt: null },
    select: { role: true },
  });
  const credentials = await accountCredentialsOf(userId, nationalIdHmac);
  const roles = effectiveRoles(
    assignments.map((entry) => entry.role),
    credentials,
  );

  if (
    input.intent === LoginIntent.PLATFORM_OPERATOR_STAFF &&
    !credentials.platformOperatorMembershipActive
  ) {
    return rejected(SignInOutcome.NOT_MEMBER, userId, roles);
  }
  const wantedSide = sideOfIntent(input.intent);
  if (wantedSide !== RoleSide.APPLICANT && !roles.some((role) => roleSideOf(role) === wantedSide)) {
    return rejected(SignInOutcome.NO_ROLE_YET, userId, roles);
  }

  await database.session.create({
    data: { userId, expiresAt: new Date(Date.now() + SESSION_TTL_SECONDS * 1000) },
  });
  // sub ใน session = HMAC ของ subject (ค่าเดียวกับ user_identities.subject_hmac) ไม่มี subject ดิบออกจาก server
  const sessionToken = await sealSession({
    sub: hmacField(input.subject),
    displayName: input.displayName,
    roles,
    identityProvider: input.provider,
  });
  return { outcome: SignInOutcome.SIGNED_IN, sessionToken, roles, userId };
}
