/**
 * A Tailwind colour class that names a shade the config does not define compiles
 * to NOTHING — no rule, no warning, no error. The element renders unstyled and
 * the code reads as if it were styled.
 *
 * Found 2026-09-07 (evidence/apple-qa-audit-2026-09-07): the application wizard's
 * whole "selected" treatment used `bg-leaf-50`, `bg-leaf-100` and
 * `border-leaf-200`, none of which exist — `theme.extend.colors.leaf` defines only
 * DEFAULT, 300, 600, 700, 800, soft and onSoft. Ten references across four files,
 * every one of them dead, on the screens a farmer fills in to file an application.
 * Nothing in the toolchain says a word about it: there is no safelist, no
 * `content` miss, just a class that matches no rule.
 *
 * So the test does what the compiler will not: read the palette the config
 * actually defines, then assert that every colour class used in src/ names a key
 * that is in it.
 */
import fs from 'node:fs';
import path from 'node:path';
import twConfig from '../../../tailwind.config.cjs';

const WEB_ROOT = path.join(__dirname, '..', '..', '..');
const tw = twConfig as {
    theme: { extend: { colors: Record<string, unknown> } };
};

/** Families this test governs: project palettes, not Tailwind's own built-ins. */
const GOVERNED = ['leaf', 'officer', 'mint', 'lime', 'brand', 'gov', 'primary'];
/**
 * `shadow-` is deliberately absent: in Tailwind it addresses TWO scales, the
 * boxShadow keys (shadow-leaf-btn, shadow-leaf-card — all real, declared in
 * theme.extend.boxShadow) and the colour scale (shadow-leaf-700). Including it
 * made this test flag 13 legitimate boxShadow utilities. A guard that cries wolf
 * on correct code gets deleted, so it only governs the prefixes that resolve to
 * the colour scale and nothing else.
 */
const PREFIXES = ['bg', 'text', 'border', 'ring', 'fill', 'stroke', 'from', 'to', 'via', 'divide', 'outline', 'decoration', 'accent', 'caret', 'placeholder'];

/** Every key the config defines for a family, including nested ones. */
function keysFor(family: string): Set<string> {
    const value = tw.theme.extend.colors[family];
    const out = new Set<string>();
    if (typeof value === 'string') { out.add(''); return out; }
    if (value && typeof value === 'object') {
        for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
            if (k === 'DEFAULT') { out.add(''); continue; }
            if (v && typeof v === 'object') {
                for (const nested of Object.keys(v as Record<string, unknown>)) out.add(`${k}-${nested}`);
            } else {
                out.add(k);
            }
        }
    }
    return out;
}

function sourceFiles(dir: string, acc: string[] = []): string[] {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === '__tests__' || entry.name === 'node_modules') continue;
            sourceFiles(full, acc);
        } else if (/\.(tsx|ts)$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
            acc.push(full);
        }
    }
    return acc;
}

const FILES = sourceFiles(path.join(WEB_ROOT, 'src'));

describe.each(GOVERNED)('the %s palette', (family) => {
    const defined = keysFor(family);

    it('defines at least one key, or this test is vacuous', () => {
        expect(defined.size).toBeGreaterThan(0);
    });

    it('has no class in src/ naming a shade it does not define', () => {
        const re = new RegExp(`(?<![\\w-])(?:${PREFIXES.join('|')})-${family}(?:-([A-Za-z0-9]+(?:-[A-Za-z0-9]+)?))?(?![\\w-])`, 'g');
        const dead: string[] = [];
        for (const file of FILES) {
            const src = fs.readFileSync(file, 'utf8');
            let m: RegExpExecArray | null;
            while ((m = re.exec(src)) !== null) {
                const shade = m[1] ?? '';
                if (!defined.has(shade)) {
                    dead.push(`${path.relative(WEB_ROOT, file)}: ${m[0]}`);
                }
            }
        }
        expect(dead).toEqual([]);
    });
});
