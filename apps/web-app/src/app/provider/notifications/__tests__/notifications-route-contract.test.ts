/**
 * M1 — FE↔BE route-existence contract for the notifications mark-read calls
 * (both portal twins: provider + health).
 *
 * Both client-views called `api.post('/api/notifications/${id}/read')` +
 * `api.post('/api/notifications/read-all')` while the backend serves
 * PUT /:id/read + PUT /mark-all-read (routes/api/system/notifications.js).
 * Wrong METHOD + wrong path (+ a '/api/' double-prefix the sibling GET does
 * not have). The `catch {}` + optimistic setState hid it completely —
 * read-state NEVER persisted and the bell badge never cleared.
 *
 * Pattern: fs source-scan pinning FE literals against the BE source, same as
 * provider/scheduler/reassign/__tests__/reassign-route-contract.test.ts.
 */

import fs from 'fs';
import path from 'path';

const read = (p: string) => fs.readFileSync(p, 'utf8');

// __tests__ → notifications → provider → app → src → web-app → apps
const APPS_DIR = path.resolve(__dirname, '../../../../../..');
const PROVIDER_VIEW = path.resolve(__dirname, '..', 'client-view.tsx');
const HEALTH_VIEW = path.join(APPS_DIR, 'web-app/src/app/health/notifications/client-view.tsx');
const BE_NOTIFICATIONS = path.join(APPS_DIR, 'backend/routes/api/system/notifications.js');

const CLIENT_VIEWS: Array<[string, string]> = [
    ['provider', PROVIDER_VIEW],
    ['health', HEALTH_VIEW],
];

describe('M1 — notifications mark-read calls hit the mounted BE routes', () => {
    describe.each(CLIENT_VIEWS)('%s portal client-view', (_portal, file) => {
        const src = read(file);

        test('mark-as-read uses PUT /notifications/:id/read (apiClient prepends /api)', () => {
            expect(src).toContain('api.put<unknown>(`/notifications/${id}/read`');
        });

        test('mark-all-read uses PUT /notifications/mark-all-read', () => {
            expect(src).toContain('api.put<unknown>("/notifications/mark-all-read"');
        });

        test('the dead POST /api/... literals must NOT come back', () => {
            // Both dead paths carried the '/api/' double-prefix (the sibling
            // GET correctly uses '/notifications'); forbid the whole class.
            expect(src).not.toContain('/api/notifications');
            expect(src).not.toContain('read-all');
        });
    });

    test('BE still mounts PUT /:id/read + PUT /mark-all-read where the FE points', () => {
        const beSrc = read(BE_NOTIFICATIONS);
        expect(beSrc).toMatch(/router\.put\(\s*'\/:id\/read'/);
        expect(beSrc).toMatch(/router\.put\(\s*'\/mark-all-read'/);
    });
});
