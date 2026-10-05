/**
 * The certificates page states each certificate's own validity, not a constant
 * (review of fix/truthful-copy, minor 1). The page used to say "3 ปี" for every
 * certificate; new ones last 1 year, ones issued before 2026-09-11 keep 3.
 */
import * as fs from 'fs';
import * as path from 'path';
import { describe, expect, it } from '@jest/globals';

import { certificateValidityYears } from '../validity-years';

describe('certificateValidityYears', () => {
    it('a certificate issued under today\'s rule: 1 year', () => {
        expect(certificateValidityYears('2026-09-26T00:00:00.000Z', '2027-09-26T00:00:00.000Z')).toBe(1);
    });

    it('a certificate issued before 2026-09-11 keeps its 3 years (staging, 10 Sep 2569 -> 10 Sep 2572)', () => {
        expect(certificateValidityYears('2026-09-10T00:00:00.000Z', '2029-09-10T00:00:00.000Z')).toBe(3);
    });

    it('a Bangkok-midnight edge or a leap day does not change the number', () => {
        expect(certificateValidityYears('2027-02-28T17:00:00.000Z', '2028-02-29T17:00:00.000Z')).toBe(1);
        expect(certificateValidityYears('2026-09-10T17:00:00.000Z', '2027-09-10T16:59:59.000Z')).toBe(1);
    });

    it('names no number when a date is missing or unreadable', () => {
        expect(certificateValidityYears('', '2027-09-26')).toBeNull();
        expect(certificateValidityYears('2026-09-26', null)).toBeNull();
        expect(certificateValidityYears('not a date', '2027-09-26')).toBeNull();
        expect(certificateValidityYears('2026-09-26', '2026-10-26')).toBeNull();
    });

    it('the page no longer declares a fixed validity', () => {
        const page = fs.readFileSync(path.join(__dirname, '..', 'client-view.tsx'), 'utf8');
        expect(page).not.toMatch(/CERT_VALIDITY_YEARS\s*=/);
        expect(page).toContain('certificateValidityYears(cert.issuedDate, cert.expiryDate)');
    });
});
