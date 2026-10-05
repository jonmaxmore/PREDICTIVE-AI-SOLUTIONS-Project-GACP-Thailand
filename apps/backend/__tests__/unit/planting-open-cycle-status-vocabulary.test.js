/**
 * "Open" must mean the same thing to the field sign and to the create form.
 *
 * Two modules answer "is this plot's cycle still open?":
 *   services/planting-service.js            — the R15 gate that refuses a second cycle
 *   services/trace-service/resolve-plot-cycle.js — the public plot QR's "current cycle"
 *
 * They hold the same list rather than one importing the other, because requiring the
 * trace-service module pulls trace-service/common.js, which boots server.js and its
 * production-secret checks at require time — planting-service is required by nearly every
 * cultivation route and unit suite, so that import would drag a server boot into all of them.
 *
 * A copy nobody checks is how the sign and the form end up disagreeing about which round
 * the farmer is standing in, which is the exact failure R15 exists to prevent. So this test
 * reads both files as TEXT (no require, no boot) and fails the moment the lists drift apart.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const FILES = {
    'services/planting-service.js': path.join(__dirname, '../../services/planting-service.js'),
    'services/trace-service/resolve-plot-cycle.js': path.join(__dirname, '../../services/trace-service/resolve-plot-cycle.js'),
};

function readOpenStatuses(file) {
    const source = fs.readFileSync(file, 'utf8');
    const match = source.match(/const OPEN_CYCLE_STATUSES = \[([^\]]*)\]/);
    if (!match) {
        throw new Error(`OPEN_CYCLE_STATUSES declaration not found in ${file}`);
    }
    return match[1]
        .split(',')
        .map((token) => token.trim().replace(/^['"]|['"]$/g, ''))
        .filter(Boolean);
}

describe('the definition of an OPEN planting cycle has one meaning', () => {
    const [planting, trace] = Object.values(FILES).map(readOpenStatuses);

    test('planting-service and resolve-plot-cycle list the same statuses', () => {
        expect(planting).toEqual(trace);
    });

    test('the list is the spec R15 one: everything before harvest, nothing after', () => {
        // R15: drying the previous round runs in parallel and does NOT hold the plot,
        // because the goods have left the ground. HARVESTED/COMPLETED must stay out.
        expect(planting).toEqual(['PLANNING', 'PLANTED', 'GROWING', 'READY_HARVEST']);
        expect(planting).not.toContain('HARVESTED');
        expect(planting).not.toContain('COMPLETED');
    });
});
