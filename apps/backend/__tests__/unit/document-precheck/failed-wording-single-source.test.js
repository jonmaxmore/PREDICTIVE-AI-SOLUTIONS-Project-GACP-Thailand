/**
 * Walk D5 (evidence/document-precheck-2026-09-27/real-stack/INDEX.md): one
 * FAILED pre-check had three wordings — the API flag's reasonTH ("…ให้
 * เจ้าหน้าที่ตรวจเอง"), the applicant card ("…เจ้าหน้าที่จะตรวจเอง") and the
 * officer row ("…ให้ตรวจเอกสารนี้ด้วยตนเอง"). It now has one, spec §5's
 * applicant copy, defined once in the package both sides already share
 * (`@gacp/validation`, like upload-rules.js) and read by all three.
 *
 * The web half (card + officer row) is pinned by the web suite; this file
 * pins the backend half and scans both trees so a fourth literal cannot creep
 * back in beside the constant.
 */

const fs = require('fs');
const path = require('path');

const { PRECHECK_FAILED_TH } = require('@gacp/validation/precheck-copy');
const { FAILURE_FLAG } = require('../../../services/document-precheck/status');

const SPEC_5_APPLICANT_COPY = 'ตรวจอัตโนมัติไม่สำเร็จ เจ้าหน้าที่จะตรวจเอง';
const FIRST_CLAUSE = 'ตรวจอัตโนมัติไม่สำเร็จ';

const REPO = path.resolve(__dirname, '../../../../..');
const SOURCE_ROOTS = [
    'apps/backend/services',
    'apps/backend/routes',
    'apps/backend/shared',
    'apps/backend/constants',
    'apps/backend/jobs',
    'apps/backend/utils',
    'apps/web-app/src',
];
const SKIP_DIRS = new Set(['node_modules', '__tests__', '.next']);

function* sourceFiles(dir) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (entry.isDirectory()) {
            if (!SKIP_DIRS.has(entry.name)) { yield* sourceFiles(path.join(dir, entry.name)); }
        } else if (/\.(js|ts|tsx)$/.test(entry.name) && !/\.test\.(js|ts|tsx)$/.test(entry.name)) {
            yield path.join(dir, entry.name);
        }
    }
}

describe('one FAILED wording (walk D5)', () => {
    test('the shared constant is spec §5 applicant copy, verbatim', () => {
        expect(PRECHECK_FAILED_TH).toBe(SPEC_5_APPLICANT_COPY);
    });

    test('the API failure flag carries exactly that constant', () => {
        expect(FAILURE_FLAG.reasonTH).toBe(PRECHECK_FAILED_TH);
    });

    test('no source file outside the constant spells the FAILED wording itself', () => {
        const offenders = [];
        for (const root of SOURCE_ROOTS) {
            for (const file of sourceFiles(path.join(REPO, root))) {
                if (fs.readFileSync(file, 'utf8').includes(FIRST_CLAUSE)) {
                    offenders.push(path.relative(REPO, file));
                }
            }
        }
        expect(offenders).toEqual([]);
    });
});
