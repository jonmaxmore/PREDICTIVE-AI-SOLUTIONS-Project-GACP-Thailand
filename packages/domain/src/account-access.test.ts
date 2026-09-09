import { UserRole } from '@gacp/contracts';
import { describe, expect, it } from 'vitest';
import {
  type AccountCredentials,
  canAssignRole,
  canRevokeRole,
  effectiveRoles,
  permittedRolesFor,
  RoleAssignmentRejection,
} from './account-access.ts';

const none: AccountCredentials = {
  providerCredentialActive: false,
  providerAgencyAuthorized: false,
  platformOperatorMembershipActive: false,
};
const certificationBodyStaff: AccountCredentials = {
  ...none,
  providerCredentialActive: true,
  providerAgencyAuthorized: true,
};
const providerWithoutAgency: AccountCredentials = { ...none, providerCredentialActive: true };
const platformOperatorStaff: AccountCredentials = {
  ...none,
  platformOperatorMembershipActive: true,
};

describe('permittedRolesFor', () => {
  it('ทุกคนที่พิสูจน์ตัวตนแล้วเป็นผู้ขอรับรองได้', () => {
    expect([...permittedRolesFor(none)]).toEqual([UserRole.APPLICANT]);
  });

  it('Provider ID ที่สังกัดได้รับอนุญาตเปิดบทบาทฝั่งกรมทั้ง 6', () => {
    const roles = permittedRolesFor(certificationBodyStaff);
    expect(roles.has(UserRole.DOCUMENT_REVIEWER)).toBe(true);
    expect(roles.has(UserRole.CERTIFICATION_BODY_ADMIN)).toBe(true);
    expect(roles.has(UserRole.PLATFORM_OPERATOR_ADMIN)).toBe(false);
    expect(roles.size).toBe(7);
  });

  it('Provider ID ที่สังกัดไม่อยู่ในรายการ ไม่เปิดบทบาทฝั่งกรม', () => {
    expect([...permittedRolesFor(providerWithoutAgency)]).toEqual([UserRole.APPLICANT]);
  });

  it('รายชื่อบริษัทเปิดบทบาทฝั่งบริษัททั้ง 2', () => {
    const roles = permittedRolesFor(platformOperatorStaff);
    expect(roles.has(UserRole.PLATFORM_OPERATOR_FINANCE_OFFICER)).toBe(true);
    expect(roles.has(UserRole.DISPATCHER)).toBe(false);
    expect(roles.size).toBe(3);
  });
});

describe('effectiveRoles', () => {
  it('คือบทบาทที่ถูกมอบตัดกับที่เครดิตอนุญาต เรียงตามลำดับ UserRole', () => {
    expect(
      effectiveRoles(
        [UserRole.PLATFORM_OPERATOR_ADMIN, UserRole.DISPATCHER, UserRole.DOCUMENT_REVIEWER],
        certificationBodyStaff,
      ),
    ).toEqual([UserRole.APPLICANT, UserRole.DOCUMENT_REVIEWER, UserRole.DISPATCHER]);
  });

  it('Provider ID หลุด บทบาทฝั่งกรมหายทั้งหมด เหลือผู้ขอรับรอง', () => {
    expect(
      effectiveRoles([UserRole.DOCUMENT_REVIEWER], {
        ...certificationBodyStaff,
        providerCredentialActive: false,
      }),
    ).toEqual([UserRole.APPLICANT]);
  });

  it('ไม่ต้องมอบ APPLICANT ก็ได้บทบาทนี้เสมอ', () => {
    expect(effectiveRoles([], none)).toEqual([UserRole.APPLICANT]);
  });
});

describe('canAssignRole', () => {
  it('ผู้ดูแลกรมมอบบทบาทฝั่งกรมให้คนที่มีเครดิตได้', () => {
    expect(
      canAssignRole(
        [UserRole.CERTIFICATION_BODY_ADMIN],
        UserRole.FIELD_INSPECTOR,
        certificationBodyStaff,
      ),
    ).toEqual({ ok: true });
  });

  it('ผู้ดูแลกรมมอบบทบาทให้คนที่ไม่มี Provider ID ไม่ได้', () => {
    expect(
      canAssignRole([UserRole.CERTIFICATION_BODY_ADMIN], UserRole.FIELD_INSPECTOR, none),
    ).toEqual({ ok: false, code: RoleAssignmentRejection.TARGET_CREDENTIAL_MISSING });
  });

  it('ผู้ดูแลบริษัทมอบบทบาทฝั่งบริษัท และตั้งผู้ดูแลกรมได้ แต่มอบบทบาทกรมอื่นไม่ได้', () => {
    expect(
      canAssignRole(
        [UserRole.PLATFORM_OPERATOR_ADMIN],
        UserRole.PLATFORM_OPERATOR_FINANCE_OFFICER,
        platformOperatorStaff,
      ),
    ).toEqual({ ok: true });
    expect(
      canAssignRole(
        [UserRole.PLATFORM_OPERATOR_ADMIN],
        UserRole.CERTIFICATION_BODY_ADMIN,
        certificationBodyStaff,
      ),
    ).toEqual({ ok: true });
    expect(
      canAssignRole(
        [UserRole.PLATFORM_OPERATOR_ADMIN],
        UserRole.DOCUMENT_REVIEWER,
        certificationBodyStaff,
      ),
    ).toEqual({ ok: false, code: RoleAssignmentRejection.ACTOR_NOT_ALLOWED });
  });

  it('บทบาทที่ไม่ใช่ผู้ดูแลมอบอะไรไม่ได้ และ APPLICANT มอบไม่ได้', () => {
    expect(
      canAssignRole([UserRole.DISPATCHER], UserRole.DOCUMENT_REVIEWER, certificationBodyStaff).ok,
    ).toBe(false);
    expect(
      canAssignRole([UserRole.CERTIFICATION_BODY_ADMIN], UserRole.APPLICANT, certificationBodyStaff)
        .ok,
    ).toBe(false);
  });
});

describe('canRevokeRole', () => {
  it('ถอดผู้ดูแลระบบคนสุดท้ายของฝั่งไม่ได้', () => {
    expect(
      canRevokeRole([UserRole.CERTIFICATION_BODY_ADMIN], UserRole.CERTIFICATION_BODY_ADMIN, 1),
    ).toEqual({ ok: false, code: RoleAssignmentRejection.LAST_ADMIN_OF_SIDE });
    expect(
      canRevokeRole([UserRole.CERTIFICATION_BODY_ADMIN], UserRole.CERTIFICATION_BODY_ADMIN, 2),
    ).toEqual({ ok: true });
    expect(
      canRevokeRole([UserRole.PLATFORM_OPERATOR_ADMIN], UserRole.PLATFORM_OPERATOR_ADMIN, 1).ok,
    ).toBe(false);
  });

  it('ถอดบทบาทธรรมดาได้เมื่อมีสิทธิ์มอบ', () => {
    expect(canRevokeRole([UserRole.CERTIFICATION_BODY_ADMIN], UserRole.DISPATCHER, 1)).toEqual({
      ok: true,
    });
    expect(canRevokeRole([UserRole.PLATFORM_OPERATOR_ADMIN], UserRole.DISPATCHER, 1).ok).toBe(
      false,
    );
  });
});
