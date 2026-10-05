/**
 * Master Data Routes - GACP Configuration Data
 * Professional API structure for ระบบรับรองมาตรฐาน GACP สมุนไพร (DTAM)
 * 
 * Provides master data for:
 * - Certification purposes (วัตถุประสงค์การรับรอง)
 * - Cultivation methods (ระบบการปลูก)
 * - Farm layouts (รูปแบบแปลงปลูก)
 * - Growing styles (รูปแบบการปลูก)
 * - Document requirements (เอกสารที่ต้องใช้)
 * - Security requirements (ข้อกำหนดความปลอดภัย)
 */

const express = require('express');
const router = express.Router();
const JourneyController = require('../../../controllers/journey-controller');

// MASTER DATA ENDPOINTS

// Root handler — returns available cultivation config endpoints
router.get('/', (req, res) => {
    res.json({
        success: true,
        data: {
            availableEndpoints: [
                '/cultivation-config/certification-purposes',
                '/cultivation-config/cultivation-methods',
                '/cultivation-config/farm-layouts',
                '/cultivation-config/growing-styles',
                '/cultivation-config/document-requirements',
                '/cultivation-config/security-requirements',
                '/cultivation-config/full-config',
                '/cultivation-config/gacp-categories',
                '/cultivation-config/environment-checklist',
                '/cultivation-config/water-sources',
                '/cultivation-config/soil-types',
                '/cultivation-config/seed-sources',
                '/cultivation-config/ipm-methods',
            ],
            description: 'GACP Cultivation Configuration Master Data API',
        },
    });
});

// Certification Purposes (วัตถุประสงค์การรับรอง)
router.get('/certification-purposes', JourneyController.getPurposes);

// Cultivation Methods (ระบบการปลูก)
router.get('/cultivation-methods', JourneyController.getCultivationMethods);

// Farm Layouts (รูปแบบแปลงปลูก)
// Query: ?cultivationMethod=outdoor|greenhouse|indoor
router.get('/farm-layouts', JourneyController.getFarmLayouts);

// Growing Styles (รูปแบบการปลูก - Indoor only)
router.get('/growing-styles', JourneyController.getGrowingStyles);

// Document Requirements (เอกสารที่ต้องใช้)
router.get('/document-requirements', JourneyController.getDocumentDefinitions);

// Security Requirements (ข้อกำหนดความปลอดภัย)
router.get('/security-requirements', JourneyController.getSecurityDefinitions);

// Full Configuration (สำหรับ Frontend Initialization)
router.get('/full-config', JourneyController.getFullConfig);

// GACP STANDARD ENDPOINTS

// GACP 14 Categories (หมวดหมู่ GACP)
router.get('/gacp-categories', JourneyController.getGACPCategories);

// Environment Checklist (สำหรับ Step 4)
router.get('/environment-checklist', JourneyController.getEnvironmentChecklist);

// Water Sources (แหล่งน้ำ)
router.get('/water-sources', JourneyController.getWaterSources);

// Step Requirements (ข้อกำหนด GACP ต่อ Step)
router.get('/step-requirements/:stepNumber', JourneyController.getStepRequirements);

// STEP 5: PLOTS ENDPOINTS

// Soil Types (ประเภทดิน)
router.get('/soil-types', JourneyController.getSoilTypes);

// Seed Sources (แหล่งเมล็ดพันธุ์)
router.get('/seed-sources', JourneyController.getSeedSources);

// IPM Methods (การป้องกันศัตรูพืช)
router.get('/ipm-methods', JourneyController.getIPMMethods);

module.exports = router;
