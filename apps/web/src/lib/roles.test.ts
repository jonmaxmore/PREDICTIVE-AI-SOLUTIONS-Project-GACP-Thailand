import { LoginIntent, RoleSide, UserRole } from '@gacp/contracts';
import { describe, expect, it } from 'vitest';
import {
  homePathForIntent,
  loginPathForPathname,
  outcomePath,
  roleForPathname,
  roleHomePath,
  sideToneOf,
} from './roles.ts';

describe('เส้นทางตามฝั่ง', () => {
  it('หน้าหลักของบทบาทจัดกลุ่มตามฝั่ง', () => {
    expect(roleHomePath(UserRole.APPLICANT)).toBe('/applicant');
    expect(roleHomePath(UserRole.DOCUMENT_REVIEWER)).toBe('/certification-body/document-reviewer');
    expect(roleHomePath(UserRole.CERTIFICATION_BODY_ADMIN)).toBe('/certification-body/admin');
    expect(roleHomePath(UserRole.PLATFORM_OPERATOR_FINANCE_OFFICER)).toBe(
      '/platform-operator/finance-officer',
    );
  });

  it('หา role จาก pathname โดยเทียบ prefix ที่ยาวสุด', () => {
    expect(roleForPathname('/certification-body/admin/agencies')).toBe(
      UserRole.CERTIFICATION_BODY_ADMIN,
    );
    expect(roleForPathname('/platform-operator/admin')).toBe(UserRole.PLATFORM_OPERATOR_ADMIN);
    expect(roleForPathname('/platform-operator/login')).toBeUndefined();
    expect(roleForPathname('/applicant/applications/x/steps/2')).toBe(UserRole.APPLICANT);
    expect(roleForPathname('/applicant-x')).toBeUndefined();
    expect(roleForPathname('/verify/GACP-TH-2569-000001')).toBeUndefined();
  });

  it('หน้าล็อกอินของฝั่งบริษัทแยกจากหน้าสาธารณะ', () => {
    expect(loginPathForPathname('/platform-operator/admin')).toBe('/platform-operator/login');
    expect(loginPathForPathname('/certification-body/dispatcher')).toBe('/auth/login');
    expect(loginPathForPathname('/applicant')).toBe('/auth/login');
  });

  it('หลังล็อกอินไปหน้าหลักของบทบาทแรกในฝั่งที่ตั้งใจ', () => {
    expect(
      homePathForIntent(LoginIntent.CERTIFICATION_BODY_STAFF, [
        UserRole.APPLICANT,
        UserRole.DISPATCHER,
      ]),
    ).toBe('/certification-body/dispatcher');
    expect(homePathForIntent(LoginIntent.APPLICANT, [UserRole.APPLICANT])).toBe('/applicant');
    expect(
      homePathForIntent(LoginIntent.PLATFORM_OPERATOR_STAFF, [
        UserRole.APPLICANT,
        UserRole.PLATFORM_OPERATOR_FINANCE_OFFICER,
      ]),
    ).toBe('/platform-operator/finance-officer');
  });

  it('หน้าผลลัพธ์การล็อกอินและโทนสีของฝั่ง', () => {
    expect(outcomePath('NOT_PROVIDER')).toBe('/auth/outcome?code=NOT_PROVIDER');
    expect(sideToneOf(UserRole.APPLICANT)).toBe('applicant');
    expect(sideToneOf(UserRole.FIELD_INSPECTOR)).toBe('officer');
    expect(sideToneOf(UserRole.PLATFORM_OPERATOR_ADMIN)).toBe('operator');
    expect(RoleSide.PLATFORM_OPERATOR).toBe('PLATFORM_OPERATOR');
  });
});
