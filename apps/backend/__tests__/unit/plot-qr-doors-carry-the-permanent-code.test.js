/**
 * T8 — the sign in the field has a permanent code, and the doors have to hand it over.
 *
 * The permanent identity is real and complete everywhere EXCEPT here. Layer 1 minted
 * Plot.plotCode and made every new plot carry one (services/plot-code-extension.js); the
 * public resolver already answers a scanned plot code and reports the permanent URL
 * (resolve-plot-cycle.js — "the URL that will keep working next season"); the printable
 * sign exists (app/health/planting/[id]/plot-signs/plot-sign-sheet.tsx).
 *
 * What was missing is the sentence the plots tab wrote about itself:
 *
 *     "The permanent three are optional because that endpoint does not return them yet"
 *     — planting-cycle-detail-tabs-section-a-overview-plots.tsx:44
 *
 * So the screen that knows how to show a permanent code, and knows how to link to that
 * plot's own printable sign, was told "no code yet" for every plot in the country — and
 * fell back to the whole-cycle sheet. The column existed, the sign existed, and the two
 * were never introduced.
 *
 * The seasonal QR is NOT removed here. It seals a season's payload into the evidence chain
 * and it is what every already-printed sticker resolves through. It just stops being the
 * only identity these doors know about, and it now says which one it is.
 */
'use strict';

const PLOT = {
    id: 'plot-1',
    name: 'แปลงที่ 1',
    solarSystem: 'OUTDOOR',
    plotCode: 'PLOT-7F2KX-M9QRT',
    qrIssuedAt: new Date('2026-08-24T00:00:00Z'),
    qrRevokedAt: null,
};
const ASSIGNMENT = { id: 'cyclePlot-1', plot: PLOT, allocatedAreaSqm: 400, plannedPlantCount: 20 };
const SEASONAL = { entityId: 'cyclePlot-1', qrCode: 'a-uuid-from-last-season', publicUrl: 'https://x/trace/plot-cycle/a-uuid-from-last-season', status: 'ACTIVE' };

const { buildPlotQrRow } = require('../../services/plot-qr-row');

describe('the row every plot-QR door returns', () => {
    test('carries the permanent code, its issue and revoke marks', () => {
        const row = buildPlotQrRow({ assignment: ASSIGNMENT, seasonal: SEASONAL, cultivationType: 'OUTDOOR' });
        expect(row.plotCode).toBe('PLOT-7F2KX-M9QRT');
        expect(row.qrIssuedAt).toEqual(PLOT.qrIssuedAt);
        expect(row.qrRevokedAt).toBeNull();
    });

    test('still carries the season\'s QR, under a name that says which one it is', () => {
        const row = buildPlotQrRow({ assignment: ASSIGNMENT, seasonal: SEASONAL, cultivationType: 'OUTDOOR' });
        expect(row.qrCode).toBe('a-uuid-from-last-season');
        expect(row.trackingUrl).toBe(SEASONAL.publicUrl);
        expect(row.seasonalQrCode).toBe('a-uuid-from-last-season');
    });

    test('a plot with no permanent code says so with null, not with a missing key', () => {
        const row = buildPlotQrRow({
            assignment: { ...ASSIGNMENT, plot: { id: 'p', name: 'n', solarSystem: 'OUTDOOR' } },
            seasonal: SEASONAL, cultivationType: 'OUTDOOR',
        });
        expect(row).toHaveProperty('plotCode');
        expect(row.plotCode).toBeNull();
    });

    test('a plot whose season was never sealed still reports its permanent code', () => {
        const row = buildPlotQrRow({ assignment: ASSIGNMENT, seasonal: null, cultivationType: 'OUTDOOR' });
        expect(row.plotCode).toBe('PLOT-7F2KX-M9QRT');
        expect(row.qrCode).toBeNull();
    });

    test('keeps every field the three doors already published', () => {
        const row = buildPlotQrRow({ assignment: ASSIGNMENT, seasonal: SEASONAL, cultivationType: 'GREENHOUSE' });
        expect(row).toMatchObject({
            cyclePlotId: 'cyclePlot-1',
            plotId: 'plot-1',
            plotName: 'แปลงที่ 1',
            cultivationMethod: 'OUTDOOR',
            allocatedAreaSqm: 400,
            plannedPlantCount: 20,
        });
    });

    test('falls back to the cycle\'s method only when the plot does not say', () => {
        const row = buildPlotQrRow({
            assignment: { ...ASSIGNMENT, plot: { ...PLOT, solarSystem: null } },
            seasonal: SEASONAL, cultivationType: 'greenhouse',
        });
        expect(row.cultivationMethod).toBe('GREENHOUSE');
    });
});

describe('the plot selections that feed those doors', () => {
    const source = require('fs').readFileSync(require.resolve('../../services/planting-cycle-service.js'), 'utf8');
    const providerSource = require('fs').readFileSync(require.resolve('../../services/planting-service.js'), 'utf8');
    const adminSource = require('fs').readFileSync(require.resolve('../../routes/api/admin/planting.js'), 'utf8');

    // A row builder that asks for plotCode is useless if the query never selected it —
    // and a `select` that omits a column returns undefined rather than failing, so this
    // is the one place where reading the query text is the honest check.
    test.each([
        ['farmer (loadOwnedCycleWithPlots)', () => source],
        ['provider (getProviderCyclePlotQrs)', () => providerSource],
        ['admin (routes/api/admin/planting.js)', () => adminSource],
    ])('%s selects plotCode, qrIssuedAt and qrRevokedAt', (_name, get) => {
        const text = get();
        for (const column of ['plotCode', 'qrIssuedAt', 'qrRevokedAt']) {
            expect(text).toContain(`${column}: true`);
        }
    });
});
