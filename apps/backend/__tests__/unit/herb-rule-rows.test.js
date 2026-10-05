'use strict';

/**
 * T3 — กฎหมายเอกสาร กทล.1 ของแต่ละชนิด ในฐานะข้อมูลที่มีวันที่ (spec 2026-09-01 §2.1)
 *
 * ชุดแถวคือกฎหมายของ ส่วนที่ ๓ และสิ่งที่ควรตรึงคือ *กฎหมาย* ไม่ใช่สคริปต์: แถวที่หายไป
 * แปลว่าเกษตรกรไม่เคยถูกขอเอกสารที่กรมต้องการ ส่วนมิติที่เกินมาแปลว่ากฎที่ไม่มีวันทำงาน
 * ทั้งสองอย่างเงียบจนกว่าจะมีคำขอหลุดผ่านไป
 *
 * 2026-09-11 ขยายจากกัญชาชนิดเดียวเป็นหกชนิด (มติ operator) — สิ่งที่ต่างกันจริงมีอย่างเดียว
 * คือใบอนุญาตสมุนไพรควบคุม ซึ่งมีแค่กัญชากับกระท่อม
 *
 * So this suite tests the PURE row builder and the PURE idempotency matcher —
 * no database, no client, no clock. Requiring the script must therefore never
 * build a Prisma client (same discipline as
 * __tests__/unit/close-quotations-script.test.js).
 */

const path = require('path');
const { execFileSync } = require('child_process');

const fs = require('fs');

const {
    buildHerbRuleRows,
    buildAllHerbRuleRows,
    findExistingOpenRule,
    HERB_SLUGS,
    CANNABIS_SLUG,
} = require('../../scripts/seed-herb-requirement-rules');
const { CONTROLLED_HERB_SLUGS } = require('../../config/plant-species-slugs');

const BACKEND_DIR = path.join(__dirname, '..', '..');
const SCRIPT_PATH = path.join(BACKEND_DIR, 'scripts', 'seed-herb-requirement-rules.js');

describe('กฎหมายเอกสารของกัญชา v1', () => {
    const rows = buildHerbRuleRows('cannabis', { effectiveFrom: '2026-09-02T00:00:00Z' });
    it('has exactly 30 rows, all cannabis, all dated', () => {
        // 29 base rows + licence_pt11 for the PROCESSING scope. Fix round 2 (operator
        // 2026-10-05): the two controlled_herb_license rows (PLANTING, PROCESSING) are gone —
        // the cannabis planting licence is optional ("ถ้ามี"), and the register holds
        // required rows only; PROCESSING asks for ภ.ท. 11 under the purpose's own slot id.
        expect(rows).toHaveLength(30);
        rows.forEach((r) => { expect(r.plantCode).toBe('cannabis'); expect(r.effectiveFrom).toBe('2026-09-02T00:00:00Z'); });
    });
    it('the six every-case slots carry no case dims', () => {
        const every = rows.filter((r) => !r.holderType && !r.landTenure && !r.areaType && !r.certScope && r.requestType === 'NEW');
        expect(every.map((r) => r.slotId).sort()).toEqual(
            ['id_house_reg', 'land_rights', 'production_util_plan', 'security_residue_plan', 'site_map_coords', 'site_photos', 'sop_manual'].sort());
    });
    it('conditions match the law', () => {
        expect(rows.find((r) => r.slotId === 'landlord_consent').landTenure).toBe('RENTED');
        expect(rows.filter((r) => r.slotId === 'building_plan_photos').map((r) => r.areaType).sort()).toEqual(['GREENHOUSE', 'INDOOR']);
        expect(rows.find((r) => r.slotId === 'field_surround_photos').areaType).toBe('OUTDOOR');
        expect(rows.find((r) => r.slotId === 'producer_supervision_letter').holderType).toBe('INDIVIDUAL');
        expect(rows.filter((r) => r.slotId === 'licence_pt11').map((r) => r.certScope)).toEqual(['PROCESSING']);
        expect(rows.map((r) => r.slotId)).not.toContain('controlled_herb_license');
        // 2026-09-06 (operator approval, proposal P1/P2): a succeeding request must still
        // prove WHO is filing. The ministry's own intake checklist lists บัตร ปชช.+ทะเบียนบ้าน
        // for every คำขอ without splitting by type; กทล.1 exempts renewals from the FORM's
        // ส่วนที่ ๑-๒, not from its attachments.
        expect(rows.filter((r) => r.requestType === 'RENEWAL')).toHaveLength(10);
        expect(rows.filter((r) => r.requestType === 'REPLACEMENT')).toHaveLength(3);
        expect(rows.filter((r) => r.slotId === 'id_house_reg').map((r) => r.requestType).sort())
            .toEqual(['NEW', 'RENEWAL', 'REPLACEMENT']);
    });
});

/**
 * The matcher that makes --apply re-runnable. requirement_rules is append-only,
 * so a second run that files the same law twice cannot be undone by an edit —
 * both rows stay in force, and every reader has to guess which one the ministry
 * meant. "Already on file" therefore has to be decided on the substance of the
 * rule (its slot and its dimension tuple), not on a row id the seed does not own.
 */
describe('the idempotency matcher', () => {
    const rows = buildHerbRuleRows('cannabis', { effectiveFrom: '2026-09-02T00:00:00Z' });
    const juristicReg = rows.find((r) => r.slotId === 'juristic_reg_6m');

    it('recognises the same law already on file under an OLD spelling of the slot', () => {
        // A rule filed before the v2 fold carries yesterday's slot id; nothing
        // rewrites stored rows (spec §7), so a matcher that compared raw strings
        // would file a second copy of a rule that is already in force.
        const onFile = [{
            id: 'rule-old-spelling',
            slotId: 'company_reg',
            holderType: 'JURISTIC',
            requestType: 'NEW',
            plantCode: 'cannabis',
            landTenure: null,
            areaType: null,
            certScope: null,
        }];
        expect(findExistingOpenRule(juristicReg, onFile)).toBe(onFile[0]);
    });

    it('does not recognise a rule that differs in one dimension', () => {
        const onFile = [{
            id: 'rule-other-request-type',
            slotId: 'juristic_reg_6m',
            holderType: 'JURISTIC',
            requestType: 'RENEWAL',
            plantCode: 'cannabis',
            landTenure: null,
            areaType: null,
            certScope: null,
        }];
        expect(findExistingOpenRule(juristicReg, onFile)).toBeNull();
    });

    it('reads an absent dimension and an empty one as the same "every value"', () => {
        const onFile = [{
            id: 'rule-blank-dims',
            slotId: 'juristic_reg_6m',
            holderType: 'JURISTIC',
            requestType: 'NEW',
            plantCode: 'cannabis',
            landTenure: '',
        }];
        expect(findExistingOpenRule(juristicReg, onFile)).toBe(onFile[0]);
    });
});

/**
 * The dry run is what an operator reads before approving --apply, and the box
 * this platform runs on carries NODE_ENV=production in apps/backend/.env. A
 * production refusal that also blocks the run that WRITES NOTHING would teach
 * the operator to type --i-know as a matter of routine — and the next thing they
 * type it in front of is the run that files national policy. So the refusal
 * guards the write, and the dry run stays free: no flag, no database, no client.
 */
describe('the dry run', () => {
    it('prints the whole law and writes nothing under NODE_ENV=production, with no --i-know', () => {
        const out = execFileSync(process.execPath, [SCRIPT_PATH], {
            cwd: BACKEND_DIR,
            env: { ...process.env, NODE_ENV: 'production' },
            encoding: 'utf8',
        });

        expect(out).toMatch(/mode:\s+DRY RUN \(nothing will be written\)/);
        expect(out).toMatch(/rows:\s+175/);   // กัญชา 30 (29 + ภ.ท. 11) + อีก 5 ชนิด x 29
        expect(out).toContain('DRY RUN — no rows written');
        // The law itself is on screen, not just a count.
        expect(out).toContain('land_rights');
        expect(out).toContain('landlord_consent');
        // และเห็นว่ามันครอบทั้งหกชนิด ไม่ใช่กัญชาอย่างเดียว
        expect(out).toMatch(/plant:\s+ทั้งหมด/);
        // Nothing was filed: the words the apply path prints are absent.
        expect(out).not.toContain('FILED');
    }, 30000);
});

/**
 * สิ่งที่มติ 2026-09-11 เปลี่ยนจริง — และสิ่งที่มันต้องไม่เปลี่ยน
 *
 * operator สั่งให้รับหกชนิด และให้ demo "copy ออกมาอีก 5 ชุด แต่ไม่ใช่ใบเดียวกัน"
 * การ copy ตรง ๆ ทั้งดุ้นจะไปขอ "ใบอนุญาตสมุนไพรควบคุม" จากคนปลูกขิง ซึ่งเป็นเอกสารที่
 * ไม่มีอยู่สำหรับขิง — ด่านเอกสารจะกันเขาไว้ตลอดกาลโดยที่เขาหาไฟล์มาแนบไม่ได้เลย
 * และมันจะเงียบ เพราะหน้าจอจะขึ้นแค่ว่า "ยังไม่ได้แนบ"
 */
describe('หกชนิด แยกกันจริง และไม่ขอเอกสารที่ไม่มีอยู่', () => {
    const all = buildAllHerbRuleRows({ effectiveFrom: '2026-09-02T00:00:00Z' });

    it('ทุกชนิดในทะเบียนคำศัพท์มีกฎหมายของตัวเอง ไม่มีชนิดไหนตกหล่น', () => {
        expect(HERB_SLUGS).toHaveLength(6);
        expect([...new Set(all.map((r) => r.plantCode))].sort()).toEqual([...HERB_SLUGS].sort());
    });

    it('ไม่มีแถวไหน plantCode ว่าง — ว่างแปลว่า "ทุกชนิด" ซึ่งจะรวมสองชุดเข้าเป็นฉบับเดียว', () => {
        expect(all.filter((r) => !r.plantCode)).toEqual([]);
    });

    it('ใบอนุญาตในทะเบียน (ภ.ท. 11 ขอบข่ายแปรรูป) ขอเฉพาะกัญชา — กระท่อมและอีกสี่ชนิดไม่มี', () => {
        const askedOf = [...new Set(
            all.filter((r) => r.slotId === 'licence_pt11').map((r) => r.plantCode),
        )];
        expect(askedOf).toEqual([CANNABIS_SLUG]);
        const licenceSlots = ['controlled_herb_license', 'licence_pt09', 'licence_pt10', 'licence_pt11', 'kratom_export_licence'];
        all.filter((r) => r.plantCode !== CANNABIS_SLUG).forEach((r) => {
            expect(licenceSlots).not.toContain(r.slotId);
        });
    });

    it('อีกห้าชนิดได้ชุดพื้นฐานครบ แค่ไม่มีใบอนุญาต', () => {
        const base = buildHerbRuleRows('cannabis').map((r) => r.slotId).filter((id) => id !== 'licence_pt11');
        ['kratom', 'turmeric', 'ginger', 'plai', 'black_galangal'].forEach((herb) => {
            expect(new Set(buildHerbRuleRows(herb).map((r) => r.slotId))).toEqual(new Set(base));
        });
    });

    it('ปฏิเสธชนิดที่แพลตฟอร์มตั้งชื่อไม่ได้ แทนที่จะเงียบ ๆ ยื่นชุดเปล่า', () => {
        expect(() => buildHerbRuleRows('lavender')).toThrow(/lavender/);
    });

    /**
     * `CONTROLLED_HERB_SLUGS` เป็นสำเนาโดยจำเป็น — builder ต้องบริสุทธิ์ แตะฐานข้อมูลไม่ได้
     * ส่วน isControlled ตัวจริงอยู่บนตาราง HerbSpecies ที่ seed-herbs.js เขียน
     * ผูกสองที่ด้วยการอ่านไฟล์ seed เป็นข้อความ สำนวนเดียวกับ plant-slug-map-covers-the-wizard
     */
    /**
     * ข้อเท็จจริง "ชนิดนี้ถูกกฎหมายควบคุมไหม" ถูกเขียนไว้สามที่โดยจำเป็น และทั้งสามที่
     * ตัดสินคนละเรื่อง — ขอใบอนุญาตไหม (ที่นี่) · ทะเบียนสมุนไพร (seed-herbs.isControlled)
     * · ปิดบังที่อยู่แปลงบนหน้าสแกนสาธารณะไหม (seed-plants.requiresLicense)
     *
     * ถ้าสามที่นี้เพี้ยนกัน จะไม่มีอะไรพัง — แต่จะมีแปลงกัญชาที่ที่อยู่ถูกเปิดสาธารณะ
     * หรือคนปลูกขิงที่ถูกขอใบอนุญาตที่ไม่มีอยู่ ทั้งสองอย่างเงียบ
     */
    it('รายชื่อชนิดที่ควบคุม ตรงกับ requiresLicense ใน seed-plants.js ด้วย', () => {
        const text = fs.readFileSync(path.join(BACKEND_DIR, 'prisma', 'seed-plants.js'), 'utf8');
        const needsLicence = [...text.matchAll(/code: '([A-Z]{3})'[\s\S]*?requiresLicense: (true|false)/g)]
            .filter((m) => m[2] === 'true')
            .map((m) => m[1]);
        expect(needsLicence.sort()).toEqual(['CAN', 'KRA']);

        const { PLANT_SLUG_TO_CODE } = require('../../config/plant-species-slugs');
        expect(CONTROLLED_HERB_SLUGS.map((s) => PLANT_SLUG_TO_CODE[s]).sort()).toEqual(['CAN', 'KRA']);
    });

    it('รายชื่อชนิดที่ควบคุม ตรงกับ isControlled ใน seed-herbs.js', () => {
        const text = fs.readFileSync(path.join(BACKEND_DIR, 'prisma', 'seed-herbs.js'), 'utf8');
        const controlledCodes = [...text.matchAll(/code: '([A-Z_]+)'[^\n]*isControlled: true/g)]
            .map((m) => m[1]);
        expect(controlledCodes.sort()).toEqual(['CANNABIS', 'KRATOM']);

        const { PLANT_SLUG_TO_CODE } = require('../../config/plant-species-slugs');
        const controlledMasterCodes = CONTROLLED_HERB_SLUGS.map((slug) => PLANT_SLUG_TO_CODE[slug]);
        expect(controlledMasterCodes.sort()).toEqual(['CAN', 'KRA']);
    });
});
