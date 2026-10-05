'use strict';

/**
 * ระยะปลอดภัยก่อนเก็บเกี่ยว (Pre-Harvest Interval — PHI)
 *
 * หัวใจข้อหนึ่งของ GACP: พ่นสารควบคุมศัตรูพืชแล้ว ต้องเว้นระยะก่อนเก็บเกี่ยว
 * ระบบรู้ทั้งสองวันมาตลอด — วันพ่นอยู่ใน CultivationLog (logType PEST_CONTROL)
 * และวันเก็บอยู่ใน HarvestBatch.harvestDate — แต่ไม่มีอะไรเทียบสองวันนี้กันเลย
 * (ช่องว่างข้อ 1 ของรายงาน reports/research/2026-09-07-tnt-five-audiences)
 * เก็บเกี่ยวถัดจากวันพ่นหนึ่งวันก็บันทึกผ่านเงียบ ๆ
 *
 * เป็น "คำเตือน" ไม่ใช่ "การปฏิเสธ" — โดยเจตนา:
 *   - PHI จริงต่างกันตามสารและพืช (ฉลากสารเป็นผู้กำหนด) · ระบบไม่มีทะเบียนสาร
 *     จึงตัดสินแทนฉลากไม่ได้ ใช้ค่าเริ่มต้นอนุรักษนิยม 14 วันเป็นเส้นเตือน
 *   - การห้ามเก็บเกี่ยวคือการหยุดงานจริงของฟาร์ม — เส้นแบ่งแบบนั้นเป็นมติ operator
 *     (บันทึกไว้ในรายงานข้อ 6) ไม่ใช่ของ agent
 * สิ่งที่คำเตือนทำ: ความจริงไปถึง **คนบันทึกและผู้ตรวจ** ไม่ใช่จมอยู่ในตาราง log ที่ไม่มีใคร
 * เทียบ · ฉบับแรกของคอมเมนต์นี้เขียนว่า "ให้ผู้ตรวจ/ผู้ซื้อเห็น" ซึ่งเป็นคำเชิญที่อันตราย:
 * "ผู้ซื้อ" คือหน้าสแกนสาธารณะ และคำเตือนนี้อ้างอิงแถว CultivationLog ของการพ่นสาร ซึ่งมี
 * ทั้งชื่อสาร (productName) และชื่อผู้ปฏิบัติงาน (performedBy) ห้อยอยู่ — การส่ง phiWarning
 * ขึ้นหน้าล็อตสาธารณะจึงเท่ากับเปิดสมุดบันทึกการใช้สารและชื่อคนให้คนแปลกหน้า
 * (พบโดยการกวาดแบบขนาน 2026-09-07) · ถ้าวันหนึ่ง operator สั่งให้ผู้ซื้อเห็นเรื่อง PHI
 * ต้องเป็นข้อความสรุปที่สร้างใหม่ ไม่ใช่ก้อนนี้ และต้องผ่าน projection เหมือน toPublicPlant
 *
 * @module services/planting-cycle/pre-harvest-interval
 */

/** ชนิดกิจกรรมที่นับเป็นการใช้สาร — พ่นยา และกำจัดวัชพืช (สารเคมีทั้งคู่ตามการใช้จริง) */
const SPRAY_LOG_TYPES = Object.freeze(['PEST_CONTROL', 'PESTICIDE', 'WEED_CONTROL']);

/** เส้นเตือนเริ่มต้น (วัน) — อนุรักษนิยม ปรับได้ต่อการเรียก เมื่อมีทะเบียนสารค่อยละเอียดกว่านี้ */
const DEFAULT_PHI_DAYS = 14;

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * ประเมิน PHI ของการเก็บเกี่ยวหนึ่งครั้ง เทียบกับบันทึกการพ่นสารของรอบปลูกนั้น
 *
 * @param {object} args
 * @param {object} args.prisma        client ที่อ่าน cultivationLog ได้
 * @param {string} args.cycleId
 * @param {Date}   args.harvestDate
 * @param {number} [args.intervalDays]  เส้นเตือน (วัน)
 * @returns {Promise<null | {
 *   intervalDays: number,
 *   messageTh: string,
 *   sprayEvents: Array<{logDate: Date, daysBeforeHarvest: number, productName: ?string, logType: string}>,
 * }>} null เมื่อไม่มีการพ่นในหน้าต่างเตือน — ไม่มีคำเตือนก็ไม่มีก้อนข้อมูลให้เข้าใจผิด
 */
async function assessPreHarvestInterval({ prisma, cycleId, harvestDate, intervalDays = DEFAULT_PHI_DAYS }) {
    if (!prisma || typeof prisma.cultivationLog?.findMany !== 'function') { return null; }
    const harvestAt = harvestDate instanceof Date ? harvestDate : new Date(harvestDate);
    if (!Number.isFinite(harvestAt.getTime())) { return null; }
    const windowStart = new Date(harvestAt.getTime() - intervalDays * DAY_MS);

    const sprays = await prisma.cultivationLog.findMany({
        where: {
            cycleId,
            logType: { in: [...SPRAY_LOG_TYPES] },
            logDate: { gte: windowStart, lte: harvestAt },
        },
        select: { logDate: true, productName: true, logType: true },
        orderBy: { logDate: 'desc' },
    });
    if (!sprays.length) { return null; }

    const sprayEvents = sprays.map((row) => ({
        logDate: row.logDate,
        daysBeforeHarvest: Math.floor((harvestAt.getTime() - new Date(row.logDate).getTime()) / DAY_MS),
        productName: row.productName ?? null,
        logType: row.logType,
    }));
    const nearest = sprayEvents[0];
    const named = nearest.productName ? ` (${nearest.productName})` : '';
    return {
        intervalDays,
        messageTh: `มีการใช้สารควบคุมศัตรูพืช${named} ${nearest.daysBeforeHarvest} วันก่อนวันเก็บเกี่ยว `
            + `ซึ่งอยู่ในระยะเฝ้าระวัง ${intervalDays} วัน — โปรดตรวจระยะปลอดภัยตามฉลากสารก่อนนำผลผลิตออกจำหน่าย`,
        sprayEvents,
    };
}

module.exports = { assessPreHarvestInterval, SPRAY_LOG_TYPES, DEFAULT_PHI_DAYS };
