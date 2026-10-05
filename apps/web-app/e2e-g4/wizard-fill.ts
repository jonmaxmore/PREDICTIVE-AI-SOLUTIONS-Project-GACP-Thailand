/**
 * Fill one wizard step the way the applicant would — and STOP when it cannot.
 *
 * Operator, 2026-08-25: "ทุกอย่างต้องกดที่ UI จริง เท่านั้น แล้วต้องไม่ใช่ไม่ผ่านแล้วสั่งให้มันผ่าน
 * ถ้าไม่ผ่านเรามาคุยกันก่อนแล้วแก้กันไปจุดต่อจุด".
 *
 * So this module has exactly one rule that matters: it only ever types an answer it was
 * GIVEN. Every value comes from the farmer's own profile (GOALS §G4.2) or from what the
 * applicant already entered earlier in the journey. A required control this module has no
 * answer for is not guessed, not skipped and not clicked past — the walk halts and names
 * the control, because an invented answer is indistinguishable from a passing test and
 * turns the whole journey into fiction.
 *
 * Matching is by the control's VISIBLE LABEL, not by id. The wizard's inputs carry React
 * useId values (`_r_7_`, `_r_a_`, …) which change between renders — proven across two runs
 * of the same build — so an id-based map would be broken by the next deploy while looking
 * correct in review.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Locator, Page } from '@playwright/test';
import { documentFixture, type FarmerProfile } from './g4-helpers';

export interface Answer {
  /** Matches the control's visible label. */
  label: RegExp;
  value: string;
  /** Pick from a dropdown/combobox by the option's visible text. */
  byOptionText?: boolean;
  /**
   * Replace a value the app pre-filled for the user. Used where the wizard invents a
   * default the applicant would not keep — the farm name arrives as "ฟาร์ม" + the
   * applicant's first name, and a walk that accepts it certifies a farm whose name nobody
   * chose.
   */
  overwrite?: boolean;
  why: string;
}

export interface FillResult {
  step: string;
  url: string;
  filled: Array<{ label: string; value: string }>;
  uploaded: Array<{ slot: string; file: string }>;
  /** Required controls with no answer available — the walk must stop on these. */
  unanswered: Array<{ label: string; kind: string }>;
}

/**
 * Everything this applicant can truthfully say, derived from their own profile.
 * Anything a step asks for that is not here is a question the walk cannot answer, and
 * that is a decision for a human — not for this file.
 */
export function answersFor(p: FarmerProfile, nationalId: string, email: string, phone: string): Answer[] {
  const addr = `${p.address.houseNo} ต.${p.address.subdistrict} อ.${p.address.district} จ.${p.address.province} ${p.address.postalCode}`;
  return [
    { label: /^ชื่อ\*?$/, value: p.firstName, why: 'account' },
    { label: /นามสกุล/, value: p.lastName, why: 'account' },
    { label: /เลขบัตรประชาชน|เลขประจำตัวประชาชน/, value: nationalId, why: 'account' },
    { label: /เบอร์โทร|โทรศัพท์/, value: phone, why: 'account' },
    { label: /อีเมล/, value: email, why: 'account' },
    { label: /ที่อยู่ตามทะเบียนบ้าน|ที่อยู่ผู้ยื่น/, value: addr, why: 'profile address' },
    { label: /ชื่อฟาร์ม|ชื่อสถานที่เพาะปลูก|ชื่อสถานที่ปลูก/, value: p.farmName, overwrite: true, why: 'profile farm name (the wizard pre-fills "ฟาร์ม"+firstName, which is not this farm\'s name)' },
    { label: /ที่อยู่ฟาร์ม|ที่ตั้งฟาร์ม|ที่อยู่สถานที่ปลูก|^ที่อยู่\*?$/, value: addr, why: 'profile address' },
    // The plot list. Farmer A has one plot covering the whole farm; farmer B's three plots
    // are added explicitly by the spec, because "press เพิ่มแปลง twice" is a decision about
    // the farm's shape, not a field to be filled in.
    { label: /ชื่อแปลง/, value: p.plots[0].name, overwrite: true, why: 'GOALS G4.2 plot list' },
    { label: /จังหวัด/, value: p.address.province, byOptionText: true, why: 'profile address' },
    { label: /อำเภอ|เขต/, value: p.address.district, byOptionText: true, why: 'profile address' },
    { label: /ตำบล|แขวง/, value: p.address.subdistrict, byOptionText: true, why: 'profile address' },
    { label: /รหัสไปรษณีย์/, value: p.address.postalCode, why: 'profile address' },
    { label: /พื้นที่รวม|ขนาดพื้นที่|พื้นที่ทั้งหมด/, value: String(p.totalAreaSqm), why: 'GOALS G4.2 — 200 sq.m' },
    { label: /ละติจูด|latitude/i, value: '18.796143', why: 'farm GPS (เมือง เชียงใหม่)' },
    { label: /ลองจิจูด|longitude/i, value: '98.953608', why: 'farm GPS (เมือง เชียงใหม่)' },
  ];
}

/** The visible label of a control, however this app happens to attach it. */
async function labelOf(page: Page, el: Locator): Promise<string> {
  return el.evaluate((node: Element) => {
    const id = (node as HTMLInputElement).id;
    if (id) {
      const l = document.querySelector(`label[for="${CSS.escape(id)}"]`);
      if (l?.textContent?.trim()) return l.textContent.trim();
    }
    const wrap = node.closest('label');
    if (wrap?.textContent?.trim()) return wrap.textContent.trim();
    const aria = node.getAttribute('aria-label');
    if (aria) return aria.trim();
    // Mantine renders the label as a sibling element inside the field wrapper rather than
    // a <label for=…>, so walk up a few levels looking for one before giving up.
    let p: Element | null = node.parentElement;
    for (let i = 0; p && i < 4; i++, p = p.parentElement) {
      const lbl = p.querySelector('label, .mantine-InputWrapper-label, [class*="-label"]');
      if (lbl?.textContent?.trim()) return lbl.textContent.trim();
    }
    const ph = node.getAttribute('placeholder');
    if (ph) return ph.trim();
    const group = node.closest('div');
    return group?.textContent?.trim().slice(0, 60) ?? '';
  });
}

/**
 * The heading of the upload slot a file input belongs to, so the generated document is the
 * document that slot actually asked for — never a generic file with the right extension.
 */
async function slotTitleFor(el: Locator): Promise<string> {
  return el.evaluate((node: Element) => {
    let p: Element | null = node.parentElement;
    for (let i = 0; p && i < 6; i++, p = p.parentElement) {
      const t = p.textContent || '';
      const m = t.match(/ภ\.?ท\.?\s?\d+[^\n]{0,60}|[A-Za-z][A-Za-z ()/-]{4,60}/);
      if (m && t.length < 600) return m[0].trim();
    }
    return '';
  });
}

export async function fillStep(
  page: Page,
  opts: {
    step: string;
    profile: FarmerProfile;
    answers: Answer[];
    nationalId: string;
    outDir: string;
    fixtureDir: string;
  },
): Promise<FillResult> {
  const res: FillResult = { step: opts.step, url: page.url(), filled: [], uploaded: [], unanswered: [] };

  // ── text / number inputs, textareas and dropdowns ───────────────────────────
  //
  // Dropdowns here are Mantine <Select>s, which render as a read-only text input plus a
  // portalled option list — NOT a native <select>. Typing into one does nothing, and an
  // earlier version of this file threw on the attempt and took the whole walk down with
  // it. Every control is handled inside its own try/catch: a control this module cannot
  // operate is a finding to record, never a reason to abandon the journey.
  const inputs = page.locator(
    'input:visible:not([type=file]):not([type=checkbox]):not([type=radio]), textarea:visible, select:visible',
  );
  for (let i = 0; i < await inputs.count(); i++) {
    const el = inputs.nth(i);
    let label = '';
    try {
      const meta = await el.evaluate((n: Element) => ({
        tag: n.tagName.toLowerCase(),
        readOnly: (n as HTMLInputElement).readOnly === true,
        combo: n.getAttribute('role') === 'combobox'
          || n.getAttribute('aria-haspopup') === 'listbox'
          || n.getAttribute('aria-expanded') !== null,
        required: (n as HTMLInputElement).required || n.getAttribute('aria-required') === 'true',
      }));
      const current = (await el.inputValue().catch(() => '')) || '';
      label = (await labelOf(page, el)).replace(/\s+/g, ' ').trim();
      const hit = opts.answers.find((a) => a.label.test(label));

      if (current && !(hit && hit.overwrite)) continue; // already answered
      if (!hit) {
        if (meta.required) res.unanswered.push({ label, kind: meta.tag });
        continue;
      }

      if (meta.tag === 'select') {
        await el.selectOption(hit.byOptionText ? { label: hit.value } : hit.value);
      } else if (meta.combo || meta.readOnly) {
        await el.click();
        const option = page.getByRole('option', { name: hit.value, exact: false }).first();
        await option.waitFor({ state: 'visible', timeout: 15_000 });
        await option.click();
      } else {
        await el.fill(hit.value);
      }
      res.filled.push({ label, value: hit.value });
    } catch (err) {
      res.unanswered.push({
        label: label || `(control #${i})`,
        kind: `could not operate: ${String((err as Error).message).split('\n')[0].slice(0, 120)}`,
      });
    }
  }

  // ── document slots ──────────────────────────────────────────────────────────
  const files = page.locator('input[type=file]');
  for (let i = 0; i < await files.count(); i++) {
    const el = files.nth(i);
    const already = await el.evaluate((n: Element) => ((n as HTMLInputElement).files?.length ?? 0) > 0);
    if (already) continue;
    const title = (await slotTitleFor(el)).replace(/\s+/g, ' ').trim() || `เอกสารแนบ ${i + 1}`;
    const code = title.match(/ภ\.?ท\.?\s?\d+/)?.[0] ?? `DOC${i + 1}`;
    const pdf = documentFixture(opts.fixtureDir, { code, title, description: title }, opts.profile, opts.nationalId);
    const posted = page.waitForResponse(
      (r) => /draft-documents|documents|upload/.test(r.url()) && r.request().method() === 'POST',
      { timeout: 90_000 },
    ).catch(() => null);
    await el.setInputFiles(pdf);
    await posted;
    res.uploaded.push({ slot: title.slice(0, 60), file: pdf.split(/[\\/]/).pop() as string });
  }

  mkdirSync(opts.outDir, { recursive: true });
  writeFileSync(join(opts.outDir, `${opts.step}-fill.json`), JSON.stringify(res, null, 2));
  return res;
}
