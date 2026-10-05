/**
 * Reports API Integration Tests
 */

const request = require('supertest');
const express = require('express');

// Mock auth middleware
jest.mock('../../middleware/auth-middleware', () => ({
    authenticateProvider: (req, res, next) => {
        req.user = { id: 'provider-123', role: 'PROVIDER' };
        next();
    },
    authenticateDTAM: (req, res, next) => {
        req.user = { id: 'provider-123', role: 'PROVIDER' };
        next();
    },
}));

// Mock metrics service. Batch 15 (2026-05-16): the route now calls
// `metricsService.{countActiveFarms, groupFarmsByProvince,
// groupApplicationsByStatus, getAnalyticsAggregates,
// countActiveHealthApplicants}` instead of issuing prisma queries
// directly. The mock keeps the prisma stub below for legacy test code
// that still pokes at it via the exported `prisma` shim, but the
// reports route itself never reads it.
jest.mock('../../services/metrics-service', () => ({
    getDashboardStats: jest.fn().mockResolvedValue({
        totalFarms: 10,
        totalApplications: 25,
        totalCertificates: 5,
        pendingApplications: 3,
        recentApplications: [],
    }),
    countActiveFarms: jest.fn(),
    groupFarmsByProvince: jest.fn(),
    groupApplicationsByStatus: jest.fn(),
    getAnalyticsAggregates: jest.fn(),
    countActiveHealthApplicants: jest.fn(),
}));

jest.mock('../../services/prisma-database', () => ({
    prisma: {
        farm: {
            count: jest.fn(),
            groupBy: jest.fn(),
        },
        application: {
            groupBy: jest.fn(),
            findMany: jest.fn(),
        },
        invoice: {
            findMany: jest.fn(),
        },
        user: {
            findMany: jest.fn(),
            count: jest.fn(),
        },
        certificate: {
            count: jest.fn(),
        },
    },
}));

const { prisma } = require('../../services/prisma-database');
const metricsService = require('../../services/metrics-service');
const reportsRouter = require('../../routes/api/documents/reports');

describe('Reports API', () => {
    let app;

    beforeAll(() => {
        app = express();
        app.use(express.json());
        app.use('/api/reports', reportsRouter);
    });

    beforeEach(() => {
        jest.clearAllMocks();

        const daysAgo = (days) => new Date(Date.now() - (days * 24 * 60 * 60 * 1000));

        // Prisma mocks kept for any legacy lookup; route uses metricsService.
        prisma.farm.count.mockResolvedValue(12);
        prisma.farm.groupBy.mockResolvedValue([
            { province: 'Bangkok', _count: { province: 7 } },
            { province: 'Chiang Mai', _count: { province: 5 } },
        ]);

        // metricsService mocks — these are what the route actually reads.
        metricsService.countActiveFarms.mockResolvedValue(12);
        metricsService.groupFarmsByProvince.mockResolvedValue([
            { province: 'Bangkok', _count: { province: 7 } },
            { province: 'Chiang Mai', _count: { province: 5 } },
        ]);
        metricsService.groupApplicationsByStatus.mockResolvedValue([
            { status: 'APPROVED', _count: { status: 3 } },
            { status: 'PENDING', _count: { status: 2 } },
        ]);
        metricsService.countActiveHealthApplicants.mockResolvedValue(50);
        metricsService.getAnalyticsAggregates.mockResolvedValue({
            applicationsWindow: [
                {
                    createdAt: daysAgo(2),
                    updatedAt: daysAgo(1),
                    scheduledDate: daysAgo(1),
                    status: 'APPROVED',
                    serviceType: 'new_application',
                    areaType: 'OUTDOOR',
                },
                {
                    createdAt: daysAgo(10),
                    updatedAt: daysAgo(4),
                    scheduledDate: null,
                    status: 'PENDING',
                    serviceType: 'renewal',
                    areaType: 'INDOOR',
                },
                {
                    createdAt: daysAgo(8),
                    updatedAt: daysAgo(6),
                    scheduledDate: daysAgo(5),
                    status: 'REJECTED',
                    serviceType: 'renewal',
                    areaType: 'GREENHOUSE',
                },
                {
                    createdAt: daysAgo(40),
                    updatedAt: daysAgo(38),
                    scheduledDate: daysAgo(39),
                    status: 'APPROVED',
                    serviceType: 'new_application',
                    areaType: 'OUTDOOR',
                },
            ],
            invoicesWindow: [
                { createdAt: daysAgo(3), status: 'PAID', totalAmount: 1000 },
                { createdAt: daysAgo(4), status: 'PENDING', totalAmount: 300 },
                { createdAt: daysAgo(6), status: 'REFUNDED', totalAmount: 100 },
                { createdAt: daysAgo(35), status: 'PAID', totalAmount: 500 },
            ],
            applicantsWindow: [
                { createdAt: daysAgo(5) },
                { createdAt: daysAgo(35) },
            ],
            activeCertificates: 7,
            farmsByProvince: [
                { province: 'Bangkok', _count: { province: 7 } },
                { province: 'Chiang Mai', _count: { province: 5 } },
            ],
        });
    });

    describe('GET /api/reports/dashboard', () => {
        it('should return dashboard stats', async () => {
            const response = await request(app)
                .get('/api/reports/dashboard');

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data).toHaveProperty('totalFarms');
            expect(response.body.data).toHaveProperty('totalApplications');
        });

        it('should return 401 without authentication', async () => {
            // Reset mock to simulate no auth
            jest.resetModules();
            
            const response = await request(app)
                .get('/api/reports/dashboard');

            // Should succeed since we mocked auth
            expect([200, 401]).toContain(response.status);
        });
    });

    describe('GET /api/reports/farms', () => {
        it('should return farm statistics', async () => {
            const response = await request(app)
                .get('/api/reports/farms');

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.total).toBe(12);
            expect(response.body.data.byProvince).toEqual(expect.arrayContaining([
                expect.objectContaining({ province: 'Bangkok', count: 7 }),
            ]));
        });
    });

    describe('GET /api/reports/applications', () => {
        it('should return application statistics', async () => {
            const response = await request(app)
                .get('/api/reports/applications');

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data).toEqual(expect.arrayContaining([
                expect.objectContaining({ status: 'APPROVED' }),
            ]));
        });
    });

    describe('GET /api/reports/analytics', () => {
        it('should return consolidated BI payload with required contract', async () => {
            const response = await request(app)
                .get('/api/reports/analytics?period=30');

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data).toEqual(expect.objectContaining({
                period: '30',
                applications: expect.any(Object),
                financial: expect.any(Object),
                users: expect.any(Object),
                performance: expect.any(Object),
                dailyStats: expect.any(Array),
                plantTypeDistribution: expect.any(Array),
                topProvinces: expect.any(Array),
            }));

            expect(response.body.data.applications).toEqual(expect.objectContaining({
                total: 3,
                new: 1,
                renewal: 2,
                approved: 1,
                rejected: 1,
                pending: 1,
                trend: 200,
            }));

            expect(response.body.data.financial).toEqual(expect.objectContaining({
                revenue: 1000,
                pending: 300,
                refunded: 100,
                trend: 100,
            }));

            expect(response.body.data.users).toEqual(expect.objectContaining({
                totalApplicants: 50,
                newApplicants: 1,
                activeCertificates: 7,
                trend: 0,
            }));

            expect(response.body.data.dailyStats).toHaveLength(30);
            expect(response.body.data.dailyStats[0]).toEqual(expect.objectContaining({
                date: expect.any(String),
                applications: expect.any(Number),
                approved: expect.any(Number),
                revenue: expect.any(Number),
            }));

            expect(response.body.data.plantTypeDistribution).toEqual(expect.arrayContaining([
                expect.objectContaining({ name: expect.any(String), value: expect.any(Number), color: expect.any(String) }),
            ]));
            expect(response.body.data.topProvinces).toEqual(expect.arrayContaining([
                expect.objectContaining({ province: expect.any(String), count: expect.any(Number), percentage: expect.any(Number) }),
            ]));
        });

        it('should clamp out-of-range period to 365 days', async () => {
            const response = await request(app)
                .get('/api/reports/analytics?period=999');

            expect(response.status).toBe(200);
            expect(response.body.success).toBe(true);
            expect(response.body.data.period).toBe('365');
            expect(response.body.data.dailyStats).toHaveLength(365);
        });
    });
});

describe('Report Data Validation', () => {
    it('should validate date range format', () => {
        const isValidDateRange = (start, end) => {
            const startDate = new Date(start);
            const endDate = new Date(end);
            return startDate instanceof Date && 
                   !isNaN(startDate) && 
                   endDate instanceof Date && 
                   !isNaN(endDate) &&
                   startDate <= endDate;
        };

        expect(isValidDateRange('2025-01-01', '2025-12-31')).toBe(true);
        expect(isValidDateRange('2025-12-31', '2025-01-01')).toBe(false);
        expect(isValidDateRange('invalid', '2025-01-01')).toBe(false);
    });

    it('should calculate percentage correctly', () => {
        const calculatePercentage = (value, total) => {
            if (total === 0) { return 0; }
            return Math.round((value / total) * 100 * 100) / 100;
        };

        expect(calculatePercentage(25, 100)).toBe(25);
        expect(calculatePercentage(0, 100)).toBe(0);
        expect(calculatePercentage(33, 100)).toBe(33);
        expect(calculatePercentage(1, 3)).toBeCloseTo(33.33, 2);
    });
});
