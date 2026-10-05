'use strict';

/**
 * ฟาร์มและแปลงที่เกิดตอนออกใบรับรอง ต้องมีพื้นที่เท่าที่คำขอแจ้งไว้
 *
 * เดินจริงบน staging 2026-09-07 · คำขอแจ้ง `farmData.areaSqm = "1200"` และออกใบรับรอง
 * `GACP-TH-2569-8DE364` สำเร็จ · แต่แถวที่เกิดตามมาคือ
 *
 *     farm.totalArea = 0        plot "แปลงหลัก" area = 1 ตร.ม.
 *
 * แล้วเกษตรกรสร้างรอบปลูกแรกไม่ได้เลย: 500 "Allocated area for plot แปลงหลัก exceeds
 * plot size" — เพราะขอใช้ 1,200 บนแปลงที่ระบบบันทึกไว้ว่ากว้าง 1 ตารางเมตร
 *
 * ต้นเหตุ: ตัวอ่านพื้นที่ของ certificate-service มองหา productionData.growingArea /
 * farmData.totalAreaSize / farmData.totalArea / formData.totalArea — **ไม่มี
 * `farmData.areaSqm`** ซึ่งเป็นคีย์ที่วิซาร์ดหกขั้นเขียนจริง · ตัวอ่านอีกตัวในระบบเดียวกัน
 * (readFilingSite) รู้จักคีย์นั้นมาตลอด (application-farm-materialization.js:126)
 * ⇒ ทุกฟาร์มที่เกิดจากคำขอรุ่นวิซาร์ดใหม่ ได้พื้นที่ 0 และแปลงได้ 1
 *
 * คลาสเดียวกับ select-gap: ข้อมูลมีอยู่ ตัวอ่านไม่เคยถาม — ต่างกันที่รอบนี้มีตัวอ่านที่ถูกอยู่แล้ว
 * ในไฟล์ข้าง ๆ
 */

const { readFilingSite } = require('../../services/application-service/application-farm-materialization');

const FILING = {
    farmData: {
        siteName: 'สวนชูเกียรติสมุนไพร',
        siteAddress: '12 หมู่ 3',
        subDistrict: 'หนองหาร',
        district: 'สันทราย',
        province: 'เชียงใหม่',
        postalCode: '50290',
        areaSqm: '1200',
    },
};

describe('พื้นที่ที่คำขอแจ้ง ต้องไปถึงแถวฟาร์มและแปลง', () => {
    it('ตัวอ่านที่ถูกอยู่แล้ว เห็น areaSqm และรู้ว่าหน่วยคือตารางเมตร', () => {
        const site = readFilingSite(FILING);
        expect(String(site.areaAmount)).toBe('1200');
        expect(String(site.areaUnit).toLowerCase()).toBe('sqm');
    });

    it('ตัวอ่านของการออกใบรับรอง ต้องรู้จักคีย์เดียวกัน', () => {
        const src = require('fs').readFileSync(
            require('path').join(__dirname, '..', '..', 'services', 'certificate-service.js'), 'utf8',
        );
        // บล็อกที่ประกอบ rawTotalAreaAmount ต้องเอ่ยถึง areaSqm ด้วย ไม่ใช่แค่สามคีย์เดิม
        const block = src.slice(src.indexOf('const rawTotalAreaAmount'), src.indexOf('const computeBaseArea'));
        expect(block).toContain('areaSqm');
    });

    it('หน่วยถูกเดาเป็นตารางเมตรเฉพาะเมื่อ areaSqm เป็นคนตอบ — ไม่ใช่กับคีย์ที่ไม่บอกหน่วย', () => {
        const src = require('fs').readFileSync(
            require('path').join(__dirname, '..', '..', 'services', 'certificate-service.js'), 'utf8',
        );
        // คำขอเก่าที่ใส่ตัวเลขมาโดยไม่บอกหน่วย ต้องยังถูกปฏิเสธเหมือนเดิม
        // (1 ไร่ = 1,600 ตร.ม. — เดาแทนกันไม่ได้)
        expect(src).toContain('answeredByAreaSqm');
        expect(src).toMatch(/answeredByAreaSqm \? AREA_UNIT : farmData\.totalAreaUnit/);
    });
});
