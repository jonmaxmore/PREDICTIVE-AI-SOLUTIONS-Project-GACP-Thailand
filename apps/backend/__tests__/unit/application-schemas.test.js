/**
 * Unit tests for application-schemas (Zod validation)
 */
const {
    validateStep,
    validateAllSteps,
    _step1Schema,
    _step4Schema,
} = require('../../validation/application-schemas');

describe('application-schemas (Zod)', () => {
    // validateStep — single step
    describe('validateStep', () => {
        it('returns success: true for unknown step numbers', () => {
            const result = validateStep(99, {});
            expect(result.success).toBe(true);
        });

        // Step 1
        it('validates Step 1 with complete data', () => {
            const result = validateStep(1, {
                operator_name: 'นายทดสอบ',
                tax_id: '1234567890123',
                address_contact: '123 ถนนเทสต์',
                phone_no: '081-234-5678',
                email: 'test@example.com',
                operator_type: 'INDIVIDUAL',
            });
            expect(result.success).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('rejects Step 1 with missing fields', () => {
            const result = validateStep(1, {});
            expect(result.success).toBe(false);
            expect(result.errors.length).toBeGreaterThan(0);
            const paths = result.errors.map(e => e.path);
            expect(paths).toContain('operator_name');
            expect(paths).toContain('tax_id');
            expect(paths).toContain('email');
        });

        it('rejects Step 1 with invalid email', () => {
            const result = validateStep(1, {
                operator_name: 'Test',
                tax_id: '123',
                address_contact: '123',
                phone_no: '081',
                email: 'not-an-email',
                operator_type: 'INDIVIDUAL',
            });
            expect(result.success).toBe(false);
            const emailError = result.errors.find(e => e.path === 'email');
            expect(emailError).toBeDefined();
            expect(emailError.message).toContain('อีเมล');
        });

        // Step 2
        it('validates Step 2 (plant info)', () => {
            const result = validateStep(2, {
                herb_type_id: 'CANNABIS',
                botanical_name: 'Cannabis sativa L.',
                strain_name: 'Thai Stick',
                material_source: 'เมล็ดพันธุ์จากแหล่งรับรอง',
                source_location: 'เชียงใหม่',
                lot_number: 'LOT-2026-001',
            });
            expect(result.success).toBe(true);
        });

        // Step 3 (mostly optional)
        it('validates Step 3 with minimal data', () => {
            const result = validateStep(3, {});
            expect(result.success).toBe(true);
        });

        // Step 5
        it('validates Step 5 (farm info) with complete data', () => {
            const result = validateStep(5, {
                plot_name: 'แปลงที่ 1',
                land_title_no: 'น.ส.3 ก. เลขที่ 12345',
                area_rai: 5,
                area_ngan: 2,
                area_sq_wa: 50,
                lat: 18.7883,
                long: 98.9853,
                surrounding_environment: 'พื้นที่เกษตร ไม่มีโรงงานอุตสาหกรรม',
            });
            expect(result.success).toBe(true);
        });

        it('rejects Step 5 with non-numeric area', () => {
            const result = validateStep(5, {
                plot_name: 'Test',
                land_title_no: '12345',
                area_rai: 'abc',
                area_ngan: 0,
                area_sq_wa: 0,
                lat: 18.7,
                long: 98.9,
                surrounding_environment: 'Test',
            });
            expect(result.success).toBe(false);
        });

        // Step 6
        it('validates Step 6 (production) with complete data', () => {
            const result = validateStep(6, {
                water_source_type: 'WELL',
                irrigation_method: 'DRIP',
                soil_preparation_method: 'การไถกลบ',
                soil_analysis_date: '2026-01-15',
                water_analysis_date: '2026-01-15',
                fertilizer_type: 'ORGANIC',
                fertilizer_schedule: 'ทุก 2 สัปดาห์',
                pest_control_method: 'IPM',
                weed_control_method: 'ถอนมือ',
                input_usage_history: 'ไม่เคยใช้สารเคมี',
            });
            expect(result.success).toBe(true);
        });

        // Step 8 (documents)
        it('validates Step 8 requires at least 1 file', () => {
            const noFiles = validateStep(8, { files: [] });
            expect(noFiles.success).toBe(false);

            const withFiles = validateStep(8, { files: [{ name: 'doc.pdf' }] });
            expect(withFiles.success).toBe(true);
        });
    });

    // Step 4: Applicant Type Branching
    describe('Step 4 — Applicant Branching', () => {
        it('validates INDIVIDUAL applicant', () => {
            const result = validateStep(4, {
                applicant_type: 'INDIVIDUAL',
                first_name: 'สมชาย',
                last_name: 'ทดสอบ',
                // F-G4-10: was '1234567890123', which is not a real ID — its check
                // digit is 1, not 3. It only ever "passed" because step 4 checked
                // length alone. Same prefix, correct check digit.
                id_card: '1234567890121',
                phone: '081-234-5678',
                email: 'test@test.com',
            });
            expect(result.success).toBe(true);
        });

        it('rejects INDIVIDUAL without id_card', () => {
            const result = validateStep(4, {
                applicant_type: 'INDIVIDUAL',
                first_name: 'สมชาย',
                last_name: 'ทดสอบ',
                phone: '081',
                email: 'test@test.com',
            });
            expect(result.success).toBe(false);
            const idCardError = result.errors.find(e => e.path === 'id_card');
            expect(idCardError).toBeDefined();
        });

        it('validates COMMUNITY_ENTERPRISE applicant', () => {
            const result = validateStep(4, {
                applicant_type: 'COMMUNITY_ENTERPRISE',
                community_name: 'วิสาหกิจชุมชนบ้านเทสต์',
                president_name: 'นายประธาน ทดสอบ',
                registration_svc01: 'SVC-01-12345',
            });
            expect(result.success).toBe(true);
        });

        it('validates LEGAL_ENTITY applicant', () => {
            const result = validateStep(4, {
                applicant_type: 'LEGAL_ENTITY',
                company_name: 'บริษัท ทดสอบ จำกัด',
                registration_number: '0105512345678',
                authorized_signatory: 'นายกรรมการ ทดสอบ',
            });
            expect(result.success).toBe(true);
        });

        it('rejects unknown applicant_type with appropriate error', () => {
            const result = validateStep(4, {
                applicant_type: 'UNKNOWN_TYPE',
            });
            expect(result.success).toBe(false);
        });
    });

    // validateAllSteps — full submission
    describe('validateAllSteps', () => {
        const makeFullData = () => ({
            '1': {
                operator_name: 'Test', tax_id: '123', address_contact: '123',
                phone_no: '081', email: 'test@test.com', operator_type: 'IND',
            },
            '2': {
                herb_type_id: 'A', botanical_name: 'B', strain_name: 'C',
                material_source: 'D', source_location: 'E', lot_number: 'F',
            },
            '3': {},
            '4': {
                applicant_type: 'INDIVIDUAL', first_name: 'A', last_name: 'B',
                id_card: '1234567890121', phone: '081', email: 'a@b.com',
            },
            '5': {
                plot_name: 'A', land_title_no: 'B', area_rai: 1, area_ngan: 0,
                area_sq_wa: 0, lat: 13.0, long: 100.0, surrounding_environment: 'C',
            },
            '6': {
                water_source_type: 'A', irrigation_method: 'B', soil_preparation_method: 'C',
                soil_analysis_date: '2026-01-01', water_analysis_date: '2026-01-01',
                fertilizer_type: 'D', fertilizer_schedule: 'E', pest_control_method: 'F',
                weed_control_method: 'G', input_usage_history: 'H',
            },
            '7': {
                harvest_criteria: 'A', harvest_method: 'B', equipment_sanitation: 'C',
                harvest_time_of_day: 'D', cleaning_method: 'E', drying_method: 'F',
                sorting_criteria: 'G', moisture_content_target: 'H',
                packaging_material_type: 'I', storage_condition: 'J',
                warehouse_pest_control: 'K', stock_management_system: 'L',
            },
            '8': { files: [{ name: 'doc.pdf' }] },
            '9': {
                traceability_code_format: 'A', internal_audit_date: '2026-01-01',
                sample_retention_period: 'B', complaint_handling_procedure: 'C',
            },
        });

        it('passes with all steps complete', () => {
            const result = validateAllSteps(makeFullData());
            expect(result.isValid).toBe(true);
            expect(Object.keys(result.errorsByStep)).toHaveLength(0);
        });

        it('fails when step 8 has no files', () => {
            const data = makeFullData();
            data['8'] = { files: [] };
            const result = validateAllSteps(data);
            expect(result.isValid).toBe(false);
            expect(result.errorsByStep).toHaveProperty('8');
        });

        it('fails when step 1 is empty', () => {
            const data = makeFullData();
            data['1'] = {};
            const result = validateAllSteps(data);
            expect(result.isValid).toBe(false);
            expect(result.errorsByStep).toHaveProperty('1');
            expect(result.errorsByStep['1'].length).toBeGreaterThan(0);
        });

        it('returns empty errors for null/undefined input', () => {
            const result = validateAllSteps(null);
            expect(result.isValid).toBe(false);
        });

        it('each error has path and Thai message', () => {
            const result = validateAllSteps({ '1': {} });
            expect(result.isValid).toBe(false);
            const step1Errors = result.errorsByStep['1'];
            expect(step1Errors.length).toBeGreaterThan(0);
            for (const err of step1Errors) {
                expect(err).toHaveProperty('path');
                expect(err).toHaveProperty('message');
                expect(typeof err.message).toBe('string');
            }
        });
    });
});
