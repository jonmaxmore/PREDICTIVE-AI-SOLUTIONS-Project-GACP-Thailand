/**
 * A02v2 — เจ้าหน้าที่ตรวจเอกสารรายช่อง แล้วขอเพิ่มหนึ่งฉบับ · ผู้ยื่นแก้ · รอบที่สอง
 *
 * a04 เดินเฉพาะเส้น "อนุมัติ" — ไม่เคยกดขอให้แก้ไขเลยสักครั้ง ประตูฝั่ง REQUEST_MORE
 * จึงไม่เคยถูกกดโดย walk ใด ใบนี้เดินเส้นนั้น และเดินให้ครบวง: ขอเพิ่ม → ผู้ยื่นเห็น
 * เฉพาะช่องที่ถูกขอ → แทนไฟล์ → ส่งกลับ → เจ้าหน้าที่เห็นรอบที่ 2 → รับคำขอ
 *
 * SELECTOR — อ่านก่อนแก้
 *   หน้าตรวจเอกสารของเจ้าหน้าที่และหน้าแก้ไขของผู้ยื่น **ไม่มี data-testid แม้แต่ตัวเดียว**
 *   ทั้งที่ repo นี้ใช้ 551 จุดในหน้าอื่น · สิ่งที่เสถียรที่สุดที่มีคือ id ของช่องกรอกในฟอร์ม
 *   ขอเพิ่ม ซึ่งฝัง slotId ไว้: `#reason-<slotId>` และ `#due-<slotId>`
 *   (document-check/client-view.tsx:212,219) — ใบนี้จึงยึดสองตัวนั้นเป็นหลัก
 *
 *   กับดักที่ต้องรู้: ปุ่มระดับแถวที่ "เปิดฟอร์ม" กับปุ่ม "ยืนยันส่ง" ในฟอร์ม ใช้ข้อความ
 *   เดียวกันเป๊ะ ('ขอเอกสารเพิ่ม' — client-view.tsx:203 และ :237) พอฟอร์มเปิดแล้วจะมีสองใบ
 *   บนจอ · ส่วนปุ่มตัดสินรวมใช้คนละคำ ('ส่งคำขอเอกสารเพิ่ม') จึงแยกออกได้
 *
 * วันครบกำหนด: ฝั่งหน้าจอเช็คแค่ "ไม่ว่าง" แต่ประตูฝั่งเซิร์ฟเวอร์บังคับว่าต้องเป็นวันทำการ
 * (application-document-review-service.js:86 → REVIEW_DUE_DATE_INVALID) ใบนี้จึงคำนวณวัน
 * ทำการถัดไปเอง · ยังไม่ได้กันวันหยุดราชการไทย — ถ้าเทสตกด้วย REVIEW_DUE_DATE_INVALID
 * ให้เลื่อนวันออกไป ไม่ใช่ผ่อนประตู
 *
 * TWO-STATE: อ่านสถานะและรอบจากฐานข้อมูลก่อนกด · ถ้ารอบก่อนหน้าเดินไปแล้ว ใบนี้ยืนยัน
 * ของที่มีอยู่แทนการกดซ้ำ
 *
 * ห้ามรันใบนี้ในงานที่สร้างมัน (task-16) — coordinator เป็นคนกด
 */
import { test, expect, type Page } from '@playwright/test';
import { FARMERS, pw, seg, shot, readVars, g4psql, g4Login, farmerId, typeInto } from './g4-helpers';

const P = FARMERS.B;
const OUT = seg('a02v2');
const FARMER_ID = farmerId(P);

/** ช่องที่จะถูกขอเพิ่ม — คำขอเช่าที่ดินย่อมมีช่องนี้เสมอ (a01v2 ยืนยันไว้แล้ว) */
const HELD_SLOT = 'landlord_consent';
const HELD_LABEL_TH = 'หนังสือยินยอมจากผู้ให้เช่าหรือผู้ให้ใช้ที่ดิน';

function officer(env: string): { id: string; pw: string } {
    const id = process.env[`${env}_ID`] || '';
    const pwd = process.env[`${env}_PW`] || '';
    if (!id || !pwd) throw new Error(`${env}_ID / ${env}_PW must be exported by the run command (L2 — never committed)`);
    return { id, pw: pwd };
}

/** วันทำการถัดไปนับจากวันนี้ไป n วัน (ข้ามเสาร์อาทิตย์) รูปแบบ YYYY-MM-DD สำหรับ input[type=date] */
function nextWorkingDay(daysAhead = 5): string {
    const d = new Date();
    d.setDate(d.getDate() + daysAhead);
    while (d.getDay() === 0 || d.getDay() === 6) d.setDate(d.getDate() + 1);
    return d.toISOString().slice(0, 10);
}

/** รอบการตรวจที่หน้าจอบอก — ไม่มี testid จึงอ่านจากข้อความ */
async function roundOnScreen(page: Page): Promise<number> {
    const text = await page.getByText(/รอบการตรวจที่\s*\d+/).innerText();
    const m = /รอบการตรวจที่\s*(\d+)/.exec(text);
    expect(m, `อ่านรอบการตรวจจากหน้าจอไม่ได้ (ได้ "${text}")`).toBeTruthy();
    return Number(m![1]);
}

/** แถวเอกสารหนึ่งใบบนหน้าเจ้าหน้าที่ — การ์ด <div> ที่ครอบชื่อเอกสาร ตัวในสุด */
function docRow(page: Page, labelTH: string) {
    return page
        .locator('div')
        .filter({ has: page.getByText(labelTH, { exact: false }) })
        .filter({ has: page.getByRole('button', { name: 'รับเอกสารนี้', exact: true }) })
        .last();
}

const APP = readVars()[`${P.varPrefix}_APPV2`] || '';

test.describe.serial('A02v2 — ตรวจรายช่อง → ขอเพิ่ม → ผู้ยื่นแก้ → รอบสอง → รับคำขอ', () => {
    test('เจ้าหน้าที่รับทุกช่องยกเว้นหนังสือยินยอม แล้วขอเพิ่มพร้อมเหตุผลและกำหนดส่ง', async ({ page }) => {
        expect(APP, `ไม่พบ ${P.varPrefix}_APPV2 ใน VARS — a01v2 ต้องเดินก่อน`).toBeTruthy();

        const before = JSON.parse(
            g4psql(`SELECT status FROM applications WHERE id = '${APP}'`),
        ) as Array<{ status: string }>;
        const startedAt = before[0]?.status;
        expect(
            ['ASSIGNED_FOR_REVIEW', 'REVISION_REQUESTED', 'DOC_APPROVED', 'PENDING_AUDIT_FEE'],
            `คำขอไม่ได้อยู่ในช่วงที่ใบนี้เดินได้ (พบ ${startedAt})`,
        ).toContain(startedAt);
        const alreadyRequested = startedAt !== 'ASSIGNED_FOR_REVIEW';
        if (alreadyRequested) {
            // eslint-disable-next-line no-console
            console.log(`[A02v2] คำขออยู่ที่ ${startedAt} แล้ว — รอบนี้ยืนยันของเดิม ไม่กดขอเพิ่มซ้ำ`);
        }

        const rev = officer('G4_REVIEWER');
        await g4Login(page, { kind: 'provider', id: rev.id, pw: rev.pw });
        await page.goto(`/provider/reviewer/${APP}/document-check`);
        await expect(page.getByRole('heading', { name: 'ตรวจเอกสารตาม กทล.1' })).toBeVisible({ timeout: 120_000 });
        await shot(page, OUT, 'officer-round1.png');

        if (!alreadyRequested) {
            expect(await roundOnScreen(page), 'ครั้งแรกต้องเป็นรอบที่ 1').toBe(1);

            // รับทุกช่องที่รับได้ ยกเว้นช่องที่จะกัก · ปุ่มรับถูก disable เมื่อยังไม่มีไฟล์
            // จึงกดเฉพาะใบที่กดได้ ไม่ใช่ทุกใบบนจอ
            const acceptButtons = page.getByRole('button', { name: 'รับเอกสารนี้', exact: true });
            const total = await acceptButtons.count();
            expect(total, 'หน้าตรวจต้องมีช่องเอกสารให้ตรวจอย่างน้อยหนึ่งช่อง').toBeGreaterThan(0);
            for (let i = 0; i < total; i += 1) {
                const row = docRow(page, HELD_LABEL_TH);
                const heldButton = row.getByRole('button', { name: 'รับเอกสารนี้', exact: true });
                const button = acceptButtons.nth(i);
                if ((await heldButton.count()) > 0 && (await button.elementHandle()) === (await heldButton.elementHandle())) {
                    continue; // ช่องที่ตั้งใจกักไว้
                }
                if (await button.isEnabled()) {
                    await button.click();
                    await expect(page.getByText('รับแล้ว').first()).toBeVisible({ timeout: 60_000 });
                }
            }

            // เปิดฟอร์มขอเพิ่มของช่องที่กักไว้ · ยิงจากในแถว ไม่ใช่จากทั้งหน้า เพราะพอฟอร์ม
            // เปิดแล้วจะมีปุ่มข้อความเดียวกันสองใบ
            await docRow(page, HELD_LABEL_TH)
                .getByRole('button', { name: 'ขอเอกสารเพิ่ม', exact: true })
                .click();

            const reason = page.locator(`#reason-${HELD_SLOT}`);
            const due = page.locator(`#due-${HELD_SLOT}`);
            await expect(reason, 'ฟอร์มขอเพิ่มต้องเปิดที่ช่องที่กดเท่านั้น').toBeVisible({ timeout: 60_000 });

            // เหตุผลต้องยาวอย่างน้อย 10 ตัวอักษร (document-check-state.ts:64)
            await typeInto(page, `#reason-${HELD_SLOT}`, 'หนังสือยินยอมที่แนบมาไม่มีลายมือชื่อผู้ให้เช่า กรุณาแนบฉบับที่ลงนามครบถ้วน');
            await typeInto(page, `#due-${HELD_SLOT}`, nextWorkingDay());
            await shot(page, OUT, 'officer-request-form.png');

            // ปุ่มยืนยันอยู่ในฟอร์ม — ยิงจากในแถวเดียวกันเพื่อไม่ให้ชนกับปุ่มเปิดฟอร์ม
            await docRow(page, HELD_LABEL_TH)
                .getByRole('button', { name: 'ขอเอกสารเพิ่ม', exact: true })
                .last()
                .click();
            await expect(page.getByText('ขอเพิ่ม').first()).toBeVisible({ timeout: 60_000 });

            // ตัดสินรวม: ส่งคำขอเอกสารเพิ่ม (คนละปุ่มกับระดับแถว)
            await page.getByRole('button', { name: 'ส่งคำขอเอกสารเพิ่ม', exact: true }).click();
            await shot(page, OUT, 'officer-requested.png');
        }

        // ฐานข้อมูลต้องมีแถวรีวิวรอบที่ 1 ของช่องที่กัก และคำขอต้องเดินไป REVISION_REQUESTED
        await expect
            .poll(
                () =>
                    (
                        JSON.parse(
                            g4psql(`SELECT status FROM applications WHERE id = '${APP}'`),
                        ) as Array<{ status: string }>
                    )[0]?.status,
                { timeout: 120_000, message: 'คำขอต้องเดินไป REVISION_REQUESTED หลังเจ้าหน้าที่ขอเอกสารเพิ่ม' },
            )
            .not.toBe('ASSIGNED_FOR_REVIEW');

        const round1 = JSON.parse(
            g4psql(
                `SELECT "slotId", verdict, round FROM application_document_reviews WHERE "applicationId" = '${APP}' AND round = 1 ORDER BY "slotId"`,
            ),
        ) as Array<{ slotId: string; verdict: string; round: number }>;
        expect(round1.length, 'รอบที่ 1 ต้องมีแถวรีวิวอย่างน้อยหนึ่งแถว').toBeGreaterThan(0);
        expect(
            round1.find((r) => r.slotId === HELD_SLOT)?.verdict,
            `ช่อง ${HELD_SLOT} ต้องถูกบันทึกว่าขอเพิ่ม ไม่ใช่รับแล้ว`,
        ).toBe('REQUESTED');
    });

    test('ผู้ยื่นเห็นเฉพาะช่องที่ถูกขอ แก้แล้วส่งกลับ', async ({ page }) => {
        await g4Login(page, { kind: 'health', id: FARMER_ID, pw: pw(P) });
        await page.goto(`/health/applications/${APP}/revision`);

        // หน้านี้ต้องแสดง "เฉพาะ" ช่องที่ถูกขอ — ไม่ใช่ทั้งใบ
        await expect(page.getByRole('heading', { name: HELD_LABEL_TH })).toBeVisible({ timeout: 120_000 });
        const cards = page.getByRole('heading', { level: 2 });
        expect(await cards.count(), 'ผู้ยื่นต้องเห็นเฉพาะช่องเดียวที่เจ้าหน้าที่ขอ').toBe(1);
        await expect(page.getByText('เหตุผลจากเจ้าหน้าที่:')).toBeVisible();
        await shot(page, OUT, 'farmer-revision.png');

        // ยังไม่แทนไฟล์ ปุ่มส่งกลับต้องกดไม่ได้ และต้องบอกเหตุผล
        const resubmit = page.getByRole('button', { name: 'ส่งกลับให้เจ้าหน้าที่ตรวจ', exact: true });
        if (await resubmit.isDisabled()) {
            await expect(page.getByText('ยังมีเอกสารที่ยังไม่ได้อัปโหลดฉบับใหม่')).toBeVisible();

            // ปุ่มแทนไฟล์เป็น <a href> ไม่ใช่ปุ่มจริง — พาไปขั้นที่ 5 ของวิซาร์ด
            await page.getByRole('link', { name: 'อัปโหลดฉบับใหม่', exact: true }).first().click();
            await page.waitForURL(/\/step\/5/, { timeout: 120_000 });

            // แทนไฟล์ในการ์ดของช่องนั้น · input[type=file] ซ่อนอยู่ในการ์ด ไม่มี id
            const card = page
                .locator('div')
                .filter({ has: page.getByText(HELD_LABEL_TH, { exact: false }) })
                .filter({ has: page.locator('input[type="file"]') })
                .last();
            await card.locator('input[type="file"]').setInputFiles({
                name: 'landlord-consent-signed.pdf',
                mimeType: 'application/pdf',
                buffer: Buffer.from('%PDF-1.4\n% a01v2/a02v2 walk fixture\n'),
            });

            await page.goto(`/health/applications/${APP}/revision`);
            await expect(page.getByText('อัปโหลดฉบับใหม่แล้ว')).toBeVisible({ timeout: 120_000 });
        } else {
            // eslint-disable-next-line no-console
            console.log('[A02v2] ผู้ยื่นแทนไฟล์ไว้แล้วในรอบก่อน — รอบนี้ส่งกลับอย่างเดียว');
        }

        await expect(resubmit).toBeEnabled({ timeout: 60_000 });
        await resubmit.click();
        await page.waitForURL(new RegExp(`/health/applications/${APP}$`), { timeout: 120_000 });
        await shot(page, OUT, 'farmer-resubmitted.png');
    });

    test('เจ้าหน้าที่เห็นรอบที่ 2 แล้วรับคำขอ', async ({ page }) => {
        const rev = officer('G4_REVIEWER');
        await g4Login(page, { kind: 'provider', id: rev.id, pw: rev.pw });
        await page.goto(`/provider/reviewer/${APP}/document-check`);
        await expect(page.getByRole('heading', { name: 'ตรวจเอกสารตาม กทล.1' })).toBeVisible({ timeout: 120_000 });

        // รอบต้องเดินไปที่ 2 — ถ้ายังเป็น 1 แปลว่าการส่งกลับไม่ได้เปิดรอบใหม่จริง
        expect(await roundOnScreen(page), 'หลังผู้ยื่นส่งกลับ ต้องเป็นรอบการตรวจที่ 2').toBeGreaterThanOrEqual(2);
        await shot(page, OUT, 'officer-round2.png');

        const acceptButtons = page.getByRole('button', { name: 'รับเอกสารนี้', exact: true });
        const total = await acceptButtons.count();
        for (let i = 0; i < total; i += 1) {
            const button = acceptButtons.nth(i);
            if (await button.isEnabled()) await button.click();
        }

        const decide = page.getByRole('button', { name: 'รับคำขอ', exact: true });
        await expect(decide, 'รับทุกช่องแล้ว ปุ่มรับคำขอต้องกดได้').toBeEnabled({ timeout: 60_000 });
        await decide.click();
        await shot(page, OUT, 'officer-accepted.png');

        // ฐานข้อมูล: ต้องมีแถวรีวิวทั้งรอบ 1 และรอบ 2 และคำขอต้องเดินพ้น REVISION_REQUESTED
        const rounds = JSON.parse(
            g4psql(
                `SELECT DISTINCT round FROM application_document_reviews WHERE "applicationId" = '${APP}' ORDER BY round`,
            ),
        ) as Array<{ round: number }>;
        expect(
            rounds.map((r) => r.round),
            'ต้องมีร่องรอยการตรวจทั้งสองรอบ ไม่ใช่รอบเดียวที่ถูกเขียนทับ',
        ).toEqual(expect.arrayContaining([1, 2]));

        await expect
            .poll(
                () =>
                    (
                        JSON.parse(
                            g4psql(`SELECT status FROM applications WHERE id = '${APP}'`),
                        ) as Array<{ status: string }>
                    )[0]?.status,
                { timeout: 120_000, message: 'คำขอต้องเดินพ้น REVISION_REQUESTED หลังเจ้าหน้าที่รับคำขอ' },
            )
            .not.toBe('REVISION_REQUESTED');
    });
});
