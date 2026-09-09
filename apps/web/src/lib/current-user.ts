import 'server-only';
import type { UserRole } from '@gacp/contracts';
import { redirect } from 'next/navigation';
import { currentSession } from './current-session.ts';
import { database } from './database.ts';
import { loginPathForPathname } from './roles.ts';
import type { SessionPayload } from './session.ts';

export type CurrentUser = {
  readonly id: string;
  readonly displayName: string;
  readonly roles: readonly UserRole[];
  readonly session: SessionPayload;
};

// แปลง session เป็นแถว users ทุกหน้าที่แตะข้อมูลของผู้ใช้เรียกผ่านฟังก์ชันนี้
// session.sub คือ HMAC ของ subject อยู่แล้ว (ค่าเดียวกับ user_identities.subject_hmac) จึงค้นได้ตรง ๆ
// การล็อกอินจริงสร้างแถวไว้ก่อนใน completeSignIn ส่วน dev login สร้างใน devLogin; ที่นี่สร้างเฉพาะกรณีตกหล่น
export async function currentUser(): Promise<CurrentUser | undefined> {
  const session = await currentSession();
  if (!session) return undefined;
  const provider = session.identityProvider;
  const subjectHmac = session.sub;
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

// ใช้ในหน้าและ Server Action ของบทบาทนั้น: ไม่มี session → ไปหน้าเข้าสู่ระบบของฝั่งนั้น, บทบาทไม่ตรง → /forbidden
export async function requireUserWithRole(role: UserRole, nextPath: string): Promise<CurrentUser> {
  const user = await currentUser();
  if (!user) redirect(`${loginPathForPathname(nextPath)}?next=${encodeURIComponent(nextPath)}`);
  if (!user.roles.includes(role)) redirect('/forbidden');
  return user;
}
