'use server';

import { UserRole } from '@gacp/contracts';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { assignRoleAs, formText, revokeRoleAs } from '@/lib/account-admin.ts';
import { recordAudit } from '@/lib/audit.ts';
import { requireUserWithRole } from '@/lib/current-user.ts';
import { database } from '@/lib/database.ts';

const PAGE = '/certification-body/admin';

const agencySchema = z.object({
  businessId: z.string().min(1).max(64),
  agencyCode: z.string().max(32).nullable(),
  nameTh: z.string().min(1).max(200),
});

// เพิ่มสังกัดที่รับเป็นเจ้าหน้าที่กรม (เช่น กรมฯ, สสจ.) ตาม business id ของ Provider ID
export async function addAuthorizedProviderAgency(formData: FormData): Promise<void> {
  const actor = await requireUserWithRole(UserRole.CERTIFICATION_BODY_ADMIN, PAGE);
  const parsed = agencySchema.safeParse({
    businessId: formText(formData, 'businessId'),
    agencyCode: formText(formData, 'agencyCode') || null,
    nameTh: formText(formData, 'nameTh'),
  });
  if (!parsed.success) redirect(`${PAGE}?error=invalid`);
  const { businessId, agencyCode, nameTh } = parsed.data;
  const agency = await database.authorizedProviderAgency.upsert({
    where: { businessId },
    create: { businessId, agencyCode, nameTh, addedById: actor.id },
    update: {
      agencyCode,
      nameTh,
      revokedAt: null,
      revokedById: null,
      addedById: actor.id,
      addedAt: new Date(),
    },
  });
  await recordAudit({
    actorUserId: actor.id,
    actorRole: UserRole.CERTIFICATION_BODY_ADMIN,
    action: 'AUTHORIZED_PROVIDER_AGENCY_ADDED',
    targetType: 'AuthorizedProviderAgency',
    targetId: agency.id,
    diff: { businessId, agencyCode, nameTh },
  });
  revalidatePath(PAGE);
}

// ถอดสังกัด: คนในสังกัดนั้นจะไม่มีบทบาทมีผลฝั่งกรมทันทีในการเข้าสู่ระบบครั้งถัดไป (effectiveRoles)
export async function revokeAuthorizedProviderAgency(formData: FormData): Promise<void> {
  const actor = await requireUserWithRole(UserRole.CERTIFICATION_BODY_ADMIN, PAGE);
  const parsed = z.uuid().safeParse(formText(formData, 'agencyId'));
  if (!parsed.success) redirect(`${PAGE}?error=invalid`);
  const agency = await database.authorizedProviderAgency.findUnique({ where: { id: parsed.data } });
  if (!agency) redirect(`${PAGE}?error=notFound`);
  await database.authorizedProviderAgency.update({
    where: { id: agency.id },
    data: { revokedAt: new Date(), revokedById: actor.id },
  });
  await recordAudit({
    actorUserId: actor.id,
    actorRole: UserRole.CERTIFICATION_BODY_ADMIN,
    action: 'AUTHORIZED_PROVIDER_AGENCY_REVOKED',
    targetType: 'AuthorizedProviderAgency',
    targetId: agency.id,
    diff: { businessId: agency.businessId },
  });
  revalidatePath(PAGE);
}

export async function assignRole(formData: FormData): Promise<void> {
  await assignRoleAs(UserRole.CERTIFICATION_BODY_ADMIN, PAGE, formData);
}

export async function revokeRole(formData: FormData): Promise<void> {
  await revokeRoleAs(UserRole.CERTIFICATION_BODY_ADMIN, PAGE, formData);
}
