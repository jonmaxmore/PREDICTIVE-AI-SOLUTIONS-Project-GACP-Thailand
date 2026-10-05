/**
 * W12 — the renewal wizard must call an endpoint that EXISTS, with a body the
 * route actually validates.
 *
 * The defect this exists to prevent recurring:
 *   client-view.tsx POSTed to `/api/applications/renewal` (singular).
 *   The route is mounted at `/renewals` (routes/api/index.js).
 * Verified against a running backend on 2026-08-22:
 *   POST /api/applications/renewal  -> 404
 *   POST /api/applications/renewals -> 401 (auth) / 400 (body validation)
 * So the renewal button had never once worked against a real backend. Nothing
 * caught it because playwright/renewal-flow.spec.ts mocked the singular URL —
 * the test agreed with the bug instead of with the server.
 *
 * That is why this suite reads the REAL ROUTE FILE rather than a fixture. A
 * mock can be wrong in the same direction as the caller; the route file cannot.
 */

import { readFileSync } from 'fs';
import { resolve } from 'path';

const WEB_SRC = resolve(__dirname, '..');
const BACKEND = resolve(__dirname, '../../../backend');

const clientView = readFileSync(
    resolve(WEB_SRC, 'app/health/applications/renewal/client-view.tsx'),
    'utf8',
);
const routeIndex = readFileSync(resolve(BACKEND, 'routes/api/index.js'), 'utf8');
const renewalsRoute = readFileSync(
    resolve(BACKEND, 'routes/api/applications/renewals.js'),
    'utf8',
);

/** The single POST the wizard makes to create the renewal. */
function callerPost(): { url: string; body: string } {
    // api.post<...>(\n  '<url>',\n  { <body> },\n)
    const m = clientView.match(
        /api\.post<[^>]*>\(\s*'([^']+)'\s*,\s*\{([^}]*)\}/,
    );
    if (!m) { throw new Error('no api.post(...) call found in the renewal client view'); }
    return { url: m[1] as string, body: m[2] as string };
}

/** Field names the route reads off the request body. */
function routeAcceptedBodyFields(): string[] {
    const fields = new Set<string>();
    for (const m of renewalsRoute.matchAll(/body\.([A-Za-z_][A-Za-z0-9_]*)/g)) {
        fields.add(m[1] as string);
    }
    return [...fields];
}

describe('W12 — the URL the wizard posts to is the URL the server mounts', () => {
    it('the backend mounts the renewal router at the PLURAL path', () => {
        // If this ever changes, the caller assertion below has to change with
        // it — which is the whole point of reading it from the route file.
        expect(routeIndex).toContain(`appConsolidated.use('/renewals'`);
        expect(routeIndex).not.toContain(`appConsolidated.use('/renewal'`);
    });

    it('the wizard posts to that exact path, not the singular one', () => {
        const { url } = callerPost();
        expect(url).toBe('/api/applications/renewals');
    });

    it('no singular /api/applications/renewal call survives anywhere in the wizard', () => {
        // A trailing-boundary check: `/renewal` not followed by `s`.
        expect(clientView).not.toMatch(/'\/api\/applications\/renewal'/);
    });
});

describe('W12 — the body the wizard sends is a body the route validates', () => {
    it('the route requires originalCertificateId (or its certificateId fallback)', () => {
        expect(renewalsRoute).toContain('body.originalCertificateId || body.certificateId');
        expect(renewalsRoute).toContain('originalCertificateId is required');
    });

    it('the wizard sends the canonical field name', () => {
        const { body } = callerPost();
        expect(body).toContain('originalCertificateId');
    });

    it('every field the wizard sends is a field the route reads', () => {
        const { body } = callerPost();
        const sent = [...body.matchAll(/([A-Za-z_][A-Za-z0-9_]*)\s*:/g)].map((m) => m[1] as string);
        expect(sent.length).toBeGreaterThan(0);

        const accepted = routeAcceptedBodyFields();
        const ignored = sent.filter((f) => !accepted.includes(f));
        // Sending fields the server drops on the floor is how the old payload
        // (previousApplicationId, documentIds) hid the fact that the call was
        // never reaching a real handler.
        expect(ignored).toEqual([]);
    });

    it('the retired upload payload is gone', () => {
        const { body } = callerPost();
        expect(body).not.toContain('documentIds');
        expect(body).not.toContain('previousApplicationId');
    });
});

describe('W12 — the document-upload step is out of the renewal wizard', () => {
    it('REQUIRED_DOCS no longer exists', () => {
        const types = readFileSync(
            resolve(WEB_SRC, 'app/health/applications/renewal/types.tsx'),
            'utf8',
        );
        expect(types).not.toMatch(/export const REQUIRED_DOCS/);
    });

    it('the upload step is not a step any more', () => {
        const types = readFileSync(
            resolve(WEB_SRC, 'app/health/applications/renewal/types.tsx'),
            'utf8',
        );
        const stepType = types.match(/export type RenewalStep = ([^;]+);/);
        expect(stepType?.[1]).not.toContain("'upload'");
        expect(stepType?.[1]).toContain("'quotation'");
    });

    it('the wizard no longer uploads anything', () => {
        expect(clientView).not.toContain('draft-documents');
        expect(clientView).not.toContain('renewal-documents');
        expect(clientView).not.toContain('UploadStep');
    });

    it('the upload component file is gone', () => {
        expect(() => readFileSync(
            resolve(WEB_SRC, 'app/health/applications/renewal/upload-step.tsx'),
            'utf8',
        )).toThrow();
    });
});
