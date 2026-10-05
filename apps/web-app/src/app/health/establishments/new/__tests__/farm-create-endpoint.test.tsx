/**
 * Farm-worker Wave A, Chunk 1 (2026-07-02) — the farm-create form used to POST
 * `/establishments`, which has NO backend mount (dead endpoint; every submit
 * 404'd). The real endpoint is POST /farms (apps/backend/routes/api/cultivation/
 * farms.js:146), which requires farmName/address/province/district/subDistrict
 * and consumes the farm-service.createFarm field names. These tests pin:
 *   1. the client-view posts to /farms via the shared payload builder, and
 *   2. the payload mapping matches the backend contract exactly.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { buildFarmCreatePayload } from '../farm-create-payload';

describe('[wave-a-chunk-1] /health/establishments/new posts the real endpoint', () => {
  const src = readFileSync(resolve(__dirname, '../client-view.tsx'), 'utf8');

  it('no longer posts the dead /establishments endpoint', () => {
    expect(src).not.toMatch(/apiClient\.post[^\n]*['"]\/establishments['"]/);
  });

  it('posts /farms with the shared payload builder', () => {
    expect(src).toMatch(/apiClient\.post[^\n]*\(\s*['"]\/farms['"]/);
    expect(src).toMatch(/buildFarmCreatePayload/);
  });

  it('collects the backend-required address fields', () => {
    // POST /farms 400s without province/district/subDistrict (farms.js:150)
    expect(src).toMatch(/province/);
    expect(src).toMatch(/district/);
    expect(src).toMatch(/subDistrict/);
  });
});

describe('[wave-a-fix-M4] farm-create surfaces API failure envelopes (no blind navigate)', () => {
  // apiClient NEVER throws on an API failure — it resolves
  // { success:false, error } (api-client.ts:384-399), so a bare
  // try/await/router.push navigates away on EVERY failure and the
  // catch block is unreachable for API errors. The submit handler must
  // gate navigation on res.success and surface res.error in the banner.
  const src = readFileSync(resolve(__dirname, '../client-view.tsx'), 'utf8');

  it('captures the response envelope and gates on res.success', () => {
    expect(src).toMatch(/const\s+res\s*=\s*await\s+apiClient\.post/);
    expect(src).toMatch(/if\s*\(\s*!res\.success\s*\)/);
  });

  it('surfaces the envelope error in the existing error banner state', () => {
    expect(src).toMatch(/setError\(\s*res\.error/);
  });

  it('navigates only AFTER the success gate (failure path returns first)', () => {
    const gateIdx = src.indexOf('!res.success');
    const navIdx = src.indexOf("router.push('/health/establishments')");
    expect(gateIdx).toBeGreaterThan(-1);
    expect(navIdx).toBeGreaterThan(gateIdx);
  });
});

describe('[wave-a-chunk-1] buildFarmCreatePayload maps form -> POST /farms contract', () => {
  const baseForm = {
    name: '  สวนสมุนไพรมีสุข แปลง A ',
    address: ' 42 หมู่ 3 ',
    province: ' เชียงใหม่ ',
    district: ' แม่ริม ',
    subDistrict: ' ริมใต้ ',
    type: 'GREENHOUSE',
    areaSize: '2.5',
    licenseNumber: ' LIC-777 ',
  };

  it('maps to the exact farm-service.createFarm field names', () => {
    const payload = buildFarmCreatePayload(baseForm);
    expect(payload).toMatchObject({
      farmName: 'สวนสมุนไพรมีสุข แปลง A',
      farmType: 'CULTIVATION',
      address: '42 หมู่ 3',
      province: 'เชียงใหม่',
      district: 'แม่ริม',
      subDistrict: 'ริมใต้',
      cultivationMethod: 'GREENHOUSE',
      totalArea: 2.5,
      cultivationArea: 2.5,
      areaUnit: 'sqm',
    });
    // No stray legacy keys the backend does not read
    expect(payload).not.toHaveProperty('name');
    expect(payload).not.toHaveProperty('type');
    expect(payload).not.toHaveProperty('areaSize');
    expect(payload).not.toHaveProperty('licenseNumber');
  });

  it('persists licenseNumber inside landDocuments (Farm has no licenseNumber column)', () => {
    const payload = buildFarmCreatePayload(baseForm);
    expect(payload.landDocuments).toEqual({ licenseNumber: 'LIC-777' });
  });

  it('omits landDocuments when licenseNumber is blank', () => {
    const payload = buildFarmCreatePayload({ ...baseForm, licenseNumber: '   ' });
    expect(payload).not.toHaveProperty('landDocuments');
  });

  it('is null-safe on unparseable area input (backend defaults, never NaN)', () => {
    const payload = buildFarmCreatePayload({ ...baseForm, areaSize: 'ยังไม่ทราบ' });
    expect(payload.totalArea).toBe(0);
    expect(payload.cultivationArea).toBe(0);
  });
});
