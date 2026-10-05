/**
 * member-permission-matrix-logic.ts — pure, SSR-safe logic for the
 * per-member farm-operation permission matrix (Farm-worker Wave C chunk 2).
 *
 * The catalog itself (keys + Thai labels) is authoritative on the BACKEND
 * (routes/api/entities/member-permissions.js → GET payload `catalog`). This
 * module only owns the FE PRESENTATION concerns:
 *   - which of the 5 Thai groups each farm-operation code belongs to,
 *   - the 3-state cell vocabulary (สืบทอดจาก role / ให้สิทธิ์ / เพิกถอน) with
 *     the engine's precedence (REVOKE wins),
 *   - inherit/effective display helpers,
 *   - the OPTIONAL reason bounds (5-500 when provided — the BE S10 contract).
 *
 * Kept pure (no React, no api-client) so the test suite can assert the
 * taxonomy without booting the client island — the same convention as the
 * provider matrix's permission-matrix-config.ts (interaction pattern only;
 * the VISUALS follow the HEALTH friendly ui_kit, not Fiori).
 */

export type GrantEffect = 'GRANT' | 'REVOKE';
/** The three states a matrix cell can be in. */
export type CellState = 'inherit' | GrantEffect;

export interface CatalogEntry {
    key: string;
    label: string;
}

export interface PermissionGroup {
    /** stable id used as the React key + test hook */
    id: string;
    /** Thai section title shown in the matrix */
    titleTH: string;
    /** predicate: does this permission key belong in this group? */
    match: (key: string) => boolean;
}

/**
 * Farm-operation groups, in display order. `match` is evaluated
 * top-to-bottom; the FIRST group that matches owns the key. A key matched
 * by none falls into the trailing "อื่น ๆ" bucket — a newly-added backend
 * code never vanishes from the matrix.
 */
export const MEMBER_PERMISSION_GROUPS: readonly PermissionGroup[] = Object.freeze([
    {
        id: 'farm',
        titleTH: 'ฟาร์ม',
        match: (key) => key === 'FARM_CREATE' || key === 'EDIT_FARM',
    },
    {
        id: 'cycle',
        titleTH: 'รอบปลูก / ต้นปลูก',
        match: (key) => key === 'CYCLE_CREATE' || key === 'UNIT_MANAGE',
    },
    {
        id: 'activity',
        titleTH: 'กิจกรรมในแปลง (7 ประเภท)',
        match: (key) => key.startsWith('ACTIVITY_'),
    },
    {
        id: 'harvest-qr',
        titleTH: 'เก็บเกี่ยว / QR',
        match: (key) => key === 'HARVEST_RECORD' || key === 'QR_GENERATE',
    },
    {
        id: 'records',
        titleTH: 'บันทึก / รายงาน',
        match: (key) => key === 'RECORDS_MANAGE' || key === 'REPORT_SUBMIT',
    },
]);

const OTHER_GROUP_ID = 'other';
const OTHER_GROUP_TITLE = 'อื่น ๆ';

export interface GroupedCatalog {
    id: string;
    titleTH: string;
    entries: CatalogEntry[];
}

/**
 * Partition the backend catalog into ordered display groups. Any key that
 * no defined group claims lands in the trailing "อื่น ๆ" bucket (omitted
 * when empty). Within a group the entries keep their catalog order.
 */
export function groupCatalog(catalog: CatalogEntry[]): GroupedCatalog[] {
    const buckets = new Map<string, CatalogEntry[]>();
    for (const group of MEMBER_PERMISSION_GROUPS) {
        buckets.set(group.id, []);
    }
    buckets.set(OTHER_GROUP_ID, []);

    for (const entry of catalog) {
        const owner = MEMBER_PERMISSION_GROUPS.find((g) => g.match(entry.key));
        buckets.get(owner ? owner.id : OTHER_GROUP_ID)!.push(entry);
    }

    const ordered: GroupedCatalog[] = MEMBER_PERMISSION_GROUPS.map((g) => ({
        id: g.id,
        titleTH: g.titleTH,
        entries: buckets.get(g.id) || [],
    }));
    const other = buckets.get(OTHER_GROUP_ID) || [];
    if (other.length > 0) {
        ordered.push({ id: OTHER_GROUP_ID, titleTH: OTHER_GROUP_TITLE, entries: other });
    }
    return ordered.filter((g) => g.entries.length > 0);
}

/**
 * The current cell state for a permission, derived from the grant list.
 * REVOKE wins over GRANT — matches the entity-effective-permissions
 * engine's precedence.
 */
export function cellStateFor(
    permission: string,
    grants: { permission: string; effect: GrantEffect | string }[],
): CellState {
    let state: CellState = 'inherit';
    for (const g of grants) {
        if (g.permission !== permission) continue;
        if (g.effect === 'REVOKE') return 'REVOKE';
        if (g.effect === 'GRANT') state = 'GRANT';
    }
    return state;
}

/** The 3 segmented-control options, in display order. */
export const CELL_OPTIONS: readonly { state: CellState; labelTH: string }[] = Object.freeze([
    { state: 'inherit', labelTH: 'สืบทอดจาก role' },
    { state: 'GRANT', labelTH: '✓ ให้สิทธิ์' },
    { state: 'REVOKE', labelTH: '✗ เพิกถอน' },
]);

/**
 * Would "inherit" mean HAS the permission? Baseline = role defaults ∪ the
 * legacy membership.permissions[] array (both come straight from the GET
 * payload; the engine unions them before grants apply).
 */
export function inheritedHas(
    permission: string,
    rolePermissions: string[],
    legacyPermissions: string[],
): boolean {
    return rolePermissions.includes(permission) || legacyPermissions.includes(permission);
}

/**
 * The NET-result chip next to each row — reads the `effective` array the
 * API computed (never re-derived on the FE; BE is authoritative).
 */
export function effectiveChipFor(
    permission: string,
    effective: string[],
): { has: boolean; labelTH: string } {
    const has = effective.includes(permission);
    return { has, labelTH: has ? 'มีสิทธิ์' : 'ไม่มีสิทธิ์' };
}

// BE S10 contract (routes/api/entities/member-permissions.js): reason is
// OPTIONAL, but WHEN PROVIDED must be 5-500 trimmed characters.
export const MIN_REASON_LENGTH = 5;
export const MAX_REASON_LENGTH = 500;

/**
 * Validate the optional reason input. Empty (after trim) = omitted = valid;
 * otherwise the BE bounds apply.
 */
export function validateReason(reason: string): { ok: boolean; messageTH?: string } {
    const trimmed = reason.trim();
    if (trimmed.length === 0) {
        return { ok: true };
    }
    if (trimmed.length < MIN_REASON_LENGTH) {
        return {
            ok: false,
            messageTH: `เหตุผลต้องยาวอย่างน้อย ${MIN_REASON_LENGTH} ตัวอักษร (หรือเว้นว่างไว้)`,
        };
    }
    if (trimmed.length > MAX_REASON_LENGTH) {
        return {
            ok: false,
            messageTH: `เหตุผลต้องไม่เกิน ${MAX_REASON_LENGTH} ตัวอักษร`,
        };
    }
    return { ok: true };
}
