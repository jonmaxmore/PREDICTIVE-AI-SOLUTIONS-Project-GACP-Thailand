/**
 * ป้ายที่ปักอยู่กลางแปลง ต้องไม่เงียบเรื่องใบรับรอง
 *
 * หน้าสแกนของ **ล็อต** และ **รุ่น** ตอบ 410 เมื่อใบรับรองถูกเพิกถอนหรือหมดอายุ ·
 * หน้าสแกนของ **แปลง** ไม่มีฟิลด์เกี่ยวกับใบรับรองเลยแม้แต่ฟิลด์เดียว จึงตอบ 200 ตามปกติ
 * พร้อมหน้าตาของระบบ GACP ให้กับที่ดินที่ใบรับรองหมดอายุไปแล้ว (วัดจริง 2026-09-06)
 *
 * สิ่งที่ทำในไฟล์นี้คือ **เพิ่มความจริง ไม่ใช่ปิดหน้า**: หน้ายังตอบ 200 เหมือนเดิม แต่บอก
 * สถานะของใบรับรองออกมาด้วย · การเลือกว่าจะ "ปิดหน้าเหมือนล็อต" หรือ "ให้หน้าบอกความจริง"
 * เป็นการตัดสินใจเชิงออกแบบที่ operator ต้องชี้ขาด — แต่การ **เงียบ** ไม่ใช่ทางเลือกในนั้น
 * เพราะหลักข้อ 1 ของสเปกขอบเขตข้อมูลเขียนว่า "ข้อมูลเปิดมีไว้ให้ตรวจสอบคุณภาพ" และคนที่
 * ตรวจคุณภาพต้องรู้ว่าการรับรองยังมีผลอยู่หรือไม่
 *
 * เปิดเผยแค่ **สถานะ** ไม่ใช่เลขที่ใบ ไม่ใช่วันที่ ไม่ใช่ id — ป้ายกลางแปลงตอบใครก็ได้ที่
 * เดินผ่าน และสำหรับพืชควบคุมหน้านี้ยังมาสก์ชื่อฟาร์มกับอำเภออยู่
 */
'use strict';

const { publicCertificateState } = require('../../services/trace-service/resolve-plot-cycle');

describe('สถานะใบรับรองบนป้ายของแปลง', () => {
    const future = new Date(Date.now() + 365 * 24 * 3600 * 1000);
    const past = new Date('2020-01-01');

    test('ใบยังมีผล', () => {
        expect(publicCertificateState({ status: 'active', expiryDate: future }))
            .toEqual({ status: 'ACTIVE', isValid: true });
    });

    test('ใบหมดอายุ', () => {
        expect(publicCertificateState({ status: 'active', expiryDate: past }))
            .toEqual({ status: 'EXPIRED', isValid: false });
    });

    test('ใบถูกเพิกถอน — เพิกถอนชนะวันหมดอายุ', () => {
        expect(publicCertificateState({ status: 'REVOKED', expiryDate: future }))
            .toEqual({ status: 'REVOKED', isValid: false });
    });

    test('ไม่มีใบผูกอยู่เลย = บอกว่าไม่มี ไม่ใช่เงียบ', () => {
        expect(publicCertificateState(null)).toEqual({ status: 'NONE', isValid: false });
    });

    test('ไม่ปล่อยเลขที่ใบ วันที่ หรือ id ออกไปกับป้าย', () => {
        const out = publicCertificateState({
            id: 'cert-1', certificateNumber: 'GACP-TH-2569-AAAAAA',
            status: 'active', expiryDate: future, issuedDate: new Date('2026-01-01'),
        });
        expect(Object.keys(out).sort()).toEqual(['isValid', 'status']);
        expect(JSON.stringify(out)).not.toContain('GACP-TH');
    });
});
