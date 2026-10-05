'use strict';

/**
 * Static scan for business-date reads that bypass the Bangkok zone helpers.
 *
 * Operator ruling 2026-09-26 ("เวลาไทยทั้งหมด"): every business date, year and
 * month is a Bangkok one. The containers run on UTC, so any calendar read off
 * the process clock (or off UTC) names the wrong day for everything between
 * 00:00 and 06:59 in Bangkok. The only places allowed to touch the raw clock
 * are the zone helpers themselves:
 *   - apps/backend/utils/working-days.js       (getZonedParts & friends)
 *   - apps/web-app/src/lib/format/thai-date.ts  (THAI_TIME_ZONE & friends)
 *
 * What counts as a hit, in code (comments are blanked out first):
 *   1. process-clock calendar/clock reads/writes: .getFullYear( .getMonth(
 *      .getDate( .getDay( .getHours( .getMinutes( .setHours( .setMinutes(
 *      .setDate( .setMonth( .setFullYear( — also through .call( / .apply(
 *   2. UTC calendar/clock reads: .getUTCFullYear( .getUTCMonth( .getUTCDate(
 *      .getUTCDay( .getUTCHours( .getUTCMinutes(
 *   3. UTC ISO day/month slices: toISOString()/toJSON() .slice(0, 10|7) /
 *      .substring / .substr, and .split('T')
 *   4. .toDateString() (the process clock's day as a string)
 *   5. toLocaleDateString( / toLocaleTimeString( on any receiver, Intl.DateTimeFormat(
 *      with date or time fields, and toLocaleString( on any receiver that is not
 *      recognisably a number (isNumberReceiver) — whenever the call's arguments
 *      name no `timeZone`
 *   6. `new Date(a, b, …)` with two or more arguments (a process-clock calendar
 *      constructor)
 *   7. a zone-less wall-clock string parse: new Date(`${d}T00:00:00`),
 *      new Date('2026-09-17T09:00') or new Date(day + 'T00:00:00') — a string
 *      piece with a "T..:" time and no Z or ±hh:mm offset in the argument
 *   8. any of the methods above called by computed name: d['getFullYear']()
 *
 * Known blind spots (heuristic, not a parser): a regex literal holding a quote
 * or a nested template literal can hide the code after it; a formatter whose
 * options object is built elsewhere and passed by name is judged by that name
 * only (it has no `timeZone` token, so it is flagged — a false positive that
 * is fixed by naming the zone at the call).
 */

function blankComments(src) {
    let out = '';
    let i = 0;
    const n = src.length;
    let quote = null;
    while (i < n) {
        const c = src[i];
        const d = src[i + 1];
        if (quote === null) {
            if (c === '/' && d === '*') {
                const j = src.indexOf('*/', i + 2);
                const end = j < 0 ? n : j + 2;
                out += src.slice(i, end).replace(/[^\n]/g, ' ');
                i = end;
                continue;
            }
            if (c === '/' && d === '/' && src[i - 1] !== ':') {
                const j = src.indexOf('\n', i);
                const end = j < 0 ? n : j;
                out += ' '.repeat(end - i);
                i = end;
                continue;
            }
            if (c === '"' || c === "'" || c === '`') {
                quote = c;
            }
            out += c;
            i += 1;
            continue;
        }
        if (c === '\\') {
            out += c + (d || '');
            i += 2;
            continue;
        }
        if (c === quote) {
            quote = null;
        }
        out += c;
        i += 1;
    }
    return out;
}

function callArgs(code, openParenIndex) {
    let depth = 0;
    for (let i = openParenIndex; i < code.length; i += 1) {
        const c = code[i];
        if (c === '(') {
            depth += 1;
        } else if (c === ')') {
            depth -= 1;
            if (depth === 0) {
                return code.slice(openParenIndex + 1, i);
            }
        }
    }
    return code.slice(openParenIndex + 1);
}

function topLevelArgCount(args) {
    const trimmed = args.replace(/,\s*$/, '').trim();
    if (!trimmed) {
        return 0;
    }
    let depth = 0;
    let commas = 0;
    for (const c of trimmed) {
        if ('([{'.includes(c)) {
            depth += 1;
        } else if (')]}'.includes(c)) {
            depth -= 1;
        } else if (c === ',' && depth === 0) {
            commas += 1;
        }
    }
    return commas + 1;
}

const PLAIN_RULES = [
    [/\.(getFullYear|getMonth|getDate|getDay|getHours|getMinutes|setHours|setMinutes|setDate|setMonth|setFullYear)(\(|\.(call|apply)\()/g,
        'process-clock calendar/clock read or write'],
    [/\.(getUTCFullYear|getUTCMonth|getUTCDate|getUTCDay|getUTCHours|getUTCMinutes)(\(|\.(call|apply)\()/g,
        'UTC calendar/clock read'],
    [/(toISOString|toJSON)\(\)\s*\.\s*(slice|substring|substr)\(\s*0\s*,\s*(10|7)\s*\)|(toISOString|toJSON)\(\)\s*\.\s*split\(\s*['"]T['"]\s*\)/g,
        'UTC ISO day/month slice'],
    [/\.toDateString\(\)/g, 'process-clock day string (toDateString)'],
    // The same methods called through a computed name: d['getFullYear']().
    [/\[\s*['"`](getFullYear|getMonth|getDate|getDay|getHours|getMinutes|setHours|setMinutes|setDate|setMonth|setFullYear|getUTCFullYear|getUTCMonth|getUTCDate|getUTCDay|getUTCHours|getUTCMinutes|toDateString|toLocaleString|toLocaleDateString|toLocaleTimeString)['"`]\s*\]\s*\(/g,
        'calendar/clock method called by computed name'],
];

/**
 * Is the receiver of `.toLocaleString(` at `dotIndex` a number? Judged from the
 * receiver expression's text: `Number(x)`, `x.toFixed`, a numeric literal, a
 * `(a + b)` / `Math.*` expression, or an identifier/property whose name reads as
 * an amount or count. Anything else — a Date variable, `row.createdAt`, `d` —
 * is treated as a date and must name its zone.
 */
// Suffixes only, never a bare letter: a one-letter suffix (the old `|n`) made
// every name ending in "n" — lastLogin, expiration, createdOn, session — a number.
const NUMBER_NAME = /(amount|total|subtotal|vat|price|fee|sum|count|qty|quantity|balance|payable|revenue|net|gross|value|cost|rate|size|bytes|num|len|length|limit|max|min|remaining|paid|dueAmount|debit|credit|satang|baht|thb|score|points|weight|kg|area|rai|sqm|index|seq|number|scope)$/i;
// Checked BEFORE NUMBER_NAME: a name that reads as a moment is a date.
const DATE_NAME = /(date|Date|At|On|time|Time|when|now|day|Day|expiry|Expiry|expir\w*|Expir\w*|deadline|Deadline|since|until|from|to|start|end|timestamp|Timestamp|login|Login|session|Session|due|Due)$/;

function receiverText(code, dotIndex) {
    let i = dotIndex - 1;
    let depth = 0;
    while (i >= 0) {
        const c = code[i];
        if (c === ')' || c === ']') { depth += 1; }
        else if (c === '(' || c === '[') {
            if (depth === 0) { break; }
            depth -= 1;
        } else if (depth === 0 && !/[\w$.?!]/.test(c)) { break; }
        i -= 1;
    }
    return code.slice(i + 1, dotIndex).trim();
}

function isNumberReceiver(code, dotIndex) {
    const recv = receiverText(code, dotIndex);
    if (!recv) { return false; }
    if (/^new Date\b|Date\(/.test(recv)) { return false; }
    if (/^(Number|Math\.\w+|parseFloat|parseInt|round\w*|toNumber|Decimal)\(|^\d|\)\.toFixed\(/.test(recv)) { return true; }
    if (recv.startsWith('(') && recv.endsWith(')')) {
        // A parenthesised receiver is a number only when it is arithmetic over
        // numbers: `(a + b)`, `(total * 1.07)`. A fallback like
        // `(row.createdAt || now)` or a ternary is judged a date.
        const inner = recv.slice(1, -1).trim();
        if (/\bnew\b|Date\b|\?(?![.?])/.test(inner)) { return false; } // a Date, or a ternary
        // A fallback chain `(a || b)` / `(a ?? b)` is a number only when EVERY
        // alternative is: `(data.amount || 0)` is, `(row.createdAt || now)` is not.
        const alternatives = inner.split(/\|\||\?\?/).map((part) => part.trim());
        if (alternatives.length > 1) {
            return alternatives.every((part) => /^\d/.test(part) || isNumberReceiver(`${part}.`, part.length));
        }
        if (!/[+\-*/%]/.test(inner)) { return isNumberReceiver(`${inner}.`, inner.length); }
        const names = inner.match(/[A-Za-z_$][\w$]*/g) || [];
        return names.every((name) => !DATE_NAME.test(name));
    }
    const last = recv.replace(/\(.*\)$/, '').split(/[.?!]+/).filter(Boolean).pop() || '';
    if (DATE_NAME.test(last)) { return false; }
    return NUMBER_NAME.test(last);
}

// Options only a NUMBER format takes: `n.toLocaleString('th-TH', { minimumFractionDigits: 2 })`.
const NUMBER_FIELD = /\b(minimumFractionDigits|maximumFractionDigits|minimumIntegerDigits|maximumSignificantDigits|minimumSignificantDigits|currency|currencyDisplay|useGrouping|notation|compactDisplay|unit|unitDisplay)\s*:|\bstyle\s*:\s*['"`](currency|percent|decimal|unit)/;
const DATE_FIELD = /\b(year|month|day|weekday|hour|minute|dateStyle|timeStyle)\s*:/;

/**
 * @param {string} src
 * @returns {Array<{ line: number, rule: string, text: string }>}
 */
function scanSource(src) {
    const code = blankComments(src);
    const lineOf = (index) => code.slice(0, index).split('\n').length;
    const hits = [];
    for (const [re, rule] of PLAIN_RULES) {
        re.lastIndex = 0;
        let m;
        while ((m = re.exec(code))) {
            hits.push({ line: lineOf(m.index), rule, text: m[0] });
        }
    }

    const localeCall = /\.(toLocaleDateString|toLocaleTimeString|toLocaleString)\(|\bIntl\.DateTimeFormat\(/g;
    let m;
    while ((m = localeCall.exec(code))) {
        const args = callArgs(code, m.index + m[0].length - 1);
        if (/\btimeZone\b/.test(args)) {
            continue;
        }
        const method = m[1];
        if (method === 'toLocaleString' && !DATE_FIELD.test(args)
            && (NUMBER_FIELD.test(args) || isNumberReceiver(code, m.index))) {
            continue; // a number's toLocaleString (an amount, a count), not a date
        }
        if (!method && !DATE_FIELD.test(args)) {
            continue; // Intl.DateTimeFormat used for something with no date field
        }
        hits.push({ line: lineOf(m.index), rule: 'locale date/time without timeZone', text: m[0] });
    }

    const ctor = /\bnew Date\(/g;
    while ((m = ctor.exec(code))) {
        const args = callArgs(code, m.index + m[0].length - 1);
        const literal = args.trim();
        // A wall-clock time written into the string — as the literal itself, a
        // template, or a concatenated piece like `day + 'T00:00:00'` — with no
        // Z or ±hh:mm anywhere in the argument, is read in the process zone.
        const stringPieces = literal.match(/`[^`]*`|'[^']*'|"[^"]*"/g) || [];
        const hasWallClock = stringPieces.some((piece) => /T(\d{2}|\$\{[^}]*\}):/.test(piece));
        const hasZone = stringPieces.some((piece) => /(Z|[+-]\d{2}:?\d{2})[`'"]$/.test(piece));
        if (hasWallClock && !hasZone) {
            hits.push({
                line: lineOf(m.index),
                rule: 'zone-less wall-clock parse (reads the time in the process zone)',
                text: `new Date(${literal.slice(0, 40)}`,
            });
            continue;
        }
        if (topLevelArgCount(args) >= 2) {
            hits.push({
                line: lineOf(m.index),
                rule: 'multi-argument new Date (process-clock calendar)',
                text: `new Date(${args.slice(0, 40).replace(/\s+/g, ' ')}`,
            });
        }
    }
    return hits.sort((a, b) => a.line - b.line);
}

module.exports = { scanSource, blankComments };
