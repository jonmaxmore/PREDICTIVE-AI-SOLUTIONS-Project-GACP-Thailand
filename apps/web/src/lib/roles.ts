import { UserRole } from '@gacp/contracts';

// route segment ต่อบทบาท (docs/glossary.md §5): ชื่อ segment = ชื่อบทบาทแบบ kebab-case ไม่มีชื่อย่อ
export const ROLE_ROUTE_SEGMENTS: Record<UserRole, string> = {
  [UserRole.APPLICANT]: 'applicant',
  [UserRole.FINANCE_OFFICER]: 'finance-officer',
  [UserRole.DISPATCHER]: 'dispatcher',
  [UserRole.DOCUMENT_REVIEWER]: 'document-reviewer',
  [UserRole.FIELD_INSPECTOR]: 'field-inspector',
  [UserRole.CERTIFICATE_APPROVER]: 'certificate-approver',
  [UserRole.SYSTEM_ADMIN]: 'system-admin',
};

const SEGMENT_TO_ROLE: ReadonlyMap<string, UserRole> = new Map(
  Object.entries(ROLE_ROUTE_SEGMENTS).map(([role, segment]) => [segment, role as UserRole]),
);

export function roleHomePath(role: UserRole): string {
  return `/${ROLE_ROUTE_SEGMENTS[role]}`;
}

export function roleForPathname(pathname: string): UserRole | undefined {
  const firstSegment = pathname.split('/').filter(Boolean)[0];
  return firstSegment ? SEGMENT_TO_ROLE.get(firstSegment) : undefined;
}
