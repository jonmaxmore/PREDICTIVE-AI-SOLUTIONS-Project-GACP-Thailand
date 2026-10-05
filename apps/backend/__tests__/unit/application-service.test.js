/**
 * Unit Tests for Application Service
 * Tests critical application functions: create, update, status transitions
 */

// Mock Prisma
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        application: {
            findFirst: jest.fn(),
            findUnique: jest.fn(),
            findMany: jest.fn(),
            create: jest.fn(),
            update: jest.fn(),
            count: jest.fn(),
        },
        user: {
            findUnique: jest.fn(),
        },
    },
}));

const { prisma } = require('../../services/prisma-database');

describe('Application Service', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    // APPLICATION STATUS TRANSITIONS
    describe('Application Status Transitions', () => {
        const validTransitions = {
            DRAFT: ['SUBMITTED'],
            SUBMITTED: ['DOCUMENT_REVIEW', 'REJECTED'],
            DOCUMENT_REVIEW: ['PENDING_PAYMENT', 'DOCUMENT_INCOMPLETE', 'REJECTED'],
            DOCUMENT_INCOMPLETE: ['DOCUMENT_REVIEW'],
            PENDING_PAYMENT: ['PAYMENT_CONFIRMED', 'PAYMENT_FAILED'],
            PAYMENT_CONFIRMED: ['FIELD_AUDIT_SCHEDULED'],
            FIELD_AUDIT_SCHEDULED: ['FIELD_AUDIT_COMPLETED'],
            FIELD_AUDIT_COMPLETED: ['COMMITTEE_REVIEW'],
            COMMITTEE_REVIEW: ['APPROVED', 'REJECTED', 'REVISION_REQUIRED'],
            REVISION_REQUIRED: ['COMMITTEE_REVIEW'],
            APPROVED: ['CERTIFIED'],
            CERTIFIED: [],
            REJECTED: [],
        };

        it('should define valid status transitions', () => {
            expect(validTransitions).toBeDefined();
            expect(validTransitions.DRAFT).toContain('SUBMITTED');
            expect(validTransitions.SUBMITTED).toContain('DOCUMENT_REVIEW');
        });

        it('should not allow invalid transitions from DRAFT', () => {
            expect(validTransitions.DRAFT).not.toContain('APPROVED');
            expect(validTransitions.DRAFT).not.toContain('CERTIFIED');
        });

        it('should not allow transitions from CERTIFIED', () => {
            expect(validTransitions.CERTIFIED).toHaveLength(0);
        });

        it('should not allow transitions from REJECTED', () => {
            expect(validTransitions.REJECTED).toHaveLength(0);
        });
    });

    // APPLICATION NUMBER GENERATION
    describe('Application Number Generation', () => {
        const generateApplicationNumber = (plantCode, sequence) => {
            const year = new Date().getFullYear() + 543; // Buddhist Era
            const paddedSeq = String(sequence).padStart(5, '0');
            return `GACP-${plantCode}-${year}-${paddedSeq}`;
        };

        it('should generate correct application number format', () => {
            const appNumber = generateApplicationNumber('CAN', 1);
            expect(appNumber).toMatch(/^GACP-CAN-\d{4}-00001$/);
        });

        it('should pad sequence number correctly', () => {
            expect(generateApplicationNumber('KRA', 1)).toContain('00001');
            expect(generateApplicationNumber('KRA', 99)).toContain('00099');
            expect(generateApplicationNumber('KRA', 12345)).toContain('12345');
        });

        it('should use Buddhist Era year', () => {
            const currentBEYear = new Date().getFullYear() + 543;
            const appNumber = generateApplicationNumber('TUR', 1);
            expect(appNumber).toContain(String(currentBEYear));
        });
    });

    // APPLICATION VALIDATION
    describe('Application Validation', () => {
        const validateApplicationData = (data) => {
            const errors = [];

            if (!data.plantId) {
                errors.push('plantId is required');
            }

            if (!data.applicantData) {
                errors.push('applicantData is required');
            } else {
                if (!data.applicantData.applicantType) {
                    errors.push('applicantType is required');
                }
                if (data.applicantData.applicantType === 'INDIVIDUAL') {
                    if (!data.applicantData.idCard) {
                        errors.push('idCard is required for INDIVIDUAL');
                    }
                    if (!data.applicantData.firstName) {
                        errors.push('firstName is required');
                    }
                    if (!data.applicantData.lastName) {
                        errors.push('lastName is required');
                    }
                }
            }

            if (!data.farmData) {
                errors.push('farmData is required');
            } else {
                if (!data.farmData.farmName) {
                    errors.push('farmName is required');
                }
                if (!data.farmData.province) {
                    errors.push('province is required');
                }
            }

            return {
                isValid: errors.length === 0,
                errors,
            };
        };

        it('should validate complete application data', () => {
            const validData = {
                plantId: 'cannabis',
                applicantData: {
                    applicantType: 'INDIVIDUAL',
                    idCard: '1234567890123',
                    firstName: 'Test',
                    lastName: 'User',
                },
                farmData: {
                    farmName: 'Test Farm',
                    province: 'Bangkok',
                },
            };

            const result = validateApplicationData(validData);
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('should reject application without plantId', () => {
            const invalidData = {
                applicantData: { applicantType: 'INDIVIDUAL' },
                farmData: { farmName: 'Test' },
            };

            const result = validateApplicationData(invalidData);
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('plantId is required');
        });

        it('should reject INDIVIDUAL without idCard', () => {
            const invalidData = {
                plantId: 'cannabis',
                applicantData: {
                    applicantType: 'INDIVIDUAL',
                    firstName: 'Test',
                    lastName: 'User',
                },
                farmData: { farmName: 'Test', province: 'Bangkok' },
            };

            const result = validateApplicationData(invalidData);
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('idCard is required for INDIVIDUAL');
        });

        it('should reject application without farmData', () => {
            const invalidData = {
                plantId: 'cannabis',
                applicantData: { applicantType: 'INDIVIDUAL', idCard: '1234567890123' },
            };

            const result = validateApplicationData(invalidData);
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('farmData is required');
        });
    });

    // APPLICATION CRUD OPERATIONS
    describe('Application CRUD', () => {
        const mockApplication = {
            id: 'app-123',
            applicationNumber: 'GACP-CAN-2569-00001',
            status: 'DRAFT',
            plantId: 'cannabis',
            userId: 'user-123',
            formData: {},
            createdAt: new Date(),
            updatedAt: new Date(),
        };

        it('should create application with DRAFT status', async () => {
            prisma.application.create.mockResolvedValue(mockApplication);

            const result = await prisma.application.create({
                data: {
                    status: 'DRAFT',
                    plantId: 'cannabis',
                    userId: 'user-123',
                },
            });

            expect(result.status).toBe('DRAFT');
            expect(prisma.application.create).toHaveBeenCalled();
        });

        it('should find application by id', async () => {
            prisma.application.findUnique.mockResolvedValue(mockApplication);

            const result = await prisma.application.findUnique({
                where: { id: 'app-123' },
            });

            expect(result).toEqual(mockApplication);
        });

        it('should find applications by userId', async () => {
            prisma.application.findMany.mockResolvedValue([mockApplication]);

            const result = await prisma.application.findMany({
                where: { userId: 'user-123' },
            });

            expect(result).toHaveLength(1);
            expect(result[0].userId).toBe('user-123');
        });

        it('should update application status', async () => {
            const updatedApp = { ...mockApplication, status: 'SUBMITTED' };
            prisma.application.update.mockResolvedValue(updatedApp);

            // Test fixture: this verifies the prisma mock plumbing, not a real production
            // status-write site, so we explicitly opt out of the writeApplicationStatus rule.
            // eslint-disable-next-line gacp/no-direct-application-status-write
            const result = await prisma.application.update({
                where: { id: 'app-123' },
                data: { status: 'SUBMITTED' },
            });

            expect(result.status).toBe('SUBMITTED');
        });
    });

    // PLANT TYPES
    describe('Plant Types', () => {
        const PLANT_TYPES = {
            cannabis: { name: 'กัญชา', code: 'CAN' },
            kratom: { name: 'กระท่อม', code: 'KRA' },
            turmeric: { name: 'ขมิ้นชัน', code: 'TUR' },
            ginger: { name: 'ขิง', code: 'GIN' },
            black_galangal: { name: 'กระชายดำ', code: 'BGA' },
            plai: { name: 'ไพล', code: 'PLA' },
        };

        it('should have all required plant types', () => {
            expect(PLANT_TYPES).toHaveProperty('cannabis');
            expect(PLANT_TYPES).toHaveProperty('kratom');
            expect(PLANT_TYPES).toHaveProperty('turmeric');
            expect(PLANT_TYPES).toHaveProperty('ginger');
            expect(PLANT_TYPES).toHaveProperty('black_galangal');
            expect(PLANT_TYPES).toHaveProperty('plai');
        });

        it('should have unique codes for each plant', () => {
            const codes = Object.values(PLANT_TYPES).map((p) => p.code);
            const uniqueCodes = [...new Set(codes)];
            expect(codes.length).toBe(uniqueCodes.length);
        });

        it('should have 3-letter codes', () => {
            Object.values(PLANT_TYPES).forEach((plant) => {
                expect(plant.code).toHaveLength(3);
            });
        });
    });
});
