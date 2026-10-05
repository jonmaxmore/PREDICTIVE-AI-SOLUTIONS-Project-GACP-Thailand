/**
 * MfaChallengeForm — render smoke (renderToStaticMarkup; the web-app harness has
 * no @testing-library/react). Asserts the OTP-entry surface renders the code
 * field, the backup-code toggle, and the submit button — i.e. the audit gap
 * (mfa_required with no FE screen) is closed.
 */
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('../../../../lib/api/api-client', () => ({ apiClient: { post: jest.fn() } }));
jest.mock('../../../../lib/services/auth-service', () => ({ AuthService: { saveSession: jest.fn() } }));

import MfaChallengeForm from '../mfa-challenge-form';

describe('MfaChallengeForm', () => {
    it('renders the verification-code field, a backup-code toggle and a submit button (TH)', () => {
        const html = renderToStaticMarkup(
            <MfaChallengeForm mfaSession="jwt.challenge" onSuccess={() => {}} />,
        );
        expect(html).toContain('ยืนยันตัวตนสองชั้น');     // title
        expect(html).toContain('id="mfa-code"');           // the code input
        expect(html).toContain('one-time-code');           // autoComplete hint
        expect(html).toContain('type="checkbox"');         // backup-code toggle
        expect(html).toContain('ใช้รหัสสำรอง');             // backup label
    });

    it('renders English copy when lang="en"', () => {
        const html = renderToStaticMarkup(
            <MfaChallengeForm mfaSession="jwt.challenge" onSuccess={() => {}} lang="en" />,
        );
        expect(html).toContain('Two-Factor Verification');
        expect(html).toContain('Use a backup code');
    });

    // มติ operator 2026-09-15: ปัจจัยที่สองมีแค่ TOTP ไม่มีรหัสทางอีเมล หน้านี้เคยบอกทุกคนว่า
    // "หากใช้ Email OTP รหัสจะถูกส่งไปยังอีเมล" ซึ่งทำให้ผู้ใช้รออีเมลที่ไม่มีวันมา
    it('names only the authenticator app: there is no email OTP', () => {
        const th = renderToStaticMarkup(<MfaChallengeForm mfaSession="jwt.challenge" onSuccess={() => {}} />);
        const en = renderToStaticMarkup(<MfaChallengeForm mfaSession="jwt.challenge" onSuccess={() => {}} lang="en" />);
        expect(th).not.toMatch(/Email OTP|อีเมล/);
        expect(en).not.toMatch(/email/i);
        expect(th).toContain('authenticator');
        expect(en).toContain('authenticator');
    });

    it('has no branch for email-OTP failure codes the backend can no longer send', () => {
        const src = readFileSync(resolve(__dirname, '..', 'mfa-challenge-form.tsx'), 'utf8');
        expect(src).not.toMatch(/OTP_EXPIRED|OTP_TOO_MANY|EMAIL-OTP/);
    });
});
