'use strict';

/**
 * ขอบเขตที่ใบรับรองอนุญาต — และประตูสองบานที่เคยเดินอ้อมมันได้
 *
 * กทล.๑ ส่วนที่ ๔ (๓): "ไม่เปลี่ยนแปลงพื้นที่ปลูก เมล็ดพันธุ์ หรือส่วนของพืชที่ใช้
 * โดยไม่ยื่นคำขอใหม่" · ขั้นที่ 6 ของ wizard แสดงข้อความนี้ให้ผู้ยื่นติ๊กรับรองแล้ว
 * ⇒ แพลตฟอร์มที่ให้คนเซ็นข้อนี้ แล้วเปิดทางให้ผิดสัญญาด้วยคำขอธรรมดาสองใบ กำลังให้เซ็นกระดาษเปล่า
 *
 * ช่องที่วัดได้จริง เป็นสองก้าว:
 *
 *   ก้าวที่ 1  `PATCH /api/farms/:id { cultivationMethod: 'INDOOR' }` → 200
 *              ไม่มีใครถามใบรับรอง ไม่มี audit row
 *   ก้าวที่ 2  `POST /api/farms/:id/plots { solarSystem: 'INDOOR' }` → 201
 *              ด่านเดียวที่พูดว่า "certified for" เทียบกับ `farms.cultivationMethod`
 *              ซึ่งเป็นคอลัมน์ที่ก้าวแรกเพิ่งย้าย
 *
 * **หัวใจของการแก้คือแหล่งความจริง** ไม่ใช่การเพิ่มด่าน: ขอบเขตที่รับรองไว้ต้องอ่านจาก
 * **ใบรับรอง → คำขอต้นทาง** ซึ่งเป็นบันทึกที่ก้าวแรกเอื้อมไม่ถึง · เพิ่มด่านที่ยังอ่าน
 * คอลัมน์เดิม จะได้ด่านที่คนเดียวกันเดินอ้อมได้ด้วยวิธีเดียวกัน
 *
 * และอ่านลักษณะพื้นที่ด้วย `tickedAreaTypes` ตัวเดียวกับที่ requirement lens ใช้ —
 * ไม่ใช่การตีความ ลักษณะพื้นที่ เป็นครั้งที่สี่ในโปรเจกต์นี้
 */

const { prisma } = require('./prisma-database');
const { deriveDimensions } = require('./application-requirements-service');
const logger = require('../shared/logger');

const CERTIFIED_SCOPE_LOCKED = 'CERTIFIED_SCOPE_LOCKED';
const PLOT_OUTSIDE_CERTIFIED_SCOPE = 'PLOT_OUTSIDE_CERTIFIED_SCOPE';
const SCOPE_UNVERIFIABLE = 'CERTIFIED_SCOPE_UNVERIFIABLE';

/** คำที่ใช้เรียกลักษณะพื้นที่ ให้ตรงกับ solarSystem ของแปลง */
function asAreaWord(value) {
    const word = String(value || '').trim().toUpperCase();
    if (word === 'INDOOR_CONTROLLED') { return 'INDOOR'; }
    return word;
}

function refuse(code, messageTh, statusCode = 409) {
    return Object.assign(new Error(messageTh), { code, statusCode, messageTh });
}

/**
 * ลักษณะพื้นที่ที่ใบรับรองที่ยังมีผลของฟาร์มนี้ครอบคลุม
 *
 * คืน `areaTypes: null` เมื่อยังไม่มีใบรับรองที่มีผล — **null ไม่ใช่ลิสต์ว่าง** เพราะสองอย่างนี้
 * ต่างกันสิ้นเชิง: ลิสต์ว่างแปลว่า "รับรองไว้แต่ไม่ครอบคลุมอะไรเลย" ส่วน null แปลว่า
 * "ยังไม่มีอะไรถูกรับรอง" ซึ่งเป็นสถานะปกติของฟาร์มก่อนได้ใบ
 */
async function certifiedAreaTypes({ farmId, client = prisma, holderScope = null } = {}) {
    const none = { areaTypes: null, certificateNumber: null, applicationId: null };
    if (!farmId) { return none; }

    // อ่านไม่ได้ = ห้ามผ่าน ไม่ใช่ปล่อยผ่าน · ด่านนี้มีไว้รักษาคำรับรองตามกฎหมายที่ผู้ยื่นเซ็นไว้
    // การ fail-open เมื่ออ่านฐานข้อมูลไม่ได้ แปลว่าช่วงที่ระบบมีปัญหาคือช่วงที่กฎไม่มีผล
    // ซึ่งเป็นช่วงเวลาที่แย่ที่สุดที่จะไม่มีผล · ผู้เรียกได้คำปฏิเสธที่บอกว่า "ตรวจไม่ได้ตอนนี้"
    // ไม่ใช่ 500 ที่ไม่มีใครอ่านออก
    if (!client || !client.certificate || typeof client.certificate.findMany !== 'function') {
        throw refuse(
            SCOPE_UNVERIFIABLE,
            'ระบบตรวจสอบขอบเขตของใบรับรองไม่ได้ในขณะนี้ จึงยังทำรายการนี้ไม่ได้ กรุณาลองใหม่อีกครั้ง',
            503,
        );
    }

    let certs;
    try {
        // ── อ่าน **ทุกใบที่ยังมีผล** ไม่ใช่ใบล่าสุดใบเดียว ─────────────────────────
        //
        // เดิมบรรทัดนี้เป็น `findFirst` + `orderBy: { createdAt: 'desc' }` · ฟาร์มที่ถือ
        // ใบกลางแจ้ง (มกราคม) และใบโรงเรือน (มิถุนายน) จะถูกอ่านเห็นแต่ใบมิถุนายน
        // ⇒ เกษตรกรเปิดรอบปลูกบนแปลงกลางแจ้งของตัวเองไม่ได้ ทั้งที่ใบยังไม่หมดอายุ
        // ด่านที่ปฏิเสธคนที่มีสิทธิ แย่กว่าด่านที่ไม่มี เพราะเขาไม่รู้ว่าต้องไปแก้ที่ไหน
        //
        // ฟาร์มหนึ่งถือได้หลายใบโดยปกติ: operator 2026-09-11 ให้ออกใบ **แยกตามรูปแบบ
        // การปลูก** ⇒ ผ่านสองรูปแบบ = สองใบ · การอ่านใบเดียวจึงไม่ใช่แค่ไม่ครบ
        // มันคือการปิดกั้นเกษตรกรจากรูปแบบที่เขาได้รับรองไว้แล้ว
        certs = await client.certificate.findMany({
            // เงื่อนไข "ยังมีผล" อยู่ในคิวรี ไม่ใช่มากรองทีหลัง — การกรองทีหลังคือที่ที่เงื่อนไข
            // ข้อหนึ่งหายไปเงียบ ๆ ตอนมีคนแก้โค้ดรอบหน้า
            where: {
                farmId: String(farmId),
                isDeleted: false,
                status: { notIn: ['revoked', 'REVOKED', 'expired', 'EXPIRED'] },
                // `Certificate.expiryDate` เป็นคอลัมน์บังคับ (certification.prisma) ใบรับรอง
                // ทุกใบจึงมีวันหมดอายุเสมอ · สาขา `{ expiryDate: null }` ที่เคยอยู่ตรงนี้ไม่ได้
                // แค่ไม่มีความหมาย — Prisma ปฏิเสธรูปคิวรีตั้งแต่ก่อนแตะฐานข้อมูล ทำให้ด่านนี้
                // อ่านใบรับรองไม่ได้ "ทุกครั้ง" แล้วปฏิเสธด้วย 503 ตามที่ fail-closed ออกแบบไว้
                // ⇒ เกษตรกรที่มีใบรับรองจริงเพิ่มแปลงไม่ได้เลย (วัดจริงบน staging 2026-09-07)
                expiryDate: { gt: new Date() },
                // R1-legacy-pin: removed in Task 12 — a health door passes its holder scope;
                // the farm its gate already resolved decides the rows, as pre-R1.
                ...require('./holder-access').r1HolderOrLegacyWhenScoped(holderScope, 'Certificate', { farmId: String(farmId) }),
            },
            orderBy: { createdAt: 'desc' },
            include: { scopes: true, application: true },
        });
    } catch (readError) {
        // บอกสาเหตุไว้ในบันทึกของระบบ — ผู้ใช้ไม่ควรเห็นข้อความของฐานข้อมูล แต่คนดูแลต้องเห็น
        // ไม่งั้น "ตรวจไม่ได้" จะกลายเป็นอาการที่ไม่มีใครสาวถึงต้นเหตุได้
        logger.error(`[certified-scope] could not read the certificates for farm ${farmId}: ${readError && readError.message}`);
        throw refuse(
            SCOPE_UNVERIFIABLE,
            'ระบบตรวจสอบขอบเขตของใบรับรองไม่ได้ในขณะนี้ จึงยังทำรายการนี้ไม่ได้ กรุณาลองใหม่อีกครั้ง',
            503,
        );
    }

    if (!Array.isArray(certs) || certs.length === 0) { return none; }

    const areaTypes = new Set();
    for (const cert of certs) {
        const rows = Array.isArray(cert.scopes) ? cert.scopes : [];
        if (rows.length > 0) {
            // ── ใบเป็นบันทึกของสิ่งที่ตัดสินไปแล้ว ────────────────────────────────
            // ISO/IEC 17065 §7.7.1(d) ให้ใบระบุ "the scope of certification" ⇒ ขอบข่าย
            // เป็นของใบ ไม่ใช่มุมมองสดของคำขอ · ถ้าอ่านจากคำขอ ขอบข่ายที่รับรองไปแล้ว
            // จะเปลี่ยนทุกครั้งที่ข้อมูลคำขอเปลี่ยน ซึ่งไม่ใช่สิ่งที่ใบรับรองเป็น
            for (const row of rows) {
                if (String(row.status || 'active').toLowerCase() !== 'active') { continue; }
                const word = asAreaWord(row.areaType);
                if (word) { areaTypes.add(word); }
            }
            continue;
        }

        // ── หน้าต่าง expand: ใบที่ออกก่อนมีตารางขอบข่าย ────────────────────────────
        // ยังตอบจากคำขอต้นทางเหมือนเดิม · ถ้าไม่มีสาขานี้ ใบเก่าทุกใบจะกลายเป็น
        // "ไร้ขอบข่าย" ในวินาทีที่ deploy และเกษตรกรทุกรายที่ถือใบอยู่จะถูกปิดกั้น
        // สาขานี้ตายเองเมื่อ backfill ครบ และลบได้ในใบ contract
        if (!cert.application) { continue; }
        const dims = deriveDimensions(cert.application);
        for (const word of (Array.isArray(dims.areaTypes) ? dims.areaTypes : [])) {
            const normalized = asAreaWord(word);
            if (normalized) { areaTypes.add(normalized); }
        }
    }

    const first = certs[0];
    return {
        areaTypes: [...areaTypes],
        certificateNumber: first.certificateNumber || null,
        applicationId: (first.application && first.application.id) || null,
    };
}

/**
 * ด่านของประตูสร้างแปลง — แปลงใหม่ต้องอยู่ในขอบเขตที่ใบรับรองครอบคลุม
 *
 * ก่อนได้ใบรับรอง ด่านนี้ไม่ตัดสินอะไรเลย: ยังไม่มีใครรับรองอะไร คำประกาศของฟาร์มเองคือทั้งหมด
 * ที่มี และด่านเดิมที่เทียบกับ `farms.cultivationMethod` ยังทำหน้าที่นั้นอยู่
 */
async function assertPlotWithinCertifiedScope({ farmId, solarSystem, client = prisma, holderScope = null } = {}) {
    const scope = await certifiedAreaTypes({ farmId, client, holderScope });
    if (scope.areaTypes === null) { return; }

    const requested = asAreaWord(solarSystem || 'OUTDOOR');
    if (scope.areaTypes.includes(requested)) { return; }

    throw refuse(
        PLOT_OUTSIDE_CERTIFIED_SCOPE,
        `ใบรับรอง ${scope.certificateNumber || ''} ครอบคลุมลักษณะพื้นที่ `
        + `${scope.areaTypes.join(', ') || '(ไม่ระบุ)'} จึงเพิ่มแปลงแบบ ${requested} ไม่ได้ — `
        + 'การเปลี่ยนลักษณะพื้นที่หลังได้รับใบรับรองต้องยื่นคำขอใหม่ (กทล.๑ ส่วนที่ ๔ (๓))',
    );
}

/**
 * ด่านของประตูแก้ไขฟาร์ม — ล็อกเฉพาะ `cultivationMethod`
 *
 * **ล็อกช่องเดียวโดยตั้งใจ**: `reviseCertificateFromFarm` อ่านจังหวัด อำเภอ และที่อยู่จากฟาร์ม
 * เป็นแหล่งความจริงของการออกฉบับแก้ไข ⇒ ล็อกช่องเหล่านั้นจะทำให้ประตูแก้ไขใบรับรองพัง
 * ฟังก์ชันนี้จึงรับอาร์กิวเมนต์ก้อนเดียวที่มีแค่ช่องนี้ ผู้เรียกในอนาคตจะเผลอล็อกช่องอื่นไม่ได้
 */
async function assertCultivationMethodUnlocked({ farmId, current, requested, client = prisma, holderScope = null } = {}) {
    if (requested === undefined || requested === null) { return; }
    const before = asAreaWord(current);
    const after = asAreaWord(requested);
    if (before === after) { return; }   // บันทึกค่าเดิมซ้ำ ไม่ใช่การเปลี่ยน

    const scope = await certifiedAreaTypes({ farmId, client, holderScope });
    if (scope.areaTypes === null) { return; }

    throw refuse(
        CERTIFIED_SCOPE_LOCKED,
        `ฟาร์มนี้ถือใบรับรอง ${scope.certificateNumber || ''} ที่ยังมีผลอยู่ จึงเปลี่ยนลักษณะการปลูก`
        + `จาก ${before} เป็น ${after} ไม่ได้ — ตามคำรับรอง กทล.๑ ส่วนที่ ๔ (๓) `
        + 'การเปลี่ยนพื้นที่ปลูกต้องยื่นคำขอใหม่',
    );
}

module.exports = {
    SCOPE_UNVERIFIABLE,
    certifiedAreaTypes,
    assertPlotWithinCertifiedScope,
    assertCultivationMethodUnlocked,
    CERTIFIED_SCOPE_LOCKED,
    PLOT_OUTSIDE_CERTIFIED_SCOPE,
};
