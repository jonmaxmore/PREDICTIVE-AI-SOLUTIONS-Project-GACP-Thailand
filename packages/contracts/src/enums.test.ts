import { describe, expect, it } from 'vitest';
import {
  ApplicantType,
  ApplicationStatus,
  AreaType,
  CertificationScope,
  FeeStage,
  IdentityProvider,
  LandTenure,
  LoginIntent,
  Purpose,
  RequestType,
  ROLES_BY_SIDE,
  RoleSide,
  roleSideOf,
  TERMINAL_APPLICATION_STATUSES,
  UserRole,
} from './enums.ts';

const closedSets: ReadonlyArray<readonly [string, Record<string, string>]> = [
  ['UserRole', UserRole],
  ['RoleSide', RoleSide],
  ['LoginIntent', LoginIntent],
  ['IdentityProvider', IdentityProvider],
  ['ApplicantType', ApplicantType],
  ['RequestType', RequestType],
  ['CertificationScope', CertificationScope],
  ['Purpose', Purpose],
  ['AreaType', AreaType],
  ['LandTenure', LandTenure],
  ['FeeStage', FeeStage],
  ['ApplicationStatus', ApplicationStatus],
];

describe('ชุดค่าปิด', () => {
  it('ทุกค่าเท่ากับชื่อและเป็น UPPER_SNAKE_CASE', () => {
    for (const [setName, record] of closedSets) {
      for (const [key, value] of Object.entries(record)) {
        expect(value, `${setName}.${key}`).toBe(key);
        expect(key, `${setName}.${key}`).toMatch(/^[A-Z][A-Z0-9_]*$/);
      }
    }
  });

  it('มี 9 บทบาท 3 ฝั่ง และทุกบทบาทอยู่ฝั่งเดียว', () => {
    expect(Object.keys(UserRole)).toHaveLength(9);
    expect(Object.keys(RoleSide)).toHaveLength(3);
    const seen = new Set<string>();
    for (const roles of Object.values(ROLES_BY_SIDE)) {
      for (const role of roles) {
        expect(seen.has(role), role).toBe(false);
        seen.add(role);
      }
    }
    expect(seen.size).toBe(9);
    expect(roleSideOf(UserRole.APPLICANT)).toBe(RoleSide.APPLICANT);
    expect(roleSideOf(UserRole.DISPATCHER)).toBe(RoleSide.CERTIFICATION_BODY);
    expect(roleSideOf(UserRole.CERTIFICATION_BODY_FINANCE_OFFICER)).toBe(
      RoleSide.CERTIFICATION_BODY,
    );
    expect(roleSideOf(UserRole.PLATFORM_OPERATOR_ADMIN)).toBe(RoleSide.PLATFORM_OPERATOR);
  });

  it('ผู้ให้บริการยืนยันตัวตนคือ ThaID, Health ID ของหมอพร้อม และ dev เท่านั้น', () => {
    expect(Object.keys(IdentityProvider)).toEqual(['THAID', 'MORPHROM_HEALTH_ID', 'DEV_LOCAL']);
  });

  it('สถานะคำขอมี 12 สถานะในเส้นงาน + 5 ปลายทาง', () => {
    expect(Object.keys(ApplicationStatus)).toHaveLength(17);
    expect(TERMINAL_APPLICATION_STATUSES.size).toBe(5);
    expect(TERMINAL_APPLICATION_STATUSES.has(ApplicationStatus.CERTIFIED)).toBe(false);
  });
});
