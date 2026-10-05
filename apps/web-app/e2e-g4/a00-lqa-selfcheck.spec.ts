/**
 * G4 · A00 — the LQA checker checks itself, before it is allowed to judge the product.
 *
 * This exists because the first version of the checker produced 33 findings on one
 * screen and MOST OF THEM WERE ITS OWN BUGS: an allow-list that matched inside words
 * reported "Department" as "Departm t" and "Thai" as " ai"; a key-detector that called
 * the ministry's website "dtam.moph.go.th" a translation key; and a language toggle
 * matched by the loose fragment /EN\b/, which on a screen with no language control
 * found some other button and PRESSED IT.
 *
 * A report with invented defects in it costs more than no report: someone spends a day
 * chasing strings that were never broken, and stops trusting the real rows. So every
 * rule is pinned here on both sides — a case it must catch, and a case it must leave
 * alone — and this spec runs first (a00) so the walk never captures with a checker whose
 * behaviour has not just been demonstrated.
 */
import { test, expect } from '@playwright/test';
import { check, type TextRun } from './lqa';

function run(text: string, over: Partial<TextRun> = {}): TextRun {
  return { text, tag: 'p', cls: '', role: '', path: 'div>p', region: 'body', ...over };
}
const rules = (t: string, over: Partial<TextRun> = {}, lang: 'th' | 'en' = 'th') =>
  check(run(t, over), lang, 'selfcheck').map((f) => f.rule);

test.describe('A00 — LQA checker selfcheck', () => {
  test('English prose on a Thai screen is caught, and reported unmangled', () => {
    const f = check(run('Request timeout. Please try again', { region: 'alert' }), 'th', 'selfcheck');
    const en = f.find((x) => x.rule === 'EN_ON_TH');
    expect(en, 'an English error on a Thai screen must be caught').toBeTruthy();
    expect(en!.severity, 'text inside an alert blocks the user, so it is HIGH').toBe('HIGH');
    expect(en!.text, 'the finding must quote what is actually on screen').toContain('Request timeout');
  });

  test('allow-listed terms are matched as WHOLE WORDS, never inside other words', () => {
    // The regression that made this file necessary: EN inside "Department", TH inside "Thai".
    const f = check(
      run('Department of Thai Traditional and Alternative Medicine', { region: 'footer' }),
      'th', 'selfcheck',
    );
    const en = f.find((x) => x.rule === 'EN_ON_TH');
    expect(en, 'it is still English on a Thai page').toBeTruthy();
    expect(en!.note, 'the residue must keep whole words').toContain('Department');
    expect(en!.note, 'EN must not be cut out of "Department"').not.toContain('Departm t');
    expect(en!.note, 'TH must not be cut out of "Thai"').not.toContain(' ai ');
    expect(en!.severity, 'the ministry name in a footer is normal on a Thai gov site — LOW').toBe('LOW');
  });

  test('a Thai string carrying allow-listed terms is left alone', () => {
    expect(rules('ยื่นคำขอรับรอง GACP')).not.toContain('EN_ON_TH');
    expect(rules('น้ำหนัก 250 kg')).not.toContain('EN_ON_TH');
  });

  test('a domain is not a translation key', () => {
    expect(rules('dtam.moph.go.th')).not.toContain('RAW_I18N_KEY');
    expect(rules('ติดต่อ contact@dtam.mail.go.th')).not.toContain('RAW_I18N_KEY');
    // …but a real key still is one.
    expect(rules('common.errors.notFound')).toContain('RAW_I18N_KEY');
  });

  test('a machine error code shown to the user is caught', () => {
    expect(rules('VALIDATION_ERROR')).toContain('RAW_ERROR_CODE');
    expect(rules('ข้อมูลไม่ถูกต้อง กรุณาตรวจสอบอีกครั้ง')).not.toContain('RAW_ERROR_CODE');
  });

  test('the Thai/Latin boundary needs a space', () => {
    expect(rules('ของGACP')).toContain('TH_LATIN_NO_SPACE');
    expect(rules('ของ GACP')).not.toContain('TH_LATIN_NO_SPACE');
  });

  test('ไม้ยมก takes a leading space', () => {
    expect(rules('ตรวจบ่อยๆ')).toContain('MAIYAMOK_NO_SPACE');
    expect(rules('ตรวจบ่อย ๆ')).not.toContain('MAIYAMOK_NO_SPACE');
  });

  test('an error must name the cause and the next action', () => {
    expect(rules('ขออภัย เกิดข้อผิดพลาด')).toContain('BARE_APOLOGY');
    expect(rules('ขออภัย ระบบขัดข้องชั่วคราว กรุณาลองใหม่อีกครั้ง')).not.toContain('BARE_APOLOGY');
  });

  test('the epoch date and Gregorian years are caught; Buddhist years are not', () => {
    expect(rules('อัปเดตล่าสุด 1/1/2513')).toContain('EPOCH_DATE');
    expect(rules('วันที่ออกใบรับรอง 15 มกราคม 2569')).not.toContain('GREGORIAN_YEAR');
    expect(rules('วันที่ออกใบรับรอง 15 มกราคม 2026')).toContain('GREGORIAN_YEAR');
    expect(rules('ยอดชำระ 29,425 บาท'), 'a plain number is not a date').not.toContain('GREGORIAN_YEAR');
  });

  test('positive tracking on Thai text is caught', () => {
    expect(rules('สถานะคำขอ', { cls: 'text-xs tracking-wider uppercase' })).toContain('TRACKING_ON_THAI');
    expect(rules('สถานะคำขอ', { cls: 'text-xs tracking-tight' })).not.toContain('TRACKING_ON_THAI');
    expect(rules('STATUS', { cls: 'tracking-wider' }), 'Latin-only labels may carry tracking').not.toContain('TRACKING_ON_THAI');
  });

  test('Thai left on the English side is caught', () => {
    expect(rules('สถานะคำขอ', {}, 'en')).toContain('TH_ON_EN');
    expect(rules('Application status', {}, 'en')).not.toContain('TH_ON_EN');
  });
});
