/**
 * ค่าที่ผู้ใช้พิมพ์ กลายเป็น href ได้ก็ต่อเมื่อมันเป็นที่อยู่จริง
 *
 * คำสั่ง operator 2026-09-08: "ปล่อยผ่านแล้ว escape ตอนแสดงผล" — ประตูรับข้อมูลเลิก
 * แก้ไขสิ่งที่คนพิมพ์แล้ว หน้าที่กันจึงย้ายมาอยู่ที่จุดแสดงผลทั้งหมด · React escape
 * ข้อความให้เอง แต่ **ไม่ได้ตรวจ scheme ของ URL** — `<a href={x}>` ที่ x เป็น
 * `javascript:...` คือโค้ดที่รันในเซสชันของคนที่กด
 *
 * วัดจริง 2026-09-09 บนระบบที่รันอยู่ · ผู้ยื่นบันทึกร่างของตัวเอง:
 *
 *   POST /api/applications/draft
 *     { formData: { documents: { id_card: "javascript:alert(document.domain)" } } }
 *   -> เก็บลงฐานข้อมูลจริง (คีย์ระดับบนถูกกรอง คีย์ซ้อนไม่ถูก)
 *   -> GET /api/provider/applications/:id  คืนค่าเดิมกลับมาให้เจ้าหน้าที่
 *   -> resolveDocumentUrl() คืนสตริงนั้นตรง ๆ ไม่มีการตรวจ scheme
 *   -> documents-tab-panel.tsx:82  <a href={url} target="_blank">เปิด</a>
 *
 * เจ้าหน้าที่กดปุ่ม "เปิด" = โค้ดของผู้ยื่นรันบน origin ของแพลตฟอร์ม พร้อมเซสชันของ
 * เจ้าหน้าที่คนนั้น · การตรวจนามสกุลไฟล์ (isPdfFileUrl) กันไม่ได้ เพราะ
 * `javascript:alert(1)//x.pdf` ก็ลงท้ายด้วย .pdf
 *
 * ที่นี่จึงอนุญาตเฉพาะสิ่งที่เป็นที่อยู่ได้จริง:
 *   - พาธภายในเว็บเดียวกัน  /uploads/...
 *   - http / https
 *   - mailto  (ลิงก์ติดต่อ)
 * นอกนั้นคืน null — ผู้เรียกตัดสินเองว่าจะซ่อนปุ่มหรือแสดงเป็นข้อความ
 */

/** scheme ที่เปิดแล้วไม่กลายเป็นการรันโค้ด */
const ALLOWED_PROTOCOLS = new Set(['http:', 'https:', 'mailto:']);

/**
 * เบราว์เซอร์ข้ามอักขระควบคุมและช่องว่างก่อนอ่าน scheme — "java<TAB>script:alert(1)"
 * ยังทำงาน · ต้องลอกทิ้งก่อนตัดสิน ไม่ใช่หลังตัดสิน
 */
function stripIgnorable(value: string): string {
    // eslint-disable-next-line no-control-regex
    return value.replace(/[\u0000-\u0020\u007f-\u009f]/g, '');
}

/**
 * คืน URL ที่ปลอดภัยพอจะใส่ใน href/src หรือ null ถ้าไม่ใช่ที่อยู่ที่เปิดได้อย่างปลอดภัย
 */
export function safeUrl(value: unknown): string | null {
    if (typeof value !== 'string') { return null; }
    const raw = value.trim();
    if (!raw) { return null; }

    const probe = stripIgnorable(raw);
    if (!probe) { return null; }

    // พาธภายในเว็บเดียวกัน · "//host" ไม่ใช่พาธ มันคือเว็บอื่น จึงต้องผ่านการตรวจ scheme
    if (probe.startsWith('/') && !probe.startsWith('//')) { return raw; }

    // ไม่มี ':' เลย = ที่อยู่สัมพัทธ์ · มี '/' มาก่อน ':' ก็เช่นกัน เพราะเบราว์เซอร์
    // อ่าน scheme ได้เฉพาะเมื่อ ':' มาก่อนตัวคั่นพาธ
    const colon = probe.indexOf(':');
    const slash = probe.indexOf('/');
    if (colon === -1) { return raw; }
    if (slash !== -1 && slash < colon) { return raw; }

    try {
        // base ใช้เมื่อ raw เป็นที่อยู่สัมพัทธ์ · โดเมนนี้ไม่มีอยู่จริงโดยตั้งใจ
        const parsed = new URL(probe, 'https://relative.invalid');
        return ALLOWED_PROTOCOLS.has(parsed.protocol) ? raw : null;
    } catch {
        return null;
    }
}

/**
 * เหมือน safeUrl แต่คืน undefined เพื่อให้ใส่ prop ของ React ได้ตรง ๆ
 * (`src={safeSrc(x)}` — undefined แปลว่าไม่ใส่ attribute เลย)
 */
export function safeSrc(value: unknown): string | undefined {
    return safeUrl(value) ?? undefined;
}
