/**
 * FARMER_NAV secondary tools (B-NAV item 5, W10).
 *
 * Ruling 3 (reports/design-cleanup-2026-08-21/03-OPERATOR-DELEGATED-
 * RULINGS.md §3, table row 1): the 6 tools previously reachable ONLY via
 * /health/more (an unlisted hub page — no nav entry pointed at it) move
 * into FARMER_NAV's secondary tier ("เครื่องมือเพิ่มเติม" row on
 * /health/home), so they get a real door without /health/more itself
 * being touched (its retirement is W3-8, gated on this move landing
 * first per the ruling).
 *
 * A separate file from nav-config.test.ts on purpose — that file pins the
 * FARMER primary-tier label list and the legacy `healthNavigation` byte
 * inventory verbatim (05-BACKLOG.md's named traps); this file only adds
 * new assertions and never touches those pinned ones.
 */
import { describe, expect, it } from '@jest/globals';

import { FARMER_NAV } from '../nav-config';

const MOVED_TOOLS: Array<{ key: string; path: string; labelTH: string }> = [
  { key: 'site-analysis', path: '/health/site-analysis', labelTH: 'การวิเคราะห์พื้นที่' },
  { key: 'training', path: '/health/training', labelTH: 'บันทึกการอบรม' },
  { key: 'sop-templates', path: '/health/sop-templates', labelTH: 'แม่แบบ SOP' },
  { key: 'sop-builder', path: '/health/sop-builder', labelTH: 'สร้าง SOP' },
  { key: 'reports', path: '/health/reports', labelTH: 'รายงาน ภ.ท.27/28' },
  { key: 'documents', path: '/health/documents', labelTH: 'เอกสารแนบในระบบ' },
];

describe('FARMER_NAV — 6 tools moved out of /health/more (B-NAV item 5)', () => {
  it.each(MOVED_TOOLS)('$key is present with path $path, tier secondary, roles [health]', ({ key, path, labelTH }) => {
    const item = FARMER_NAV.find((i) => i.key === key);
    expect(item).toBeDefined();
    expect(item?.path).toBe(path);
    expect(item?.labelTH).toBe(labelTH);
    expect(item?.tier).toBe('secondary');
    expect(item?.roles).toEqual(['health']);
    // Not accidentally wired into the bottom nav (only home/status/payments/
    // certificates/planting are, per the N3 5-item bottom nav).
    expect(item?.bottomNav).toBeUndefined();
  });

  it('does not duplicate an existing path (no two FARMER_NAV items share a path)', () => {
    const paths = FARMER_NAV.map((i) => i.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it('the two /health/more items NOT in scope for this batch (planting, establishments — already covered by other tiles) are not added here', () => {
    // Ruling table row 2: "รอบการปลูก" and "ข้อมูลสถานประกอบการ" are
    // duplicates of the existing บันทึกการปลูก / (establishments) tiles and
    // disappear when /health/more retires (W3-8) — they do NOT get a
    // second FARMER_NAV entry in this batch.
    const keys = FARMER_NAV.map((i) => i.key);
    expect(keys.filter((k) => k === 'planting')).toHaveLength(1);
  });
});
