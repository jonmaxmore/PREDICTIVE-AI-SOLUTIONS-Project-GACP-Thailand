/**
 * LQA capture — the language half of the G4 walk.
 *
 * Operator, 2026-08-25: "LQA คือตรวจภาษาทั้งไทยและอังกฤษ ให้ได้มาตราฐาน และเข้าใจง่าย".
 *
 * Every screen the walk touches is captured in BOTH languages and checked against the
 * rules the repo already wrote down — the thai-ui-copy guideline, docs/i18n-policy.md
 * Policy 5, DESIGN.md's No-Tracking-On-Thai rule — plus the defect classes that have
 * actually shipped here before (the epoch date "1/1/2513" on staff screens, a Gregorian
 * year on the trace page, ท่าน/คุณ mixed on one page).
 *
 * Two design decisions worth stating, because both are the difference between a report
 * someone acts on and a list nobody reads:
 *
 *   1. Capture text as the USER sees it — from the rendered DOM, per visible element,
 *      with the element's classes attached. A dictionary audit cannot see a string that
 *      never renders, a string built by concatenation, or a Thai label wearing
 *      `tracking-wide`. Walking the product is the only way to see those.
 *
 *   2. Findings carry the exact text and where it was standing. "Some English leaked"
 *      is not actionable; `EN_ON_TH · "Request timeout. Please try again" · [role=alert]
 *      on /register` is a fix.
 *
 * This module never fails a test. A language defect is a finding to be triaged, not a
 * reason to abort a journey that is proving something else.
 */
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from '@playwright/test';

export type LqaRule =
  | 'EN_ON_TH'
  | 'TH_ON_EN'
  | 'TH_LATIN_NO_SPACE'
  | 'MAIYAMOK_NO_SPACE'
  | 'EM_DASH_IN_THAI'
  | 'GREGORIAN_YEAR'
  | 'EPOCH_DATE'
  | 'REGISTER_MIX'
  | 'BARE_APOLOGY'
  | 'TRACKING_ON_THAI'
  | 'RAW_I18N_KEY'
  | 'RAW_ERROR_CODE';

export interface LqaFinding {
  rule: LqaRule;
  severity: 'HIGH' | 'MEDIUM' | 'LOW';
  text: string;
  where: string;
  screen: string;
  lang: 'th' | 'en';
  note: string;
}

export interface TextRun { text: string; tag: string; cls: string; role: string; path: string; region: string }

/**
 * Latin words that are correct on a Thai screen: proper nouns, standards, units and
 * machine identifiers. Flagging these would bury the real misses under noise.
 *
 * MATCHED AS WHOLE WORDS ONLY. The first version of this list matched anywhere in a
 * string, so `EN` and `TH` were cut out of the middle of ordinary English —
 * "Department" was reported as "Departm t" and "Thai" as " ai", and the whole finding
 * was an artefact of the checker. A language report that invents defects costs more
 * review time than it saves.
 */
const LATIN_OK_WORDS = [
  'GACP', 'DTAM', 'MOPH', 'PDPA', 'QR', 'VAT', 'GPS', 'PDF', 'CSV', 'API', 'URL', 'ID', 'OTP',
  'ThaiD', 'Stripe', 'PromptPay', 'Visa', 'Mastercard',
  'ISO', 'IEC', 'GAP', 'GMP', 'HACCP', 'THC', 'CBD', 'RSA', 'SHA',
  'kg', 'g', 'mg', 'ml', 'cm', 'm', 'sqm', 'rai', 'EN', 'TH', 'AM', 'PM',
];
const LATIN_OK = new RegExp(`\\b(?:${LATIN_OK_WORDS.join('|')})\\b`, 'gi');

/**
 * Domains, e-mail addresses and URLs are data, not untranslated copy.
 *
 * The discriminator is a real top-level domain, NOT "it has dots in it": an i18n key
 * (`common.errors.notFound`) has dots too, and an earlier version of this pattern
 * swallowed every one of them — which would have hidden exactly the defect the
 * RAW_I18N_KEY rule exists to find.
 */
const TLD = '(?:com|net|org|io|dev|app|info|local|th|co\\.th|go\\.th|or\\.th|ac\\.th|in\\.th)';
const LOOKS_LIKE_ADDRESS = new RegExp(
  `^(?:https?://|www\\.)|^[\\w.+-]+@[\\w-]+\\.[\\w.]+$|^[\\w-]+(?:\\.[\\w-]+)*\\.${TLD}(?:/|$)`,
  'i',
);

const THAI = /[฀-๿]/;
const LATIN_WORD = /[A-Za-z]{2,}/;

/** Strip the words that are legitimately Latin, then ask whether any Latin prose is left. */
function residualLatin(text: string): string {
  const stripped = text.replace(LATIN_OK, ' ');
  const m = stripped.match(/[A-Za-z][A-Za-z'’-]*(?:\s+[A-Za-z][A-Za-z'’-]*)*/g);
  const words = (m || []).map((s) => s.trim()).filter((s) => LATIN_WORD.test(s));
  return words.join(' ').trim();
}

/**
 * How much a defect costs depends on where it stands. English inside a button, a field
 * label or an error the user must act on blocks the task; the ministry's own name in
 * English in a footer is how Thai government sites are normally written. Same rule,
 * different weight — so the report can be triaged top-down instead of read in full.
 */
function weigh(run: TextRun, base: LqaFinding['severity']): LqaFinding['severity'] {
  if (run.region === 'alert' || run.region === 'form') return 'HIGH';
  if (run.region === 'footer' || run.region === 'external-link') return 'LOW';
  if (['button', 'label', 'h1', 'h2', 'h3'].includes(run.tag)) return 'HIGH';
  return base;
}

export function check(run: TextRun, lang: 'th' | 'en', screen: string): LqaFinding[] {
  const out: LqaFinding[] = [];
  const t = run.text;
  const add = (rule: LqaRule, severity: LqaFinding['severity'], note: string, text = t) =>
    out.push({ rule, severity, text: text.slice(0, 160), where: run.path, screen, lang, note });

  // An i18n key or a raw error code standing where a sentence should be. Both mean the
  // user is reading the plumbing. Domains, e-mails and URLs look the same to a naive
  // pattern and are none of those things — "dtam.moph.go.th" is the ministry's website.
  const isAddress = LOOKS_LIKE_ADDRESS.test(t.trim()) || run.region === 'external-link';
  if (!isAddress && /^[a-z][a-z0-9]*(\.[a-z][a-zA-Z0-9]*){2,}$/.test(t.trim())) {
    add('RAW_I18N_KEY', 'HIGH', 'a translation key rendered instead of its text');
  }
  if (/^[A-Z][A-Z0-9]{3,}(_[A-Z0-9]+){1,}$/.test(t.trim())) {
    add('RAW_ERROR_CODE', weigh(run, 'HIGH'),
      'a machine error code shown to the user; codes stay English but the MESSAGE must map to Thai (i18n-policy Policy 5)');
  }

  if (lang === 'th') {
    const residue = isAddress ? '' : residualLatin(t);
    if (residue && LATIN_WORD.test(residue)) {
      add('EN_ON_TH', weigh(run, 'MEDIUM'),
        `untranslated English on the Thai UI (Latin left after allow-listed terms: "${residue.slice(0, 60)}")`);
    }
    if (/[฀-๿][A-Za-z]|[A-Za-z][฀-๿]/.test(t)) {
      add('TH_LATIN_NO_SPACE', 'LOW', 'needs a space at the Thai/Latin boundary ("ของ GACP", not "ของGACP")');
    }
    if (/[^\s]ๆ/.test(t)) {
      add('MAIYAMOK_NO_SPACE', 'LOW', 'ไม้ยมก takes a leading space per Royal Institute style ("บ่อย ๆ")');
    }
    if (THAI.test(t) && t.includes('—')) {
      add('EM_DASH_IN_THAI', 'LOW', 'no em dash in Thai copy — separate clauses with a space');
    }
    if (/ขออภัย/.test(t) && !/(ลอง|รีเฟรช|ติดต่อ|ตรวจสอบ|กรุณา)/.test(t)) {
      add('BARE_APOLOGY', 'MEDIUM', 'an error must name the cause and the next action, not apologise');
    }
  } else {
    // A person's own name, a farm's name and an address stay Thai on an English page —
    // that is data the user typed, not copy the product owns.
    if (THAI.test(t) && run.region !== 'user-data') {
      add('TH_ON_EN', weigh(run, 'MEDIUM'), 'Thai left on the English UI');
    }
  }

  // Dates. The database stores Gregorian and the SCREEN must show Buddhist era via
  // formatThaiDate; 2513 is the Unix epoch rendered through a null date, which has
  // shipped to staff screens and financial CSVs here before.
  if (/\b2513\b/.test(t)) {
    add('EPOCH_DATE', 'HIGH', 'the Unix epoch rendered as a Thai date — a null/invalid date reached the formatter');
    // NB: no \b around the Thai month names. JavaScript's \b is defined on ASCII \w, so
    // a boundary never occurs beside a Thai glyph and `\bมกราคม\b` matches nothing — the
    // rule silently never fired. Caught by this module's own selfcheck (a00).
  } else if (lang === 'th' && /\b(20[2-4]\d)\b/.test(t)
      && /[/\-–]|มกราคม|กุมภาพันธ์|มีนาคม|เมษายน|พฤษภาคม|มิถุนายน|กรกฎาคม|สิงหาคม|กันยายน|ตุลาคม|พฤศจิกายน|ธันวาคม|พ\.ศ\.|ค\.ศ\./.test(t)) {
    add('GREGORIAN_YEAR', 'HIGH', 'a Gregorian year on a Thai screen — dates must go through formatThaiDate (พ.ศ.)');
  }

  // Typography: positive letter-spacing and synthesized weights break Thai glyph
  // stacking (DESIGN.md No-Tracking-On-Thai; eslint no-thai-letterspacing).
  if (THAI.test(t) && /\b(tracking-wide|tracking-wider|tracking-widest|uppercase|font-black)\b/.test(run.cls)) {
    const which = (run.cls.match(/\b(tracking-wide|tracking-wider|tracking-widest|uppercase|font-black)\b/g) || []).join(' ');
    add('TRACKING_ON_THAI', 'MEDIUM', `Thai text wearing ${which} — detaches sara/วรรณยุกต์ from the base glyph`);
  }

  return out;
}

async function readRuns(page: Page): Promise<TextRun[]> {
  return page.evaluate(() => {
    const seen = new Set<string>();
    const out: Array<{ text: string; tag: string; cls: string; role: string; path: string; region: string }> = [];
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    let n: Node | null;
    while ((n = walker.nextNode())) {
      const raw = (n.nodeValue || '').replace(/\s+/g, ' ').trim();
      if (!raw || raw.length < 2) continue;
      const el = n.parentElement;
      if (!el) continue;
      if (['SCRIPT', 'STYLE', 'NOSCRIPT'].includes(el.tagName)) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0 || r.height === 0) continue;
      const style = getComputedStyle(el);
      if (style.visibility === 'hidden' || style.display === 'none' || style.opacity === '0') continue;
      const parts: string[] = [];
      let p: Element | null = el;
      for (let i = 0; p && i < 3; i++, p = p.parentElement) {
        parts.unshift(p.tagName.toLowerCase() + (p.id ? '#' + p.id : ''));
      }
      const path = parts.join('>') + (el.getAttribute('role') ? `[role=${el.getAttribute('role')}]` : '');
      // Where the text stands decides how much a defect there costs.
      let region = 'body';
      if (el.closest('[role="alert"]')) region = 'alert';
      else if (el.closest('form, label, [role="dialog"]')) region = 'form';
      else if (el.closest('footer')) region = 'footer';
      else if (el.tagName === 'A' && /^(https?:)?\/\//.test((el as HTMLAnchorElement).getAttribute('href') || '')) region = 'external-link';
      else if (el.closest('nav, header')) region = 'nav';
      const key = raw + '|' + path;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ text: raw, tag: el.tagName.toLowerCase(), cls: el.className?.toString?.() ?? '', role: el.getAttribute('role') || '', path, region });
    }
    return out;
  });
}

/**
 * The exact accessible names this app gives its language control. Both spellings are
 * live: the auth pages write their own, and the shared LanguageToggle writes another
 * (which is itself finding F-LQA-02 — one control, two names).
 *
 * Matched EXACTLY, never by a loose fragment. An earlier version matched /EN\b/, which
 * on a screen with no language control matched some unrelated button and PRESSED IT.
 * A tool that walks a live product must never press a control it cannot name.
 */
const TO_ENGLISH = ['Switch language to English', 'สลับภาษาเป็นภาษาอังกฤษ'];
const TO_THAI = ['Switch language to Thai', 'เปลี่ยนภาษาเป็นภาษาไทย', 'สลับภาษาเป็นภาษาไทย'];

async function findToggle(page: Page, names: string[]) {
  for (const n of names) {
    const btn = page.getByRole('button', { name: n, exact: true }).first();
    if (await btn.isVisible().catch(() => false)) return btn;
  }
  return null;
}

/**
 * Capture one screen in Thai, then — if the page offers a language control — in English,
 * and flip back so the walk continues in the language the applicant was using.
 *
 * `ownData` is the text this user typed (their name, farm name, address). It stays Thai
 * in English mode by definition and must not be reported as an untranslated string.
 */
export async function lqaCapture(
  page: Page,
  dir: string,
  screen: string,
  ownData: string[] = [],
  captureEnglish = false,
) {
  mkdirSync(dir, { recursive: true });
  const url = page.url();

  const isOwnData = (t: string) => ownData.some((d) => d && t.includes(d));
  const thRuns = await readRuns(page);
  const findings: LqaFinding[] = thRuns.flatMap((r) => check(r, 'th', screen));

  // ท่าน is reserved for legal/PDPA surfaces; mixing the two registers on one page is a
  // defect the 2026-07-23 audit called out by name. This is a page-level rule, not a
  // run-level one, so it is checked over the whole capture.
  const all = thRuns.map((r) => r.text).join(' ');
  if (/\bท่าน\b/.test(all) && /\bคุณ\b/.test(all)) {
    findings.push({
      rule: 'REGISTER_MIX', severity: 'MEDIUM', lang: 'th', screen, where: '(page)',
      text: 'ท่าน + คุณ on one page',
      note: 'address the user as คุณ; ท่าน is for legal/PDPA surfaces only (i18n-policy Policy 5)',
    });
  }

  let enRuns: TextRun[] = [];
  let languageSwitched = false;

  // Pressing the language control MUTATES THE PAGE THE WALK IS STANDING ON — and the
  // toggle writes localStorage, so the change survives navigation. On the activities
  // screen the flip left the page in a state whose plot button the walk could no longer
  // press, and 60 seconds later the journey died on a control that was right there.
  // A measuring instrument must not move what it measures: the English pass is OPT-IN,
  // taken at the end of a spec (or on read-only screens), never mid-walk.
  const toEn = captureEnglish ? await findToggle(page, TO_ENGLISH) : null;

  if (!captureEnglish) {
    // Thai-only capture: every rule above still ran; the English side is simply not
    // sampled here. Recorded so the report never mistakes "not sampled" for "clean".
    writeFileSync(join(dir, `${screen}.lqa.json`), JSON.stringify({
      screen, url, capturedAt: new Date().toISOString(),
      hasLanguageToggle: null, languageSwitched: null, englishPass: 'skipped (mid-walk)',
      th: thRuns.map((r) => ({ text: r.text, path: r.path, cls: r.cls, region: r.region })),
      en: [],
      findings,
    }, null, 2));
    return findings;
  }

  if (!toEn) {
    // Not a defect of this capture — a defect of the screen. Half of a bilingual product
    // is unreachable if the control only exists before login.
    findings.push({
      rule: 'TH_ON_EN', severity: 'MEDIUM', lang: 'en', screen, where: '(page)',
      text: '(no language control on this screen)',
      note: 'this screen offers no way to switch language, so its English side cannot be reached or reviewed',
    });
  } else {
    await toEn.click().catch(() => {});
    await page.waitForTimeout(1500);
    enRuns = await readRuns(page);

    // Prove the flip before judging what is on screen. If nothing changed, the button did
    // not switch the language, and every Thai run would otherwise be reported as "Thai
    // left on the English UI" — dozens of findings that are all one fact, stated wrongly.
    const before = thRuns.map((r) => r.text).join('');
    languageSwitched = enRuns.map((r) => r.text).join('') !== before;

    if (languageSwitched) {
      findings.push(...enRuns.filter((r) => !isOwnData(r.text)).flatMap((r) => check(r, 'en', screen)));
      const back = await findToggle(page, TO_THAI);
      if (back) { await back.click().catch(() => {}); await page.waitForTimeout(1200); }
    } else {
      findings.push({
        rule: 'TH_ON_EN', severity: 'HIGH', lang: 'en', screen, where: '(page)',
        text: '(language control present but nothing changed)',
        note: 'pressing the language control left all ' + thRuns.length + ' visible strings identical — this screen has no English at all',
      });
    }
  }

  writeFileSync(join(dir, `${screen}.lqa.json`), JSON.stringify({
    screen, url, capturedAt: new Date().toISOString(),
    hasLanguageToggle: Boolean(toEn),
    languageSwitched,
    th: thRuns.map((r) => ({ text: r.text, path: r.path, cls: r.cls, region: r.region })),
    en: enRuns.map((r) => ({ text: r.text, path: r.path, cls: r.cls, region: r.region })),
    findings,
  }, null, 2));

  return findings;
}

/** Merge every *.lqa.json under `root` into one report a human can triage in order. */
export function lqaReport(root: string, outFile: string) {
  const files: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) {
      if (e.isDirectory()) walk(join(d, e.name));
      else if (e.name.endsWith('.lqa.json')) files.push(join(d, e.name));
    }
  };
  walk(root);

  const findings: LqaFinding[] = [];
  const screens: Array<{ screen: string; url: string; toggle: boolean | null; switched: boolean; thRuns: number; enRuns: number }> = [];
  for (const f of files) {
    const j = JSON.parse(readFileSync(f, 'utf8'));
    findings.push(...(j.findings || []));
    screens.push({ screen: j.screen, url: j.url, toggle: j.hasLanguageToggle, switched: Boolean(j.languageSwitched), thRuns: j.th?.length ?? 0, enRuns: j.en?.length ?? 0 });
  }

  // One row per distinct (rule, text): the same string on six screens is one fix.
  const byKey = new Map<string, LqaFinding & { screens: Set<string> }>();
  for (const f of findings) {
    const k = `${f.rule}|${f.text}`;
    const hit = byKey.get(k);
    if (hit) hit.screens.add(f.screen);
    else byKey.set(k, { ...f, screens: new Set([f.screen]) });
  }
  const rank = { HIGH: 0, MEDIUM: 1, LOW: 2 } as const;
  const rows = [...byKey.values()].sort((a, b) => rank[a.severity] - rank[b.severity] || a.rule.localeCompare(b.rule));

  const lines: string[] = [];
  lines.push('# G4 · LQA — ผลตรวจภาษาจากการเดินจริง');
  lines.push('');
  lines.push(`เก็บจากหน้าจอจริง ${screens.length} หน้า · ข้อความไทย ${screens.reduce((s, x) => s + x.thRuns, 0)} ชิ้น · อังกฤษ ${screens.reduce((s, x) => s + x.enRuns, 0)} ชิ้น`);
  lines.push(`ประเด็นที่ต้องแก้ ${rows.length} รายการ (นับแบบรวมข้อความซ้ำเป็นหนึ่ง — แก้ที่เดียวจบ)`);
  lines.push('');
  lines.push('| ระดับ | กฎ | ข้อความ | เจอที่ | อธิบาย |');
  lines.push('|---|---|---|---|---|');
  for (const r of rows) {
    const esc = (s: string) => s.replace(/\|/g, '\\|').replace(/\n/g, ' ');
    lines.push(`| ${r.severity} | ${r.rule} | \`${esc(r.text)}\` | ${[...r.screens].slice(0, 4).join(', ')} | ${esc(r.note)} |`);
  }
  lines.push('');
  lines.push('## หน้าจอที่เก็บได้');
  lines.push('');
  lines.push('| หน้า | URL | ปุ่มสลับภาษา | สลับได้จริง |');
  lines.push('|---|---|---|---|');
  for (const s of screens) {
    // null = the English pass was deliberately skipped mid-walk. "Not sampled" must never
    // read as "sampled and clean".
    const toggleCell = s.toggle === null ? 'ยังไม่ได้ตรวจ' : (s.toggle ? 'มี' : '**ไม่มี**');
    const switchedCell = s.toggle === null ? '-' : (s.toggle ? (s.switched ? 'ได้' : '**กดแล้วไม่เปลี่ยน**') : '-');
    lines.push(`| ${s.screen} | ${s.url} | ${toggleCell} | ${switchedCell} |`);
  }
  writeFileSync(outFile, lines.join('\n') + '\n');
  return { screens: screens.length, findings: rows.length };
}
