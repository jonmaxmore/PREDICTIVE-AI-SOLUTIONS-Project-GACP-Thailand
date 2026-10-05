const { prisma } = require('../services/prisma-database');
const logger = require('../shared/logger');
const { getZonedParts, localMonthRange } = require('../utils/working-days');

/**
 * Report Controller
 * Generates summary reports and KPI data for provider roles.
 * Used by: Admin, all roles (dashboard)
 */
const reportController = {
    /**
     * GET /api/provider/reports/summary
     * Monthly/quarterly summary of applications, audits, certificates
     */
    summary: async (req, res) => {
        try {
            const period = String(req.query.period || 'month').toLowerCase();
            const now = new Date();
            let startDate;

            // Bangkok month / quarter starts, not the process clock's.
            const nowBkk = getZonedParts(now);
            if (period === 'quarter') {
                const quarter = Math.floor((nowBkk.month - 1) / 3);
                startDate = localMonthRange(nowBkk.year, quarter * 3 + 1).start;
            } else {
                startDate = localMonthRange(nowBkk.year, nowBkk.month).start;
            }

            const [
                totalApplications,
                pendingReview,
                approvedCount,
                certifiedCount,
                rejectedCount,
            ] = await Promise.all([
                prisma.application.count({
                    where: { createdAt: { gte: startDate }, isDeleted: false },
                }),
                prisma.application.count({
                    where: {
                        status: { in: ['SUBMITTED', 'ASSIGNED_FOR_REVIEW'] },
                        isDeleted: false,
                    },
                }),
                prisma.application.count({
                    where: {
                        status: 'APPROVED',
                        updatedAt: { gte: startDate },
                        isDeleted: false,
                    },
                }),
                prisma.application.count({
                    where: {
                        status: 'CERTIFIED',
                        updatedAt: { gte: startDate },
                        isDeleted: false,
                    },
                }),
                prisma.application.count({
                    where: {
                        status: 'REJECTED',
                        updatedAt: { gte: startDate },
                        isDeleted: false,
                    },
                }),
            ]);

            // Revenue from the record that actually settles.
            //
            // This read PaymentTransaction rows with status SUCCESS and summed
            // `amount` raw. Two defects: PaymentTransaction is the card/PromptPay
            // gateway's table and nothing in the live bank-transfer path writes
            // to it, so the figure was zero for every month the platform has
            // taken money; and `amount` is SATANG (billing.prisma:318), so
            // summing it as baht is a 100x overstatement the moment a gateway is
            // enabled.
            //
            // Approved slips are what daily-cash-report-service and
            // bank-reconciliation-service both read, with the same fallback
            // chain, so all three reports reconcile to the same number.
            let revenueData = { totalRevenue: 0, transactionCount: 0 };
            try {
                // Stripe-only revenue (the bank-slip rail is retired): settled
                // revenue is the invoices marked paid in the window, whatever the
                // rail. Was revenueFromApprovedSlips over APPROVED PaymentSlip rows.
                const paidInvoices = await prisma.invoice.findMany({
                    where: {
                        paidAt: { gte: startDate },
                        isDeleted: false,
                    },
                    select: { totalAmount: true },
                });
                revenueData = {
                    totalRevenue: paidInvoices.reduce((sum, inv) => sum + Number(inv.totalAmount || 0), 0),
                    transactionCount: paidInvoices.length,
                };
            } catch (revenueError) {
                // Report the failure rather than silently returning zero — a
                // zero here reads as "no money came in this month", which is a
                // statement about DTAM's revenue, not about a failed query.
                logger.error(`[reports] revenue read failed: ${revenueError?.message}`);
                revenueData = { totalRevenue: null, transactionCount: null, unavailable: true };
            }

            return res.json({
                success: true,
                data: {
                    period,
                    startDate: startDate.toISOString(),
                    endDate: now.toISOString(),
                    applications: {
                        total: totalApplications,
                        pendingReview,
                        approved: approvedCount,
                        certified: certifiedCount,
                        rejected: rejectedCount,
                    },
                    revenue: revenueData,
                },
            });
        } catch (error) {
            logger.error('[Report Summary] Error:', error);
            return res.status(500).json({ success: false, error: 'Failed to generate summary report' });
        }
    },

    /**
     * GET /api/provider/reports/kpi
     * KPI metrics per role — calculates real averages from workflow data
     */
    kpi: async (req, res) => {
        try {
            const now = new Date();
            const nowBkk = getZonedParts(now);
            const monthStart = localMonthRange(nowBkk.year, nowBkk.month).start; // Bangkok month

            const [
                reviewedThisMonth,
                auditsScheduled,
                auditsCompleted,
                certificatesIssued,
            ] = await Promise.all([
                prisma.application.count({
                    where: {
                        status: { in: ['DOC_APPROVED', 'APPROVED', 'CERTIFIED'] },
                        updatedAt: { gte: monthStart },
                        isDeleted: false,
                    },
                }),
                prisma.application.count({
                    where: {
                        status: { in: ['AUDIT_CONFIRMED', 'AUDIT_FEE_PAID'] },
                        isDeleted: false,
                    },
                }),
                prisma.application.count({
                    where: {
                        status: 'AUDIT_PASSED',
                        updatedAt: { gte: monthStart },
                        isDeleted: false,
                    },
                }),
                prisma.application.count({
                    where: {
                        status: 'CERTIFIED',
                        updatedAt: { gte: monthStart },
                        isDeleted: false,
                    },
                }),
            ]);

            // Calculate average review days from actual data
            //
            // 2026-09-27 (class guard, fix round 1): `submittedAt` is not a column
            // on Application — only `healthId`/`applicant`, `createdAt`, `updatedAt`,
            // etc. (prisma/schema/application.prisma). The `try/catch` below always
            // hit the catch (Prisma rejects the `select`/`where` before any row is
            // read), so `avgReviewDays` was silently ALWAYS 0 — the same "select gap"
            // class as the reported bug, just swallowed instead of 500ing. The sibling
            // `avgAuditDays` block right below already uses `createdAt` as the
            // reference instant, and every serializer elsewhere in this codebase maps
            // `submittedAt: application.createdAt` for the same reason (Application has
            // no real submission timestamp column) — matching that convention here.
            let avgReviewDays = 0;
            try {
                const reviewedApps = await prisma.application.findMany({
                    where: {
                        status: { in: ['DOC_APPROVED', 'APPROVED', 'CERTIFIED'] },
                        updatedAt: { gte: monthStart },
                        isDeleted: false,
                    },
                    select: { createdAt: true, updatedAt: true },
                    take: 100,
                });
                if (reviewedApps.length > 0) {
                    const totalDays = reviewedApps.reduce((sum, app) => {
                        const diff = (app.updatedAt.getTime() - app.createdAt.getTime()) / (1000 * 60 * 60 * 24);
                        return sum + diff;
                    }, 0);
                    avgReviewDays = Math.round((totalDays / reviewedApps.length) * 10) / 10;
                }
            } catch {
                // fallback to 0
            }

            // Calculate average audit days from actual data
            let avgAuditDays = 0;
            try {
                const auditedApps = await prisma.application.findMany({
                    where: {
                        status: 'AUDIT_PASSED',
                        updatedAt: { gte: monthStart },
                        isDeleted: false,
                    },
                    select: { createdAt: true, updatedAt: true },
                    take: 100,
                });
                if (auditedApps.length > 0) {
                    const totalDays = auditedApps.reduce((sum, app) => {
                        const diff = (app.updatedAt.getTime() - app.createdAt.getTime()) / (1000 * 60 * 60 * 24);
                        return sum + diff;
                    }, 0);
                    avgAuditDays = Math.round((totalDays / auditedApps.length) * 10) / 10;
                }
            } catch {
                // fallback to 0
            }

            return res.json({
                success: true,
                data: {
                    month: nowBkk.isoDate.slice(0, 7),
                    reviewer: {
                        reviewedThisMonth,
                        avgReviewDays,
                    },
                    auditor: {
                        auditsScheduled,
                        auditsCompleted,
                        avgAuditDays,
                    },
                    overall: {
                        certificatesIssued,
                        approvalRate: reviewedThisMonth > 0
                            ? Math.round((certificatesIssued / reviewedThisMonth) * 100)
                            : 0,
                    },
                },
            });
        } catch (error) {
            logger.error('[Report KPI] Error:', error);
            return res.status(500).json({ success: false, error: 'Failed to generate KPI report' });
        }
    },
};

module.exports = reportController;
