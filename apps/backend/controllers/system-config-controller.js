const { prisma } = require('../services/prisma-database');
const logger = require('../shared/logger');
const { respondError } = require('../shared/api-response');

const PUBLIC_CONFIG_KEYS = [
    'registration_open',
    'marketing_banner',
    'service_organic',
    'service_gacp',
    'relaxed_validation',
    // Feature flags — toggle ON/OFF จาก admin panel
    'feature.task_router',
    'feature.readiness_check',
    'feature.document_repo',
    'feature.sop_library',
    'feature.report_center',
    'feature.official_templates',
    'feature.export_documents',
];

function parseConfigValue(rawValue) {
    if (typeof rawValue === 'boolean') {
        return rawValue;
    }
    if (typeof rawValue === 'number') {
        return rawValue;
    }
    const text = String(rawValue ?? '').trim();
    if (text === '') {
        return rawValue;
    }

    const lower = text.toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(lower)) {
        return true;
    }
    if (['false', '0', 'no', 'off'].includes(lower)) {
        return false;
    }
    return rawValue;
}

/**
 * Get Public System Configurations
 * Returns simple key-value map for frontend context
 */
exports.getPublicConfigs = async (req, res) => {
    try {
        const configs = await prisma.systemConfig.findMany({
            where: { key: { in: PUBLIC_CONFIG_KEYS } },
        });

        // Transform to simple object: { key: value }
        const configMap = configs.reduce((acc, curr) => {
            acc[curr.key] = parseConfigValue(curr.value);
            return acc;
        }, {});

        // Canonical field for frontend runtime. Keep legacy alias fields for compatibility.
        const relaxedValidation = Boolean(configMap.relaxed_validation);
        configMap.relaxedValidation = relaxedValidation;
        configMap.enableRelaxedApplicationValidation = relaxedValidation;

        res.json({
            success: true,
            data: configMap,
        });
    } catch (error) {
        return respondError(res, req, error, { label: '[SystemConfig] get', message: 'Failed to fetch configurations' });
    }
};

/**
 * Get All Configurations (Admin View)
 * Returns full objects with metadata
 */
exports.getAllConfigs = async (req, res) => {
    try {
        // SystemConfig has columns (key, value, type, description, updatedBy,
        // updatedAt) — no `group` column. Earlier code ordered by a non-existent
        // field and silently 500'd on every admin GET /api/system-config.
        // The sister route at routes/api/admin/config.js orders by `key`;
        // mirror that for consistency.
        const configs = await prisma.systemConfig.findMany({
            orderBy: { key: 'asc' },
        });

        res.json({
            success: true,
            data: configs,
        });
    } catch (error) {
        return respondError(res, req, error, { label: '[SystemConfig]' });
    }
};

/**
 * Update Configuration (Admin Only)
 */
exports.updateConfig = async (req, res) => {
    const { key } = req.params;
    const { value } = req.body;

    try {
        const updated = await prisma.systemConfig.update({
            where: { key },
            data: {
                value,
                updatedBy: req.user ? req.user.id : 'ADMIN', // Assume Auth Middleware adds user
            },
        });

        res.json({
            success: true,
            message: 'Configuration updated',
            data: updated,
        });
    } catch (error) {
        return respondError(res, req, error, { label: '[SystemConfig]' });
    }
};

/**
 * Seed Default System Configurations
 * Used for initial setup and migrations
 */
exports.seedDefaultConfigs = async () => {
    const defaults = [
        { key: 'registration_open', value: 'true', description: 'Allow new user registrations', type: 'BOOLEAN' },
        { key: 'marketing_banner', value: 'false', description: 'Show promotional banner on dashboard', type: 'BOOLEAN' },
        { key: 'service_organic', value: 'false', description: 'Enable Organic Certification service', type: 'BOOLEAN' },
        { key: 'service_gacp', value: 'true', description: 'Enable GACP Certification service', type: 'BOOLEAN' },
        { key: 'relaxed_validation', value: 'false', description: 'Skip strict validation for testing', type: 'BOOLEAN' },
        // Feature flags
        { key: 'feature.task_router', value: 'true', description: 'แสดงหน้า Task Router (เลือกงานที่ต้องการทำ)', type: 'BOOLEAN' },
        { key: 'feature.readiness_check', value: 'true', description: 'แสดง Readiness Check ก่อนยื่นคำขอ', type: 'BOOLEAN' },
        { key: 'feature.document_repo', value: 'true', description: 'แสดงหน้าเอกสารของฉัน', type: 'BOOLEAN' },
        { key: 'feature.sop_library', value: 'false', description: 'แสดงหน้า SOP Library (ปิดไว้ก่อน)', type: 'BOOLEAN' },
        { key: 'feature.report_center', value: 'true', description: 'แสดงหน้าศูนย์รายงาน', type: 'BOOLEAN' },
        { key: 'feature.official_templates', value: 'true', description: 'ใช้ระบบ template เอกสารทางการ', type: 'BOOLEAN' },
        { key: 'feature.export_documents', value: 'false', description: 'แสดงเอกสารส่งออก (ปิดไว้ก่อน)', type: 'BOOLEAN' },
    ];

    for (const conf of defaults) {
        try {
            const existing = await prisma.systemConfig.findUnique({ where: { key: conf.key } });
            if (!existing) {
                await prisma.systemConfig.create({ data: conf });
                logger.info(`[SystemConfig] Seeded: ${conf.key}`);
            }
        } catch (error) {
            logger.error(`[SystemConfig] Failed to seed ${conf.key}:`, error.message);
        }
    }
};
