/**
 * A01v2 — วิซาร์ดหกขั้นของจริง: วิสาหกิจชุมชน + เช่าที่ดิน + อาคารระบบปิด + ส่งออก
 *
 * ทำไมต้องมีใบนี้ทั้งที่มี a01 อยู่แล้ว: a01 ขับวิซาร์ดรุ่นเก่า (documents-step ที่ถูกลบ
 * ไปแล้วใน T15) ใบนี้เดินของใหม่ทั้งเส้น และตรวจสิ่งที่วิซาร์ดใหม่สัญญาไว้แต่เทสหน่วย
 * พิสูจน์ไม่ได้ — ว่าการ์ดเอกสารโผล่/หายตาม "คำตอบของเซิร์ฟเวอร์" จริง ไม่ใช่ตามรายการ
 * ที่เบราว์เซอร์ถืออยู่ (step3-site-land.tsx:214 ยิงถามใหม่ทุกครั้งที่มิติเปลี่ยน)
 *
 * SELECTOR — อ่านก่อนแก้
 *   วิซาร์ดทั้งเส้นมี data-testid อยู่ตัวเดียวคือ `step6-submit` ปุ่มนำทางและตัวเลือก
 *   ทุกขั้นไม่มีทั้ง testid, aria-label และ id · ตัวเลือกไม่ใช่ radio/checkbox จริง แต่เป็น
 *   <button aria-pressed> (step1-request-type.tsx:36, step3-site-land.tsx:109,155)
 *   ⇒ getByRole('radio'|'checkbox') หาไม่เจอทั้งหมด ต้องยิงด้วย role=button + ข้อความไทย
 *   การ์ดเอกสารก็ไม่มี attribute บอก slotId ⇒ ระบุการ์ดได้ทางเดียวคือชื่อเอกสารจาก
 *   catalog ฝั่ง backend (constants/document-slots.js) ซึ่งเป็นสิ่งที่ผู้ใช้เห็นจริง
 *   ถ้าวันหนึ่งมีคนเติม testid ให้การ์ด ให้เปลี่ยนมาใช้ testid — ข้อความไทยเปราะกว่าเสมอ
 *
 * TWO-STATE: คำขอ v2 ของเกษตรกรคนนี้อาจถูกยื่นไปแล้วโดยรอบก่อน ใบนี้จึงอ่านสถานะจาก
 * ฐานข้อมูลก่อนกด แล้วยอมรับสองสถานะ — DRAFT (รอบนี้เป็นคนยื่น) หรือยื่นไปแล้ว
 * (รอบนี้ยืนยันของที่มีอยู่ ไม่ยื่นซ้ำ)
 *
 * ห้ามรันใบนี้ในงานที่สร้างมัน (task-16) — coordinator เป็นคนกด
 */
import { test, expect, type Page } from '@playwright/test';
import { FARMERS, pw, seg, shot, saveVar, readVars, g4psql, g4Login, farmerId, typeInto } from './g4-helpers';

/** เกษตรกร B — โปรไฟล์ที่ G4.2 ให้สามแปลง จึงมีที่ดินให้พูดถึงในขั้นที่ 3 */
const P = FARMERS.B;
const OUT = seg('a01v2');
const FARMER_ID = farmerId(P);

/** เลขทะเบียนวิสาหกิจชุมชน (สวช.01) — mint ครั้งเดียวแล้วอ่านกลับ เพื่อให้ resumable */
function communityRegNo(): string {
    const key = `${P.varPrefix}_SAWACHO1`;
    const existing = readVars()[key];
    if (existing) return existing;
    const value = `1-57-01-01/1-${String(Math.floor(Math.random() * 9000) + 1000)}`;
    saveVar(key, value);
    return value;
}

/** ชื่อเอกสารบนจอ — มาจาก apps/backend/constants/document-slots.js ไม่ใช่จากฝั่งเว็บ */
const SLOT_LABEL_TH = {
    landlord_consent: 'หนังสือยินยอมจากผู้ให้เช่าหรือผู้ให้ใช้ที่ดิน',
    building_plan_photos: 'แบบแปลนอาคาร',
    field_surround_photos: 'ภาพถ่ายแปลงปลูกและบริเวณโดยรอบ',
} as const;

/**
 * การ์ดเอกสารหนึ่งใบ
 *
 * ทั้งการ์ดคือ <div> ที่ครอบทั้งชื่อเอกสารและ <input type="file"> ที่ซ่อนอยู่ · บรรพบุรุษ
 * ของมันก็ครอบทั้งสองอย่างเหมือนกัน แต่ locator คืนผลตามลำดับเอกสาร ซึ่งบรรพบุรุษมาก่อน
 * เสมอ .last() จึงคือการ์ดตัวในสุด
 */
function slotCard(page: Page, labelTH: string) {
    return page
        .locator('div')
        .filter({ has: page.getByText(labelTH, { exact: false }) })
        .filter({ has: page.locator('input[type="file"]') })
        .last();
}

/** ปุ่มตัวเลือกของวิซาร์ด — <button aria-pressed> ที่มีข้อความไทยตรงตัว */
/**
 * One option tile in the wizard.
 *
 * NOT `getByRole('button', { name, exact: true })`: every tile renders its label AND
 * its explanation inside the same button, so the accessible name is the two joined —
 * measured on the running product 2026-09-10, step 1 offers
 * `button "ขอใหม่ ยังไม่เคยได้รับใบรับรอง GACP สำหรับแปลงนี้"`. An exact match on the
 * label alone therefore finds nothing, which is how this spec spent 60 s waiting for a
 * tile that was on screen the whole time.
 *
 * Matching the button that CONTAINS an element whose text is exactly the label keeps the
 * precision the exact flag was reaching for, without depending on the description text.
 */
function choice(page: Page, labelTH: string) {
    return page.locator('button').filter({ has: page.getByText(labelTH, { exact: true }) });
}

const nextButton = (page: Page) => page.getByRole('button', { name: 'ถัดไป', exact: true });

test.describe.serial('A01v2 — วิซาร์ดหกขั้น (วิสาหกิจ + เช่า + อาคารระบบปิด + ส่งออก)', () => {
    test('A01v2 — ยื่นคำขอผ่านหกขั้น แล้วส่งต่อให้หน้าชำระเงิน', async ({ page }) => {
        await g4Login(page, { kind: 'health', id: FARMER_ID, pw: pw(P) });

        // ── สถานะตั้งต้น: คำขอ v2 ของคนนี้อยู่ตรงไหนแล้ว
        const before = JSON.parse(
            g4psql(
                `SELECT id, status FROM applications WHERE "healthId" = '${FARMER_ID}' AND "isDeleted" = false ORDER BY "createdAt" DESC LIMIT 1`,
            ),
        ) as Array<{ id: string; status: string }>;
        const startedAt = before[0]?.status ?? 'NONE';
        const alreadyFiled = startedAt !== 'NONE' && startedAt !== 'DRAFT';
        if (alreadyFiled) {
            // พูดออกมาดัง ๆ · ขั้นที่กลายเป็น no-op เงียบ ๆ คือทางที่ walk เริ่มรายงาน
            // เขียวให้งานที่ไม่ได้ทำ
            // eslint-disable-next-line no-console
            console.log(`[A01v2] คำขออยู่ที่ ${startedAt} แล้ว — รอบนี้ยืนยันของเดิม ไม่ยื่นซ้ำ`);
        }

        if (!alreadyFiled) {
            // ── ขั้นที่ 1 · ประเภทคำขอและผู้ยื่น
            await page.goto('/health/applications/new/step/1');
            await choice(page, 'ขอใหม่').click();
            await choice(page, 'วิสาหกิจชุมชน').click();
            await shot(page, OUT, 'step1.png');
            await nextButton(page).click();

            // ── ขั้นที่ 2 · ตัวตนผู้ยื่น
            // สวช.01 อยู่ขั้นนี้ ไม่ใช่ขั้นที่ 5 อย่างที่ brief เขียนไว้ · ช่องนี้โผล่ก็ต่อเมื่อ
            // ขั้นที่ 1 เลือกวิสาหกิจชุมชน (step2-identity.tsx)
            await page.waitForURL(/\/step\/2/, { timeout: 120_000 });
            const sawacho1 = communityRegNo();
            await typeInto(page, '#identity-communityRegistrationNo', sawacho1);
            await shot(page, OUT, 'step2.png');
            await nextButton(page).click();

            // ── ขั้นที่ 3 · สถานที่และที่ดิน
            await page.waitForURL(/\/step\/3/, { timeout: 120_000 });

            // กดเช่า แล้วการ์ดหนังสือยินยอมต้องโผล่ พร้อมป้ายบอกเหตุผล
            await choice(page, 'เช่าที่ดินจากผู้อื่น').click();
            await typeInto(page, '#landlord-name', 'นายเจ้าของที่ดิน ทดสอบ');
            await expect(page.getByText(SLOT_LABEL_TH.landlord_consent)).toBeVisible({ timeout: 60_000 });
            await expect(page.getByText('เพราะที่ดินเป็นการเช่า')).toBeVisible();

            // กดกลับเป็นเจ้าของ แล้วการ์ดต้องหาย — ทั้งสองทาง ไม่ใช่ทางเดียว
            await choice(page, 'เป็นเจ้าของที่ดิน').click();
            await expect(page.getByText(SLOT_LABEL_TH.landlord_consent)).toBeHidden({ timeout: 60_000 });

            // แล้วกดกลับมาเช่า เพราะนี่คือคำขอที่กำลังเดิน
            await choice(page, 'เช่าที่ดินจากผู้อื่น').click();
            await expect(page.getByText(SLOT_LABEL_TH.landlord_consent)).toBeVisible({ timeout: 60_000 });

            // อาคารระบบปิด → แบบแปลนอาคารมา · ภาพถ่ายแปลงกลางแจ้งต้องไม่มา
            await choice(page, 'อาคารระบบปิด').click();
            await expect(page.getByText(SLOT_LABEL_TH.building_plan_photos)).toBeVisible({ timeout: 60_000 });
            await expect(page.getByText(SLOT_LABEL_TH.field_surround_photos)).toBeHidden();
            await shot(page, OUT, 'step3-cards.png');

            await nextButton(page).click();

            // ── ขั้นที่ 4 · พันธุ์และวัตถุประสงค์
            await page.waitForURL(/\/step\/4/, { timeout: 120_000 });
            await choice(page, 'ส่งออก').click();
            // ประกาศใบอนุญาตส่งออกเป็น role=status ไม่ใช่ alert เพราะมันเป็นการบอกล่วงหน้า
            // ไม่ใช่การปฏิเสธ (step4-variety-purpose.tsx:110)
            await expect(page.getByRole('status').filter({ hasText: 'ใบอนุญาตส่งออกสมุนไพรควบคุม' })).toBeVisible();
            await shot(page, OUT, 'step4-export-notice.png');
            await nextButton(page).click();

            // ── ขั้นที่ 5 · แผนงานและเอกสาร
            await page.waitForURL(/\/step\/5/, { timeout: 120_000 });
            await shot(page, OUT, 'step5.png');
            await nextButton(page).click();

            // ── ขั้นที่ 6 · หน้าทวนคำขอ
            await page.waitForURL(/\/step\/6/, { timeout: 120_000 });

            // การ์ดแดงต้องบอกชื่อเอกสารที่ขาด และบอกด้วยว่าไปแก้ที่ขั้นไหน — ไม่ใช่ให้
            // ผู้ยื่นเดาเองจากหกหน้าจอ
            const missingCard = page.getByRole('alert').filter({ hasText: 'ยังยื่นไม่ได้' });
            await expect(missingCard).toBeVisible({ timeout: 60_000 });
            await expect(missingCard.getByText(/ไปแก้ที่ขั้น\s*\d/)).toBeVisible();
            await shot(page, OUT, 'step6-missing.png');

            // แล้วต้อง "หาย" หลังแนบ — การ์ดที่ขึ้นแล้วไม่มีวันลงคือการ์ดที่บอกอะไรไม่ได้
            // เดินตามลิงก์ที่การ์ดชี้เอง เพราะนั่นคือทางที่ผู้ยื่นจริงจะเดิน
            const firstMissing = missingCard.locator('li').first();
            const missingLabel = (await firstMissing.locator('span').first().innerText()).trim();
            expect(missingLabel.length, 'การ์ดแดงต้องบอกชื่อเอกสารที่ขาด ไม่ใช่บอกแค่ว่าขาด').toBeGreaterThan(0);
            await firstMissing.getByRole('link').click();
            await page.waitForURL(/\/step\/\d/, { timeout: 120_000 });

            await slotCard(page, missingLabel)
                .locator('input[type="file"]')
                .setInputFiles({
                    name: 'a01v2-attachment.pdf',
                    mimeType: 'application/pdf',
                    buffer: Buffer.from('%PDF-1.4\n% a01v2 walk fixture\n'),
                });
            await expect(page.getByText('อัปโหลดแล้ว').first()).toBeVisible({ timeout: 120_000 });

            await page.goto('/health/applications/new/step/6');
            await expect(
                page.getByRole('alert').filter({ hasText: 'ยังยื่นไม่ได้' }).getByText(missingLabel),
                `แนบ "${missingLabel}" แล้ว การ์ดแดงต้องไม่เรียกหามันอีก`,
            ).toBeHidden({ timeout: 120_000 });
            await shot(page, OUT, 'step6-missing-cleared.png');
        }

        // กทล.1 ที่ระบบประกอบให้ ต้องหอบเลข สวช.01 ที่กรอกไว้ขั้นที่ 2 มาด้วย
        // ถ้าไม่มา แปลว่ากระดาษกับฟอร์มพูดคนละเรื่อง ซึ่งเป็นสิ่งที่หน้าทวนนี้มีไว้จับ
        await page.goto('/health/applications/new/step/6');
        await expect(page.getByText('แบบคำขอ กทล ๑ ที่ระบบประกอบให้')).toBeVisible({ timeout: 120_000 });
        await expect(page.getByText(communityRegNo(), { exact: false })).toBeVisible({ timeout: 60_000 });

        if (!alreadyFiled) {
            // คำรับรองต้องติ๊กก่อน ปุ่มยื่นถึงจะกดได้ — ยืนยันทั้งก่อนและหลัง
            const submit = page.getByTestId('step6-submit');
            await expect(submit).toBeDisabled();

            for (const box of await page.locator('input[id^="decl-"]').all()) {
                await box.check();
            }
            for (const box of await page.locator('input[id^="consent-"]').all()) {
                await box.check();
            }
            await expect(submit).toBeEnabled({ timeout: 60_000 });
            await shot(page, OUT, 'step6-ready.png');

            await submit.click();
            // ส่งต่อให้หน้าชำระเงินแล้วหยุด — a03 เป็นเจ้าของการจ่ายเงิน
            await page.waitForURL(/\/health\/(payments|applications)/, { timeout: 200_000 });
            await shot(page, OUT, 'handover-to-payments.png');
        }

        // ── ฐานข้อมูลต้องเห็นตรงกับที่หน้าจอบอก
        const after = JSON.parse(
            g4psql(
                `SELECT id, status, "declarationsAcceptedAt" IS NOT NULL AS declared FROM applications WHERE "healthId" = '${FARMER_ID}' AND "isDeleted" = false ORDER BY "createdAt" DESC LIMIT 1`,
            ),
        ) as Array<{ id: string; status: string; declared: boolean }>;
        const filed = after[0];
        expect(filed, 'ไม่พบคำขอของเกษตรกรคนนี้ในฐานข้อมูล').toBeTruthy();
        if (!filed) return; // ตัวช่วยให้ผู้ตรวจชนิดเห็นว่า filed มีค่าแน่หลังบรรทัดนี้
        expect(filed.declared, 'declarationsAcceptedAt ต้องถูกประทับเมื่อยื่นแล้ว').toBe(true);
        saveVar(`${P.varPrefix}_APPV2`, filed.id);

        // เอกสารที่แนบต้องถูกเก็บด้วย slot id แบบ canonical (lower_snake) ไม่ใช่ชื่อที่
        // หน้าจอตั้งเอง — ถ้าเพี้ยน ประตูตรวจของเจ้าหน้าที่จะหาเอกสารไม่เจอทั้งใบ
        const docs = JSON.parse(
            g4psql(
                `SELECT jsonb_array_elements("formData"->'draftDocuments')->>'slotId' AS slot FROM applications WHERE id = '${filed.id}'`,
            ),
        ) as Array<{ slot: string | null }>;
        const slotIds = docs.map((d) => d.slot).filter((s): s is string => Boolean(s));
        expect(slotIds.length, 'คำขอที่ยื่นแล้วต้องมีเอกสารแนบอย่างน้อยหนึ่งฉบับ').toBeGreaterThan(0);
        for (const slot of slotIds) {
            expect(slot, `slot id ต้องเป็น lower_snake ตาม getCanonicalSlotId (พบ "${slot}")`).toMatch(/^[a-z0-9_]+$/);
        }
        expect(slotIds, 'คำขอเช่าที่ดินต้องมีหนังสือยินยอมจากผู้ให้เช่า').toContain('landlord_consent');
    });
});
