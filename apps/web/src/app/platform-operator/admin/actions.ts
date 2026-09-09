'use server';

import { isValidThaiNationalId, UserRole } from '@gacp/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { assignRoleAs, formText, revokeRoleAs } from '@/lib/account-admin.ts';
import { recordAudit } from '@/lib/audit.ts';
import { requireUserWithRole } from '@/lib/current-user.ts';
import { database } from '@/lib/database.ts';
import { hmacField } from '@/lib/protected-fields.ts';

const PAGE = '/platform-operator/admin';

// เพิ่มพนักงานบริษัท: เลขบัตรถูกแปลงเป็น HMAC ทันที ไม่เก็บ ไม่ลง log ไม่แสดงซ้ำ
export async function addPlatformOperatorMembership(formData: FormData): Promise<void> {
  const actor = await requireUserWithRole(UserRole.PLATFORM_OPERATOR_ADMIN, PAGE);
  const nationalId = formText(formData, 'nationalId').replace(/[\s-]/g, '');
  const displayName = formText(formData, 'displayName');
  if (!isValidThaiNationalId(nationalId) || displayName.length === 0 || displayName.length > 120) {
    redirect(`${PAGE}?error=invalid`);
  }
  const nationalIdHmac = hmacField(nationalId);
  const membership = await database.platformOperatorMembership.upsert({
    where: { nationalIdHmac },
    create: { nationalIdHmac, displayName, addedById: actor.id },
    update: {
      displayName,
      revokedAt: null,
      revokedById: null,
      addedById: actor.id,
      addedAt: new Date(),
    },
  });
  await recordAudit({
    actorUserId: actor.id,
    actorRole: UserRole.PLATFORM_OPERATOR_ADMIN,
    action: 'PLATFORM_OPERATOR_MEMBERSHIP_ADDED',
    targetType: 'PlatformOperatorMembership',
    targetId: membership.id,
  });
  revalidatePath(PAGE);
}

// ถอดออกจากรายชื่อ: ถอดบทบาทฝั่งบริษัททั้งหมดของคนนั้นด้วย ถอดตัวเองไม่ได้
export async function revokePlatformOperatorMembership(formData: FormData): Promise<void> {
  const actor = await requireUserWithRole(UserRole.PLATFORM_OPERATOR_ADMIN, PAGE);
  const parsed = z.uuid().safeParse(formText(formData, 'membershipId'));
  if (!parsed.success) redirect(`${PAGE}?error=invalid`);
  const membership = await database.platformOperatorMembership.findUnique({
    where: { id: parsed.data },
  });
  if (!membership) redirect(`${PAGE}?error=notFound`);
  if (membership.userId === actor.id) redirect(`${PAGE}?error=self`);
  const now = new Date();
  await database.$transaction([
    database.platformOperatorMembership.update({
      where: { id: membership.id },
      data: { revokedAt: now, revokedById: actor.id },
    }),
    ...(membership.userId
      ? [
          database.staffRoleAssignment.updateMany({
            where: {
              userId: membership.userId,
              revokedAt: null,
              role: {
                in: [UserRole.PLATFORM_OPERATOR_ADMIN, UserRole.PLATFORM_OPERATOR_FINANCE_OFFICER],
              },
            },
            data: { revokedAt: now, revokedById: actor.id },
          }),
        ]
      : []),
  ]);
  await recordAudit({
    actorUserId: actor.id,
    actorRole: UserRole.PLATFORM_OPERATOR_ADMIN,
    action: 'PLATFORM_OPERATOR_MEMBERSHIP_REVOKED',
    targetType: 'PlatformOperatorMembership',
    targetId: membership.id,
  });
  revalidatePath(PAGE);
}

export async function assignRole(formData: FormData): Promise<void> {
  await assignRoleAs(UserRole.PLATFORM_OPERATOR_ADMIN, PAGE, formData);
}

export async function revokeRole(formData: FormData): Promise<void> {
  await revokeRoleAs(UserRole.PLATFORM_OPERATOR_ADMIN, PAGE, formData);
}
