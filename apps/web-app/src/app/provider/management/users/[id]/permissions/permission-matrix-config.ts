/**
 * permission-matrix-config.ts — pure, SSR-safe config for the per-user
 * permission matrix (feat/backoffice-per-permission-grants).
 *
 * The catalog itself (keys + Thai labels) is authoritative on the BACKEND
 * (routes/api/admin/user-permissions.js → GET payload `catalog`). This file
 * only owns the FE PRESENTATION concerns:
 *   - which domain each permission key belongs to (grouping),
 *   - the display order + Thai title of each group,
 *   - the 3-state cell vocabulary (inherit / grant / revoke).
 *
 * Kept pure (no React, no api-client) so a source/render test can assert the
 * group taxonomy without booting the client island.
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
 * Domain groups, in display order. `match` is evaluated top-to-bottom; the
 * FIRST group that matches owns the key (so a key lands in exactly one group).
 * A key matched by none falls into the trailing "อื่น ๆ" bucket.
 */
export const PERMISSION_GROUPS: readonly PermissionGroup[] = Object.freeze([
  {
    id: 'application',
    titleTH: 'ใบสมัคร (Application)',
    match: (key) => key.startsWith('application.'),
  },
  {
    id: 'finance',
    titleTH: 'การเงิน (Finance)',
    match: (key) =>
      key.startsWith('invoice.') ||
      key.startsWith('receipt.') ||
      key.startsWith('bank_account.') ||
      key.startsWith('accounting.'),
  },
  {
    id: 'audit',
    titleTH: 'การตรวจสอบ (Audit)',
    match: (key) => key.startsWith('audit.'),
  },
  {
    id: 'system_admin_dtam',
    titleTH: 'ผู้ดูแลระบบ (Administration)',
    match: (key) => key === 'users.manage' || key === 'master_data.manage',
  },
  {
    id: 'report',
    titleTH: 'รายงาน (Report)',
    match: (key) => key.startsWith('report.'),
  },
]);

const OTHER_GROUP_ID = 'other';
const OTHER_GROUP_TITLE = 'อื่น ๆ (Other)';

export interface GroupedCatalog {
  id: string;
  titleTH: string;
  entries: CatalogEntry[];
}

/**
 * Partition the backend catalog into ordered display groups. Any key that no
 * defined group claims lands in the trailing "อื่น ๆ" bucket (which is omitted
 * when empty). Within a group the entries keep their catalog order.
 */
export function groupCatalog(catalog: CatalogEntry[]): GroupedCatalog[] {
  const buckets = new Map<string, CatalogEntry[]>();
  for (const group of PERMISSION_GROUPS) {
    buckets.set(group.id, []);
  }
  buckets.set(OTHER_GROUP_ID, []);

  for (const entry of catalog) {
    const owner = PERMISSION_GROUPS.find((g) => g.match(entry.key));
    buckets.get(owner ? owner.id : OTHER_GROUP_ID)!.push(entry);
  }

  const ordered: GroupedCatalog[] = PERMISSION_GROUPS.map((g) => ({
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
 * REVOKE wins over GRANT (matches the engine's precedence).
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
  { state: 'inherit', labelTH: 'สืบทอด' },
  { state: 'GRANT', labelTH: '✓ ให้สิทธิ์' },
  { state: 'REVOKE', labelTH: '✗ เพิกถอน' },
]);
