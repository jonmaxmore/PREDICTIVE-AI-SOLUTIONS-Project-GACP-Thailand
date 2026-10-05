/**
 * InvoiceRepository — Concrete repository for Invoice model.
 *
 * Extends BaseRepository with invoice-specific query methods.
 * Demonstrates Repository Pattern adoption beyond ApplicationRepository.
 *
 * @module services/repositories/invoice-repository
 */

const BaseRepository = require('./base-repository');
const { BILLING_APPLICATION_SELECT } = require('../finance/billing-select');

class InvoiceRepository extends BaseRepository {
    constructor() {
        super('invoice');
    }

    /**
     * Find invoices by application ID.
     */
    async findByApplicationId(applicationId) {
        return this.findMany({
            where: { applicationId, isDeleted: false },
            orderBy: { createdAt: 'desc' },
        });
    }

    /**
     * Find invoices by health/applicant ID.
     */
    async findByHealthId(healthId, options = {}) {
        const { status, limit = 50 } = options;
        const where = { healthId, isDeleted: false };
        if (status) {
            where.status = typeof status === 'string' ? status : status;
        }
        return this.findMany({
            where,
            orderBy: { createdAt: 'desc' },
            take: limit,
        });
    }

    /**
     * Find invoices by payment status group.
     */
    async findByStatusGroup(statusGroup, options = {}) {
        const statusMap = {
            pending: { in: ['pending', 'PENDING'] },
            paid: { in: ['PAID', 'PAID_PENDING_RECEIPT', 'RECEIPT_ISSUED', 'paid'] },
            overdue: { in: ['overdue', 'OVERDUE'] },
            held: 'HELD',
        };

        const statusFilter = statusMap[statusGroup] || statusGroup;
        return this.findMany({
            where: { status: statusFilter, isDeleted: false },
            orderBy: { createdAt: 'desc' },
            take: options.limit || 50,
            include: options.include,
        });
    }

    /**
     * Find invoices pending receipt issuance.
     */
    async findPendingReceipts() {
        return this.findMany({
            where: {
                status: { in: ['paid', 'PAID', 'PAID_PENDING_RECEIPT'] },
                receiptNumber: null,
                isDeleted: false,
            },
            orderBy: { paidAt: 'asc' },
            // Wave D Phase 5a — applicant.companyName deprecated; canonical
            // display name is Application.entity.displayName (Wave B/C).
            include: {
                applicant: {
                    select: { firstName: true, lastName: true },
                },
                application: BILLING_APPLICATION_SELECT,
            },
        });
    }

    /**
     * Find invoices with receipts already issued.
     */
    async findIssuedReceipts(limit = 100) {
        return this.findMany({
            where: {
                isDeleted: false,
                OR: [
                    { status: 'RECEIPT_ISSUED' },
                    { receiptNumber: { not: null } },
                ],
            },
            orderBy: { receiptIssuedAt: 'desc' },
            take: limit,
            // Wave D Phase 5a — applicant.companyName deprecated; canonical
            // display name is Application.entity.displayName (Wave B/C).
            include: {
                applicant: {
                    select: { firstName: true, lastName: true },
                },
                application: BILLING_APPLICATION_SELECT,
            },
        });
    }

    /**
     * Get aggregate revenue statistics.
     */
    async getRevenueStats(dateRange = {}) {
        const where = { isDeleted: false };
        if (dateRange.startDate && dateRange.endDate) {
            where.createdAt = {
                gte: new Date(dateRange.startDate),
                lte: new Date(dateRange.endDate),
            };
        }

        const paidStatuses = ['paid', 'PAID', 'PAID_PENDING_RECEIPT', 'RECEIPT_ISSUED'];

        const [totalPaid, totalPending, totalOverdue, counts] = await Promise.all([
            this.prisma.invoice.aggregate({
                _sum: { totalAmount: true },
                where: { ...where, status: { in: paidStatuses } },
            }),
            this.prisma.invoice.aggregate({
                _sum: { totalAmount: true },
                where: { ...where, status: { in: ['pending', 'PENDING'] } },
            }),
            this.prisma.invoice.aggregate({
                _sum: { totalAmount: true },
                where: { ...where, status: { in: ['overdue', 'OVERDUE'] } },
            }),
            Promise.all([
                this.prisma.invoice.count({ where }),
                this.prisma.invoice.count({ where: { ...where, status: { in: ['pending', 'PENDING'] } } }),
                this.prisma.invoice.count({ where: { ...where, status: { in: paidStatuses } } }),
                this.prisma.invoice.count({ where: { ...where, status: { in: ['overdue', 'OVERDUE'] } } }),
            ]),
        ]);

        return {
            totalRevenue: totalPaid._sum?.totalAmount || 0,
            pendingAmount: totalPending._sum?.totalAmount || 0,
            overdueAmount: totalOverdue._sum?.totalAmount || 0,
            invoiceCount: {
                total: counts[0],
                pending: counts[1],
                paid: counts[2],
                overdue: counts[3],
            },
        };
    }
}

module.exports = new InvoiceRepository();
