/**
 * client-view.tsx — retired "units" (per-plant) tab removal
 * (B-PLANTING item 2, backlog #82 / B2 / #81-adjacent, design doc R8).
 *
 * client-view.tsx composes ~10 hooks (router/params, entity permissions,
 * data loader, actions, derived state) that make a full render heavy and
 * require jsdom-level mocking of things unrelated to this change — the
 * repo's own convention for this exact situation (see
 * health/applications/renewal/__tests__/renewal-payment-pending.test.tsx,
 * "client-view exports + flag wiring (regression guard)") is a source-level
 * regression guard instead of a full render.
 *
 * Pins: the "ทะเบียนรายต้น" tab trigger and the "จะพร้อมใช้งานเร็ว ๆ นี้"
 * upgrade-CTA card (advertising a feature R8 permanently retired) are both
 * gone, and the still-live 5 tabs remain.
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';
import { TABS } from '../planting-cycle-detail-page-config';

describe('planting/[id]/client-view.tsx — retired units tab removed', () => {
  const file = readFileSync(resolve(__dirname, '../client-view.tsx'), 'utf8');

  it('no longer renders the "ทะเบียนรายต้น" (per-plant registry) tab trigger', () => {
    expect(file).not.toContain('ทะเบียนรายต้น');
  });

  it('no longer renders the retired-feature "coming soon" upgrade card', () => {
    expect(file).not.toContain('เร็ว ๆ นี้');
    expect(file).not.toContain('ยกระดับฟาร์ม');
  });

  it('no longer imports the per-plant units tab section component', () => {
    expect(file).not.toMatch(/PlantingCycleDetailTabsSectionAUnits/);
  });

  it('still renders the 5 live tabs (regression guard against over-deleting)', () => {
    for (const label of ['ภาพรวมรอบ', 'แปลงและ QR', 'กิจกรรมภาคสนาม', 'เก็บเกี่ยวและ Trace', 'บันทึกระบบ']) {
      expect(file).toContain(label);
    }
  });
});

describe('planting-cycle-detail-page-config.ts — TABS no longer offers "units"', () => {
  it('TABS does not include the retired "units" key (a stray ?tab=units URL must not select a dead tab)', () => {
    expect(TABS).not.toContain('units');
  });
});
