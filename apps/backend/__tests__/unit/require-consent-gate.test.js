'use strict';

/**
 * AUTH-09 — requireConsent runtime gate (now wired onto POST /applications/submit).
 * PDPA ม.16: consent must precede personal-data processing. The gate is
 * fail-open by design (a consent-check outage must not lock users out — the
 * PDPA obligation is met by registration-time capture), bypasses provider
 * roles + the consent/auth/public/pdpa flows, and 403s a HEALTH user who lacks
 * the required consents.
 */

jest.mock('../../shared/logger', () => {
  const l = { info: jest.fn(), warn: jest.fn(), error: jest.fn(), debug: jest.fn() };
  return { ...l, createLogger: () => l };
});

const { requireConsent, consentManager } = require('../../middleware/consent-manager');

function makeCtx({ user = { id: 'u1', role: 'HEALTH' }, path = '/api/v1/applications/submit' } = {}) {
  const req = { user, path };
  const res = {
    statusCode: null,
    body: null,
    status(c) { this.statusCode = c; return this; },
    json(b) { this.body = b; return this; },
  };
  const next = jest.fn();
  return { req, res, next };
}

describe('AUTH-09 — requireConsent gate', () => {
  afterEach(() => {
    if (consentManager.hasRequiredConsents.mockRestore) { consentManager.hasRequiredConsents.mockRestore(); }
  });

  it('HEALTH user WITHOUT required consents → 403 CONSENT_REQUIRED, does not call next', async () => {
    jest.spyOn(consentManager, 'hasRequiredConsents').mockResolvedValue(false);
    const { req, res, next } = makeCtx();
    await requireConsent(req, res, next);
    expect(res.statusCode).toBe(403);
    expect(res.body).toMatchObject({ code: 'CONSENT_REQUIRED' });
    expect(next).not.toHaveBeenCalled();
  });

  it('HEALTH user WITH consents → next()', async () => {
    jest.spyOn(consentManager, 'hasRequiredConsents').mockResolvedValue(true);
    const { req, res, next } = makeCtx();
    await requireConsent(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBeNull();
  });

  it('provider role bypasses the gate (no consent check)', async () => {
    const spy = jest.spyOn(consentManager, 'hasRequiredConsents');
    const { req, res, next } = makeCtx({ user: { id: 'p1', role: 'field_inspector' } });
    await requireConsent(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled();
  });

  it('unauthenticated request passes through (auth middleware handles it)', async () => {
    const { req, res, next } = makeCtx({ user: null });
    await requireConsent(req, res, next);
    expect(next).toHaveBeenCalled();
  });

  it('AUTH-09-02: the consent flow path is bypassed (correct /api/v1/consent prefix)', async () => {
    const spy = jest.spyOn(consentManager, 'hasRequiredConsents');
    const { req, res, next } = makeCtx({ user: { id: 'u1', role: 'HEALTH' }, path: '/api/v1/consent/grant' });
    await requireConsent(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(spy).not.toHaveBeenCalled(); // bypassed before the consent check
  });

  it('fail-open: a consent-check error does NOT block (next called, no 403)', async () => {
    jest.spyOn(consentManager, 'hasRequiredConsents').mockRejectedValue(new Error('db down'));
    const { req, res, next } = makeCtx();
    await requireConsent(req, res, next);
    expect(next).toHaveBeenCalled();
    expect(res.statusCode).toBeNull();
  });
});
