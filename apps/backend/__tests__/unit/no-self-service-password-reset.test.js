'use strict';

/**
 * ไม่มีระบบลืมรหัสผ่าน ไม่ว่าจะส่งทางอีเมลหรือ SMS — และไม่มีช่องทางส่งอีเมล/SMS ค้างอยู่ในระบบ
 *
 * มติ operator 2026-09-16: "เราไม่มีระบบ forgot ไม่ว่าจะไปอีเมลหรือ sms ทำการเก็บกวาด และ clean ให้สะอาด"
 * (ต่อจากมติ 2026-09-15: เข้าสู่ระบบด้วย หมอพร้อม / ThaID เท่านั้น ไม่มีอีเมลในระบบ)
 *
 * ก่อนหน้านี้หน้า /forgot-password บนเว็บเสนอ "ส่งลิงก์ทาง SMS หรืออีเมล" ซึ่งไม่เคยส่งอะไรถึงใคร
 * (ส่ง body ผิด schema จึงตอบ 400 ทุกครั้ง), แอปมือถือมีปุ่ม "ลืมรหัสผ่าน?" ที่ขึ้นว่ากำลังพัฒนา,
 * backend ยังมี endpoint ขอรีเซ็ต, สัญญา OpenAPI ยังบอกว่า "Sends password reset email" และ
 * config ยังสอนให้ตั้ง SMTP / SMS relay
 *
 * มติ operator 2026-09-17: "เราไม่มีการกู้บัญชี" — ทางที่เคยเหลือไว้โดยตั้งใจ (เจ้าหน้าที่ออก token รีเซ็ตที่
 * POST /provider/directory/:id/force-password-reset แล้วใช้ที่ POST /auth/health/reset-password/:token)
 * ถูกถอดทั้งสองปลาย ไฟล์นี้จึงกันการรีเซ็ตทุกรูปแบบ ไม่ใช่แค่แบบที่ผู้ใช้ขอเอง
 * คอลัมน์ passwordResetToken / passwordResetExpiry ยังอยู่ใน schema (การถอดคอลัมน์เป็น migration แยก)
 * โค้ดทำได้แค่ล้างค่าเป็น null หรือกรองออกจากคำตอบ
 */

const fs = require('fs');
const path = require('path');

const BACKEND = path.join(__dirname, '..', '..');
const REPO = path.join(BACKEND, '..', '..');
const WEB = path.join(REPO, 'apps', 'web-app');
const MOBILE = path.join(REPO, 'apps', 'mobile-app');
const read = (p) => fs.readFileSync(p, 'utf-8');
const stripComments = (src) => src
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/[^\n]*/g, '$1');
// Whole-line comments dropped, nothing else touched. stripComments above can
// swallow real code: a line comment such as `// every /auth/idp/:provider/* path`
// opens a "block comment" that runs to the next `*/` (server.js hid its reset
// limiter mount that way). The sweeps below look for declarations, which sit on
// code lines, so dropping comment lines is enough and cannot hide code.
const codeLines = (src) => src
    .split('\n')
    .filter((line) => !/^\s*(?:\/\/|\/\*|\*)/.test(line))
    .join('\n');

function filesUnder(dir, exts, skip = new Set(['node_modules', '.next', 'coverage', 'dist', 'build', '.dart_tool'])) {
    const out = [];
    if (!fs.existsSync(dir)) { return out; }
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        if (skip.has(entry.name)) { continue; }
        const p = path.join(dir, entry.name);
        if (entry.isDirectory()) { out.push(...filesUnder(p, exts, skip)); } else if (exts.some((e) => entry.name.endsWith(e))) { out.push(p); }
    }
    return out;
}

describe('no password reset of any kind: not by email or SMS, not through staff (operator 2026-09-16 / 2026-09-17)', () => {
    it('the backend mounts no reset route, neither the request nor the token redemption', () => {
        const routes = stripComments(read(path.join(BACKEND, 'routes', 'api', 'auth', 'auth-health.js')));
        expect(routes).not.toMatch(/['"`]\/reset-password/);
        expect(routes).not.toMatch(/requestPasswordReset|resetPasswordSchema\b|resetPasswordWithToken/);
    });

    // Swept, not listed: a reset door re-added in a router nobody thought of works
    // just like the two that were removed. MFA resets stay legal: they are staff
    // administration of a second factor, not a way back into an account.
    it('no router or server mount names a password-reset or recovery path', () => {
        const RECOVERY_MOUNT = /\.(?:get|post|put|patch|delete|all|use|route)\(\s*[`'"][^`'"]*(?:reset[^`'"]*password|password[^`'"]*reset|recover|forgot)/i;
        const files = filesUnder(path.join(BACKEND, 'routes'), ['.js'])
            .concat(filesUnder(path.join(BACKEND, 'modules'), ['.js']))
            .concat([path.join(BACKEND, 'server.js')]);
        const offenders = files
            .filter((f) => RECOVERY_MOUNT.test(codeLines(read(f))))
            .map((f) => path.relative(REPO, f));
        expect(offenders).toEqual([]);
    });

    it('no controller, service or schema can start or complete a reset any more', () => {
        // comments may record the removal; code may not carry it
        const code = (...segments) => stripComments(read(path.join(BACKEND, ...segments)));
        expect(code('controllers', 'auth-controller', 'auth-session-security-handlers.js')).not.toMatch(/requestPasswordReset/);
        expect(code('services', 'prisma-auth-service.js')).not.toMatch(/requestPasswordReset|resetPasswordWithToken/);
        expect(code('services', 'auth', 'password-management.js')).not.toMatch(/requestPasswordReset|resetPasswordWithToken/);

        const authSchemas = require('../../shared/schemas/auth-schemas');
        expect(authSchemas.resetPasswordSchema).toBeUndefined();
        expect(authSchemas.resetPasswordWithTokenSchema).toBeUndefined();
        const zodSchemas = require('../../shared/zod-schemas');
        expect(zodSchemas.passwordResetRequestSchema).toBeUndefined();
        expect(zodSchemas.passwordResetSchema).toBeUndefined();
    });

    // The columns stay until a separate contraction migration drops them. Until
    // then code may only clear them (PDPA erasure) or keep them out of a response;
    // anything that writes a token or looks a user up by one is a reset door.
    it('no backend code mints or looks up a password-reset token', () => {
        const ALLOWED = [
            /^passwordReset(?:Token|Expiry):\s*null\b/, // cleared
            /^passwordResetToken:\s*_\w*/,               // destructured away from a response
            /^passwordResetToken['"]/,                   // named in a response strip-list
        ];
        const skip = new Set(['node_modules', '__tests__', 'migrations', 'coverage', 'tests', 'test-support']);
        const offenders = [];
        for (const f of filesUnder(BACKEND, ['.js', '.cjs', '.mjs', '.ts'], skip)) {
            for (const m of codeLines(read(f)).matchAll(/passwordReset(?:Token|Expiry)\b.{0,40}/g)) {
                if (!ALLOWED.some((re) => re.test(m[0]))) {
                    offenders.push(`${path.relative(REPO, f)}: ${m[0].trim()}`);
                }
            }
        }
        expect(offenders).toEqual([]);
    });

    it('no error-code remediation sends anyone to a forgot-password endpoint or a reset token', () => {
        const { ERROR_CODES } = require('../../shared/error-codes');
        const pointing = Object.entries(ERROR_CODES)
            .filter(([, v]) => /forgot|request-password-reset|reset token/i.test(`${v.remediation} ${v.messageEn} ${v.messageTh}`))
            .map(([k]) => k);
        expect(pointing).toEqual([]);
    });

    // Both sweeps check the file PATH as well as the code: a page re-added as
    // `(auth)/reset-request/page.tsx` contains none of the old words, so a
    // contents-only scan would never see it. Comments are stripped first, so the
    // record of WHY the flow is gone can stay in the files it was removed from.
    const RESET_SURFACE_PATH = /forgot|password-reset|reset-password|password.recovery/i;
    const RESET_SURFACE_CODE = /forgot-password|FORGOT_PASSWORD|forgotPassword|ลืมรหัสผ่าน|reset-password|force-password-reset|resetToken/;

    it('the web app has no forgot-password or reset page, route, link, call, sitemap entry or copy', () => {
        expect(fs.existsSync(path.join(WEB, 'src', 'app', '(auth)', 'forgot-password'))).toBe(false);
        // __tests__ is skipped: the web app's own guard test has to name what it forbids.
        const skip = new Set(['node_modules', '.next', 'coverage', 'dist', 'build', '__tests__']);
        const files = filesUnder(path.join(WEB, 'src'), ['.ts', '.tsx', '.css', '.js', '.jsx', '.mdx'], skip)
            .concat(filesUnder(path.join(WEB, 'e2e'), ['.ts'], skip));
        const offenders = files
            .filter((f) => RESET_SURFACE_PATH.test(path.relative(WEB, f)) || RESET_SURFACE_CODE.test(stripComments(read(f))))
            .map((f) => path.relative(REPO, f));
        expect(offenders).toEqual([]);
    });

    it('the mobile app has no forgot-password screen, route or button', () => {
        expect(fs.existsSync(path.join(MOBILE, 'lib', 'presentation', 'features', 'auth', 'screens', 'forgot_password_screen.dart'))).toBe(false);
        const files = filesUnder(path.join(MOBILE, 'lib'), ['.dart', '.md']);
        const offenders = files
            .filter((f) => /forgot|password_recovery/i.test(path.relative(MOBILE, f))
                || /forgot-password|ForgotPassword|ลืมรหัสผ่าน|requestPasswordReset|request-password-reset/.test(stripComments(read(f))))
            .map((f) => path.relative(REPO, f));
        expect(offenders).toEqual([]);
    });

    it('the API contract documents no reset path and no email verification', () => {
        const spec = read(path.join(REPO, 'openapi', 'auth-health.yaml'));
        expect(spec).not.toMatch(/request-password-reset|verify-email|password reset email/i);
        // 2026-09-17: the staff-issued token redemption is gone as well
        expect(spec).not.toMatch(/reset-password|force-password-reset|operationId:\s*resetPassword\b/);
    });
});

describe('no email or SMS transport is configured outside the ops alerting stack (operator 2026-09-15 / 2026-09-16)', () => {
    it('nodemailer is not a dependency', () => {
        const pkg = JSON.parse(read(path.join(BACKEND, 'package.json')));
        const all = { ...pkg.dependencies, ...pkg.devDependencies, ...pkg.optionalDependencies };
        expect(all.nodemailer).toBeUndefined();
    });

    it('the secrets catalog has no SMTP, email or SMS row', () => {
        const { SECRETS_CATALOG } = require('../../config/secrets');
        expect(Object.keys(SECRETS_CATALOG).filter((k) => /^(SMTP_|EMAIL_|SMS_|THAIBULKSMS_)/.test(k))).toEqual([]);
    });

    // Swept, not listed: an allowlist of paths cannot see a relay added to a file
    // nobody thought of. Prose is NOT banned — only a variable ASSIGNMENT — so a
    // comment explaining that no mail is sent stays legal.
    //
    // monitoring/ is the one deliberate exception: Alertmanager and Grafana mail
    // the operator, which is a different system from the platform's (removed)
    // citizen mail. Both files carry that note at the top.
    it('no env template, generator or compose file configures a mail or SMS relay', () => {
        const SWEPT_DIRS = ['scripts', 'deploy', 'infra', 'nginx', 'apps'];
        const ASSIGNMENT = /^\s*(?:#|-)?\s*(?:GF_)?(SMTP_[A-Z_]+|EMAIL_(?:ENABLED|PROVIDER|HOST|USER|PASSWORD|FROM[A-Z_]*)|MAIL_[A-Z_]+|SMS_[A-Z_]+|THAIBULKSMS_[A-Z_]+|SENDGRID_[A-Z_]+|TWILIO_[A-Z_]+)\s*[:=]/m;
        const EXEMPT = /^monitoring\//;

        // Only committed templates and compose files: a developer's own .env /
        // .env.local is gitignored, is not documentation, and is none of this
        // test's business.
        const configs = fs.readdirSync(REPO, { withFileTypes: true })
            .filter((e) => e.isFile() && (/^\.env\..*example$/.test(e.name) || /^docker-compose.*\.ya?ml$/.test(e.name)))
            .map((e) => path.join(REPO, e.name));
        for (const dir of SWEPT_DIRS) {
            configs.push(...filesUnder(path.join(REPO, dir), ['.example', '.ps1', '.yml', '.yaml', '.tf'],
                new Set(['node_modules', '.next', 'coverage', 'dist', 'build', '.dart_tool', '__tests__', 'evidence'])));
        }
        configs.push(...filesUnder(path.join(REPO, 'scripts', 'security'), ['.js']));

        const offenders = configs
            .filter((p) => !EXEMPT.test(path.relative(REPO, p)))
            .filter((p) => ASSIGNMENT.test(read(p)))
            .map((p) => path.relative(REPO, p))
            .sort();
        expect(offenders).toEqual([]);
    });

    it('the email template engine that rendered for the deleted email service is gone', () => {
        expect(fs.existsSync(path.join(BACKEND, 'services', 'email-template-engine.js'))).toBe(false);
        expect(read(path.join(BACKEND, 'scripts', 'e2e-validate.js'))).not.toMatch(/email-template-engine/);
    });

    it('no error code documents the deleted email/SMS notification providers', () => {
        const { ERROR_CODES } = require('../../shared/error-codes');
        const stale = Object.entries(ERROR_CODES)
            .filter(([, v]) => /services\/notification\/(providers|transports)\//.test(v.source || ''))
            .map(([k]) => k);
        expect(stale).toEqual([]);
    });
});
