import { ROLES_BY_SIDE, RoleSide, roleSideOf, UserRole } from '@gacp/contracts';

// กติกา "เครดิตของฝั่ง → บทบาทที่ถือได้" (spec 2026-09-09 §4) ทุกประตูของระบบใช้ฟังก์ชันชุดนี้ ไม่มีที่อื่นตัดสิน

export type AccountCredentials = {
  // มี ProviderCredential และยังไม่ถูกถอน (MOPH ยังยืนยันว่ามี Provider ID)
  readonly providerCredentialActive: boolean;
  // สังกัดของ Provider ID อยู่ใน AuthorizedProviderAgency ที่ยังไม่ถูกถอด
  readonly providerAgencyAuthorized: boolean;
  // อยู่ในรายชื่อพนักงานบริษัท (PlatformOperatorMembership) และยังไม่ถูกถอด
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
  const adminRole = ADMIN_ROLE_OF_SIDE[targetSide];
  if (adminRole === null) return false;
  if (actorRoles.includes(adminRole)) return true;
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
