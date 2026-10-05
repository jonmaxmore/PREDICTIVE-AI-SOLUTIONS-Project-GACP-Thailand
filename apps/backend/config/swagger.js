const swaggerJsdoc = require('swagger-jsdoc');
const path = require('path');

const options = {
    definition: {
        openapi: '3.0.0',
        info: {
            title: 'GACP Certification API',
            version: '3.0.0',
            description: `
## GACP Certification Platform API

API Documentation สำหรับระบบรับรองมาตรฐาน GACP (Good Agricultural and Collection Practices)

### Features:
- 🌱 **Plants** - จัดการข้อมูลพืชสมุนไพร
- 🌾 **Harvest Batches** - ติดตาม Lot และ Traceability
- 📋 **Config** - เทมเพลตแบบฟอร์มและมาตรฐาน
- ✅ **Validation** - ตรวจสอบก่อนยื่นใบสมัคร
- 🔐 **Auth** - ระบบ Authentication

### Thai ID Validation:
รองรับการตรวจสอบเลขบัตรประชาชนไทย 13 หลักตามมาตรฐานกระทรวงมหาดไทย
            `,
            contact: {
                name: 'GACP Support',
                email: 'support@gacp.com',
            },
        },
        servers: [
            {
                url: 'https://gacpth.com',
                description: 'Production Server',
            },
            {
                url: 'http://localhost:8000',
                description: 'Development Server',
            },
        ],
        tags: [
            { name: 'Auth', description: 'Authentication and user management' },
            { name: 'Admin', description: 'Admin CMS routes (requires admin role)' },
            { name: 'Farms', description: 'Farm management' },
            { name: 'PlantingCycles', description: 'Planting cycle management' },
            { name: 'HarvestBatches', description: 'Harvest batch and lot tracking' },
            { name: 'Certificates', description: 'GACP certificate management' },
            { name: 'Applications', description: 'GACP application management' },
            { name: 'Payments', description: 'Payment processing and webhook handling' },
            { name: 'Quotes', description: 'Quote management and invoice generation (requires finance role)' },
            { name: 'Cron', description: 'Cron job endpoints (requires CRON_SECRET header)' },
            { name: 'Lab', description: 'Lab integration and webhook callbacks (requires LAB_API_KEY)' },
            { name: 'Trace', description: 'Public QR traceability API' },
            { name: 'Config', description: 'Configuration endpoints (document slots, templates, standards, pricing)' },
            { name: 'Plants', description: 'Plant species management' },
            { name: 'Validation', description: 'Pre-submission validation' },
        ],
        components: {
            securitySchemes: {
                BearerAuth: {
                    type: 'http',
                    scheme: 'bearer',
                    bearerFormat: 'JWT',
                    description: 'JWT token from /api/auth/health/login or /api/auth/provider/login',
                },
                ApiKeyAuth: {
                    type: 'apiKey',
                    in: 'header',
                    name: 'x-api-key',
                    description: 'API key for M2M callbacks (lab webhooks). Set via LAB_API_KEY env var.',
                },
                CronSecret: {
                    type: 'apiKey',
                    in: 'header',
                    name: 'x-cron-secret',
                    description: 'Secret token for cron job endpoints. Set via CRON_SECRET env var.',
                },
            },
            schemas: {
                PlantSpecies: {
                    type: 'object',
                    properties: {
                        id: { type: 'integer' },
                        uuid: { type: 'string', format: 'uuid' },
                        thaiName: { type: 'string', example: 'กัญชา' },
                        scientificName: { type: 'string', example: 'Cannabis sativa L.' },
                        englishName: { type: 'string', example: 'Cannabis' },
                        gacpCategory: { type: 'string', enum: ['CONTROLLED', 'MEDICINAL', 'ORNAMENTAL'] },
                        cultivationType: { type: 'string', enum: ['SELF_GROWN', 'CONTRACT_FARMING', 'PURCHASED'] },
                    },
                },
                HarvestBatch: {
                    type: 'object',
                    properties: {
                        id: { type: 'integer' },
                        uuid: { type: 'string', format: 'uuid' },
                        batchNumber: { type: 'string', example: 'LOT-ABC12345-2025-001' },
                        farmId: { type: 'integer' },
                        speciesId: { type: 'integer' },
                        plantingDate: { type: 'string', format: 'date' },
                        harvestDate: { type: 'string', format: 'date' },
                        status: { type: 'string', enum: ['PLANNED', 'GROWING', 'HARVESTED', 'PROCESSING', 'COMPLETED'] },
                        actualYield: { type: 'number', example: 150.5 },
                        yieldUnit: { type: 'string', example: 'kg' },
                        qualityGrade: { type: 'string', enum: ['A', 'B', 'C', 'REJECTED'] },
                    },
                },
                PreSubmissionValidation: {
                    type: 'object',
                    properties: {
                        isReady: { type: 'boolean' },
                        completionPercentage: { type: 'integer', example: 75 },
                        sections: {
                            type: 'array',
                            items: {
                                type: 'object',
                                properties: {
                                    name: { type: 'string' },
                                    percentage: { type: 'integer' },
                                    missing: { type: 'array', items: { type: 'object' } },
                                },
                            },
                        },
                        missingRequired: { type: 'array', items: { type: 'object' } },
                        warnings: { type: 'array', items: { type: 'object' } },
                    },
                },
                DocumentSlot: {
                    type: 'object',
                    properties: {
                        slotId: { type: 'string', example: 'license_bt11' },
                        name: { type: 'string', example: 'ใบอนุญาต บท.11' },
                        description: { type: 'string' },
                        required: { type: 'boolean' },
                        conditionalRequired: { type: 'boolean' },
                    },
                },
                User: {
                    type: 'object',
                    properties: {
                        id: { type: 'string', description: 'User ID' },
                        email: { type: 'string', format: 'email' },
                        firstName: { type: 'string' },
                        lastName: { type: 'string' },
                        role: { type: 'string', enum: ['health', 'auditor', 'admin'] },
                        status: { type: 'string', enum: ['pending', 'active', 'suspended'] },
                    },
                },
                // The PlantUnit and PlantUnitLifecycle schemas, and the PlantUnits
                // tag above, were removed on 2026-08-25. R8 of
                // design note 2026-08-20-planting-tnt-design retires
                // per-plant tracking and the 16-endpoint router they documented was
                // deleted with it. A schema left in the published spec is a promise
                // to every client that generates code from it.
            },
        },
        security: [
            {
                BearerAuth: [],
            },
        ],
    },
    apis: [
        path.join(__dirname, '../routes/**/*.js'),
        path.join(__dirname, '../controllers/**/*.js'),
        path.join(__dirname, '../server.js'),
    ],
};

const swaggerSpec = swaggerJsdoc(options);

module.exports = swaggerSpec;
