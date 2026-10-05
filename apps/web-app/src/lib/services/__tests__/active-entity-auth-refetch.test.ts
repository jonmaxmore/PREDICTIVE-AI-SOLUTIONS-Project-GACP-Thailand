/**
 * ActiveEntityProvider auth-keyed fetch guard (2026-06-11).
 *
 * The provider lives in the ROOT providers tree, so it also mounts on the
 * login page. A dependency-less mount effect fetched /entities/mine
 * unauthenticated (→ []) and the post-login client-side redirect never
 * remounted the provider — the workspace pill stayed stuck on
 * "ไม่มีพื้นที่ใช้งาน" until a hard reload (found live by the owner on
 * staging, 2026-06-11). The fetch effect must be keyed on the signed-in
 * identity so it fires when auth hydrates / the user logs in / re-logs-in.
 *
 * Source-based guard (convention: renderToStaticMarkup tests can't exercise
 * effects, cf. dashboard-layout-width guard).
 */
import { describe, expect, it } from '@jest/globals';
import { readFileSync } from 'fs';
import { resolve } from 'path';

const src = readFileSync(
    resolve(__dirname, '../active-entity-provider.tsx'),
    'utf8',
);

describe('[2026-06-11] ActiveEntityProvider fetch is keyed on the auth identity', () => {
    it('subscribes to auth state via useAuth()', () => {
        expect(src).toMatch(/useAuth\(\)/);
    });

    it('the fetch effect depends on auth hydration + the user id (not once-on-mount)', () => {
        expect(src).toMatch(/\[skipInitialFetch, authLoading, authUser\?\.id\]/);
    });

    it('waits for auth hydration before deciding (no empty-state flash on reload)', () => {
        expect(src).toMatch(/if \(authLoading\) return;/);
    });

    it('does not regress to a dependency-less mount fetch', () => {
        // the old pattern: refresh() inside an effect closed over []
        expect(src).not.toMatch(/refresh\(\);[\s\S]{0,400}?\}, \[\]\);/);
    });
});
