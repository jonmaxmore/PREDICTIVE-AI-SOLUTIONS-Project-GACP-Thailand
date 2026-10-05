/**
 * permission-matrix.test.ts — per-user permission matrix FE contract
 * (feat/backoffice-per-permission-grants).
 *
 * Two layers, following the repo convention (pure-config assertions +
 * fs source-scan pin — the same pattern as
 * app/admin/users/__tests__/console-contract-fields.test.ts). The repo does
 * NOT pull in @testing-library/react and the page island fetches its data in
 * a useEffect (invisible to renderToStaticMarkup / SSR), so we pin:
 *
 *   1. the PURE grouping/3-state config (groupCatalog taxonomy + CELL_OPTIONS
 *      + cellStateFor precedence) directly against the module, and
 *   2. that the client-view actually renders the catalog groups + the 3-state
 *      segmented control + calls the GET/PUT/DELETE endpoints via the /api
 *      proxy path helpers (so the wiring cannot silently rot).
 */

import fs from 'fs';
import path from 'path';
import {
    CELL_OPTIONS,
    PERMISSION_GROUPS,
    cellStateFor,
    groupCatalog,
    type CatalogEntry,
} from '../permission-matrix-config';

// The backend catalog (routes/api/admin/user-permissions.js buildCatalog) —
// a representative slice covering every group + the trailing "other" bucket.
const CATALOG: CatalogEntry[] = [
    { key: 'application.submit', label: 'ยื่นใบสมัคร' },
    { key: 'application.view.all', label: 'ดูใบสมัครทั้งหมด' },
    { key: 'invoice.view.all', label: 'ดูใบแจ้งหนี้ทั้งหมด' },
    { key: 'receipt.issue', label: 'ออกใบเสร็จ/ใบกำกับภาษี' },
    { key: 'bank_account.manage', label: 'จัดการบัญชีธนาคาร' },
    { key: 'accounting.dashboard.read', label: 'ดูแดชบอร์ดบัญชี' },
    { key: 'audit.submit', label: 'ส่งผลการตรวจสอบ' },
    { key: 'users.manage', label: 'จัดการผู้ใช้งาน' },
    { key: 'master_data.manage', label: 'จัดการข้อมูลหลัก' },
    { key: 'report.export', label: 'ส่งออกรายงาน' },
];

describe('permission-matrix-config — grouping taxonomy', () => {
    const grouped = groupCatalog(CATALOG);
    const byId = new Map(grouped.map((g) => [g.id, g]));

    test('exposes the five domain groups in display order', () => {
        expect(PERMISSION_GROUPS.map((g) => g.id)).toEqual([
            'application', 'finance', 'audit', 'system_admin_dtam', 'report',
        ]);
    });

    test('every finance key (invoice/receipt/bank_account/accounting) lands in "การเงิน"', () => {
        const finance = byId.get('finance');
        expect(finance).toBeTruthy();
        const keys = finance!.entries.map((e) => e.key);
        expect(keys).toEqual(expect.arrayContaining([
            'invoice.view.all', 'receipt.issue',
            'bank_account.manage', 'accounting.dashboard.read',
        ]));
        expect(finance!.titleTH).toContain('การเงิน');
    });

    test('users.manage + master_data.manage land in "ผู้ดูแลระบบ"', () => {
        const admin = byId.get('system_admin_dtam');
        expect(admin!.entries.map((e) => e.key).sort()).toEqual(['master_data.manage', 'users.manage']);
    });

    test('application.* → ใบสมัคร, audit.* → การตรวจสอบ, report.* → รายงาน', () => {
        expect(byId.get('application')!.entries.map((e) => e.key)).toEqual(
            expect.arrayContaining(['application.submit', 'application.view.all']),
        );
        expect(byId.get('audit')!.entries.map((e) => e.key)).toEqual(['audit.submit']);
        expect(byId.get('report')!.entries.map((e) => e.key)).toEqual(['report.export']);
    });

    test('each catalog key lands in exactly one group (no dupes, no drops)', () => {
        const flat = grouped.flatMap((g) => g.entries.map((e) => e.key));
        expect(flat.sort()).toEqual(CATALOG.map((e) => e.key).sort());
        expect(new Set(flat).size).toBe(flat.length);
    });
});

describe('permission-matrix-config — 3-state control', () => {
    test('CELL_OPTIONS is the inherit / grant / revoke trio in order', () => {
        expect(CELL_OPTIONS.map((o) => o.state)).toEqual(['inherit', 'GRANT', 'REVOKE']);
        expect(CELL_OPTIONS.map((o) => o.labelTH)).toEqual(['สืบทอด', '✓ ให้สิทธิ์', '✗ เพิกถอน']);
    });

    test('cellStateFor: no grant → inherit; GRANT → GRANT; REVOKE wins over GRANT', () => {
        expect(cellStateFor('report.export', [])).toBe('inherit');
        expect(cellStateFor('report.export', [{ permission: 'report.export', effect: 'GRANT' }])).toBe('GRANT');
        expect(cellStateFor('report.export', [
            { permission: 'report.export', effect: 'GRANT' },
            { permission: 'report.export', effect: 'REVOKE' },
        ])).toBe('REVOKE');
    });
});

describe('permission-matrix client-view — wiring pin (fs source-scan)', () => {
    const clientSrc = fs.readFileSync(path.resolve(__dirname, '..', 'client-view.tsx'), 'utf8');

    test('renders the grouped catalog + the 3-state segmented control', () => {
        // groups render
        expect(clientSrc).toMatch(/groupCatalog\(/);
        expect(clientSrc).toMatch(/data-testid="permission-matrix"/);
        // 3-state control iterates CELL_OPTIONS with aria-pressed segments
        expect(clientSrc).toMatch(/CELL_OPTIONS\.map/);
        expect(clientSrc).toMatch(/aria-pressed=/);
        // role baseline chip via canonical label helper
        expect(clientSrc).toMatch(/getRoleLabelTH/);
    });

    test('calls GET/PUT/DELETE via the /api proxy path helpers (no NEXT_PUBLIC_API_URL)', () => {
        expect(clientSrc).toMatch(/apiClient\.get</);
        expect(clientSrc).toMatch(/apiClient\.put</);
        expect(clientSrc).toMatch(/apiClient\.delete</);
        expect(clientSrc).toMatch(/providerApiPaths\.userPermissions/);
        expect(clientSrc).toMatch(/providerApiPaths\.userPermission\(/);
        expect(clientSrc).not.toMatch(/NEXT_PUBLIC_API_URL/);
    });

    test('uses semantic token classes for grant/revoke tones (gacp/no-raw-color)', () => {
        expect(clientSrc).toMatch(/bg-success/);
        expect(clientSrc).toMatch(/bg-destructive/);
        // No raw hex colors in className/style.
        expect(clientSrc).not.toMatch(/#[0-9a-fA-F]{6}/);
        // In-shell width standard: no page-level container cap (DashboardLayout
        // caps). The only max-w-* allowed is the modal card (a component-level
        // exception) — assert the page-cap tokens never appear.
        expect(clientSrc).not.toMatch(/max-w-7xl/);
        expect(clientSrc).not.toMatch(/max-w-6xl/);
    });
});
