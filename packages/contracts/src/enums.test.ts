import { describe, expect, it } from 'vitest';
import {
  ApplicantType,
  ApplicationStatus,
  AreaType,
  CertificationScope,
  FeeStage,
  LandTenure,
  Purpose,
  RequestType,
  TERMINAL_APPLICATION_STATUSES,
  UserRole,
} from './enums.ts';

const closedSets: ReadonlyArray<readonly [string, Record<string, string>]> = [
  ['UserRole', UserRole],
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

  it('มี 7 บทบาทตาม glossary', () => {
    expect(Object.keys(UserRole)).toHaveLength(7);
  });

  it('สถานะคำขอมี 12 สถานะในเส้นงาน + 5 ปลายทาง', () => {
    expect(Object.keys(ApplicationStatus)).toHaveLength(17);
    expect(TERMINAL_APPLICATION_STATUSES.size).toBe(5);
    expect(TERMINAL_APPLICATION_STATUSES.has(ApplicationStatus.CERTIFIED)).toBe(false);
  });
});
