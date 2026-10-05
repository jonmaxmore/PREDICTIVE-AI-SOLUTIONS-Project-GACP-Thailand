/**
 * Pre-submission Validation API
 * ตรวจสอบความพร้อมก่อนส่งใบสมัคร GACP
 *
 * Based on DTAM Requirements Document
 * Provides comprehensive checklist for application submission
 *
 * @version 1.0.0
 */

const express = require('express');
const { respondError } = require('../../../shared/api-response');
const router = express.Router();
const { getRequiredDocuments } = require('../../../constants/document-slots');
const { buildUploadedSlotSet, hasUploadedSlot } = require('./validation-slot-utils');
const logger = require('../../../shared/logger');

// PRE-SUBMISSION VALIDATION API

/**
 * @route   POST /api/validation/land-check
 * @desc    Smart Land Check (Coordinates & restricted zones)
 * @access  HEALTH_USER
 */
router.post('/land-check', async (req, res) => {
    try {
        const { lat, lng } = req.body;

        if (lat === undefined || lat === null || lng === undefined || lng === null) {
            return res.status(400).json({ success: false, error: 'Coordinate is required' });
        }

        // Coordinates must be a number or a numeric string. Reject arrays/objects/
        // booleans up front — otherwise `parseFloat([18.05])` coerces an array to a
        // valid number and the type check is silently bypassed (validation gap).
        const isNumeric = (v) =>
            (typeof v === 'number' && Number.isFinite(v)) ||
            (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)));
        if (!isNumeric(lat) || !isNumeric(lng)) {
            return res.status(400).json({ success: false, error: 'lat and lng must be numeric' });
        }

        const latitude = Number(lat);
        const longitude = Number(lng);

        // Range check (WGS84 bounds).
        if (latitude < -90 || latitude > 90 || longitude < -180 || longitude > 180) {
            return res.status(400).json({ success: false, error: 'Coordinate out of range' });
        }

        // 2. Restricted Zone Check (Mock - e.g., near Royal Palace or National Park)
        // Simple mock: if lat > 18.0 and lat < 18.5 => Restricted
        const isRestricted = (latitude > 18.0 && latitude < 18.1); // Mock restricted zone in North Thailand

        if (isRestricted) {
            return res.json({
                success: true,
                data: {
                    valid: false,
                    reason: 'Located in restricted zone (National Park/Military Base)',
                    type: 'RESTRICTED_ZONE',
                },
            });
        }

        // 3. Overlap Check (Mock - check against DB)
        // In real impl, query PostGIS. Here, mock collision if lat ends in .000
        const isOverlap = Math.floor(latitude * 1000) % 10 === 0;

        if (isOverlap) {
            return res.json({
                success: true,
                data: {
                    valid: false,
                    reason: 'Land overlaps with existing registered farm',
                    type: 'OVERLAP',
                },
            });
        }

        // Valid
        res.json({ success: true, data: { valid: true } });

    } catch (error) {
        logger.error('[Land Check] Error:', error);
        return respondError(res, req, error);
    }
});

/**
 * @route   POST /api/validation/pre-submission
 * @desc    Validate application before submission
 * @access  HEALTH_USER
 * @test    POST http://localhost:3000/api/validation/pre-submission
 */
router.post('/pre-submission', async (req, res) => {
    try {
        // ไม่มีค่าเริ่มต้นของพืช — กฎหมายเอกสารผูกกับชนิดพืช การเดาให้เท่ากับตอบกฎหมาย
        // ของพืชอื่นด้วยหน้าตาที่เหมือนคำตอบจริง (มติ operator 2026-09-12)
        const {
            _applicationId,
            plantType,
            applicantType = 'INDIVIDUAL',
            objectives = [],
            landOwnership = 'owned',
            applicationType = 'NEW',
            uploadedDocuments = [],
        } = req.body;

        if (!String(plantType || '').trim()) {
            return res.status(400).json({
                success: false,
                code: 'PLANT_NOT_DECLARED',
                error: 'plantType is required',
                messageTh: 'ต้องระบุชนิดพืชก่อน เพราะกติกาเอกสารขึ้นกับชนิดพืชที่ขอรับรอง',
            });
        }

        const validationResults = {
            isReady: true,
            completionPercentage: 0,
            sections: [],
            missingRequired: [],
            missingConditional: [],
            warnings: [],
            recommendations: [],
        };

        // ─────────────────────────────────────────────────────────
        // 1. Document Validation
        // ─────────────────────────────────────────────────────────
        const requiredDocs = getRequiredDocuments({
            plantType,
            applicantType,
            objectives,
            landOwnership,
            applicationType,
        });

        const objectiveSet = new Set(
            (Array.isArray(objectives) ? objectives : []).map((objective) => String(objective).toUpperCase()),
        );
        const uploadedSlotSet = buildUploadedSlotSet(uploadedDocuments);
        const missingDocs = requiredDocs.filter(doc =>
            !hasUploadedSlot(uploadedSlotSet, doc.slotId),
        );

        const docSection = {
            name: 'เอกสารประกอบ',
            nameEN: 'Documents',
            total: requiredDocs.length,
            completed: requiredDocs.length - missingDocs.length,
            percentage: Math.round(((requiredDocs.length - missingDocs.length) / requiredDocs.length) * 100) || 0,
            missing: missingDocs.map(d => ({
                slotId: d.slotId,
                name: d.name,
                isConditional: d.conditionalRequired || false,
            })),
        };
        validationResults.sections.push(docSection);

        // Add to missing lists
        missingDocs.forEach(doc => {
            if (doc.conditionalRequired) {
                validationResults.missingConditional.push({
                    slotId: doc.slotId,
                    name: doc.name,
                    reason: doc.warningText || 'บังคับตามเงื่อนไขที่เลือก',
                });
            } else {
                validationResults.missingRequired.push({
                    slotId: doc.slotId,
                    name: doc.name,
                });
            }
        });

        // ─────────────────────────────────────────────────────────
        // 2. Applicant Type Validation
        // ─────────────────────────────────────────────────────────
        const applicantSection = {
            name: 'ข้อมูลผู้ยื่น',
            nameEN: 'Applicant Info',
            total: 3,
            completed: 0,
            checks: [],
        };

        // Check Thai ID
        const hasIdCard = hasUploadedSlot(uploadedSlotSet, 'id_card');
        applicantSection.checks.push({
            item: 'สำเนาบัตรประชาชน',
            status: hasIdCard ? 'passed' : 'missing',
        });
        if (hasIdCard) { applicantSection.completed++; }

        // Check House Registration
        const hasHouseReg = hasUploadedSlot(uploadedSlotSet, 'house_reg');
        applicantSection.checks.push({
            item: 'สำเนาทะเบียนบ้าน',
            status: hasHouseReg ? 'passed' : 'missing',
        });
        if (hasHouseReg) { applicantSection.completed++; }

        // Check Criminal Background (DTAM Required)
        const hasCriminalBg = hasUploadedSlot(uploadedSlotSet, 'criminal_bg');
        applicantSection.checks.push({
            item: 'ผลตรวจประวัติอาชญากรรม',
            status: hasCriminalBg ? 'passed' : 'missing',
            warning: !hasCriminalBg ? 'GACP Thaiกำหนดให้ต้องมี' : null,
        });
        if (hasCriminalBg) { applicantSection.completed++; }

        applicantSection.percentage = Math.round((applicantSection.completed / applicantSection.total) * 100);
        validationResults.sections.push(applicantSection);

        // ─────────────────────────────────────────────────────────
        // 3. Land Ownership Validation
        // ─────────────────────────────────────────────────────────
        const landSection = {
            name: 'เอกสารที่ดิน',
            nameEN: 'Land Documents',
            total: 1,
            completed: 0,
            checks: [],
        };

        const hasLandDeed = hasUploadedSlot(uploadedSlotSet, 'land_deed');
        const hasLandLease = hasUploadedSlot(uploadedSlotSet, 'land_lease');
        const hasLandConsent = hasUploadedSlot(uploadedSlotSet, 'land_consent');

        if (landOwnership === 'owned') {
            landSection.checks.push({
                item: 'โฉนดที่ดิน / น.ส.3 / น.ส.4',
                status: hasLandDeed ? 'passed' : 'missing',
            });
            if (hasLandDeed) { landSection.completed++; }
        } else if (landOwnership === 'leased') {
            landSection.total = 2;
            landSection.checks.push({
                item: 'โฉนดที่ดิน',
                status: hasLandDeed ? 'passed' : 'missing',
            });
            landSection.checks.push({
                item: 'สัญญาเช่าที่ดิน',
                status: hasLandLease ? 'passed' : 'missing',
            });
            if (hasLandDeed) { landSection.completed++; }
            if (hasLandLease) { landSection.completed++; }
        } else if (landOwnership === 'permitted_use') {
            landSection.total = 2;
            landSection.checks.push({
                item: 'โฉนดที่ดิน',
                status: hasLandDeed ? 'passed' : 'missing',
            });
            landSection.checks.push({
                item: 'หนังสือยินยอมให้ใช้ที่ดิน',
                status: hasLandConsent ? 'passed' : 'missing',
            });
            if (hasLandDeed) { landSection.completed++; }
            if (hasLandConsent) { landSection.completed++; }
        }

        landSection.percentage = Math.round((landSection.completed / landSection.total) * 100) || 0;
        validationResults.sections.push(landSection);

        // ─────────────────────────────────────────────────────────
        // 4. License Validation (for controlled plants)
        // ─────────────────────────────────────────────────────────
        if (['cannabis', 'kratom'].includes(plantType.toLowerCase())) {
            const licenseSection = {
                name: 'ใบอนุญาต',
                nameEN: 'Licenses',
                total: 1,
                completed: 0,
                checks: [],
            };

            // BT.11 is always required for controlled plants
            const hasBt11 = hasUploadedSlot(uploadedSlotSet, 'license_bt11');
            licenseSection.checks.push({
                item: 'ใบอนุญาต บท.11 (ปลูก)',
                status: hasBt11 ? 'passed' : 'missing',
                critical: true,
            });
            if (hasBt11) { licenseSection.completed++; }

            // BT.13 if processing
            if (objectiveSet.has('PROCESSING') || objectiveSet.has('MANUFACTURING')) {
                licenseSection.total++;
                const hasBt13 = hasUploadedSlot(uploadedSlotSet, 'license_bt13');
                licenseSection.checks.push({
                    item: 'ใบอนุญาต บท.13 (แปรรูป)',
                    status: hasBt13 ? 'passed' : 'missing',
                });
                if (hasBt13) { licenseSection.completed++; }
            }

            licenseSection.percentage = Math.round((licenseSection.completed / licenseSection.total) * 100);
            validationResults.sections.push(licenseSection);
        }

        // ─────────────────────────────────────────────────────────
        // 5. Photos Validation
        // ─────────────────────────────────────────────────────────
        const photoSection = {
            name: 'รูปถ่าย',
            nameEN: 'Photos',
            total: 2,
            completed: 0,
            checks: [],
        };

        const hasExterior = hasUploadedSlot(uploadedSlotSet, 'photos_exterior');
        const hasSignage = hasUploadedSlot(uploadedSlotSet, 'photos_signage');

        photoSection.checks.push({
            item: 'ภาพถ่ายภายนอก/แปลงปลูก',
            status: hasExterior ? 'passed' : 'missing',
        });
        photoSection.checks.push({
            item: 'ภาพถ่ายป้าย',
            status: hasSignage ? 'passed' : 'missing',
        });

        if (hasExterior) { photoSection.completed++; }
        if (hasSignage) { photoSection.completed++; }

        photoSection.percentage = Math.round((photoSection.completed / photoSection.total) * 100);
        validationResults.sections.push(photoSection);

        // ─────────────────────────────────────────────────────────
        // Calculate Overall
        // ─────────────────────────────────────────────────────────
        const totalItems = validationResults.sections.reduce((sum, s) => sum + s.total, 0);
        const completedItems = validationResults.sections.reduce((sum, s) => sum + s.completed, 0);
        validationResults.completionPercentage = Math.round((completedItems / totalItems) * 100);
        validationResults.isReady = validationResults.missingRequired.length === 0 &&
            validationResults.sections.every(s => s.percentage >= 100);

        // Add warnings
        if (!hasCriminalBg) {
            validationResults.warnings.push({
                type: 'document',
                message: 'ยังไม่ได้อัปโหลดผลตรวจประวัติอาชญากรรม (ต้องได้จาก สตช. อายุไม่เกิน 3 เดือน)',
                priority: 'high',
            });
        }

        // Add recommendations
        if (validationResults.completionPercentage >= 80 && validationResults.completionPercentage < 100) {
            validationResults.recommendations.push('เหลืออีกเพียงเล็กน้อย! กรุณาเพิ่มเอกสารที่ขาดเพื่อให้ครบ 100%');
        }

        res.json({
            success: true,
            data: validationResults,
        });
    } catch (error) {
        logger.error('[Validation API] Error:', error);
        return respondError(res, req, error);
    }
});

/**
 * @route   GET /api/validation/checklist
 * @desc    Get submission checklist template
 * @access  Public
 * @test    GET http://localhost:3000/api/validation/checklist
 */
router.get('/checklist', async (req, res) => {
    try {
        // เช่นเดียวกับ /pre-submission — ไม่เดาชนิดพืช
        const { plantType, applicantType = 'INDIVIDUAL' } = req.query;

        if (!String(plantType || '').trim()) {
            return res.status(400).json({
                success: false,
                code: 'PLANT_NOT_DECLARED',
                error: 'plantType is required',
                messageTh: 'ต้องระบุชนิดพืชก่อน เพราะกติกาเอกสารขึ้นกับชนิดพืชที่ขอรับรอง',
            });
        }

        const checklist = {
            plantType,
            applicantType,
            sections: [
                {
                    name: 'เอกสารบุคคล',
                    items: [
                        { slotId: 'id_card', name: 'สำเนาบัตรประชาชน', required: true },
                        { slotId: 'house_reg', name: 'สำเนาทะเบียนบ้าน', required: true },
                        { slotId: 'criminal_bg', name: 'ผลตรวจประวัติอาชญากรรม', required: true },
                    ],
                },
                {
                    name: 'เอกสารที่ดิน',
                    items: [
                        { slotId: 'land_deed', name: 'โฉนดที่ดิน / น.ส.3 / น.ส.4', required: true },
                        { slotId: 'land_lease', name: 'สัญญาเช่า (กรณีเช่า)', required: false },
                        { slotId: 'land_consent', name: 'หนังสือยินยอม (กรณีขอใช้)', required: false },
                    ],
                },
                {
                    name: 'ใบอนุญาต',
                    items: [
                        { slotId: 'license_bt11', name: 'บท.11 (ปลูก)', required: ['cannabis', 'kratom'].includes(plantType) },
                        { slotId: 'license_bt13', name: 'บท.13 (แปรรูป)', required: false },
                    ],
                },
                {
                    name: 'SOP',
                    items: [
                        { slotId: 'sop_cultivation', name: 'SOP การปลูก', required: true },
                        { slotId: 'sop_harvest', name: 'SOP การเก็บเกี่ยว', required: true },
                        { slotId: 'sop_storage', name: 'SOP การเก็บรักษา', required: true },
                        { slotId: 'sop_pest', name: 'SOP การจัดการศัตรูพืช', required: true },
                    ],
                },
                {
                    name: 'รูปถ่าย',
                    items: [
                        { slotId: 'photos_exterior', name: 'ภาพถ่ายภายนอก', required: true },
                        { slotId: 'photos_signage', name: 'ภาพถ่ายป้าย', required: true },
                        { slotId: 'photos_interior', name: 'ภาพถ่ายภายใน', required: false },
                        { slotId: 'photos_storage', name: 'ภาพถ่ายคลังเก็บ', required: false },
                    ],
                },
                {
                    name: 'แบบฟอร์ม',
                    items: [
                        { slotId: 'form_09', name: 'แบบคำขอ (Form 09)', required: true },
                        { slotId: 'form_10', name: 'แบบสรุปข้อมูลฟาร์ม (Form 10)', required: true },
                        { slotId: 'site_map', name: 'แผนผังแปลงปลูก', required: true },
                    ],
                },
            ],
        };

        // Add juristic documents if applicable
        if (applicantType === 'JURISTIC') {
            checklist.sections.splice(1, 0, {
                name: 'เอกสารนิติบุคคล',
                items: [
                    { slotId: 'company_reg', name: 'หนังสือรับรองบริษัท', required: true },
                ],
            });
        } else if (applicantType === 'COMMUNITY_ENTERPRISE') {
            checklist.sections.splice(1, 0, {
                name: 'เอกสารวิสาหกิจชุมชน',
                items: [
                    { slotId: 'community_cert', name: 'หนังสือจดทะเบียนวิสาหกิจชุมชน', required: true },
                    { slotId: 'gov_support', name: 'หนังสือสนับสนุนจากหน่วยงาน', required: true },
                ],
            });
        }

        res.json({
            success: true,
            data: checklist,
        });
    } catch (error) {
        logger.error('[Validation API] Error:', error);
        return respondError(res, req, error);
    }
});

module.exports = router;
