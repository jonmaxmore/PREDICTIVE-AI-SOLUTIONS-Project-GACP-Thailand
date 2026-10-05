/**
 * Unit Tests for Health ID Validator
 * @jest-environment node
 */

import {
    validateHealthId,
    validateJuristicId,
    validateCommunityEnterpriseId,
    formatHealthId,
    validateIdByType,
} from '../thai-id-validator';

describe('Health ID Validator', () => {
    describe('validateHealthId', () => {
        it('should validate correct 13-digit Health ID', () => {
            const result = validateHealthId('1-1234-56789-01-4');
            expect(result.isValid).toBe(true);
            expect(result.formatted).toBe('1-1234-56789-01-4');
            expect(result.idType).toBe('INDIVIDUAL');
        });

        it('should reject ID with wrong length', () => {
            const result = validateHealthId('123456789');
            expect(result.isValid).toBe(false);
            expect(result.error).toContain('13 หลัก');
        });

        it('should reject ID with invalid checksum', () => {
            const result = validateHealthId('1-1234-56789-01-9'); // Wrong check digit
            expect(result.isValid).toBe(false);
            expect(result.error).toContain('ผลรวมตรวจสอบ');
        });

        it('should handle ID without dashes', () => {
            const result = validateHealthId('1234567890121');
            expect(result.formatted).toBe('1-2345-67890-12-1');
        });
    });

    describe('formatHealthId', () => {
        it('should format 13 digits with dashes', () => {
            expect(formatHealthId('1234567890121')).toBe('1-2345-67890-12-1');
        });

        it('should return original if not 13 digits', () => {
            expect(formatHealthId('12345')).toBe('12345');
        });
    });

    describe('validateJuristicId', () => {
        it('should reject ID not starting with 0', () => {
            const result = validateJuristicId('1-1234-56789-01-4');
            expect(result.isValid).toBe(false);
            expect(result.error).toContain('ขึ้นต้นด้วย 0');
        });

        it('should validate valid juristic id', () => {
            const result = validateJuristicId('0-1234-56789-01-6');
            expect(result.isValid).toBe(true);
            expect(result.idType).toBe('JURISTIC');
        });
    });

    describe('validateCommunityEnterpriseId', () => {
        it('should accept 11-13 digit IDs', () => {
            const result = validateCommunityEnterpriseId('12345678901');
            expect(result.isValid).toBe(true);
            expect(result.idType).toBe('COMMUNITY_ENTERPRISE');
        });

        it('should reject IDs shorter than 11 digits', () => {
            const result = validateCommunityEnterpriseId('1234567890');
            expect(result.isValid).toBe(false);
        });
    });

    describe('validateIdByType', () => {
        it('should route to correct validator based on type', () => {
            const individual = validateIdByType('1234567890121', 'INDIVIDUAL');
            expect(individual.idType).toBe('INDIVIDUAL');

            const juristic = validateIdByType('0123456789016', 'JURISTIC');
            expect(juristic.idType).toBe('JURISTIC');

            const community = validateIdByType('12345678901', 'COMMUNITY_ENTERPRISE');
            expect(community.idType).toBe('COMMUNITY_ENTERPRISE');
        });
    });
});
