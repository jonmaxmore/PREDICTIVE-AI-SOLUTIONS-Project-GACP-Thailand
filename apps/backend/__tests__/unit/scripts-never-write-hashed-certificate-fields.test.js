/**
 * SOURCE PIN — no script under apps/backend/scripts/ may write a certificate column
 * that is inside buildCertificateDocumentHash.
 *
 * WHY this exists as a pin and not a code review note: on 2026-08-25
 * scripts/g4/set-certificate-business-date.js backdated a demo certificate's
 * issuedDate/expiryDate. Both columns are inside the canonical hashed field list, so the
 * stored documentHash was left describing a row that no longer existed and the public
 * verifier began reporting GACP-TH-2569-CAE820 as TAMPERED. The intent was innocent; a
 * verifier cannot tell innocent from forgery, which is the whole point of the hash. The
 * script now refuses signed rows — this test stops the NEXT script repeating the mistake.
 *
 * The hashed field list is DERIVED from buildCertificateDocumentHash itself (a recording
 * Proxy), never hand-copied: a copied list silently stops covering the day someone adds a
 * column to certificateCanonicalJson.
 */

const fs = require('fs');
const path = require('path');
const certificateService = require('../../services/certificate-service');

const { buildCertificateDocumentHash } = certificateService;
const SCRIPTS_DIR = path.join(__dirname, '..', '..', 'scripts');

/**
 * Files permitted to write a hashed certificate column, each with the reason it is safe
 * and a `guard` pattern that must still be present in that file. The guard is what makes
 * an allowlist entry cost something: allowlisting a script and then deleting its refusal
 * turns the pin back into decoration, so the entry expires the moment the guard goes.
 *
 * Adding a row here is a deliberate decision to weaken the pin — state WHY, and prefer
 * re-issuing the certificate over editing a signed row.
 */
const ALLOWLIST = Object.freeze({
    'g4/set-certificate-business-date.js': {
        why: 'GOALS G4.3 backdate of ONE demo certificate, and only while it is still '
            + 'unsigned: the script refuses any row carrying a signature or a documentHash, '
            + 'so there is never a stored hash for its write to invalidate.',
        guard: /if\s*\(\s*b\.signature\s*\|\|\s*b\.documentHash\s*\)/,
    },
});

/**
 * The hashed field set, read out of the real hash builder rather than restated here.
 * buildCertificateDocumentHash reads every field it hashes off its argument, so a Proxy
 * that records property reads returns exactly that set. Every read yields null so the
 * date normaliser short-circuits instead of choking on a placeholder value.
 */
function hashedCertificateFields() {
    const seen = new Set();
    const probe = new Proxy({}, {
        get(_target, prop) {
            if (typeof prop === 'string') { seen.add(prop); }
            return null;
        },
    });
    buildCertificateDocumentHash(probe);
    return seen;
}

/** Every .js file under scripts/, recursively. */
function listScriptFiles(dir) {
    const out = [];
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
            if (entry.name === 'node_modules') { continue; }
            out.push(...listScriptFiles(full));
        } else if (entry.name.endsWith('.js')) {
            out.push(full);
        }
    }
    return out;
}

/** Text between `text[open]` (an opening bracket) and its matching close. */
function balancedSlice(text, open, openChar, closeChar) {
    let depth = 0;
    for (let i = open; i < text.length; i += 1) {
        const ch = text[i];
        if (ch === openChar) { depth += 1; } else if (ch === closeChar) {
            depth -= 1;
            if (depth === 0) { return text.slice(open + 1, i); }
        }
    }
    return null;
}

/**
 * Top-level keys of an object-literal body — keys nested in sub-objects are skipped, since
 * only the top level names a column. Shorthand (`{ issuedDate }`) counts: Prisma treats it
 * identically to `{ issuedDate: issuedDate }`, and a scanner that missed it would wave
 * through the most compact way to write the bug.
 */
function topLevelKeys(body) {
    const keys = [];
    let depth = 0;
    let atKeyPosition = true;
    for (let i = 0; i < body.length; i += 1) {
        const ch = body[i];
        if (ch === '{' || ch === '[' || ch === '(') { depth += 1; continue; }
        if (ch === '}' || ch === ']' || ch === ')') { depth -= 1; continue; }
        if (depth !== 0) { continue; }
        if (ch === ',') { atKeyPosition = true; continue; }
        if (!atKeyPosition) { continue; }
        const rest = body.slice(i);
        const named = /^(?:'([A-Za-z_$][\w$]*)'|"([A-Za-z_$][\w$]*)"|([A-Za-z_$][\w$]*))\s*(:|,|$)/.exec(rest);
        if (!named) { continue; }
        keys.push(named[1] || named[2] || named[3]);
        i += named[0].length - 1;
        // A shorthand key ends its own entry, so the next token is already a key again.
        atKeyPosition = named[4] === ',';
    }
    return keys;
}

/**
 * Findings for one file's source: every hashed column written through a
 * certificate.update / updateMany / upsert call.
 *
 * Any receiver is matched (`prisma.`, `tx.`, `client.`) — the risk is the write, not the
 * name of the handle it went through.
 */
function findHashedFieldWrites(source, hashedFields) {
    const findings = [];
    const call = /\b[\w$]+\s*\.\s*certificate\s*\.\s*(update|updateMany|upsert)\s*\(/g;
    let m = call.exec(source);
    while (m !== null) {
        const parenOpen = source.indexOf('(', m.index + m[0].length - 1);
        const args = balancedSlice(source, parenOpen, '(', ')');
        if (args) {
            // update/updateMany write through `data`; upsert through `create` and `update`.
            for (const clause of ['data', 'create', 'update']) {
                const at = new RegExp(`(^|[\\s,{])${clause}\\s*:\\s*\\{`).exec(args);
                if (!at) { continue; }
                const braceOpen = args.indexOf('{', at.index + at[0].length - 1);
                const body = balancedSlice(args, braceOpen, '{', '}');
                if (!body) { continue; }
                for (const key of topLevelKeys(body)) {
                    if (hashedFields.has(key)) {
                        findings.push({ operation: m[1], clause, field: key });
                    }
                }
            }
        }
        m = call.exec(source);
    }
    return findings;
}

describe('source pin — scripts/ never writes a hashed certificate field', () => {
    const hashedFields = hashedCertificateFields();

    it('derives the hashed field set from buildCertificateDocumentHash itself', () => {
        // Spot-check the two columns that caused the incident, plus one that must NOT be
        // in the set (status is deliberately outside the hash so revoke/suspend is legal).
        expect(hashedFields.has('issuedDate')).toBe(true);
        expect(hashedFields.has('expiryDate')).toBe(true);
        expect(hashedFields.has('status')).toBe(false);
        expect(hashedFields.size).toBeGreaterThan(10);
    });

    it('the scanner actually detects a hashed-field write (no vacuous pass)', () => {
        const bad = `
            await prisma.certificate.update({
                where: { id },
                data: { issuedDate: ISSUED, expiryDate: expiry },
            });
        `;
        expect(findHashedFieldWrites(bad, hashedFields))
            .toEqual([
                { operation: 'update', clause: 'data', field: 'issuedDate' },
                { operation: 'update', clause: 'data', field: 'expiryDate' },
            ]);

        const upsert = `
            prisma.certificate.upsert({
                where: { certificateNumber },
                create: { certificateNumber, farmName, status: 'active' },
                update: { status: 'active' },
            });
        `;
        expect(findHashedFieldWrites(upsert, hashedFields).map((f) => f.field))
            .toEqual(['certificateNumber', 'farmName']);

        const shorthand = `
            await tx.certificate.updateMany({
                where: { farmId },
                data: { farmName, updatedBy: actorId },
            });
        `;
        expect(findHashedFieldWrites(shorthand, hashedFields))
            .toEqual([{ operation: 'updateMany', clause: 'data', field: 'farmName' }]);

        const lifecycleOnly = `
            await prisma.certificate.update({
                where: { id },
                data: { status: 'revoked', revokedAt: now, revokedBy: actorId },
            });
        `;
        expect(findHashedFieldWrites(lifecycleOnly, hashedFields)).toEqual([]);
    });

    it('finds scripts to scan, and finds the certificate writers among them', () => {
        const files = listScriptFiles(SCRIPTS_DIR);
        expect(files.length).toBeGreaterThan(0);

        // Guard against the scan silently degrading to nothing: certificate writers exist
        // under scripts/ today. If the last one is genuinely removed, delete this
        // assertion on purpose rather than letting the pin pass on an empty set.
        const writers = files.filter((f) => /\b[\w$]+\s*\.\s*certificate\s*\.\s*(update|updateMany|upsert)\s*\(/
            .test(fs.readFileSync(f, 'utf8')));
        expect(writers.length).toBeGreaterThan(0);
    });

    it('no script writes a certificate column that is inside the document hash', () => {
        const offenders = [];
        for (const file of listScriptFiles(SCRIPTS_DIR)) {
            const rel = path.relative(SCRIPTS_DIR, file).split(path.sep).join('/');
            const source = fs.readFileSync(file, 'utf8');
            const findings = findHashedFieldWrites(source, hashedFields);
            if (findings.length === 0) { continue; }
            const waiver = ALLOWLIST[rel];
            if (waiver && waiver.guard.test(source)) { continue; }
            if (waiver) {
                offenders.push(`scripts/${rel}: allowlisted, but its guard is gone — ${waiver.why}`);
                continue;
            }
            for (const finding of findings) {
                offenders.push(`scripts/${rel}: certificate.${finding.operation} ${finding.clause}.${finding.field}`);
            }
        }
        expect(offenders).toEqual([]);
    });

    it('every allowlist entry still names a real file whose guard is present', () => {
        for (const [rel, waiver] of Object.entries(ALLOWLIST)) {
            const file = path.join(SCRIPTS_DIR, rel);
            expect(fs.existsSync(file)).toBe(true);
            expect(waiver.why.length).toBeGreaterThan(20);
            expect(waiver.guard.test(fs.readFileSync(file, 'utf8'))).toBe(true);
        }
    });
});
