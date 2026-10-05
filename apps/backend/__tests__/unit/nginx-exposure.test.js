/**
 * nginx-exposure.test.js
 *
 * Two nginx behaviours that read as safe and are not.
 *
 * THE WHITELIST THAT ALLOWS EVERYONE. `nginx/gacp.production.conf` runs inside
 * a container and only ever receives connections proxied from the host nginx,
 * so `$remote_addr` there is the Docker bridge — never a visitor's address. Its
 * `location /pgadmin/` block reads
 *
 *     allow 127.0.0.0/8; allow 172.16.0.0/12; allow 10.0.0.0/8; deny all;
 *
 * and `172.16.0.0/12` covers every Docker bridge address, so `deny all` can
 * never fire. Meanwhile the host config that DOES see the real client had no
 * `/pgadmin/` location at all, so the request fell through its catch-all and
 * reached the database console. An IP restriction written at the wrong layer is
 * worse than none, because the comment above it says the console is protected.
 *
 * THE HEADERS THAT VANISH. nginx does not merge `add_header`: a block that
 * declares any header of its own inherits none from its parent. Six locations
 * in the same file each set a `Cache-Control` or `X-Robots-Tag`, and so silently
 * drop all nine server-level security headers — including on `location /`,
 * which serves every page, and `location /api/`, which serves every API
 * response. The directives are present in the file and absent from the wire.
 *
 * These assertions are about config text rather than a live server, so they
 * hold in CI where no nginx is running.
 */

'use strict';

const fs = require('node:fs');
const path = require('node:path');

const REPO_ROOT = path.join(__dirname, '..', '..', '..', '..');
const HOST_CONF = path.join(REPO_ROOT, 'deploy', 'nginx', 'gacp-platform.conf');
const DOCKER_CONF = path.join(REPO_ROOT, 'nginx', 'gacp.production.conf');

const read = (file) => fs.readFileSync(file, 'utf8');
const liveLines = (file) => read(file)
    .split('\n')
    .map((text, index) => ({ text, line: index + 1 }))
    .filter((l) => !l.text.trim().startsWith('#'));

/**
 * Server-level headers the container config sets before any location block.
 *
 * Content-Security-Policy is deliberately NOT here — see the CSP describe
 * block below for why nginx must not set one at all.
 */
const SECURITY_HEADERS = [
    'X-Frame-Options',
    'X-Content-Type-Options',
    'Referrer-Policy',
];

describe('pgAdmin is not reachable from the public internet', () => {
    it('the host config, which is the only layer that sees the real client, refuses /pgadmin/', () => {
        const conf = read(HOST_CONF);
        expect(conf).toMatch(/location\s+\/pgadmin\//);
        // Whatever form the refusal takes, it must not proxy onward.
        const block = conf.slice(conf.indexOf('location /pgadmin/'));
        const body = block.slice(0, block.indexOf('}') + 1);
        expect(body).toMatch(/deny all|return\s+40[34]/);
        expect(body).not.toMatch(/proxy_pass/);
    });

    it('the container config does not claim an IP whitelist it cannot enforce', () => {
        // $remote_addr in the container is the Docker bridge, so an allow-list
        // of private ranges permits every request that arrives. Either the
        // block refuses outright, or it must not pretend to filter by address.
        const conf = read(DOCKER_CONF);
        const start = conf.indexOf('location /pgadmin/');
        if (start === -1) {return;}
        const body = conf.slice(start, conf.indexOf('}', start) + 1);
        const claimsWhitelist = /allow\s+172\.16\.0\.0\/12|allow\s+10\.0\.0\.0\/8/.test(body);
        expect(claimsWhitelist).toBe(false);
    });
});

describe('security headers survive into every location', () => {
    // A location that sets any add_header of its own inherits none from the
    // server block. Each such location must therefore restate the security set.
    const locationsSettingHeaders = () => {
        const lines = read(DOCKER_CONF).split('\n');
        const blocks = [];
        let current = null;
        let depth = 0;
        lines.forEach((text, index) => {
            const trimmed = text.trim();
            if (trimmed.startsWith('#')) {return;}
            if (/^location\s/.test(trimmed)) {
                current = { name: trimmed, line: index + 1, body: [] };
                depth = 0;
            }
            if (current) {
                current.body.push(text);
                depth += (text.match(/\{/g) || []).length;
                depth -= (text.match(/\}/g) || []).length;
                if (depth <= 0 && current.body.length > 1) {
                    if (current.body.some((l) => /add_header/.test(l) && !l.trim().startsWith('#'))) {
                        blocks.push(current);
                    }
                    current = null;
                }
            }
        });
        return blocks;
    };

    it('finds the locations that override headers', () => {
        // Guards the parser itself: if this ever returns nothing, the
        // assertion below would pass vacuously.
        expect(locationsSettingHeaders().length).toBeGreaterThan(0);
    });

    it.each(SECURITY_HEADERS)('%s is present in every header-setting location', (header) => {
        const offenders = locationsSettingHeaders()
            .filter((block) => !block.body.some((l) => l.includes(header)))
            .map((block) => `${DOCKER_CONF.split('/').pop()}:${block.line} ${block.name}`);
        expect(offenders).toEqual([]);
    });
});

describe('exactly one layer owns the Content-Security-Policy', () => {
    // A browser applies every CSP header it receives and enforces the
    // intersection, so two authorities can only ever produce a policy that is
    // wrong in one direction. Both nginx layers hardcoded
    //   img-src 'self' data: blob:
    // while apps/web-app/src/middleware.ts builds
    //   img-src 'self' data: blob: ${backendOrigin} ${tileOrigin}
    // from the environment. nginx cannot read NEXT_PUBLIC_MAP_TILE_URL or the
    // backend origin, so the intersection silently dropped both: an operator
    // who configured an in-country tile server got a blank map, and documents
    // served straight from the backend origin were refused as images.
    //
    // The layer that knows the values owns the header. nginx sets none.
    it.each([
        ['deploy/nginx/gacp-platform.conf', HOST_CONF],
        ['nginx/gacp.production.conf', DOCKER_CONF],
    ])('%s sets no Content-Security-Policy', (_name, file) => {
        const offenders = liveLines(file).filter((l) => /add_header\s+Content-Security-Policy/i.test(l.text));
        expect(offenders.map((l) => l.line)).toEqual([]);
    });

    it('the application still sets one, and it carries the configured tile origin', () => {
        const middleware = read(path.join(REPO_ROOT, 'apps', 'web-app', 'src', 'middleware.ts'));
        expect(middleware).toMatch(/Content-Security-Policy/);
        expect(middleware).toMatch(/img-src[^`]*tileOrigin/);
    });
});

describe('an HTTP-01 challenge can reach the webroot', () => {
    // The :80 server block serves /nginx-health and 301-redirects everything
    // else, so /.well-known/acme-challenge/<token> was answered with a
    // redirect and Let's Encrypt validation failed. It worked in production
    // only because a maintenance script injected the location into the
    // *deployed* copy at runtime — which the next deploy of this tracked file
    // silently reverts, and the certificate then expires with no visible
    // failure until the site goes untrusted.
    const vhosts = [
        'deploy/nginx/gacp-platform.conf',
        'deploy/nginx/staging.gacpth.com.conf',
    ];

    it.each(vhosts)('%s answers the ACME challenge path before redirecting to HTTPS', (relative) => {
        const absolute = path.join(REPO_ROOT, relative);
        if (!fs.existsSync(absolute)) {return;}
        const conf = read(absolute);
        expect(conf).toMatch(/location\s+\^~\s+\/\.well-known\/acme-challenge\//);

        // Order matters: nginx picks `^~` prefix matches ahead of the plain
        // `/` prefix, but a reader must still see it declared before the
        // redirect, or the next edit will move it below and break renewal.
        const acme = conf.indexOf('/.well-known/acme-challenge/');
        const redirect = conf.indexOf('return 301 https://');
        expect(acme).toBeLessThan(redirect);
    });
});

describe('the container config does not tell search engines to ignore the platform', () => {
    it('X-Robots-Tag noindex is not set for the whole server', () => {
        // GACP certification is a public register. A server-level
        // "noindex, nofollow" would delist the entire platform; it belongs only
        // on the admin surfaces.
        const serverLevel = liveLines(DOCKER_CONF)
            .filter((l) => /add_header\s+X-Robots-Tag/.test(l.text))
            .filter((l) => /^\s{4}add_header/.test(l.text)); // four spaces = server scope here
        expect(serverLevel).toEqual([]);
    });
});
