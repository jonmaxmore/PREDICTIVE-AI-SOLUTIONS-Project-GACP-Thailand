'use strict';

/**
 * ต้นแบบที่ 5 (ก) — สแกน/ตรวจ/รวมชุดข้อมูลอ้างอิงสมุนไพร (AI draft) ก่อนนำเข้า.
 *
 * HONEST: ชุดข้อมูลนี้เป็นร่างที่เรียบเรียงโดย AI (source ทุกแถวระบุ "ต้อง
 * ตรวจสอบกับ SSRU") — ยังไม่ใช่ข้อมูล authoritative. สคริปต์นี้ทำหน้าที่ชั้น
 * accountability ก่อนนำเข้า staging:
 *   1) validate schema ให้ตรง entrySchema ของ herb-knowledge-service
 *   2) red-flag scan: กันคำแนะนำขนาดยาในมนุษย์ / การใช้เพื่อเสพ / อ้างรักษาหายขาด
 *   3) normalize source ให้มี marker "AI_DRAFT" + "verify SSRU" เสมอ
 *   4) dedup ชื่อซ้ำต่อฐาน, รายงานการกระจายหมวด + coverage ≥300/ฐาน
 *   5) เขียนไฟล์รวมต่อฐาน (…/assembled/<CODE>.json) พร้อมนำเข้า
 *
 * ไม่แตะ production. ปลายทางนำเข้า = staging เท่านั้น จนกว่า SSRU จะตรวจเนื้อหา.
 */

const fs = require('fs');
const path = require('path');

const CATEGORIES = ['VARIETY', 'ACTIVE_COMPOUND', 'CULTIVATION', 'HARVEST', 'PROCESSING', 'DISEASE', 'LEGAL', 'GENERAL'];
const CODES = ['CANNABIS', 'TURMERIC', 'GINGER', 'BLACK_GALINGALE', 'PLAI', 'KRATOM'];
const MAX_TITLE = 500, MAX_CONTENT = 20000, MAX_UNIT = 50, MAX_SOURCE = 500;
const TARGET = 300;

// Red flags — patterns that must NOT appear in a GACP agronomy reference draft.
// Target ACTUAL guidance/instructions, NOT mere mentions of legal/addiction
// status: a LEGAL entry about cannabis/kratom must legitimately use words like
// "ยาเสพติด" (narcotic) / "เสพติด" (addiction) / "ปลดล็อก", and responsible
// safety notes (4x100 danger, adolescent risk) must be allowed. So we match
// human DOSING INSTRUCTIONS, recreational HOW-TO, and absolute cure claims only.
const RED_FLAGS = [
    { re: /(รับประทาน|กิน|ทาน|ใช้)[^.]{0,20}\d+\s*(มก\.?|มิลลิกรัม|เม็ด|แคปซูล)\s*(ต่อวัน|\/วัน|วันละ)/i, why: 'human dosing instruction' },
    { re: /ขนาด(รับประทาน|ใช้|ยา)[^.]{0,15}\d+\s*(มก|mg|กรัม)/i, why: 'dose figure' },
    { re: /(วิธี|การ)?(เสพ|สูบ|ใช้)[^.]{0,12}(ให้เมา|เพื่อความเมา|เพื่อความมัน|เพื่อนันทนาการ|ให้ออกฤทธิ์เมา)/i, why: 'recreational how-to' },
    { re: /สูบเพื่อ(ให้)?เมา|เสพเพื่อความ|กัญชานันทนาการ(ถูกกฎหมาย|ได้)/i, why: 'recreational guidance' },
    { re: /รักษา(ให้)?หายขาด|รักษามะเร็งได้จริง|หายขาด\s*100|ทดแทนการรักษาของแพทย์/i, why: 'absolute/medical-cure claim' },
];

function loadRows() {
    const dir = process.argv[2];
    if (!dir || !fs.existsSync(dir)) {
        throw new Error(`usage: node scan-and-assemble.js <herb-content-dir> [outDir]\n  dir not found: ${dir}`);
    }
    const byCode = Object.fromEntries(CODES.map(c => [c, []]));
    for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
        const rows = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
        const code = f.split('__')[0];
        if (!byCode[code]) { continue; }
        for (const r of rows) { byCode[code].push(r); }
    }
    return byCode;
}

function normalizeSource(src) {
    const base = (src && String(src).trim()) || 'AI compiled reference';
    // Always carry an explicit AI-draft + verify marker; keep within 500 chars.
    let s = base.includes('AI') || base.includes('AI_DRAFT') ? base : `AI_DRAFT: ${base}`;
    if (!/SSRU|ตรวจสอบ|verify/i.test(s)) { s = `${s} (ต้องตรวจสอบกับ SSRU)`; }
    return s.slice(0, MAX_SOURCE);
}

function validateRow(r) {
    const errs = [];
    if (!CATEGORIES.includes(r.category)) { errs.push(`bad category: ${r.category}`); }
    const title = (r.title || '').trim();
    const content = (r.content || '').trim();
    if (title.length < 1 || title.length > MAX_TITLE) { errs.push(`title len ${title.length}`); }
    if (content.length < 1 || content.length > MAX_CONTENT) { errs.push(`content len ${content.length}`); }
    if (r.unit != null && String(r.unit).length > MAX_UNIT) { errs.push('unit too long'); }
    if (r.valueNumber != null && typeof r.valueNumber !== 'number') { errs.push('valueNumber not number'); }
    return errs;
}

function scanRedFlags(r) {
    const hay = `${r.title} ${r.content}`;
    return RED_FLAGS.filter(f => f.re.test(hay)).map(f => f.why);
}

function main() {
    const outDir = process.argv[3] || path.join(process.argv[2], 'assembled');
    const byCode = loadRows();
    fs.mkdirSync(outDir, { recursive: true });

    let totalIn = 0, totalOut = 0, totalInvalid = 0, totalRed = 0, totalDup = 0;
    const summary = [];

    for (const code of CODES) {
        const rows = byCode[code] || [];
        totalIn += rows.length;
        const seen = new Set();
        const clean = [];
        const catCount = Object.fromEntries(CATEGORIES.map(c => [c, 0]));

        for (const r of rows) {
            const errs = validateRow(r);
            if (errs.length) { totalInvalid += 1; continue; }
            const red = scanRedFlags(r);
            if (red.length) { totalRed += 1; console.warn(`  [RED ${code}] "${r.title}" → ${red.join(',')}`); continue; }
            const key = `${r.category}::${r.title.trim()}`;
            if (seen.has(key)) { totalDup += 1; continue; }
            seen.add(key);
            // Build to match the server entrySchema EXACTLY: unit/valueNumber are
            // `.optional()` (accept undefined, NOT null) → OMIT them when absent,
            // never emit null, or zod rejects the whole row (skipped server-side).
            const row = {
                category: r.category,
                title: r.title.trim(),
                content: r.content.trim(),
                source: normalizeSource(r.source),
            };
            if (typeof r.valueNumber === 'number') { row.valueNumber = r.valueNumber; }
            const unit = r.unit && String(r.unit).trim();
            if (unit) { row.unit = unit.slice(0, MAX_UNIT); }
            clean.push(row);
            catCount[r.category] += 1;
        }

        totalOut += clean.length;
        fs.writeFileSync(path.join(outDir, `${code}.json`), JSON.stringify(clean, null, 1));
        const meets = clean.length >= TARGET;
        summary.push({ code, in: rows.length, out: clean.length, meets, cats: catCount });
        const catStr = CATEGORIES.map(c => `${c.slice(0, 4)}:${catCount[c]}`).join(' ');
        console.log(`${meets ? 'OK ' : 'LOW'} ${code.padEnd(16)} ${String(clean.length).padStart(3)}/${TARGET}  [${catStr}]`);
    }

    console.log(`\nTOTAL in=${totalIn} out=${totalOut} invalid=${totalInvalid} redFlags=${totalRed} dups=${totalDup}`);
    const allMeet = summary.every(s => s.meets);
    const emptyCats = summary.flatMap(s => CATEGORIES.filter(c => s.cats[c] === 0).map(c => `${s.code}/${c}`));
    console.log(`allHerbsMeet300=${allMeet}  emptyCategories=${emptyCats.length ? emptyCats.join(',') : 'none'}`);
    console.log(`assembled → ${outDir}`);
    if (!allMeet) { process.exitCode = 2; }
}

main();
