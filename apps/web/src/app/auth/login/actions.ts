'use server';

import {
  IdentityProvider,
  RoleSide,
  readEnv,
  roleSideOf,
  UserRole,
  userRoleSchema,
} from '@gacp/contracts';
import { cookies } from 'next/headers';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { database } from '@/lib/database.ts';
import { hmacField } from '@/lib/protected-fields.ts';
import { roleHomePath } from '@/lib/roles.ts';
import { SESSION_COOKIE_NAME, sealSession, sessionCookieOptions } from '@/lib/session.ts';

const devLoginSchema = z.object({
  displayName: z.string().trim().min(1).max(120),
  role: userRoleSchema,
  next: z.string().optional(),
});

// สังกัดปลอมสำหรับเครื่องพัฒนา ให้กติกา "เครดิตของฝั่ง → บทบาท" ทำงานเหมือนจริง
const DEV_AGENCY_BUSINESS_ID = 'DEV-AGENCY';
const DEV_AGENCY_NAME_TH = 'หน่วยงานทดสอบ (dev)';

// dev: หา/สร้าง User ของบทบาทนั้น พร้อมเครดิตของฝั่งที่บทบาทต้องมี และมอบบทบาทให้
// ทำให้หน้าผู้ดูแลระบบและกติกา domain ทดสอบได้จริงโดยไม่ต้องมี ThaID / Health ID
async function ensureDevUser(role: UserRole, displayName: string, subjectHmac: string) {
  const identity = await database.userIdentity.findUnique({
    // biome-ignore lint/style/useNamingConvention: ชื่อ compound unique key ที่ Prisma สร้างจาก @@unique([provider, subjectHmac])
    where: { provider_subjectHmac: { provider: IdentityProvider.DEV_LOCAL, subjectHmac } },
    include: { user: true },
  });
  const user =
    identity?.user ??
    (await database.user.create({
      data: {
        displayName,
        identities: {
          create: { provider: IdentityProvider.DEV_LOCAL, subjectHmac, lastLoginAt: new Date() },
        },
      },
    }));
  if (identity) {
    await database.user.update({ where: { id: user.id }, data: { displayName } });
  }

  const side = roleSideOf(role);
  if (side === RoleSide.CERTIFICATION_BODY) {
    await database.authorizedProviderAgency.upsert({
      where: { businessId: DEV_AGENCY_BUSINESS_ID },
      create: {
        businessId: DEV_AGENCY_BUSINESS_ID,
        agencyCode: '00000',
        nameTh: DEV_AGENCY_NAME_TH,
      },
      update: { revokedAt: null },
    });
    await database.providerCredential.upsert({
      where: { userId: user.id },
      create: {
        userId: user.id,
        providerId: `DEV-${role}`,
        agencyBusinessId: DEV_AGENCY_BUSINESS_ID,
        agencyCode: '00000',
        agencyNameTh: DEV_AGENCY_NAME_TH,
        profileHash: 'dev',
      },
      update: { revokedAt: null, lastVerifiedAt: new Date() },
    });
  }
  if (side === RoleSide.PLATFORM_OPERATOR) {
    const nationalIdHmac = hmacField(`dev-national-id:${role}`);
    await database.user.update({ where: { id: user.id }, data: { nationalIdHmac } });
    await database.platformOperatorMembership.upsert({
      where: { nationalIdHmac },
      create: { nationalIdHmac, displayName, userId: user.id },
      update: { revokedAt: null, userId: user.id },
    });
  }
  if (role !== UserRole.APPLICANT) {
    const assigned = await database.staffRoleAssignment.findFirst({
      where: { userId: user.id, role, revokedAt: null },
    });
    if (!assigned) await database.staffRoleAssignment.create({ data: { userId: user.id, role } });
  }
  return user;
}

// เข้าสู่ระบบแบบทดสอบ: สร้าง session ให้บทบาทที่เลือก ใช้ได้เฉพาะเมื่อ GACP_AUTH_DEV_LOGIN_ENABLED และไม่ใช่ production
export async function devLogin(formData: FormData): Promise<void> {
  if (!readEnv().GACP_AUTH_DEV_LOGIN_ENABLED) redirect('/auth/login');

  const parsed = devLoginSchema.safeParse({
    displayName: formData.get('displayName'),
    role: formData.get('role'),
    next: formData.get('next') || undefined,
  });
  if (!parsed.success) {
    const field = parsed.error.issues[0]?.path[0];
    redirect(`/auth/login?error=${field === 'role' ? 'role' : 'displayName'}`);
  }

  const { displayName, role, next } = parsed.data;
  // subject ของ dev = ชื่อบทบาท (หนึ่งบทบาท = หนึ่งบัญชีทดสอบ) เก็บและใช้เป็น HMAC เหมือนทางอื่น
  const subjectHmac = hmacField(`dev-local:${role.toLowerCase()}`);
  await ensureDevUser(role, displayName, subjectHmac);

  const token = await sealSession({
    sub: subjectHmac,
    displayName,
    roles: [role],
    identityProvider: IdentityProvider.DEV_LOCAL,
  });
  const cookieStore = await cookies();
  cookieStore.set(SESSION_COOKIE_NAME, token, sessionCookieOptions);

  const safeNext = next?.startsWith('/') && !next.startsWith('//') ? next : roleHomePath(role);
  redirect(safeNext);
}
