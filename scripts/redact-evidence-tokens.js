#!/usr/bin/env node
'use strict';
/**
 * ปกปิดโทเคนในไฟล์หลักฐาน ก่อนมันเข้าไปอยู่ในประวัติ git ถาวร
 *
 * ═══ ทำไมต้องมี ═══
 * สแกนเต็มประวัติ 2026-09-11 พบ 320 finding · **304 อยู่ใน evidence/** และทั้งหมดเป็น
 * log ดิบของ jest หรือของ gate ที่ถูก commit ไว้เป็นหลักฐาน · ค่าที่โดนแฟล็กคือสิ่งที่
 * โปรแกรมพิมพ์ออกมาเองตอนรัน — JWT ของบัญชี seed, ลิงก์รีเซ็ตรหัสของผู้ใช้ทดสอบ
 *
 * operator ตัดสินแล้วว่า **ไม่ rewrite history** (จะทำลาย SHA ที่ attestation ทุกใบผูกไว้)
 * ⇒ ทุก commit ที่พก log ดิบเข้ามา เพิ่มจำนวน finding อย่างถาวรและย้อนกลับไม่ได้
 * การไล่ใส่ fingerprint เป็นการรักษาอาการ · ไฟล์นี้คือการปิดต้นเหตุ
 *
 * ═══ ปกปิดอะไร ═══
 * JWT (สามส่วนคั่นด้วยจุด ขึ้นต้น eyJ) · token ในลิงก์รีเซ็ต/ยืนยัน · ค่าเลขฐานสิบหก
 * ยาว ๆ ที่ตามหลังคำว่า token/secret/key · **ไม่แตะอย่างอื่น** เพราะ log ที่ถูกปกปิดเกิน
 * จนอ่านไม่รู้เรื่อง จะทำให้คนเลิกเก็บหลักฐาน ซึ่งแย่กว่าปัญหาเดิม
 *
 * ═══ ไม่ใช่ตัวสแกนความลับ ═══
 * ไม่ได้มาแทน gitleaks หรือ probe `no-secret` · มันลดสิ่งที่ไหลเข้าไปใหม่ ไม่ได้ตัดสินว่า
 * อะไรคือความลับ · ของที่มันพลาด ด่านสองชั้นยังเจอเหมือนเดิม
 *
 * ใช้:  node scripts/redact-evidence-tokens.js <ไฟล์...>      แก้ไฟล์ในที่
 *       cat log | node scripts/redact-evidence-tokens.js       ผ่าน stdin
 *       node scripts/redact-evidence-tokens.js --check <ไฟล์...>  ไม่แก้ คืน 1 ถ้าเจอ
 */

const fs = require('fs');

const RULES = [
    // JWT — header.payload.signature · เก็บ 8 ตัวแรกไว้ให้ยังอ้างอิงกันได้ในรายงาน
    [/\beyJ[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}\.[A-Za-z0-9_-]{6,}/g,
        (m) => `${m.slice(0, 8)}…[JWT ปกปิด ${m.length} ตัวอักษร]`],
    // token ในลิงก์ — ?token=… หรือ &token=…
    [/([?&](?:token|code|reset|verify)=)([A-Za-z0-9_\-.]{16,})/gi,
        (_m, p, v) => `${p}[ปกปิด ${v.length} ตัวอักษร]`],
    // ค่ายาวหลังคำที่บอกว่าเป็นของลับ
    [/\b((?:api[_-]?key|secret|passphrase|access[_-]?token|refresh[_-]?token)["'\s:=]{1,4})([A-Za-z0-9_\-]{24,})/gi,
        (_m, p, v) => `${p}[ปกปิด ${v.length} ตัวอักษร]`],
];

function redact(text) {
    let out = text;
    for (const [re, fn] of RULES) { out = out.replace(re, fn); }
    return out;
}

function main(argv) {
    const check = argv[0] === '--check';
    const files = check ? argv.slice(1) : argv;

    if (files.length === 0) {
        const input = fs.readFileSync(0, 'utf8');
        process.stdout.write(redact(input));
        return 0;
    }

    let dirty = 0;
    for (const file of files) {
        let text;
        try { text = fs.readFileSync(file, 'utf8'); } catch { continue; }
        const out = redact(text);
        if (out === text) { continue; }
        dirty += 1;
        if (check) {
            console.error(`โทเคนที่ยังไม่ถูกปกปิดใน ${file}`);
        } else {
            fs.writeFileSync(file, out);
            console.log(`ปกปิดโทเคนใน ${file}`);
        }
    }
    return check && dirty > 0 ? 1 : 0;
}

if (require.main === module) { process.exit(main(process.argv.slice(2))); }
module.exports = { redact };
