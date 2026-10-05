const express = require('express');
const router = express.Router();
const { authenticateProvider } = require('../../../middleware/auth-middleware');
const { requireAdmin } = require('../../../middleware/require-admin');
const logger = require('../../../shared/logger'); // C4-04: log cause before generic 500

// Protect all admin routes: authenticate provider identity then enforce admin role
router.use(authenticateProvider);
router.use(requireAdmin);

// Sub-modules
router.use('/config', require('./config')); // System Configuration (Pricing/Rules)
router.use('/plants', require('./plants')); // Plant Master Data
router.use('/users', require('./users'));   // User Management
router.use('/user-permissions', require('./user-permissions')); // Per-user permission GRANT/REVOKE
router.use('/applications', require('./applications')); // Application override controls
router.use('/planting-cycles', require('./planting')); // Read-only planting trace for admin
router.use('/audit-log', require('./audit-log')); // Iter 28 — admin audit-log viewer
router.use('/requirement-rules', require('./requirement-rules')); // M2a — document law as dated data (G2)
router.use('/certificates', require('./certificates')); // Admin revoke door (per-tenant, never crossTenant)
router.use('/lots', require('./lots')); // Lot recall door — รายงาน 5 ฝ่าย ข้อ 2 (2026-09-07)

// Admin Analytics
router.get('/analytics', async (req, res) => {
    try {
        const { prisma } = require('../../../services/prisma-database');
        const [totalUsers, totalApps, totalCerts, totalFarms] = await Promise.all([
            prisma.user.count({ where: { isDeleted: false } }),
            prisma.application.count({ where: { isDeleted: false } }),
            prisma.certificate.count().catch(() => 0),
            prisma.farm.count({ where: { isDeleted: false } }),
        ]);
        return res.json({
            success: true,
            data: { totalUsers, totalApplications: totalApps, totalCertificates: totalCerts, totalFarms },
        });
    } catch (error) {
        logger.error('[admin] analytics load failed:', error?.message); // C4-04
        return res.status(500).json({ success: false, error: 'Failed to load analytics' });
    }
});

router.get('/health', (req, res) => {
    res.json({ success: true, message: 'Admin API operational' });
});

module.exports = router;
