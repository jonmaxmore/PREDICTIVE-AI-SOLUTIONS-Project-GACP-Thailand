/**
 * Pre-launch access gate — the allowlist has to fail closed, and it has to be
 * possible to find out why you were blocked.
 *
 * The platform is not open to the public yet. The first attempt at "only my
 * machine" was `ufw` on the origin allowing one address on 80/443. That is not
 * a private site; it is a broken one. Cloudflare was blocked along with
 * everyone else, so the world got `522 Connection Timed Out`, and the one
 * allowed machine reached the origin directly, bypassed Cloudflare and met the
 * origin's self-signed certificate — `ERR_CERT_AUTHORITY_INVALID` on the
 * operator's own government platform.
 *
 * The gate belongs at the only layer that can see both the real visitor and a
 * trusted certificate: host nginx, after Cloudflare's `CF-Connecting-IP` has
 * been restored into `$remote_addr`.
 *
 * Two ways to get that wrong, and both are tested here rather than discovered
 * in production:
 *
 *   1. Keying the allowlist on the wrong variable. `$realip_remote_addr` is
 *      Cloudflare's edge address, the same for every visitor on earth. An
 *      allowlist keyed on it either admits everyone or nobody, and which one
 *      depends on which Cloudflare datacentre answered.
 *   2. Defaulting to allow. A typo in a CIDR then opens the site instead of
 *      closing it, and nothing visibly breaks, so nobody notices.
 *
 * So: parse the real config file, evaluate the real addresses through real
 * CIDR arithmetic, and assert on the answers.
 */

const fs = require('fs');
const path = require('path');

const {
    parseGeoBlock,
    isAllowed,
    readGateConfig,
    findDuplicateServerNames,
} = require('../../../../scripts/ci/check-access-allowlist');

const CONF = path.resolve(__dirname, '../../../../deploy/nginx/gacp-platform.conf');
const STAGING_CONF = path.resolve(__dirname, '../../../../deploy/nginx/staging.gacpth.com.conf');

/** The operator's workstation, as supplied. */
const OPERATOR_V4 = '198.51.100.30';
const OPERATOR_V6 = '2403:6200:88a4:b3fa:183a:3109:547d:de30';

/**
 * A Cloudflare edge address, inside the published 162.158.0.0/15 range. This is
 * what `$remote_addr` would be if real-IP restoration were misconfigured. It
 * must be denied: better the operator is locked out and reads the diagnostic
 * than the site quietly serves the world.
 */
const CLOUDFLARE_EDGE = '162.158.1.1';

describe('pre-launch access gate', () => {
    const conf = fs.readFileSync(CONF, 'utf8');
    const gate = readGateConfig(conf);

    describe('deny by default', () => {
        it('blocks every address that is not named', () => {
            expect(gate.geo.defaultValue).toBe('1');
        });

        it('denies an arbitrary public address', () => {
            expect(isAllowed(gate.geo, '8.8.8.8')).toBe(false);
            expect(isAllowed(gate.geo, '203.0.113.7')).toBe(false);
            expect(isAllowed(gate.geo, '2001:db8::1')).toBe(false);
        });

        it('denies a Cloudflare edge address, so a real-IP misconfiguration fails closed', () => {
            expect(isAllowed(gate.geo, CLOUDFLARE_EDGE)).toBe(false);
        });
    });

    describe('the operator gets in', () => {
        it('allows the supplied IPv4 address', () => {
            expect(isAllowed(gate.geo, OPERATOR_V4)).toBe(true);
        });

        it('allows the supplied IPv6 address', () => {
            expect(isAllowed(gate.geo, OPERATOR_V6)).toBe(true);
        });

        it('survives an IPv6 privacy-address rotation within the same prefix', () => {
            // SLAAC privacy extensions change the last 64 bits daily. Pinning
            // the full /128 would lock the operator out overnight, and the
            // symptom would look identical to the gate being broken.
            expect(isAllowed(gate.geo, '2403:6200:88a4:b3fa:dead:beef:1234:5678')).toBe(true);
        });

        it('denies a different /48 on the same ISP', () => {
            // Obsolete-expectation fix (2026-08-23): this used to assert the
            // pin was still a /64 and pick an address just outside THAT
            // (`2403:6200:88a4:ffff::1`). But gacp-platform.conf:90-96 widened
            // the pin to `2403:6200:88a4::/48` on 2026-08-18 — the ISP itself
            // rotates the /64 prefix (b3fa -> 75f observed), so a /64 pin was
            // a lockout on a timer, same lesson as the IPv4 /21 widening a few
            // lines above it. That change is operator-approved and was
            // verified live (__access-check blocked=0) the same day, so
            // `2403:6200:88a4:ffff::1` is now correctly INSIDE the allowed
            // range (it shares the first 48 bits: 2403:6200:88a4) — the old
            // assertion was pinning a boundary the gate no longer has. The
            // prefix is still a concession to rotation, not an open door, so
            // this now proves the /48 boundary itself: an address that
            // differs in the 48-bit prefix (88a5, not 88a4) must still be
            // denied.
            expect(isAllowed(gate.geo, '2403:6200:88a5::1')).toBe(false);
        });

        it('allows loopback so on-host health checks and curl still work', () => {
            expect(isAllowed(gate.geo, '127.0.0.1')).toBe(true);
            expect(isAllowed(gate.geo, '::1')).toBe(true);
        });
    });

    describe('the real visitor address is the one being matched', () => {
        it('keys the allowlist on $remote_addr, not the proxy address', () => {
            // $realip_remote_addr is Cloudflare. Matching on it is the
            // inverse-logic bug in one line.
            expect(gate.geo.variable).toBe('$remote_addr');
        });

        it('restores CF-Connecting-IP before anything reads $remote_addr', () => {
            expect(conf).toMatch(/^\s*real_ip_header\s+CF-Connecting-IP;/m);
        });

        it('trusts Cloudflare ranges only — the header is forgeable from anywhere else', () => {
            expect(conf).toMatch(/set_real_ip_from\s+162\.158\.0\.0\/15;/);
            expect(conf).toMatch(/set_real_ip_from\s+2400:cb00::\/32;/);
        });

        it('declares set_real_ip_from before the geo block, so the gate reads the restored value', () => {
            expect(conf.indexOf('real_ip_header')).toBeLessThan(conf.indexOf('geo $remote_addr'));
        });
    });

    describe('being blocked is diagnosable', () => {
        it('exempts the access-check endpoint', () => {
            expect(gate.exemptPatterns.some((p) => p.includes('__access-check'))).toBe(true);
        });

        it('reports the address nginx actually matched on', () => {
            // Without this the operator cannot tell "my address changed" from
            // "the gate is broken", and the only way to find out is to open the
            // site to everyone and see if that fixes it.
            expect(conf).toContain('$remote_addr');
            expect(conf).toMatch(/location = \/__access-check/);
            expect(conf).toMatch(/\$realip_remote_addr/);
        });

        it('exempts the ACME challenge, or certificate renewal fails silently', () => {
            expect(gate.exemptPatterns.some((p) => p.includes('acme-challenge'))).toBe(true);
        });
    });

    describe('the gate is actually wired into the listeners', () => {
        /**
         * Two gates now, and the bare domain is behind the STRICTER one.
         *
         * `$gacp_prelaunch_deny` admits a visitor holding the gate cookie, which is what
         * lets us hand a customer a link to a demo host from any network.
         * `$gacp_bare_domain_deny` asks the same question WITHOUT the cookie, so no token
         * opens gacpth.com. That split exists because the cookie could not be scoped to
         * one vhost: handing out the staging link also handed out the bare domain, for
         * the year the cookie lives, and until this platform is an official ministry
         * system a stranger finding a working GACP site there is a legal problem.
         *
         * Every public block must still carry ONE of them — an ungated listener is the
         * hole this whole file exists to prevent.
         */
        const ANY_GATE = /if \(\$gacp_(prelaunch|bare_domain)_deny\)/;

        it('is applied in every public server block', () => {
            const serverBlocks = conf.split(/^server \{/m).slice(1);
            const publicBlocks = serverBlocks.filter((block) => /listen\s+(\[::\]:)?(80|443)/.test(block));
            expect(publicBlocks.length).toBeGreaterThanOrEqual(2);
            for (const block of publicBlocks) {
                expect(block).toMatch(ANY_GATE);
            }
        });

        it('returns 403 rather than a redirect or a timeout', () => {
            expect(conf).toMatch(/if \(\$gacp_(prelaunch|bare_domain)_deny\) \{\s*return 403;/);
        });

        it('the bare domain’s gate does NOT consider the cookie — no token may open it', () => {
            const map = conf.match(/map\s+"[^"]*"\s+\$gacp_bare_domain_deny\s*\{[^}]*\}/);
            expect(map).not.toBeNull();
            // The cookie variable must not appear in its key at all.
            expect(map[0]).not.toContain('gacp_gate_cookie_ok');
            expect(map[0]).not.toContain('gacp_demo_token_ok');
        });

        it('the bare domain is served by the cookie-blind gate, not the cookie-aware one', () => {
            const bareBlocks = conf.split(/^server \{/m).slice(1)
                .filter((block) => /server_name[^;]*gacpth\.com/.test(block)
                    && !/server_name[^;]*(staging|demo)\.gacpth\.com/.test(block));
            expect(bareBlocks.length).toBeGreaterThanOrEqual(2);
            for (const block of bareBlocks) {
                expect(block).toMatch(/if \(\$gacp_bare_domain_deny\)/);
                expect(block).not.toMatch(/if \(\$gacp_prelaunch_deny\)/);
            }
        });
    });

    describe('go-live is one edit, and it is findable', () => {
        it('marks the single line that opens the platform to the public', () => {
            expect(conf).toMatch(/GO-LIVE/);
        });
    });

    describe('staging is behind the same gate', () => {
        const staging = fs.readFileSync(STAGING_CONF, 'utf8');

        it('gates both of its listeners', () => {
            const blocks = staging.split(/^server \{/m).slice(1);
            expect(blocks).toHaveLength(2);
            for (const block of blocks) {
                expect(block).toMatch(/if \(\$gacp_prelaunch_deny\) \{ return 403; \}/);
            }
        });

        it('can diagnose a block without needing the production vhost', () => {
            expect(staging).toMatch(/location = \/__access-check/);
        });
    });
});

describe('server_name conflicts', () => {
    /**
     * nginx does not fail on a duplicate `server_name` for a given listen
     * address. It prints `[warn] conflicting server name … ignored` and then
     * silently serves one of the two blocks — whichever it parsed first. Which
     * one that is depends on filename ordering inside the include glob, so the
     * site can change behaviour because someone renamed a file.
     */
    it('finds a name declared twice on the same port', () => {
        const duplicates = findDuplicateServerNames([
            { name: 'a.conf', text: 'server {\n listen 80;\n server_name x.example;\n}\n' },
            { name: 'b.conf', text: 'server {\n listen 80;\n server_name x.example;\n}\n' },
        ]);
        expect(duplicates).toHaveLength(1);
        expect(duplicates[0]).toMatchObject({ serverName: 'x.example', port: '80' });
        expect(duplicates[0].sources).toEqual(['a.conf', 'b.conf']);
    });

    it('accepts the same name on different ports — that is the http/https pair', () => {
        expect(findDuplicateServerNames([
            { name: 'a.conf', text: 'server {\n listen 80;\n server_name x.example;\n}\nserver {\n listen 443 ssl;\n server_name x.example;\n}\n' },
        ])).toEqual([]);
    });

    it('treats the IPv6 listener as the same port as the IPv4 one', () => {
        // `listen 80;` and `listen [::]:80;` in one block are one server, not
        // two. Counting them separately would report every correct vhost.
        expect(findDuplicateServerNames([
            { name: 'a.conf', text: 'server {\n listen 80;\n listen [::]:80;\n server_name x.example;\n}\n' },
        ])).toEqual([]);
    });

    it('reports each of several names in one block independently', () => {
        const duplicates = findDuplicateServerNames([
            { name: 'a.conf', text: 'server {\n listen 443 ssl;\n server_name x.example y.example;\n}\n' },
            { name: 'b.conf', text: 'server {\n listen 443 ssl;\n server_name y.example;\n}\n' },
        ]);
        expect(duplicates).toHaveLength(1);
        expect(duplicates[0].serverName).toBe('y.example');
    });

    it('finds none in the vhosts this repo ships', () => {
        expect(findDuplicateServerNames([
            { name: 'gacp-platform.conf', text: fs.readFileSync(CONF, 'utf8') },
            { name: 'staging.gacpth.com.conf', text: fs.readFileSync(STAGING_CONF, 'utf8') },
        ])).toEqual([]);
    });
});

describe('CIDR matching', () => {
    const geo = parseGeoBlock(`
geo $remote_addr $x {
    default 1;
    10.0.0.0/8       0;
    192.168.1.5/32   0;
    2001:db8::/32    0;
}
`);

    it('matches inside a v4 prefix and not outside it', () => {
        expect(isAllowed(geo, '10.255.255.254')).toBe(true);
        expect(isAllowed(geo, '11.0.0.1')).toBe(false);
    });

    it('treats a /32 as exactly one address', () => {
        expect(isAllowed(geo, '192.168.1.5')).toBe(true);
        expect(isAllowed(geo, '192.168.1.6')).toBe(false);
    });

    it('matches inside a v6 prefix', () => {
        expect(isAllowed(geo, '2001:db8:1234::9')).toBe(true);
        expect(isAllowed(geo, '2001:db9::1')).toBe(false);
    });

    it('does not confuse address families', () => {
        // A v4 address must never fall inside a v6 prefix, however the two are
        // represented internally.
        expect(isAllowed(geo, '10.0.0.1')).toBe(true);
        expect(isAllowed(parseGeoBlock('geo $remote_addr $x {\n default 1;\n ::/0 0;\n}'), '10.0.0.1'))
            .toBe(false);
    });

    it('rejects a malformed address rather than guessing', () => {
        expect(isAllowed(geo, 'not-an-address')).toBe(false);
        expect(isAllowed(geo, '')).toBe(false);
    });
});

describe('http2 is declared in the form this platform\'s nginx understands', () => {
    /**
     * `http2 on;` as a standalone directive arrived in nginx 1.25.1. The origin
     * runs an older build, so installing a vhost that uses it produces
     *
     *   nginx: [emerg] unknown directive "http2"
     *
     * and — this is the part that matters — `nginx -t` fails while the running
     * process keeps serving from the config already in memory. Nothing looks
     * broken until the next restart or reboot, at which point nginx does not
     * come back at all.
     *
     * The two vhosts disagreed: gacp-platform.conf used the inline form and
     * staging.gacpth.com.conf used the standalone one. Both use the inline form
     * now, which every nginx since 1.9.5 accepts.
     */
    const VHOSTS = ['gacp-platform.conf', 'staging.gacpth.com.conf'];

    it.each(VHOSTS)('%s does not use the standalone directive', (name) => {
        const text = fs.readFileSync(path.resolve(__dirname, '../../../../deploy/nginx', name), 'utf8');
        expect(text).not.toMatch(/^\s*http2\s+(on|off)\s*;/m);
    });

    it.each(VHOSTS)('%s enables http2 on its TLS listener', (name) => {
        // Dropping the directive entirely would be a silent downgrade to
        // HTTP/1.1 rather than a visible failure.
        const text = fs.readFileSync(path.resolve(__dirname, '../../../../deploy/nginx', name), 'utf8');
        expect(text).toMatch(/listen\s+443\s+ssl\s+http2;/);
        expect(text).toMatch(/listen\s+\[::\]:443\s+ssl\s+http2;/);
    });
});

describe('the vhosts point at certificates that exist on this origin', () => {
    /**
     * The staging vhost referenced /etc/letsencrypt/live/gacpth.com/, which is
     * not present on the origin — it has a self-signed pair generated by
     * setup-host-nginx.sh, and Cloudflare's SSL mode is Full, which accepts it.
     * Installing the file therefore gave
     *
     *   [emerg] cannot load certificate ... No such file or directory
     *
     * with the same shape as the http2 failure: nginx -t fails, reload fails,
     * the running process carries on, and the machine does not come back after
     * a reboot.
     */
    it('uses the origin certificate both vhosts share', () => {
        const staging = fs.readFileSync(STAGING_CONF, 'utf8');
        const prod = fs.readFileSync(CONF, 'utf8');
        const certOf = (text) => (/ssl_certificate\s+(\S+);/.exec(text) || [])[1];
        expect(certOf(staging)).toBe(certOf(prod));
    });

    it('does not assume a Let\'s Encrypt path this origin has never had', () => {
        for (const file of [CONF, STAGING_CONF]) {
            expect(fs.readFileSync(file, 'utf8')).not.toMatch(/^\s*ssl_certificate(_key)?\s+\/etc\/letsencrypt\//m);
        }
    });
});
