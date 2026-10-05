/**
 * Dark-mode contrast on the wizard's slot card and step shell.
 *
 * Found by the real-stack walk (evidence/document-precheck-2026-09-27/real-stack/INDEX.md)
 * and the web-quotation-truth review (M-4):
 *   D2  a missing slot card kept stock `bg-amber-50` (it has no dark value), so the title,
 *       which flips to near-white through `text-foreground`, sat on a near-white ground.
 *   D6  the disabled "ยืนยันว่าเอกสารถูกต้อง" was white on `bg-leaf-300`, and "เปิดดูในหน้า"
 *       was the fixed `text-leaf-700` on `bg-leaf-soft`, which is #16301f in dark.
 *   M-4 the wizard step card was a bare `bg-white`, so in dark the text written straight on
 *       it (step 10's heading and paragraphs around the quotation) was near-white on grey.
 *
 * Two layers are pinned: the markup uses the themed tokens, and the tokens themselves clear
 * WCAG AA (4.5:1) in BOTH themes — measured from globals.css, never assumed.
 */
import fs from 'node:fs';
import path from 'node:path';
import { renderToStaticMarkup } from 'react-dom/server';
import { RequirementSlotCard } from '../requirement-slot-card';
import type { RequirementSlot } from '@/lib/services/application-requirements';

const STYLES = path.join(__dirname, '../../../../../../../styles');
const globals = fs.readFileSync(path.join(STYLES, 'globals.css'), 'utf8');
const STEP_PAGE = fs.readFileSync(
    path.join(__dirname, '../../../../_components/application-step-page.tsx'),
    'utf8',
);

const slot = (patch: Partial<RequirementSlot>): RequirementSlot => ({
    slotId: 'land_rights',
    labelTH: 'เอกสารสิทธิ์ที่ดิน',
    description: null,
    sourceHint: null,
    required: true,
    requiredReason: 'RENTED',
    satisfied: false,
    fileUrl: null,
    fileName: null,
    uploadedAt: null,
    ...patch,
});

const render = (s: RequirementSlot) =>
    renderToStaticMarkup(<RequirementSlotCard slot={s} appId="app-1" onChanged={() => {}} />);

/** The class attribute of the first element whose text is exactly `text`. */
function classOf(html: string, text: string): string {
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const el = Array.from(doc.querySelectorAll('button, p, span')).find((n) => n.textContent === text);
    if (!el) { throw new Error(`no element reading "${text}"`); }
    return el.getAttribute('class') || '';
}

// ── colour maths over globals.css (same formula as themed-surfaces-have-dark-values) ──
function block(css: string, selector: string): string {
    const at = css.indexOf(`${selector} {`);
    const open = css.indexOf('{', at);
    let depth = 0;
    for (let i = open; i < css.length; i += 1) {
        if (css[i] === '{') { depth += 1; } else if (css[i] === '}') {
            depth -= 1;
            if (depth === 0) { return css.slice(open + 1, i); }
        }
    }
    throw new Error(`unterminated ${selector}`);
}
function declare(css: string, prop: string): string {
    const m = new RegExp(`(?:^|;|\\n)\\s*${prop}\\s*:\\s*([^;]+);`).exec(css);
    if (!m) { throw new Error(`${prop} not declared`); }
    return m[1].replace(/\/\*.*?\*\//g, '').trim();
}
function hslToRgb(h: number, s: number, l: number): [number, number, number] {
    const a = s * Math.min(l, 1 - l);
    const f = (n: number) => {
        const k = (n + h / 30) % 12;
        return Math.round(255 * (l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1))));
    };
    return [f(0), f(8), f(4)];
}
/** `234 249 240` (rgb channels) or `150 12% 35%` (hsl triple). */
function toRgb(value: string): [number, number, number] {
    const parts = value.trim().split(/\s+/);
    if (parts[1]?.endsWith('%')) {
        return hslToRgb(Number(parts[0]), parseFloat(parts[1]) / 100, parseFloat(parts[2]) / 100);
    }
    return parts.map(Number) as [number, number, number];
}
function luminance([r, g, b]: [number, number, number]): number {
    const lin = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}
function ratio(fgToken: string, bgToken: string, theme: string): number {
    const [a, b] = [luminance(toRgb(declare(theme, fgToken))), luminance(toRgb(declare(theme, bgToken)))];
    const [hi, lo] = a > b ? [a, b] : [b, a];
    return (hi + 0.05) / (lo + 0.05);
}
const THEMES: ReadonlyArray<[string, string]> = [['light', block(globals, ':root')], ['dark', block(globals, '.dark')]];
const AA = 4.5;

describe('D2: a missing slot card sits on a surface that flips', () => {
    const html = render(slot({}));

    it('uses the caution surface token, not stock amber-50 (which has no dark value)', () => {
        expect(html).toContain('bg-caution-soft');
        expect(html).toContain('border-caution-edge');
        expect(html).not.toContain('bg-amber-50');
        expect(html).not.toContain('border-amber-200');
    });

    it.each(THEMES)('title (--foreground), status (--muted-foreground) and reason (--leaf-on-soft) clear AA on it in %s', (_name, theme) => {
        expect(ratio('--foreground', '--caution-soft', theme)).toBeGreaterThanOrEqual(AA);
        expect(ratio('--muted-foreground', '--caution-soft', theme)).toBeGreaterThanOrEqual(AA);
        expect(ratio('--leaf-on-soft', '--caution-soft', theme)).toBeGreaterThanOrEqual(AA);
    });

    it('the light look is unchanged: --caution-soft is amber-50 in :root', () => {
        expect(toRgb(declare(THEMES[0][1], '--caution-soft'))).toEqual([255, 251, 235]);
    });

    it('the "เพราะ…" reason badge uses the themed on-soft ink', () => {
        expect(classOf(html, 'เพราะที่ดินเป็นการเช่า')).toContain('text-leaf-onSoft');
        expect(classOf(html, 'เพราะที่ดินเป็นการเช่า')).not.toContain('text-leaf-700');
    });
});

describe('D6: the view button and the disabled confirm button are readable in dark', () => {
    const flagged = slot({
        satisfied: true, fileUrl: '/uploads/a.pdf', fileName: 'a.pdf',
        precheck: {
            id: 'pc-1', status: 'DONE', acknowledgedAt: '2026-09-29T03:00:00.000Z',
            flags: [{ check: 'CROSS_MATCH', result: 'NOT_FOUND', reasonTH: 'ไม่พบชื่อผู้ยื่นในเอกสาร', confidence: 90, evidenceSnippet: null }],
        },
    } as Partial<RequirementSlot>);
    const html = render(flagged);

    it('"เปิดดูในหน้า" uses text-leaf-onSoft (flips), not the fixed text-leaf-700', () => {
        const cls = classOf(html, 'เปิดดูในหน้า');
        expect(cls).toContain('text-leaf-onSoft');
        expect(cls).not.toMatch(/(^|\s)text-leaf-700(\s|$)/);
    });

    it('the disabled confirm button paints muted tokens, not white on leaf-300', () => {
        const cls = classOf(html, 'ยืนยันว่าเอกสารถูกต้อง');
        expect(cls).toContain('disabled:bg-muted');
        expect(cls).toContain('disabled:text-muted-foreground');
        expect(cls).not.toContain('disabled:bg-leaf-300');
    });

    it.each(THEMES)('--leaf-on-soft on --leaf-soft and --muted-foreground on --muted clear AA in %s', (_name, theme) => {
        expect(ratio('--leaf-on-soft', '--leaf-soft', theme)).toBeGreaterThanOrEqual(AA);
        expect(ratio('--muted-foreground', '--muted', theme)).toBeGreaterThanOrEqual(AA);
    });
});

describe('M-4: the wizard step card flips with the theme', () => {
    it('the step card and its loading card are bg-card, never a bare bg-white', () => {
        expect(STEP_PAGE).not.toMatch(/(^|\s|")bg-white(\s|"|\/)/);
        expect((STEP_PAGE.match(/rounded-\[1\.375rem\] border border-mint-bg bg-card/g) || []).length).toBe(2);
    });

    // The step body is `bg-mint-soft/40` laid over the card, so the ground the step 10
    // heading and paragraphs actually sit on is that 40 % blend, measured as such.
    it.each(THEMES)('--muted-foreground (step 10 heading/paragraphs) clears AA on mint-soft/40 over --card in %s', (_name, theme) => {
        const card = toRgb(declare(theme, '--card'));
        const mint = toRgb(declare(theme, '--mint-soft'));
        const ground = card.map((c, i) => Math.round(0.4 * mint[i] + 0.6 * c)) as [number, number, number];
        const [a, b] = [luminance(toRgb(declare(theme, '--muted-foreground'))), luminance(ground)];
        const [hi, lo] = a > b ? [a, b] : [b, a];
        expect((hi + 0.05) / (lo + 0.05)).toBeGreaterThanOrEqual(AA);
    });
});
