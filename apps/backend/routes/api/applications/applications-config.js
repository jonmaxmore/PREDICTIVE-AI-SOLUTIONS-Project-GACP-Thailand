/**
 * Applications Configuration Routes
 * Provides journey configuration based on purpose and cultivation method
 * 
 * @author ระบบรับรองมาตรฐาน GACP สมุนไพร (DTAM)
 */

const express = require('express');
const router = express.Router();
const JourneyController = require('../../../controllers/journey-controller');

const PURPOSE_ALIAS = Object.freeze({
    new: 'domestic',
});

const METHOD_ALIAS = Object.freeze({
    individual: 'outdoor',
});

function normalizeJourneyParam(value, aliasMap) {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) {
        return '';
    }
    return aliasMap[normalized] || normalized;
}

// GET /api/applications/config (query-param fallback)
// Returns default step config for the legacy wizard
//
// `plantId` สะท้อนสิ่งที่ผู้เรียกบอกมาเท่านั้น — ไม่มีก็คืน null
//
// เดิมเขียน `req.query.plantId || 'cannabis'` · ประตูนี้จึงตอบว่า "กัญชา" ให้ทุกคนที่
// ไม่ได้ถามถึงพืชใด และคำตอบนั้นหน้าตาเหมือนข้อเท็จจริง ไม่ใช่ค่าที่เดาขึ้น
// มติ operator 2026-09-12: "ค่าเริ่มต้นต้องไม่ใช่กัญชา ต้องใช้หรือเรียกข้อมูลจากพืชที่ปลูก"
//
// null ไม่ใช่ความผิดพลาด — มันคือคำตอบที่ตรงกับคำถามที่ยังไม่ได้ถูกถาม และเป็นรูปเดียวกับ
// ที่ประตูบันทึกร่างเก็บลงฐาน (ทดสอบแล้ว: ไม่ส่ง plantId → เก็บ null)
router.get('/', (req, res) => {
    const plantId = String(req.query.plantId || '').trim() || null;
    res.json({
        success: true,
        data: {
            steps: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12],
            plantId,
        },
    });
});

// Application configuration by journey
// GET /api/applications/config/:purpose/:method
router.get('/:purpose/:method', (req, res, next) => {
    req.params.purpose = normalizeJourneyParam(req.params.purpose, PURPOSE_ALIAS);
    req.params.method = normalizeJourneyParam(req.params.method, METHOD_ALIAS);
    return JourneyController.getJourneyConfig(req, res, next);
});

module.exports = router;
