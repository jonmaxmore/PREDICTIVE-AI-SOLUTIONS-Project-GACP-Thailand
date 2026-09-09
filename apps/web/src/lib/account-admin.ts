import 'server-only';
import { ROLES_BY_SIDE, RoleSide, type UserRole, userRoleSchema } from '@gacp/contracts';
import { canAssignRole, canRevokeRole } from '@gacp/domain';
import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { z } from 'zod';
import { recordAudit } from '@/lib/audit.ts';
import { requireUserWithRole } from '@/lib/current-user.ts';
import { database } from '@/lib/database.ts';
import { accountCredentialsOfUser } from '@/lib/identity/account-credentials.ts';

// งานของผู้ดูแลระบบทั้งสองฝั่ง: รายชื่อคนที่มีเครดิตของฝั่ง และการมอบ/ถอดบทบาทตามกติกาใน domain

export type CertificationBodyStaffRow = {
  readonly userId: string;
  readonly displayName: string;
  readonly providerId: string;
  readonly agencyNameTh: string | null;
  readonly credentialActive: boolean;
  readonly roles: readonly UserRole[];
};

// เจ้าหน้าที่ที่เคยเข้าสู่ระบบด้วย Provider ID พร้อมบทบาทฝั่งกรมที่ถืออยู่
export async function listCertificationBodyStaff(): Promise<CertificationBodyStaffRow[]> {
  const sideRoles = ROLES_BY_SIDE[RoleSide.CERTIFICATION_BODY];
  const credentials = await database.providerCredential.findMany({
    include: { user: { include: { staffRoleAssignments: { where: { revokedAt: null } } } } },
    orderBy: { verifiedAt: 'asc' },
  });
  return credentials.map((credential) => ({
    userId: credential.userId,
    displayName: credential.user.displayName,
    providerId: credential.providerId,
    agencyNameTh: credential.agencyNameTh,
    credentialActive: credential.revokedAt === null,
    roles: credential.user.staffRoleAssignments
      .map((entry) => entry.role)
      .filter((role) => sideRoles.includes(role)),
  }));
}

export type PlatformOperatorMembershipRow = {
  readonly membershipId: string;
  readonly userId: string | null;
  readonly displayName: string;
  readonly active: boolean;
  readonly addedAt: Date;
  readonly roles: readonly UserRole[];
};

// รายชื่อพนักงานบริษัท (ทั้งที่เคยและยังไม่เคยเข้าสู่ระบบ) พร้อมบทบาทฝั่งบริษัทที่ถืออยู่
export async function listPlatformOperatorMemberships(): Promise<PlatformOperatorMembershipRow[]> {
  const sideRoles = ROLES_BY_SIDE[RoleSide.PLATFORM_OPERATOR];
  const memberships = await database.platformOperatorMembership.findMany({
    include: { user: { include: { staffRoleAssignments: { where: { revokedAt: null } } } } },
    orderBy: { addedAt: 'asc' },
  });
  return memberships.map((membership) => ({
    membershipId: membership.id,
    userId: membership.userId,
    displayName: membership.displayName,
    active: membership.revokedAt === null,
    addedAt: membership.addedAt,
    roles:
      membership.user?.staffRoleAssignments
        .map((entry) => entry.role)
        .filter((role) => sideRoles.includes(role)) ?? [],
  }));
}

export type AuthorizedProviderAgencyRow = {
  readonly id: string;
  readonly businessId: string;
  readonly agencyCode: string | null;
  readonly nameTh: string;
  readonly active: boolean;
  readonly addedAt: Date;
};

export async function listAuthorizedProviderAgencies(): Promise<AuthorizedProviderAgencyRow[]> {
  const agencies = await database.authorizedProviderAgency.findMany({
    orderBy: { addedAt: 'asc' },
  });
  return agencies.map((agency) => ({
    id: agency.id,
    businessId: agency.businessId,
    agencyCode: agency.agencyCode,
    nameTh: agency.nameTh,
    active: agency.revokedAt === null,
    addedAt: agency.addedAt,
  }));
}

export function formText(formData: FormData, name: string): string {
  return String(formData.get(name) ?? '').trim();
}

// มอบบทบาท: actorRole บอกว่าใครกด กติกา (ฝั่งไหนมอบอะไรได้ ต้องมีเครดิต) อยู่ใน domain canAssignRole
export async function assignRoleAs(
  actorRole: UserRole,
  page: string,
  formData: FormData,
): Promise<void> {
  const actor = await requireUserWithRole(actorRole, page);
  const parsed = z
    .object({ userId: z.uuid(), role: userRoleSchema })
    .safeParse({ userId: formText(formData, 'userId'), role: formText(formData, 'role') });
  if (!parsed.success) redirect(`${page}?error=invalid`);
  const { userId, role } = parsed.data;
  const decision = canAssignRole(actor.roles, role, await accountCredentialsOfUser(userId));
  if (!decision.ok) redirect(`${page}?error=${decision.code}`);
  const existing = await database.staffRoleAssignment.findFirst({
    where: { userId, role, revokedAt: null },
  });
  if (!existing) {
    const created = await database.staffRoleAssignment.create({
      data: { userId, role, assignedById: actor.id },
    });
    await recordAudit({
      actorUserId: actor.id,
      actorRole,
      action: 'ROLE_ASSIGNED',
      targetType: 'StaffRoleAssignment',
      targetId: created.id,
      diff: { userId, role },
    });
  }
  revalidatePath(page);
}

// ถอดบทบาท: ห้ามถอดผู้ดูแลระบบคนสุดท้ายของฝั่ง (canRevokeRole นับผู้ถือที่เหลือ)
export async function revokeRoleAs(
  actorRole: UserRole,
  page: string,
  formData: FormData,
): Promise<void> {
  const actor = await requireUserWithRole(actorRole, page);
  const parsed = z
    .object({ userId: z.uuid(), role: userRoleSchema })
    .safeParse({ userId: formText(formData, 'userId'), role: formText(formData, 'role') });
  if (!parsed.success) redirect(`${page}?error=invalid`);
  const { userId, role } = parsed.data;
  const holders = await database.staffRoleAssignment.count({ where: { role, revokedAt: null } });
  const decision = canRevokeRole(actor.roles, role, holders);
  if (!decision.ok) redirect(`${page}?error=${decision.code}`);
  const revoked = await database.staffRoleAssignment.updateMany({
    where: { userId, role, revokedAt: null },
    data: { revokedAt: new Date(), revokedById: actor.id },
  });
  if (revoked.count > 0) {
    await recordAudit({
      actorUserId: actor.id,
      actorRole,
      action: 'ROLE_REVOKED',
      targetType: 'StaffRoleAssignment',
      targetId: userId,
      diff: { role },
    });
  }
  revalidatePath(page);
}
