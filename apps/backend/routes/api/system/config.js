const express = require('express');
const { respondError } = require('../../../shared/api-response');
const router = express.Router();
const {
    DOCUMENT_SLOTS,
    getRequiredDocuments,
} = require('../../../constants/document-slots');
const { CERTIFICATION_PURPOSES } = require('../../../shared/certification-purposes');
const cannabisTemplatesData = [];

// Root handler — returns summary of available config endpoints
router.get('/', (req, res) => {
    res.json({
        success: true,
        data: {
            availableEndpoints: [
                '/config/document-slots',
                '/config/templates',
                '/config/standards',
                '/config/service-types',
                '/config/purposes',
                '/config/cultivation-methods',
                '/config/farm-types',
                '/config/area-types',
                '/config/applicant-types',
                '/config/plants',
                '/config/provinces',
            ],
            description: 'GACP System Configuration API',
        },
    });
});

router.get('/document-slots', (req, res) => {
    try {
        const slots = Object.entries(DOCUMENT_SLOTS).map(([key, slot]) => ({
            key,
            ...slot,
        }));
        res.json({
            success: true,
            count: slots.length,
            data: slots,
        });
    } catch (error) {
        return respondError(res, req, error);
    }
});
router.get('/document-slots/required', (req, res) => {
    try {
        const { plantType, objectives, applicantType } = req.query;
        const objectivesArray = objectives
            ? (Array.isArray(objectives) ? objectives : objectives.split(','))
            : [];
        const requiredDocs = getRequiredDocuments({
            plantType: plantType || 'general',
            objectives: objectivesArray,
            applicantType: applicantType || 'INDIVIDUAL',
        });
        res.json({
            success: true,
            count: requiredDocs.length,
            query: { plantType, objectives: objectivesArray, applicantType },
            data: requiredDocs,
        });
    } catch (error) {
        return respondError(res, req, error);
    }
});
router.get('/templates', (req, res) => {
    try {
        const templates = cannabisTemplatesData;
        const templateList = templates.map((t, index) => ({
            id: index,
            title: t.template?.title,
            titleTH: t.template?.titleTH,
            type: t.template?.cannabisMetadata?.surveyType,
            questionCount: t.questions?.length || 0,
            status: t.template?.status,
        }));
        res.json({
            success: true,
            count: templateList.length,
            data: templateList,
        });
    } catch (error) {
        return respondError(res, req, error);
    }
});
router.get('/templates/:type', (req, res) => {
    try {
        const { type } = req.params;
        const templates = cannabisTemplatesData;
        const template = templates.find(t =>
            t.template?.cannabisMetadata?.surveyType === type,
        );
        if (!template) {
            return res.status(404).json({
                success: false,
                error: `Template type '${type}' not found`,
                availableTypes: templates.map(t => t.template?.cannabisMetadata?.surveyType),
            });
        }
        res.json({
            success: true,
            data: {
                template: template.template,
                questions: template.questions,
            },
        });
    } catch (error) {
        return respondError(res, req, error);
    }
});
router.get('/templates/:type/questions', (req, res) => {
    try {
        const { type } = req.params;
        const templates = cannabisTemplatesData;
        const template = templates.find(t =>
            t.template?.cannabisMetadata?.surveyType === type,
        );
        if (!template) {
            return res.status(404).json({
                success: false,
                error: `Template type '${type}' not found`,
            });
        }
        res.json({
            success: true,
            type,
            count: template.questions?.length || 0,
            data: template.questions,
        });
    } catch (error) {
        return respondError(res, req, error);
    }
});
router.get('/standards', (req, res) => {
    try {
        const standards = [
            { code: 'thai', name: 'Thai GACP', file: 'gacp-thailand.json' },
            { code: 'who', name: 'WHO GAP', file: 'who-gap.json' },
            { code: 'eu', name: 'EU Organic', file: 'eu-organic.json' },
        ];
        res.json({
            success: true,
            count: standards.length,
            data: standards,
        });
    } catch (error) {
        return respondError(res, req, error);
    }
});
router.get('/standards/:code', (req, res) => {
    try {
        const { code } = req.params;
        const fs = require('fs');
        const path = require('path');
        const fileMap = {
            thai: 'gacp-thailand.json',
            who: 'who-gap.json',
            eu: 'eu-organic.json',
        };
        if (!fileMap[code]) {
            return res.status(404).json({
                success: false,
                error: `Standard '${code}' not found`,
                availableCodes: Object.keys(fileMap),
            });
        }
        // nosemgrep: javascript.express.security.audit.express-path-join-resolve-traversal.express-path-join-resolve-traversal -- `code` is validated against the hardcoded 3-entry `fileMap` above (404 on miss), so the joined segment is always one of three constant filenames — no user-controlled path input.
        const filePath = path.join(__dirname, '../../../data/standards', fileMap[code]);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({
                success: false,
                error: `Standard file not found: ${fileMap[code]}`,
            });
        }
        const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        res.json({
            success: true,
            code,
            data,
        });
    } catch (error) {
        return respondError(res, req, error);
    }
});
router.get('/service-types', (req, res) => {
    try {
        const serviceTypes = [
            { code: 'NEW', label: 'ขอใหม่', labelEN: 'New Application', description: 'ยื่นขอใบรับรอง GACP ใหม่' },
            { code: 'RENEWAL', label: 'ต่ออายุ', labelEN: 'Renewal', description: 'ต่ออายุใบรับรอง GACP ที่หมดอายุ' },
            { code: 'AMENDMENT', label: 'แก้ไข', labelEN: 'Amendment', description: 'แก้ไขข้อมูลใบรับรอง GACP' },
            { code: 'EXPANSION', label: 'ขยายขอบเขต', labelEN: 'Scope Expansion', description: 'ขยายขอบเขตใบรับรอง GACP' },
        ];
        res.json({
            success: true,
            count: serviceTypes.length,
            data: serviceTypes,
        });
    } catch (error) {
        return respondError(res, req, error);
    }
});
router.get('/purposes', (req, res) => {
    try {
        // มติ operator 2026-10-05 — สามคำที่มีใบอนุญาต ภ.ท. รองรับ จากไฟล์เดียว
        const purposes = Object.values(CERTIFICATION_PURPOSES).map((purpose) => ({
            code: purpose.code,
            label: purpose.label,
            licenceCode: purpose.licenceCode,
            licenceName: purpose.licenceName,
            slotId: purpose.slotId,
        }));
        res.json({
            success: true,
            count: purposes.length,
            data: purposes,
        });
    } catch (error) {
        return respondError(res, req, error);
    }
});
router.get('/cultivation-methods', (req, res) => {
    try {
        const methods = [
            { code: 'CONVENTIONAL', label: 'ทั่วไป', labelEN: 'Conventional' },
            { code: 'ORGANIC', label: 'เกษตรอินทรีย์', labelEN: 'Organic' },
            { code: 'GAP', label: 'GAP', labelEN: 'Good Agricultural Practice' },
            { code: 'HYDROPONIC', label: 'ไฮโดรโปนิกส์', labelEN: 'Hydroponic' },
            { code: 'SOILLESS', label: 'ไร้ดิน', labelEN: 'Soilless' },
            { code: 'AEROPONIC', label: 'แอโรโปนิกส์', labelEN: 'Aeroponic' },
        ];
        res.json({
            success: true,
            count: methods.length,
            data: methods,
        });
    } catch (error) {
        return respondError(res, req, error);
    }
});
router.get('/farm-types', (req, res) => {
    try {
        const farmTypes = [
            { code: 'CULTIVATION', label: 'แปลงปลูก', labelEN: 'Cultivation Farm' },
            { code: 'PROCESSING', label: 'โรงแปรรูป', labelEN: 'Processing Facility' },
            { code: 'STORAGE', label: 'คลังสินค้า', labelEN: 'Storage Facility' },
            { code: 'NURSERY', label: 'เรือนเพาะชำ', labelEN: 'Nursery' },
            { code: 'MIXED', label: 'ผสมผสาน', labelEN: 'Mixed Use' },
        ];
        res.json({
            success: true,
            count: farmTypes.length,
            data: farmTypes,
        });
    } catch (error) {
        return respondError(res, req, error);
    }
});
router.get('/area-types', (req, res) => {
    try {
        const areaTypes = [
            { code: 'INDOOR', label: 'ในอาคาร', labelEN: 'Indoor', description: 'ปลูกในอาคารควบคุมสภาพแวดล้อม' },
            { code: 'OUTDOOR', label: 'กลางแจ้ง', labelEN: 'Outdoor', description: 'ปลูกพื้นที่โล่งแจ้ง' },
            { code: 'GREENHOUSE', label: 'โรงเรือน', labelEN: 'Greenhouse', description: 'ปลูกในโรงเรือนพลาสติก/กระจก' },
            { code: 'CONTROLLED', label: 'สภาพแวดล้อมควบคุม', labelEN: 'Controlled Environment', description: 'ห้องปลูกควบคุมอุณหภูมิ/แสง' },
        ];
        res.json({
            success: true,
            count: areaTypes.length,
            data: areaTypes,
        });
    } catch (error) {
        return respondError(res, req, error);
    }
});
router.get('/applicant-types', (req, res) => {
    try {
        const applicantTypes = [
            { code: 'INDIVIDUAL', label: 'บุคคลธรรมดา', labelEN: 'Individual' },
            { code: 'JURISTIC', label: 'นิติบุคคล', labelEN: 'Juristic Person' },
            { code: 'COMMUNITY_ENTERPRISE', label: 'วิสาหกิจชุมชน', labelEN: 'Community Enterprise' },
        ];
        res.json({
            success: true,
            count: applicantTypes.length,
            data: applicantTypes,
        });
    } catch (error) {
        return respondError(res, req, error);
    }
});
router.get('/plants', (req, res) => {
    try {
        const plants = [
            { id: 1, name: 'กัญชา (Cannabis)', code: 'CANNABIS', category: 'medicinal' },
            { id: 2, name: 'กัญชง (Hemp)', code: 'HEMP', category: 'industrial' },
            { id: 3, name: 'กระท่อม (Kratom)', code: 'KRATOM', category: 'medicinal' },
            { id: 4, name: 'ฟ้าทะลายโจร', code: 'ANDROGRAPHIS', category: 'herbal' },
            { id: 5, name: 'ขมิ้นชัน', code: 'TURMERIC', category: 'herbal' },
            { id: 6, name: 'ไพล', code: 'PHLAI', category: 'herbal' },
            { id: 7, name: 'ว่านหางจระเข้', code: 'ALOE_VERA', category: 'herbal' },
            { id: 8, name: 'มะขามป้อม', code: 'INDIAN_GOOSEBERRY', category: 'herbal' },
        ];
        res.json({
            success: true,
            count: plants.length,
            data: plants,
        });
    } catch (error) {
        return respondError(res, req, error);
    }
});
router.get('/provinces', (req, res) => {
    try {
        const provinces = [
            { code: 'BKK', name: 'กรุงเทพมหานคร', region: 'central' },
            { code: 'CNX', name: 'เชียงใหม่', region: 'north' },
            { code: 'NKI', name: 'นครราชสีมา', region: 'northeast' },
            { code: 'SKA', name: 'สงขลา', region: 'south' },
            { code: 'KKN', name: 'ขอนแก่น', region: 'northeast' },
            { code: 'UDN', name: 'อุดรธานี', region: 'northeast' },
            { code: 'CBI', name: 'ชลบุรี', region: 'east' },
            { code: 'NST', name: 'นครศรีธรรมราช', region: 'south' },
            { code: 'RYG', name: 'ระยอง', region: 'east' },
            { code: 'PKT', name: 'ภูเก็ต', region: 'south' },
        ];
        res.json({
            success: true,
            count: provinces.length,
            data: provinces,
        });
    } catch (error) {
        return respondError(res, req, error);
    }
});
module.exports = router;
