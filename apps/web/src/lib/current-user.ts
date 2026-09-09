import 'server-only';
import { IdentityProvider, type UserRole } from '@gacp/contracts';
import { redirect } from 'next/navigation';
import { currentSession } from './current-session.ts';
import { database } from './database.ts';
import { hmacField } from './protected-fields.ts';
import type { SessionPayload } from './session.ts';

export type CurrentUser = {
  readonly id: string;
  readonly displayName: string;
  readonly roles: readonly UserRole[];
  readonly session: SessionPayload;
};

// subject ใน session มีรูป "<provider>:<id>" เก็บลงฐานข้อมูลเป็น HMAC เท่านั้น
function providerOf(subject: string): IdentityProvider {
  if (subject.startsWith('thaid:')) return IdentityProvider.THAID;
  if (subject.startsWith('morphrom:')) return IdentityProvider.MORPHROM;
  return IdentityProvider.DEV_LOCAL;
}

// แปลง session เป็นแถว users (สร้างครั้งแรกที่พบ) ทุกหน้าที่แตะข้อมูลของผู้ใช้เรียกผ่านฟังก์ชันนี้
export async function currentUser(): Promise<CurrentUser | undefined> {
  const session = await currentSession();
  if (!session) return undefined;
  const provider = providerOf(session.sub);
  const subjectHmac = hmacField(session.sub);
  const identity = await database.userIdentity.findUnique({
    // biome-ignore lint/style/useNamingConvention: ชื่อ compound unique key ที่ Prisma สร้างจาก @@unique([provider, subjectHmac])
    where: { provider_subjectHmac: { provider, subjectHmac } },
    include: { user: true },
  });
  if (identity) {
    if (identity.user.displayName !== session.displayName) {
      await database.user.update({
        where: { id: identity.userId },
        data: { displayName: session.displayName },
      });
    }
    await database.userIdentity.update({
      where: { id: identity.id },
      data: { lastLoginAt: new Date() },
    });
    return { id: identity.userId, displayName: session.displayName, roles: session.roles, session };
  }
  const user = await database.user.create({
    data: {
      displayName: session.displayName,
      identities: { create: { provider, subjectHmac, lastLoginAt: new Date() } },
    },
  });
  return { id: user.id, displayName: session.displayName, roles: session.roles, session };
}

// ใช้ในหน้าและ Server Action ของบทบาทนั้น: ไม่มี session → ไปหน้า login, บทบาทไม่ตรง → /forbidden
export async function requireUserWithRole(role: UserRole, nextPath: string): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) redirect(`/auth/login?next=${encodeURIComponent(nextPath)}`);
  if (!user.roles.includes(role)) redirect('/forbidden');
  return user;
}
