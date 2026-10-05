#!/usr/bin/env node
/**
 * The pre-launch access gate, read back and checked.
 *
 * `deploy/nginx/gacp-platform.conf` carries an allowlist that decides who can
 * reach the platform before launch. nginx will not tell you whether that list
 * says what you meant — a `geo` block with `default 0` is valid config and an
 * open door. This reads the file, evaluates addresses through the same prefix
 * arithmetic nginx uses, and exits non-zero if the answers are wrong.
 *
 * How this runs (2026-08-14): by hand only — `pnpm check:access-allowlist`
 * (package.json:27). Its blocking invoker was
 * `.github/workflows/topology-guard.yml:47` and GitHub Actions is permanently
 * unavailable (the change log 2026-08-14); it has no row in
 * scripts/ci/local-gate.sh or scripts/ci/full-gate-checks.txt. So the sentence
 * "CI enforces the allowlist", wherever you read it, is not true today — run
 * this before every install of deploy/nginx/gacp-platform.conf. The 2026-08-14
 * lockout incident (the change log, same date) is what skipping it costs.
 *
 * Two properties matter more than the rest:
 *
 *   - It must deny by default. A mistake should lock people out, loudly, not
 *     let them in, quietly.
 *   - It must match on `$remote_addr` *after* Cloudflare's `CF-Connecting-IP`
 *     has been restored. Matching on the proxy's own address is the difference
 *     between "only my machine" and "every machine, or none, depending on which
 *     Cloudflare datacentre answered".
 *
 * Behaviour is covered by apps/backend/__tests__/unit/prelaunch-access-gate.test.js.
 */

const fs = require('fs');
const path = require('path');

const CONF_PATH = path.resolve(__dirname, '..', '..', 'deploy', 'nginx', 'gacp-platform.conf');

// ---- address arithmetic -------------------------------------------------

/**
 * Parse an address into a family-tagged integer.
 *
 * Returns null for anything that is not unambiguously one address. Guessing is
 * how a typo becomes an allowlist entry.
 */
function parseIp(text) {
    const value = String(text || '').trim();
    if (!value) return null;

    if (value.includes(':')) return parseIpv6(value);
    if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) return parseIpv4(value);
    return null;
}

function parseIpv4(value) {
    const octets = value.split('.');
    if (octets.length !== 4) return null;

    let bits = 0n;
    for (const octet of octets) {
        const n = Number(octet);
        if (!Number.isInteger(n) || n < 0 || n > 255) return null;
        bits = (bits << 8n) | BigInt(n);
    }
    return { family: 4, bits, width: 32 };
}

function parseIpv6(value) {
    // No IPv4-mapped forms here on purpose: the config has no use for them, and
    // accepting them would mean deciding whether ::ffff:198.51.100.30 is the
    // same host as 198.51.100.30 — a question with no safe default.
    if (value.includes('.')) return null;

    const halves = value.split('::');
    if (halves.length > 2) return null;

    const head = halves[0] ? halves[0].split(':') : [];
    const tail = halves.length === 2 && halves[1] ? halves[1].split(':') : [];

    let groups;
    if (halves.length === 2) {
        const gap = 8 - head.length - tail.length;
        if (gap < 1) return null;
        groups = [...head, ...Array(gap).fill('0'), ...tail];
    } else {
        groups = head;
    }
    if (groups.length !== 8) return null;

    let bits = 0n;
    for (const group of groups) {
        if (!/^[0-9a-fA-F]{1,4}$/.test(group)) return null;
        bits = (bits << 16n) | BigInt(parseInt(group, 16));
    }
    return { family: 6, bits, width: 128 };
}

/** Parse `1.2.3.0/24` or a bare address (treated as a host route). */
function parseCidr(text) {
    const [addressPart, prefixPart] = String(text || '').split('/');
    const address = parseIp(addressPart);
    if (!address) return null;

    const prefix = prefixPart === undefined ? address.width : Number(prefixPart);
    if (!Number.isInteger(prefix) || prefix < 0 || prefix > address.width) return null;

    return { ...address, prefix };
}

function withinPrefix(address, cidr) {
    if (address.family !== cidr.family) return false;
    if (cidr.prefix === 0) return true;
    const shift = BigInt(cidr.width - cidr.prefix);
    return (address.bits >> shift) === (cidr.bits >> shift);
}

// ---- config reading -----------------------------------------------------

/**
 * Pull the first `geo` block out of an nginx config.
 *
 * Longest-prefix wins, as nginx does — an entry for a /32 inside an allowed
 * /64 has to be able to override it, or the list cannot express an exception.
 */
function parseGeoBlock(text) {
    const opener = /geo\s+(\$\w+)\s+(\$\w+)\s*\{/.exec(text);
    if (!opener) return null;

    const bodyStart = opener.index + opener[0].length;
    const bodyEnd = text.indexOf('}', bodyStart);
    if (bodyEnd === -1) return null;

    const entries = [];
    let defaultValue = null;

    for (const rawLine of text.slice(bodyStart, bodyEnd).split('\n')) {
        const line = rawLine.replace(/#.*$/, '').trim().replace(/;$/, '').trim();
        if (!line) continue;

        const [key, value] = line.split(/\s+/);
        if (key === 'default') {
            defaultValue = value;
            continue;
        }
        const cidr = parseCidr(key);
        if (!cidr) continue;
        entries.push({ cidr, value, source: key });
    }

    return {
        variable: opener[1],
        result: opener[2],
        defaultValue,
        entries,
    };
}

/** Evaluate the geo block for one address the way nginx would. */
function lookup(geo, addressText) {
    const address = parseIp(addressText);
    if (!geo || !address) return geo ? geo.defaultValue : null;

    let best = null;
    for (const entry of geo.entries) {
        if (!withinPrefix(address, entry.cidr)) continue;
        if (!best || entry.cidr.prefix > best.cidr.prefix) best = entry;
    }
    return best ? best.value : geo.defaultValue;
}

/**
 * The geo variable holds the *deny* flag: 1 means blocked. An address is
 * allowed only by an explicit entry saying so.
 */
function isAllowed(geo, addressText) {
    return lookup(geo, addressText) === '0';
}

/** Regex keys of the map that lets a path through the gate regardless of address. */
function parseExemptPatterns(text) {
    const opener = /map\s+\$request_uri\s+\$gacp_prelaunch_exempt\s*\{/.exec(text);
    if (!opener) return [];

    const bodyStart = opener.index + opener[0].length;
    const bodyEnd = text.indexOf('}', bodyStart);
    if (bodyEnd === -1) return [];

    return text
        .slice(bodyStart, bodyEnd)
        .split('\n')
        .map((line) => line.replace(/#.*$/, '').trim())
        .filter((line) => line.startsWith('~'))
        .map((line) => line.split(/\s+/)[0]);
}

function readGateConfig(text) {
    return {
        geo: parseGeoBlock(text),
        exemptPatterns: parseExemptPatterns(text),
    };
}

// ---- server_name conflicts ----------------------------------------------

/**
 * Names claimed by more than one server block on the same port.
 *
 * nginx does not treat this as an error. It warns — `conflicting server name
 * "x" on 0.0.0.0:443, ignored` — and then serves whichever block it parsed
 * first, which is decided by filename order inside the include glob. So the
 * site's behaviour can change because a file was renamed, and the only warning
 * appears in the output of a command nobody runs after a deploy.
 *
 * Takes `{ name, text }` pairs rather than reading the disk so the caller
 * decides what counts as installed — on a server that is the expanded include
 * globs, which is where the duplicate usually is.
 */
function findDuplicateServerNames(files) {
    const claims = new Map();

    for (const file of files) {
        for (const block of String(file.text || '').split(/^server \{/m).slice(1)) {
            const body = block.slice(0, block.indexOf('\n}'));

            const ports = new Set();
            for (const match of body.matchAll(/^\s*listen\s+([^;]+);/gm)) {
                // `listen 443 ssl`, `listen [::]:443 ssl`, `listen 0.0.0.0:80`.
                // The address half is irrelevant here: two blocks on the same
                // port collide whether or not they name the same interface.
                const port = /(\d+)\s*(?:$|\s)/.exec(match[1].replace(/\[[^\]]*\]:?/, ''));
                if (port) ports.add(port[1]);
            }

            const names = new Set();
            for (const match of body.matchAll(/^\s*server_name\s+([^;]+);/gm)) {
                for (const name of match[1].trim().split(/\s+/)) names.add(name);
            }

            for (const port of ports) {
                for (const name of names) {
                    const key = `${name} ${port}`;
                    if (!claims.has(key)) claims.set(key, { serverName: name, port, sources: [] });
                    claims.get(key).sources.push(file.name);
                }
            }
        }
    }

    return [...claims.values()].filter((claim) => claim.sources.length > 1);
}

// ---- the gate -----------------------------------------------------------

function checkGate(text) {
    const findings = [];
    const { geo, exemptPatterns } = readGateConfig(text);

    if (!geo) {
        findings.push('no `geo` block found — the pre-launch allowlist is missing entirely');
        return findings;
    }

    if (geo.variable !== '$remote_addr') {
        findings.push(
            `the allowlist matches on ${geo.variable}. It must match on $remote_addr, which `
            + 'carries the visitor after CF-Connecting-IP is restored; anything else matches '
            + "Cloudflare's own address and is the same for every visitor on earth",
        );
    }

    if (geo.defaultValue !== '1') {
        findings.push(
            `the allowlist defaults to "${geo.defaultValue}". It must default to 1 (deny), so that `
            + 'a mistake locks people out rather than opening the platform',
        );
    }

    if (geo.entries.length === 0) {
        findings.push('the allowlist is empty — nobody, including the operator, can reach the site');
    }

    const realIpAt = text.indexOf('real_ip_header');
    const geoAt = text.indexOf('geo $remote_addr');
    if (realIpAt === -1) {
        findings.push('real_ip_header is absent — $remote_addr would be a Cloudflare edge address');
    } else if (geoAt !== -1 && realIpAt > geoAt) {
        findings.push('real_ip_header is declared after the allowlist; restore the visitor address first');
    }

    for (const required of ['__access-check', 'acme-challenge']) {
        if (!exemptPatterns.some((pattern) => pattern.includes(required))) {
            findings.push(`${required} is not exempt from the gate`);
        }
    }

    const publicBlocks = text
        .split(/^server \{/m)
        .slice(1)
        .filter((block) => /listen\s+(\[::\]:)?(80|443)/.test(block));
    for (const [index, block] of publicBlocks.entries()) {
        if (!/if \(\$gacp_prelaunch_deny\)/.test(block)) {
            const name = (/server_name\s+([^;]+);/.exec(block) || [])[1] || `#${index + 1}`;
            findings.push(`server block ${name.trim()} listens publicly but does not apply the gate`);
        }
    }

    return findings;
}

module.exports = {
    parseIp,
    parseCidr,
    parseGeoBlock,
    parseExemptPatterns,
    findDuplicateServerNames,
    readGateConfig,
    lookup,
    isAllowed,
    checkGate,
};

if (require.main === module) {
    const conf = fs.readFileSync(CONF_PATH, 'utf8');
    const findings = checkGate(conf);

    if (findings.length === 0) {
        const { geo } = readGateConfig(conf);
        console.log('Pre-launch access gate: deny by default, matching on $remote_addr.');
        for (const entry of geo.entries) console.log(`  allow ${entry.source}`);
        process.exit(0);
    }

    console.error('Pre-launch access gate is not safe:\n');
    for (const finding of findings) console.error(`  - ${finding}`);
    process.exit(1);
}
