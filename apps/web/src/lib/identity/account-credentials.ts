import 'server-only';
import type { AccountCredentials } from '@gacp/domain';
import { database } from '@/lib/database.ts';

// เครดิตของฝั่งที่ผู้ใช้ถืออยู่ตอนนี้ (อ่านจากฐานข้อมูล ไม่ใช่จาก session)
// ใช้ทั้งตอนล็อกอิน (completeSignIn) และตอนผู้ดูแลระบบจะมอบบทบาท (canAssignRole)
export async function accountCredentialsOf(
  userId: string,
  nationalIdHmac: string | null,
): Promise<AccountCredentials> {
  const [credential, membership] = await Promise.all([
    database.providerCredential.findUnique({ where: { userId } }),
    nationalIdHmac
      ? database.platformOperatorMembership.findUnique({ where: { nationalIdHmac } })
      : null,
  ]);
  let providerAgencyAuthorized = false;
  if (credential?.agencyBusinessId && !credential.revokedAt) {
    providerAgencyAuthorized =
      (await database.authorizedProviderAgency.count({
        where: { businessId: credential.agencyBusinessId, revokedAt: null },
      })) > 0;
  }
  return {
    providerCredentialActive: credential !== null && credential.revokedAt === null,
    providerAgencyAuthorized,
    platformOperatorMembershipActive: membership !== null && membership.revokedAt === null,
  };
}

// แบบที่รู้แค่ userId: อ่าน HMAC เลขบัตรของผู้ใช้จากแถว users ก่อน
export async function accountCredentialsOfUser(userId: string): Promise<AccountCredentials> {
  const user = await database.user.findUnique({
    where: { id: userId },
    select: { nationalIdHmac: true },
  });
  return accountCredentialsOf(userId, user?.nationalIdHmac ?? null);
}
