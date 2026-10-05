/**
 * คำถามกับคำตอบต้องเป็นชุดเดียวกัน
 *
 * บั๊กประจำถิ่นของหน้าสแกน: คอลัมน์มีอยู่ · ตัวส่งออกพิมพ์มัน · แต่ `select` ไม่ได้ขอ
 * Prisma คืน undefined ให้ฟิลด์ที่ไม่ได้ขอ (ไม่ใช่ error) `?? null` จึงตีพิมพ์ null
 * ออกไปเงียบ ๆ และหน้าเว็บอ่านว่าฟาร์มไม่เคยกรอกข้อมูลนั้น — เกิดมาแล้วสามครั้ง
 * (T8 plotCode, T12 address, N6 readAt)
 *
 * เทสนี้ผูกสองด้านเข้าหากันแบบสองทาง เพื่อให้การเพิ่มฟิลด์ที่ลืมอีกด้านหนึ่ง = แดง
 */

const { PUBLIC_FARM_SELECT, toPublicFarm } = require('../../services/trace-service/public-farm');

/** แถวฟาร์มที่ "ตอบครบทุกคอลัมน์ที่คิวรีขอ" — ค่าไม่ซ้ำกันเพื่อไล่หาได้ว่าหายไปที่ไหน */
function rowAnsweringTheSelect() {
    const row = {};
    Object.keys(PUBLIC_FARM_SELECT).forEach((key, i) => { row[key] = `sentinel-${i}-${key}`; });
    return row;
}

describe('projection ของฟาร์มสาธารณะ ต้องขอทุกคอลัมน์ที่มันตีพิมพ์', () => {
    test('ไม่มีฟิลด์ไหนออกมาเป็น null ทั้งที่คิวรีตอบครบแล้ว', () => {
        const published = toPublicFarm(rowAnsweringTheSelect());
        const empty = Object.entries(published)
            .filter(([, v]) => v === null || v === undefined)
            .map(([k]) => k);
        // ว่างทั้งที่ข้อมูลครบ = projection อ่านคอลัมน์ที่ PUBLIC_FARM_SELECT ไม่ได้ขอ
        expect(empty).toEqual([]);
    });

    test('ทุกคอลัมน์ที่คิวรีขอ ถูกใช้จริง — ไม่มีการขอข้อมูลมาโดยไม่มีใครอ่าน', () => {
        const row = rowAnsweringTheSelect();
        const serialised = JSON.stringify(toPublicFarm(row));
        const unused = Object.keys(row).filter((key) => !serialised.includes(row[key]));
        // ขอมาแล้วไม่ได้ใช้ = ดึงข้อมูลของเกษตรกรออกจากฐานโดยไม่มีเหตุผล
        expect(unused).toEqual([]);
    });

    test('พิกัดไม่ได้อยู่ในคำถามด้วยซ้ำ', () => {
        expect(PUBLIC_FARM_SELECT.latitude).toBeUndefined();
        expect(PUBLIC_FARM_SELECT.longitude).toBeUndefined();
        // id ต้องไม่ติดมาโดยปริยาย — ผู้เรียกที่ต้องใช้ต้องเขียนขอเองให้เห็น
        expect(PUBLIC_FARM_SELECT.id).toBeUndefined();
    });

    test('ฟาร์มที่ไม่ได้กรอกที่อยู่ ได้ null ไม่ใช่ค่าปลอม และไม่ทำให้ทั้งก้อนพัง', () => {
        const bare = { farmName: 'ฟ', farmType: 'CULTIVATION', district: 'อ', province: 'จ', status: 'ACTIVE' };
        expect(toPublicFarm(bare)).toMatchObject({
            name: 'ฟ', location: 'อ, จ', address: null, subDistrict: null, postalCode: null,
        });
    });
});
