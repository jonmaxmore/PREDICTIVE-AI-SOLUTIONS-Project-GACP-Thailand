/**
 * /health/profile/privacy — the delete-account warning promises no recovery.
 *
 * Operator 2026-09-17: "เราไม่มีการกู้บัญชี". The warning said "after the first
 * 30 days you can no longer recover the account", which reads as "within 30
 * days you can". No route restores a deleted account (pdpa-service.softDeleteUser
 * only sets isDeleted, and a deleted account cannot sign in), so the sentence
 * promised something the system does not do.
 * renderToStaticMarkup, like the security page next door.
 */
import { renderToStaticMarkup } from 'react-dom/server';

jest.mock('next/navigation', () => ({ useRouter: () => ({ push: jest.fn(), replace: jest.fn() }) }));
jest.mock('@/lib/api/api-client', () => ({ apiClient: { getBlob: jest.fn(), delete: jest.fn() } }));
jest.mock('@/lib/services/auth-service', () => ({ AuthService: {} }));

import HealthPrivacyPage from '../page';

describe('HealthPrivacyPage — delete warning', () => {
  it('says a deleted account cannot be recovered, with no grace-period promise', () => {
    const html = renderToStaticMarkup(<HealthPrivacyPage />);
    // positive control: this is the delete section
    expect(html).toContain('ก่อนตัดสินใจลบบัญชี');
    expect(html).not.toContain('30 วันแรก');
    expect(html).not.toContain('จะไม่สามารถกู้คืนบัญชีได้อีก');
    expect(html).toContain('ระบบไม่มีการกู้บัญชี');
  });
});
