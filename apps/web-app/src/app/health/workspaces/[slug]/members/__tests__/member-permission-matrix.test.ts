/**
 * member-permission-matrix.test.ts — Farm-worker Wave C chunk 2:
 * OWNER-facing per-member permission matrix on the workspace members page.
 *
 * Two layers, repo convention (pure-config assertions + fs source-scan pin —
 * same pattern as provider/management/users/[id]/permissions/__tests__/
 * permission-matrix.test.ts; NO @testing-library/react in deps and the
 * matrix fetches in a useEffect, invisible to renderToStaticMarkup):
 *
 *   1. PURE logic (member-permission-matrix-logic.ts): the 5-group Thai
 *      taxonomy over the 15 farm-operation codes, cellStateFor precedence
 *      (REVOKE wins), CELL_OPTIONS trio, optional-reason validation
 *      (5-500 when provided), inherit/effective display helpers.
 *   2. fs pins: the matrix component wires GET/PUT/DELETE to the Wave-B
 *      admin endpoints via apiClient, renders the grouped 3-state control,
 *      follows the HEALTH friendly ui_kit (emerald, not Fiori tokens), and
 *      the page gates the expander to OWNER + non-OWNER-target + ACTIVE.
 */

import fs from 'fs';
import path from 'path';
import {
    CELL_OPTIONS,
    MEMBER_PERMISSION_GROUPS,
    MIN_REASON_LENGTH,
    MAX_REASON_LENGTH,
    cellStateFor,
    effectiveChipFor,
    groupCatalog,
    inheritedHas,
    validateReason,
    type CatalogEntry,
} from '../member-permission-matrix-logic';

// The backend catalog (routes/api/entities/member-permissions.js
// buildCatalog) — all 15 grantable farm-operation codes with Thai labels.
const CATALOG: CatalogEntry[] = [
    { key: 'FARM_CREATE', label: 'สร้างฟาร์ม' },
    { key: 'EDIT_FARM', label: 'แก้ไขข้อมูลฟาร์ม' },
    { key: 'CYCLE_CREATE', label: 'สร้างรอบปลูก/จัดการแปลง' },
    { key: 'UNIT_MANAGE', label: 'ลงแปลงปลูก/จัดการต้นปลูก' },
    { key: 'ACTIVITY_IRRIGATION', label: 'บันทึกการรดน้ำ' },
    { key: 'ACTIVITY_FERTILIZER', label: 'บันทึกการใส่ปุ๋ย' },
    { key: 'ACTIVITY_PEST_CONTROL', label: 'บันทึกการกำจัดศัตรูพืช' },
    { key: 'ACTIVITY_WEED_CONTROL', label: 'บันทึกการกำจัดวัชพืช' },
    { key: 'ACTIVITY_INSPECTION', label: 'บันทึกการตรวจแปลง' },
    { key: 'ACTIVITY_INCIDENT', label: 'บันทึกเหตุการณ์ผิดปกติ' },
    { key: 'ACTIVITY_OTHER', label: 'บันทึกกิจกรรมอื่น ๆ' },
    { key: 'HARVEST_RECORD', label: 'บันทึกการเก็บเกี่ยว' },
    { key: 'QR_GENERATE', label: 'สร้าง QR แปลงปลูก' },
    { key: 'RECORDS_MANAGE', label: 'จัดการบันทึกฟาร์ม (วิเคราะห์พื้นที่/อบรม)' },
    { key: 'REPORT_SUBMIT', label: 'ส่งรายงาน' },
];

describe('member-permission-matrix-logic — grouping taxonomy', () => {
    const grouped = groupCatalog(CATALOG);
    const byId = new Map(grouped.map((g) => [g.id, g]));

    test('exposes the five farm-operation groups in display order', () => {
        expect(MEMBER_PERMISSION_GROUPS.map((g) => g.id)).toEqual([
            'farm', 'cycle', 'activity', 'harvest-qr', 'records',
        ]);
    });

    test('ฟาร์ม = FARM_CREATE + EDIT_FARM', () => {
        expect(byId.get('farm')!.entries.map((e) => e.key).sort()).toEqual(
            ['EDIT_FARM', 'FARM_CREATE'],
        );
        expect(byId.get('farm')!.titleTH).toContain('ฟาร์ม');
    });

    test('รอบปลูก-ต้นปลูก = CYCLE_CREATE + UNIT_MANAGE', () => {
        expect(byId.get('cycle')!.entries.map((e) => e.key).sort()).toEqual(
            ['CYCLE_CREATE', 'UNIT_MANAGE'],
        );
    });

    test('กิจกรรม bucket holds exactly the 7 ACTIVITY_* codes', () => {
        const keys = byId.get('activity')!.entries.map((e) => e.key);
        expect(keys).toHaveLength(7);
        expect(keys.every((k) => k.startsWith('ACTIVITY_'))).toBe(true);
        expect(byId.get('activity')!.titleTH).toContain('กิจกรรม');
    });

    test('เก็บเกี่ยว-QR = HARVEST_RECORD + QR_GENERATE; บันทึก-รายงาน = RECORDS_MANAGE + REPORT_SUBMIT', () => {
        expect(byId.get('harvest-qr')!.entries.map((e) => e.key).sort()).toEqual(
            ['HARVEST_RECORD', 'QR_GENERATE'],
        );
        expect(byId.get('records')!.entries.map((e) => e.key).sort()).toEqual(
            ['RECORDS_MANAGE', 'REPORT_SUBMIT'],
        );
    });

    test('each catalog key lands in exactly one group (no dupes, no drops)', () => {
        const flat = grouped.flatMap((g) => g.entries.map((e) => e.key));
        expect(flat.sort()).toEqual(CATALOG.map((e) => e.key).sort());
        expect(new Set(flat).size).toBe(flat.length);
    });

    test('an unknown future code falls into a trailing "อื่น ๆ" bucket instead of vanishing', () => {
        const withUnknown = groupCatalog([...CATALOG, { key: 'FUTURE_CODE', label: 'อนาคต' }]);
        const other = withUnknown.find((g) => g.id === 'other');
        expect(other).toBeTruthy();
        expect(other!.entries.map((e) => e.key)).toEqual(['FUTURE_CODE']);
    });
});

describe('member-permission-matrix-logic — 3-state control + display helpers', () => {
    test('CELL_OPTIONS is the inherit / grant / revoke trio in order, Thai-labelled', () => {
        expect(CELL_OPTIONS.map((o) => o.state)).toEqual(['inherit', 'GRANT', 'REVOKE']);
        expect(CELL_OPTIONS[0].labelTH).toContain('สืบทอด');
        expect(CELL_OPTIONS[1].labelTH).toContain('ให้สิทธิ์');
        expect(CELL_OPTIONS[2].labelTH).toContain('เพิกถอน');
    });

    test('cellStateFor: no grant → inherit; GRANT → GRANT; REVOKE wins over GRANT (engine precedence)', () => {
        expect(cellStateFor('HARVEST_RECORD', [])).toBe('inherit');
        expect(cellStateFor('HARVEST_RECORD', [{ permission: 'HARVEST_RECORD', effect: 'GRANT' }])).toBe('GRANT');
        expect(cellStateFor('HARVEST_RECORD', [
            { permission: 'HARVEST_RECORD', effect: 'GRANT' },
            { permission: 'HARVEST_RECORD', effect: 'REVOKE' },
        ])).toBe('REVOKE');
        // other permissions' grants don't bleed in
        expect(cellStateFor('HARVEST_RECORD', [{ permission: 'QR_GENERATE', effect: 'REVOKE' }])).toBe('inherit');
    });

    test('inheritedHas = role defaults ∪ legacy permissions[]', () => {
        expect(inheritedHas('HARVEST_RECORD', ['HARVEST_RECORD'], [])).toBe(true);
        expect(inheritedHas('EDIT_FARM', ['HARVEST_RECORD'], ['EDIT_FARM'])).toBe(true);
        expect(inheritedHas('EDIT_FARM', [], [])).toBe(false);
    });

    test('effectiveChipFor reflects the NET effective set from the API payload', () => {
        expect(effectiveChipFor('HARVEST_RECORD', ['HARVEST_RECORD'])).toEqual(
            { has: true, labelTH: 'มีสิทธิ์' },
        );
        expect(effectiveChipFor('HARVEST_RECORD', [])).toEqual(
            { has: false, labelTH: 'ไม่มีสิทธิ์' },
        );
    });

    test('validateReason: OPTIONAL — empty ok; 5-500 enforced when provided (BE contract)', () => {
        expect(MIN_REASON_LENGTH).toBe(5);
        expect(MAX_REASON_LENGTH).toBe(500);
        expect(validateReason('').ok).toBe(true);
        expect(validateReason('   ').ok).toBe(true); // trims to empty = omitted
        expect(validateReason('สั้น').ok).toBe(false); // 4 chars < 5
        expect(validateReason('ทดลองงานผ่านแล้ว').ok).toBe(true);
        expect(validateReason('ก'.repeat(501)).ok).toBe(false);
        expect(validateReason('ก'.repeat(500)).ok).toBe(true);
    });
});

describe('member-permission-matrix component — wiring pin (fs source-scan)', () => {
    const componentSrc = fs.readFileSync(
        path.resolve(__dirname, '..', 'member-permission-matrix.tsx'), 'utf8',
    );

    test('fetches the OWNER admin view and writes via PUT / DELETE (fresh-payload optimistic update)', () => {
        // GET …/members/:userId/permissions
        expect(componentSrc).toMatch(/apiClient\.get</);
        // PUT body { permission, effect, reason? } — targets the collection path
        expect(componentSrc).toMatch(/apiClient\.put</);
        // DELETE …/permissions/:permission (revert to inherit)
        expect(componentSrc).toMatch(/apiClient\.delete</);
        expect(componentSrc).toMatch(/\/permissions/);
        // writes return the fresh GET payload → re-render from response
        expect(componentSrc).toMatch(/setPayload\(res\.data\)/);
        expect(componentSrc).not.toMatch(/NEXT_PUBLIC_API_URL/);
    });

    test('renders the grouped catalog + 3-state segmented control from the logic module', () => {
        expect(componentSrc).toMatch(/groupCatalog\(/);
        expect(componentSrc).toMatch(/CELL_OPTIONS\.map/);
        expect(componentSrc).toMatch(/aria-pressed=/);
        expect(componentSrc).toMatch(/cellStateFor\(/);
        expect(componentSrc).toMatch(/effectiveChipFor\(/);
    });

    test('optional reason input enforces 5-500 only when provided', () => {
        expect(componentSrc).toMatch(/validateReason\(/);
    });

    // Wave-C adversarial-verify SHOULD F3 — the copy used to claim REVOKE
    // "ชนะเสมอ...มีผลทันที" unconditionally, but the engine's LEGACY_OWNER
    // fast-path (entity-effective-permissions-service.js rule (a)/M1) lets
    // an ACTIVE member keep FULL authority on workspace farms THEY created
    // (farm.ownerId = the worker): per-permission REVOKE does not bind
    // there — only membership-revoke does. The matrix copy must DISCLOSE
    // that divergence instead of overstating enforcement.
    test('F3 — the enforcement copy discloses the creator-owned-farm exception', () => {
        expect(componentSrc).toContain('มีผลกับคำขอถัดไปทันที');
        expect(componentSrc).toContain(
            'ยกเว้นฟาร์มที่สมาชิกคนนั้นเป็นผู้สร้างเอง ระบบยังให้สิทธิ์ผู้สร้างจนกว่าจะถอนสมาชิกออกจากนิติบุคคลหรือวิสาหกิจชุมชน',
        );
    });

    test('follows the HEALTH friendly ui_kit — leaf tones + rounded cards, NOT the provider Fiori shell', () => {
        // W3 emerald→leaf remap: the friendly green is the tokenized leaf ramp now.
        expect(componentSrc).toMatch(/leaf/);
        expect(componentSrc).not.toMatch(/emerald/);
        expect(componentSrc).toMatch(/rounded-(lg|xl|2xl)/);
        expect(componentSrc).not.toMatch(/ProviderLayout/);
        // in-shell width standard — no page-level caps
        expect(componentSrc).not.toMatch(/max-w-7xl/);
        expect(componentSrc).not.toMatch(/max-w-6xl/);
        // no raw hex colors
        expect(componentSrc).not.toMatch(/#[0-9a-fA-F]{6}/);
    });
});

describe('members page — expander gating pin (fs source-scan)', () => {
    const pageSrc = fs.readFileSync(path.resolve(__dirname, '..', 'page.tsx'), 'utf8');

    test('renders the matrix expander OWNER-only, never on the OWNER row (self-guard mirrors BE), ACTIVE targets only', () => {
        expect(pageSrc).toMatch(/MemberPermissionMatrix/);
        expect(pageSrc).toMatch(/จัดการสิทธิ์/);
        // gating predicate: requester role OWNER + target not OWNER + target ACTIVE
        expect(pageSrc).toMatch(/canManagePermissions/);
        expect(pageSrc).toMatch(/entity\?\.role === 'OWNER'|entity\.role === 'OWNER'/);
    });
});
