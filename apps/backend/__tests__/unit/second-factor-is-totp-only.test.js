/**
 * ปัจจัยที่สองมีอย่างเดียว: TOTP — ไม่มี 2FA แบบอีเมล ไม่มีล็อกอินด้วยอีเมล
 *
 * มติ operator 2026-09-15: "เราไม่มีล็อกอินด้วย email หรือ 2FA แบบ email แล้ว ระบบนี้ไม่ได้ใช้จริงด้วย
 * ต่อไปเราใช้แค่ หมอพร้อม กับ ThaiD" — ระบบยืนยันตัวตนคือ หมอพร้อม (MOPH Provider/Health ID)
 * กับ ThaID เท่านั้น ส่วน email-otp-service / email-service (SMTP) เป็นโค้ดที่ไม่มีใครใช้:
 * production ไม่เคยตั้ง SMTP_HOST (email-service.js:42 "Email sending will be mocked") ดังนั้น
 * ทุกทางที่ "ส่งอีเมล" คือทางที่เงียบหายไปโดยไม่มีใครรู้
 *
 * Wave 3 ของ branch cleanup เคยลบไฟล์ทั้งสองทิ้งเฉย ๆ (2026-09-14) แล้ว mfa.js กับ
 * health-auth-profile-handlers.js ยัง require อยู่ — ผู้ใช้ที่ twoFactorMethod = 'EMAIL' จะระเบิด
 * ตอน /verify ไฟล์นี้กันไม่ให้ทำครึ่งเดียวอีก: ไฟล์ต้องหาย จุดเรียกต้องหาย แถวเก่าใน DB ต้องถูก
 * ปลดล็อก และทุกประตูล็อกอินต้องตัดสิน MFA ผ่าน helper ตัวเดียวที่มองข้ามวิธีที่เลิกแล้ว
 */
'use strict';

const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..', '..');
const WEB = path.join(BACKEND, '..', 'web-app', 'src');
const read = (p) => fs.readFileSync(p, 'utf-8');

const SKIP_DIRS = new Set(['node_modules', '__tests__', 'archives', 'evidence', 'docs', 'prisma', 'coverage', 'dist']);
function sourceFiles(dir, out = []) {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (SKIP_DIRS.has(entry.name)) { continue; }
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) { sourceFiles(p, out); } else if (/\.(js|cjs|mjs)$/.test(entry.name)) { out.push(p); }
    }
    return out;
}

describe('the second factor is TOTP only (operator ruling 2026-09-15)', () => {
    it('the email OTP service and the SMTP email service are gone', () => {
        expect(fs.existsSync(path.join(BACKEND, 'services', 'email-otp-service.js'))).toBe(false);
        expect(fs.existsSync(path.join(BACKEND, 'services', 'email-service.js'))).toBe(false);
    });

    it('no backend source requires them any more (a lazy require is a bomb, not a dependency)', () => {
        const offenders = sourceFiles(BACKEND)
            .filter((f) => /require\(\s*['"][^'"]*email-(otp-)?service['"]\s*\)/.test(read(f)))
            .map((f) => path.relative(BACKEND, f));
        expect(offenders).toEqual([]);
    });

    it('the MFA router has no email enrolment routes and no EMAIL branch', () => {
        const src = read(path.join(BACKEND, 'routes', 'api', 'identity', 'mfa.js'));
        expect(src).not.toMatch(/\/email\/(setup|verify-setup)/);
        expect(src).not.toMatch(/['"]EMAIL['"]/);
    });

    it('identity-service can no longer enrol the EMAIL method', () => {
        const src = read(path.join(BACKEND, 'services', 'identity-service.js'));
        expect(src).not.toMatch(/enableEmailMfa|twoFactorMethod:\s*['"]EMAIL['"]/);
    });

    it('a legacy EMAIL-method row counts as NOT enrolled — it never had a TOTP seed, so a challenge would be a lockout', () => {
        const { hasUsableSecondFactor } = require('../../shared/second-factor');
        expect(hasUsableSecondFactor({ twoFactorEnabled: true, twoFactorMethod: 'TOTP' })).toBe(true);
        expect(hasUsableSecondFactor({ twoFactorEnabled: true, twoFactorMethod: null })).toBe(true);
        expect(hasUsableSecondFactor({ twoFactorEnabled: true })).toBe(true);
        expect(hasUsableSecondFactor({ mfaEnabled: true })).toBe(true); // legacy column name still honoured
        expect(hasUsableSecondFactor({ twoFactorEnabled: true, twoFactorMethod: 'EMAIL' })).toBe(false);
        expect(hasUsableSecondFactor({ twoFactorEnabled: false, twoFactorMethod: 'TOTP' })).toBe(false);
        expect(hasUsableSecondFactor(null)).toBe(false);
    });

    it('every login surface decides MFA through that one helper', () => {
        for (const rel of ['services/prisma-auth-service.js', 'routes/api/auth/auth-provider.js']) {
            const src = read(path.join(BACKEND, ...rel.split('/')));
            expect(src).toMatch(/hasUsableSecondFactor\(/);
            expect(src).not.toMatch(/Boolean\(user\.twoFactorEnabled \|\| user\.mfaEnabled\)/);
        }
    });

    it('a challenge token can only name TOTP', () => {
        const { mintMfaChallengeToken } = require('../../shared/mfa-challenge-binding');
        let err;
        try {
            mintMfaChallengeToken({ userId: 'u-1', method: 'EMAIL', ip: '127.0.0.1', userAgent: 'jest', tokenType: 'public' });
        } catch (e) { err = e; }
        expect(err && err.code).toBe('MFA_METHOD_RETIRED');
    });

    it('a migration retires every EMAIL-method row instead of leaving it enabled with no seed', () => {
        const dir = path.join(BACKEND, 'prisma', 'migrations');
        const folder = fs.readdirSync(dir).find((d) => /^\d{14}_retire_email_second_factor$/.test(d));
        expect(folder).toBeTruthy();
        const sql = read(path.join(dir, folder, 'migration.sql'));
        expect(sql).toMatch(/"twoFactorMethod"\s*=\s*'EMAIL'/);
        expect(sql).toMatch(/"twoFactorEnabled"\s*=\s*false/i);
        expect(sql).toMatch(/"twoFactorBackupCodes"\s*=\s*NULL/i);
    });

    it('no MFA source still narrates the email OTP path it lost (review 2026-09-16)', () => {
        const mfa = read(path.join(BACKEND, 'routes', 'api', 'identity', 'mfa.js'));
        expect(mfa).not.toMatch(/STORE_UNAVAILABLE|now 503s|Test helper/);
        const identity = read(path.join(BACKEND, 'services', 'identity-service.js'));
        expect(identity).not.toMatch(/emailed-OTP|hasEmail|refuse a legacy row/);
    });

    it('the error catalog documents only MFA failures that can still happen, at the line that raises them', () => {
        const { ERROR_CODES } = require('../../shared/error-codes');
        for (const gone of ['OTP_EXPIRED', 'OTP_TOO_MANY', 'MFA_STORE_UNAVAILABLE']) {
            expect(ERROR_CODES[gone]).toBeUndefined();
        }
        for (const code of ['MFA_METHOD_MISMATCH', 'MFA_METHOD_RETIRED']) {
            const [file, line] = ERROR_CODES[code].source.split(':');
            const at = read(path.join(BACKEND, ...file.split('/'))).split('\n')[Number(line) - 1];
            expect(at).toContain(code);
        }
    });

    it('the web app offers no email 2FA anywhere', () => {
        expect(read(path.join(WEB, 'lib', 'services', 'provider-api.ts'))).not.toMatch(/mfa\/email/);
        const farmerSecurity = read(path.join(WEB, 'app', 'health', 'profile', 'security', 'page.tsx'));
        expect(farmerSecurity).not.toMatch(/mfa\/email|emailSetup|emailVerifySetup/);
    });
});
