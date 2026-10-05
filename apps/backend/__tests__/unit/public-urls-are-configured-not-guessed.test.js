/**
 * The platform's own public addresses live in ONE place, and production may not
 * guess them.
 *
 * Operator, 2026-09-05: "เราใช้ hardcode ให้น้อยที่สุดถึงไม่ใช้เลย."
 *
 * ── WHAT WAS SPREAD AROUND ────────────────────────────────────────────────────
 * Six env names for two ideas, and the production domain typed as a fallback in
 * five services:
 *
 *   invoice-template-service.js:1212  process.env.APP_PUBLIC_URL || process.env.STAGING_PUBLIC_URL || 'https://gacpth.com'
 *   pdpa-erasure-service.js:323       process.env.APP_URL        || 'https://gacpth.com'
 *   farm-service.js:357               process.env.PUBLIC_APP_URL || 'https://gacpth.com'
 *   lot-label-template-service.js:45  process.env.PUBLIC_TRACE_URL || process.env.TRACE_BASE_URL || 'https://gacpth.com/trace'
 *   lot-label-template-service.js:130 (the same expression again)
 *
 * trace-service/common.js already got this right and says why in its own words:
 * "production must provide TRACE_BASE_URL explicitly. Falling back to a hardcoded
 * 'https://gacpth.com' silently sends staging-issued QR codes to the production
 * verify domain." The other five had no such guard — so a staging deploy that
 * forgot one variable printed production URLs onto invoices, QR stickers, farm
 * verification links and PDPA erasure notices, and nothing said a word.
 *
 * ── WHAT THIS MODULE IS FOR ───────────────────────────────────────────────────
 * One accessor per address, one env-name list per address, and the same rule
 * everywhere: in production an unset address is a REFUSAL, never a guess. The
 * development fallback exists once, in one file, labelled as such.
 */

'use strict';

const ENV_KEYS = [
    'APP_PUBLIC_URL', 'STAGING_PUBLIC_URL', 'APP_URL', 'PUBLIC_APP_URL',
    'PUBLIC_TRACE_URL', 'TRACE_BASE_URL', 'CERT_VERIFY_BASE_URL', 'NODE_ENV',
];
const saved = {};

beforeEach(() => {
    ENV_KEYS.forEach((k) => { saved[k] = process.env[k]; delete process.env[k]; });
    jest.resetModules();
});
afterEach(() => {
    ENV_KEYS.forEach((k) => {
        if (saved[k] === undefined) { delete process.env[k]; } else { process.env[k] = saved[k]; }
    });
    jest.resetModules();
});

const load = () => require('../../config/public-urls');

describe('production never guesses its own address', () => {
    test.each([
        ['appBaseUrl'],
        ['traceBaseUrl'],
        ['verifyBaseUrl'],
    ])('%s refuses when nothing is configured in production', (fn) => {
        process.env.NODE_ENV = 'production';
        expect(() => load()[fn]()).toThrow(expect.objectContaining({ code: 'PUBLIC_URL_NOT_CONFIGURED' }));
    });

    test('the refusal names the variable an operator has to set', () => {
        process.env.NODE_ENV = 'production';
        let err;
        try { load().traceBaseUrl(); } catch (e) { err = e; }
        expect(err.message).toContain('TRACE_BASE_URL');
    });
});

describe('outside production it falls back once, in one place', () => {
    test('the fallback is usable', () => {
        process.env.NODE_ENV = 'test';
        expect(load().appBaseUrl()).toMatch(/^https?:\/\//);
    });

    test('every service reads the SAME fallback — not its own copy', () => {
        const fs = require('fs');
        const path = require('path');
        const dir = path.join(__dirname, '..', '..');
        const offenders = [];
        for (const rel of [
            'services/pdf/invoice-template-service.js',
            'services/pdpa-erasure-service.js',
            'services/farm-service.js',
            'services/pdf/lot-label-template-service.js',
            'services/trace-service/common.js',
            'services/certificate-verify-url.js',
        ]) {
            const src = fs.readFileSync(path.join(dir, rel), 'utf8')
                .split('\n')
                .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))   // declarations, not mentions
                .join('\n');
            if (/['"`]https:\/\/(www\.)?gacpth\.com/.test(src)) { offenders.push(rel); }
        }
        expect(offenders).toEqual([]);
    });
});

describe('a configured address wins, and is normalised', () => {
    test.each([
        ['APP_PUBLIC_URL', 'appBaseUrl'],
        ['TRACE_BASE_URL', 'traceBaseUrl'],
        ['CERT_VERIFY_BASE_URL', 'verifyBaseUrl'],
    ])('%s is used by %s', (envKey, fn) => {
        process.env.NODE_ENV = 'production';
        process.env[envKey] = 'https://staging.gacpth.com';
        expect(load()[fn]()).toBe('https://staging.gacpth.com');
    });

    test('a trailing slash never doubles up in a built URL', () => {
        process.env.NODE_ENV = 'production';
        process.env.APP_PUBLIC_URL = 'https://staging.gacpth.com/';
        expect(load().appBaseUrl()).toBe('https://staging.gacpth.com');
    });

    test('the older env names still work — a deploy is not broken by this refactor', () => {
        process.env.NODE_ENV = 'production';
        process.env.APP_URL = 'https://staging.gacpth.com';
        expect(load().appBaseUrl()).toBe('https://staging.gacpth.com');
    });

    test('a value that is not a URL is refused rather than pasted into a QR code', () => {
        process.env.NODE_ENV = 'production';
        process.env.TRACE_BASE_URL = 'not a url';
        expect(() => load().traceBaseUrl()).toThrow(expect.objectContaining({ code: 'PUBLIC_URL_INVALID' }));
    });
});

describe('the module is the only place process.env is read for these', () => {
    test('it exposes the env names it honours, so a runbook can be generated from it', () => {
        const { PUBLIC_URL_ENV_KEYS } = load();
        expect(PUBLIC_URL_ENV_KEYS.trace).toContain('TRACE_BASE_URL');
        expect(PUBLIC_URL_ENV_KEYS.app).toContain('APP_PUBLIC_URL');
    });
});
