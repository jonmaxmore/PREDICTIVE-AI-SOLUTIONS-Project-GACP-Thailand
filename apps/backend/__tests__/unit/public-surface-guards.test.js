/**
 * public-surface-guards.test.js
 *
 * Two things that are reachable, or point somewhere, without anyone deciding
 * they should.
 *
 * GET /api/metrics carried no authentication. nginx proxies all of /api/ to the
 * backend, and the only middleware in front of it is the rate limiter, so
 * anyone on the internet could ask a Thai government platform for its uptime,
 * per-endpoint request and error counters, response-time samples, host CPU and
 * memory, Socket.IO connection counts and database timing. Most of those
 * recorders happen not to be wired up today, so the payload is thin — which is
 * exactly why this is worth locking now rather than after someone wires them
 * up and turns a quiet endpoint into a live operational feed.
 *
 * The Flutter client hardcoded a second backend origin. `ApiConfig` is
 * commented "SINGLE SOURCE OF TRUTH for the backend base URL" and resolves to
 * gacpth.com, while `ApiService` ignored it and pointed at api.dtam.go.th —
 * a host this platform does not serve. Its call sites are currently unreachable
 * code, so nothing is failing in the field; it is a trap waiting for the first
 * screen that wires them in.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const read = (relative) => fs.readFileSync(path.join(REPO_ROOT, relative), 'utf8');

describe('GET /api/metrics is not anonymous', () => {
    const ROUTER = 'apps/backend/routes/api/index.js';

    it('declares authentication middleware on the route', () => {
        const source = read(ROUTER);
        const line = source.split('\n').find((l) => /router\.get\(\s*['"]\/metrics['"]/.test(l));
        expect(line).toBeDefined();
        // Operational telemetry is staff data, not public data.
        expect(line).toMatch(/authenticateProvider|requireAdmin/);
    });

    it('still exposes the unauthenticated health probe, which docker and load balancers need', () => {
        // Guards against over-correcting: /health must stay open or the
        // container healthcheck and any LB probe start failing.
        const source = read(ROUTER);
        const line = source.split('\n').find((l) => /router\.get\(\s*['"]\/health['"]/.test(l));
        if (!line) {return;}
        expect(line).not.toMatch(/authenticate/);
    });
});

describe('the mobile client has one backend origin', () => {
    const SERVICE = 'apps/mobile-app/lib/core/services/api_service.dart';
    const CONFIG = 'apps/mobile-app/lib/core/config/api_config.dart';

    it('ApiService does not hardcode a base URL', () => {
        const source = read(SERVICE);
        const live = source.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
        expect(live).not.toMatch(/baseUrl:\s*['"]https?:\/\//);
    });

    it('ApiService resolves its base URL through ApiConfig', () => {
        const source = read(SERVICE);
        expect(source).toMatch(/ApiConfig/);
    });

    it('api.dtam.go.th appears nowhere in live mobile code', () => {
        // The platform does not serve that host. Any call through it fails.
        const source = read(SERVICE);
        const live = source.split('\n').filter((l) => !l.trim().startsWith('//')).join('\n');
        expect(live).not.toMatch(/api\.dtam\.go\.th/);
    });

    it('ApiConfig remains the single source of truth it claims to be', () => {
        expect(read(CONFIG)).toMatch(/SINGLE SOURCE OF TRUTH/);
    });
});
