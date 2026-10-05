/**
 * ไฟล์ CSV ที่เราสร้าง ต้องไม่กลายเป็นโปรแกรมเมื่อเปิดใน Excel
 *
 * Excel และ LibreOffice ลอกเครื่องหมายคำพูดออกก่อน แล้วประเมินช่องที่ขึ้นต้นด้วย
 * `=` `+` `-` `@` แท็บ หรือ carriage return เป็นสูตร · การใส่เครื่องหมายคำพูดตาม
 * RFC 4180 จึงไม่ใช่การป้องกัน (CWE-1236) — มันแก้เรื่องตัวคั่น ไม่ได้แก้เรื่องสูตร
 *
 * ฝั่ง backend ตัดสินเรื่องนี้ไปแล้ว (audit C5-04) และมี
 * apps/backend/shared/csv-utils.js ใช้อยู่ที่ 4 จุด · ตัวส่งออกฝั่งเบราว์เซอร์ 3 ตัว
 * ไม่ได้ตามมาด้วย ทั้งที่ข้อมูลในนั้นมาจากช่องที่ผู้ยื่นพิมพ์เอง เช่นชื่อฟาร์ม ซึ่ง
 * routes/api/farm/farms.js ตรวจแค่ว่ามีค่าหรือไม่
 *
 * เส้นทางที่ทำให้เป็นเรื่อง: ผู้ยื่นตั้งชื่อฟาร์มขึ้นต้นด้วย `=` -> ค่านอนอยู่ใน
 * ฐานข้อมูลจนกว่าผู้ดูแลจะเปิดหน้า /admin/certificates กดส่งออก แล้วเปิดไฟล์ใน
 * Excel บนเครื่องของตัวเอง ซึ่งมีรายชื่อใบรับรองของทุกหน่วยงานอยู่บนจอพอดี
 *
 * วิธีเดียวกับ backend: เติม `'` นำหน้า ทำให้ Excel อ่านเป็นข้อความ
 */

/** อักขระที่ทำให้ช่องหนึ่งกลายเป็นสูตร */
const FORMULA_TRIGGER = /^[=+\-@\t\r]/;

/**
 * ทำให้ค่าหนึ่งช่องปลอดภัยจากการถูกประเมินเป็นสูตร
 * ตรงกับ apps/backend/shared/csv-utils.js — สองฝั่งต้องตัดสินเหมือนกัน
 */
export function neutralizeCsvFormula(value: string): string {
    if (typeof value !== 'string' || value.length === 0) {
        return value;
    }
    return FORMULA_TRIGGER.test(value) ? `'${value}` : value;
}

/**
 * แปลงค่าหนึ่งช่องเป็นข้อความ CSV: กันสูตรก่อน แล้วค่อยใส่เครื่องหมายคำพูดตาม RFC 4180
 * ลำดับสำคัญ — กันสูตรหลังใส่คำพูดจะไม่มีผล เพราะ Excel ลอกคำพูดออกก่อนประเมิน
 */
export function csvCell(value: string | number | null | undefined): string {
    if (value === null || value === undefined) { return ''; }
    const safe = neutralizeCsvFormula(String(value));
    if (/[",\n\r]/.test(safe)) {
        return `"${safe.replace(/"/g, '""')}"`;
    }
    return safe;
}

/** หนึ่งบรรทัดของ CSV */
export function csvRow(values: Array<string | number | null | undefined>): string {
    return values.map(csvCell).join(',');
}
