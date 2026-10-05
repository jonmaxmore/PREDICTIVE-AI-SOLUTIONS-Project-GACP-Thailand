/**
 * Wave B fix S11 (2026-07-03) — the cycle-detail loader auto-fires
 * plot-qrs/generate on load when QR rows are missing. For a QR-denied
 * workspace member (VIEWER / REVOKE'd worker) the backend answers 403
 * ENTITY_PERMISSION_DENIED — the auto-fire must swallow that silently
 * (page still renders, no toast); every OTHER failure keeps the yellow
 * warning toast.
 *
 * Convention (this suite's style, e.g. farm-create-endpoint.test.tsx):
 * pure-predicate unit tests + source pins on the loader/service wiring.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { isWorkspacePermissionDenied } from '../plot-qr-permission';

describe('[wave-b-s11] isWorkspacePermissionDenied predicate', () => {
  it('true on HTTP 403 (the endpoint\'s only 403 is the permission gate)', () => {
    expect(isWorkspacePermissionDenied({ status: 403 })).toBe(true);
  });

  it('true on the machine code when the transport surfaces it', () => {
    expect(isWorkspacePermissionDenied({ code: 'ENTITY_PERMISSION_DENIED' })).toBe(true);
  });

  it('false on other failures (400/500/network) — those keep the toast', () => {
    expect(isWorkspacePermissionDenied({ status: 400 })).toBe(false);
    expect(isWorkspacePermissionDenied({ status: 500, code: 'INTERNAL' })).toBe(false);
    expect(isWorkspacePermissionDenied({})).toBe(false); // network error: no status
    expect(isWorkspacePermissionDenied(null)).toBe(false);
    expect(isWorkspacePermissionDenied(undefined)).toBe(false);
  });
});

describe('[wave-b-s11] loader wiring — silent swallow BEFORE the toast', () => {
  const loaderSrc = readFileSync(
    resolve(__dirname, '../use-planting-cycle-detail-data-loader.ts'),
    'utf8',
  );

  it('imports and gates the auto-generate toast on the predicate', () => {
    expect(loaderSrc).toMatch(/import\s*\{\s*isWorkspacePermissionDenied\s*\}\s*from\s*'\.\/plot-qr-permission'/);
    expect(loaderSrc).toMatch(/else if\s*\(\s*!isWorkspacePermissionDenied\(autoQrResult\)\s*\)/);
  });

  it('the toast stays inside the gated branch (denials render nothing)', () => {
    const gateIdx = loaderSrc.indexOf('!isWorkspacePermissionDenied(autoQrResult)');
    const toastIdx = loaderSrc.indexOf("title: 'สร้าง QR แปลงอัตโนมัติไม่สำเร็จ'");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(toastIdx).toBeGreaterThan(gateIdx);
  });
});

describe('[wave-b-s11] planting-service passes status + code through', () => {
  const serviceSrc = readFileSync(
    resolve(__dirname, '../../../../../lib/services/planting-service.ts'),
    'utf8',
  );

  it('generatePlotCycleQrs forwards result.status and result.code (were dropped)', () => {
    const fnStart = serviceSrc.indexOf('async generatePlotCycleQrs');
    const fnEnd = serviceSrc.indexOf('async listPlotCycleQrs');
    const fn = serviceSrc.slice(fnStart, fnEnd);
    expect(fn).toMatch(/status:\s*result\.status/);
    expect(fn).toMatch(/code:\s*result\.code/);
  });
});
