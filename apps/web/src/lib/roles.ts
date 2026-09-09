import { type LoginIntent, ROLES_BY_SIDE, RoleSide, roleSideOf, UserRole } from '@gacp/contracts';

// เส้นทางจัดกลุ่มตามฝั่ง (spec 2026-09-09 §5): /applicant · /certification-body/<บทบาท> · /platform-operator/<บทบาท>
export const ROLE_HOME_PATHS: Readonly<Record<UserRole, string>> = {
  [UserRole.APPLICANT]: '/applicant',
  [UserRole.DOCUMENT_REVIEWER]: '/certification-body/document-reviewer',
  [UserRole.DISPATCHER]: '/certification-body/dispatcher',
  [UserRole.FIELD_INSPECTOR]: '/certification-body/field-inspector',
  [UserRole.CERTIFICATE_APPROVER]: '/certification-body/certificate-approver',
  [UserRole.CERTIFICATION_BODY_ADMIN]: '/certification-body/admin',
  [UserRole.CERTIFICATION_BODY_FINANCE_OFFICER]: '/certification-body/finance-officer',
  [UserRole.PLATFORM_OPERATOR_ADMIN]: '/platform-operator/admin',
  [UserRole.PLATFORM_OPERATOR_FINANCE_OFFICER]: '/platform-operator/finance-officer',
};

export const PLATFORM_OPERATOR_PATH_PREFIX = '/platform-operator';
export const PLATFORM_OPERATOR_LOGIN_PATH = '/platform-operator/login';
export const PUBLIC_LOGIN_PATH = '/auth/login';

// เทียบ prefix ที่ยาวสุดก่อน เพื่อให้ /certification-body/admin ไม่ถูก /certification-body ของบทบาทอื่นดักไปก่อน
const ROLES_BY_PATH_LENGTH: readonly (readonly [UserRole, string])[] = (
  Object.entries(ROLE_HOME_PATHS) as [UserRole, string][]
).sort((left, right) => right[1].length - left[1].length);

export function roleHomePath(role: UserRole): string {
  return ROLE_HOME_PATHS[role];
}

export function roleForPathname(pathname: string): UserRole | undefined {
  if (pathname === PLATFORM_OPERATOR_LOGIN_PATH) return undefined;
  const match = ROLES_BY_PATH_LENGTH.find(
    ([, path]) => pathname === path || pathname.startsWith(`${path}/`),
  );
  return match?.[0];
}

// ฝั่งบริษัทมีหน้าเข้าสู่ระบบของตัวเอง (ThaID อย่างเดียว) ส่วนผู้ขอรับรองและเจ้าหน้าที่กรมใช้หน้าสาธารณะ
export function loginPathForPathname(pathname: string): string {
  return pathname === PLATFORM_OPERATOR_PATH_PREFIX ||
    pathname.startsWith(`${PLATFORM_OPERATOR_PATH_PREFIX}/`)
    ? PLATFORM_OPERATOR_LOGIN_PATH
    : PUBLIC_LOGIN_PATH;
}

const SIDE_OF_INTENT: Readonly<Record<LoginIntent, RoleSide>> = {
  APPLICANT: RoleSide.APPLICANT,
  CERTIFICATION_BODY_STAFF: RoleSide.CERTIFICATION_BODY,
  PLATFORM_OPERATOR_STAFF: RoleSide.PLATFORM_OPERATOR,
};

export function sideOfIntent(intent: LoginIntent): RoleSide {
  return SIDE_OF_INTENT[intent];
}

// หลังเข้าสู่ระบบ: ไปหน้าหลักของบทบาทแรก (ตามลำดับใน ROLES_BY_SIDE) ในฝั่งที่ตั้งใจเข้า
export function homePathForIntent(intent: LoginIntent, roles: readonly UserRole[]): string {
  const side = SIDE_OF_INTENT[intent];
  const first =
    ROLES_BY_SIDE[side].find((role) => roles.includes(role)) ?? roles[0] ?? UserRole.APPLICANT;
  return roleHomePath(first);
}

export function outcomePath(code: string): string {
  return `/auth/outcome?code=${encodeURIComponent(code)}`;
}

export type SideTone = 'applicant' | 'officer' | 'operator';

export const SIDE_TONE: Readonly<Record<RoleSide, SideTone>> = {
  [RoleSide.APPLICANT]: 'applicant',
  [RoleSide.CERTIFICATION_BODY]: 'officer',
  [RoleSide.PLATFORM_OPERATOR]: 'operator',
};

export function sideToneOf(role: UserRole): SideTone {
  return SIDE_TONE[roleSideOf(role)];
}
