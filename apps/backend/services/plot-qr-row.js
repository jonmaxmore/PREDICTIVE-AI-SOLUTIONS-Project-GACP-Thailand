'use strict';

/**
 * T8 — แถวเดียวที่ประตู QR แปลงทั้งสามบานใช้ร่วมกัน
 *
 * แปลงหนึ่งมีตัวตนสองอย่าง และก่อนหน้านี้ประตูรู้จักแค่อย่างเดียว:
 *
 *     `plotCode`   รหัสถาวรของแปลง — เกิดพร้อมแถว Plot (services/plot-code-extension.js)
 *                  อยู่ข้ามฤดู เป็นสิ่งที่พิมพ์ติดเสาในแปลง (มกษ. 3502-2561 ข้อ 8(1))
 *     `qrCode`     ผนึกของ *ฤดูกาลนี้* — UUID หนึ่งใบต่อ (รอบปลูก, แปลง) เกิดใหม่ทุกฤดู
 *                  เป็นข้อต่อในห่วงโซ่หลักฐาน และเป็นสิ่งที่สติกเกอร์ที่พิมพ์ไปแล้วสแกนเจอ
 *
 * ทั้งสองต้องอยู่ ไม่ใช่เลือกอันใดอันหนึ่ง — ที่ผิดคือประตูส่งออกแต่อันหลัง แล้วหน้าจอที่รู้วิธี
 * แสดงรหัสถาวรและรู้ทางไปหน้าพิมพ์ป้ายของแปลงนั้น กลับถูกบอกว่า "ยังไม่มีรหัส" ทุกแปลง
 * (ดูคอมเมนต์ที่ planting-cycle-detail-tabs-section-a-overview-plots.tsx:44 ซึ่งเขียนไว้เอง
 * ว่า endpoint ยังไม่คืนสามฟิลด์นี้)
 *
 * `seasonalQrCode` ซ้ำกับ `qrCode` โดยตั้งใจ: `qrCode` คงไว้เพื่อไม่ให้ผู้เรียกเดิมพัง
 * ส่วนชื่อที่บอกชนิดมีไว้ให้โค้ดที่เขียนหลังจากนี้เลือกใช้อันที่ตั้งใจจริง ๆ — ชื่อที่ไม่บอกว่า
 * มันคืออะไร คือสาเหตุที่ UUID รายฤดูเกือบไปโผล่บนป้ายที่ตั้งใจให้อยู่ถาวร
 */

function buildPlotQrRow({ assignment, seasonal, cultivationType }) {
    const plot = (assignment && assignment.plot) || {};
    return {
        cyclePlotId: String((assignment && assignment.id) || ''),
        plotId: plot.id || null,
        plotName: plot.name || null,

        // ── ตัวตนถาวร ──
        plotCode: plot.plotCode || null,
        // วันพิมพ์ป้ายกับวันยกเลิกป้าย เป็นคนละเรื่องกับการมีรหัส — หน้าจอใช้สองค่านี้
        // ตัดสินว่าจะเสนอ "พิมพ์ป้าย" หรือ "พิมพ์ใหม่แทนป้ายเดิม"
        qrIssuedAt: plot.qrIssuedAt || null,
        qrRevokedAt: plot.qrRevokedAt || null,

        // ── ผนึกของฤดูกาลนี้ ──
        qrCode: (seasonal && seasonal.qrCode) || null,
        trackingUrl: (seasonal && seasonal.publicUrl) || null,
        seasonalQrCode: (seasonal && seasonal.qrCode) || null,
        ...(seasonal && seasonal.status !== undefined ? { status: seasonal.status } : {}),

        cultivationMethod: String(plot.solarSystem || cultivationType || 'OUTDOOR').toUpperCase(),
        allocatedAreaSqm: Number((assignment && assignment.allocatedAreaSqm) || 0),
        // จำนวนต้นที่เกษตรกรประกาศไว้บนการจัดสรรแปลง ไม่ใช่การนับแถวที่ติดตามอยู่ (R8)
        plannedPlantCount: Number((assignment && assignment.plannedPlantCount) || 0),
    };
}

module.exports = { buildPlotQrRow };
