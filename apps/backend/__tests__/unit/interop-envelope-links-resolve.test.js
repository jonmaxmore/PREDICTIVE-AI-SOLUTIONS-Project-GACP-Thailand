'use strict';

/**
 * Every URL a partner receives inside a signed e-certificate / envelope / trust
 * record must resolve to a route that is really mounted. Walks the express
 * router's registered paths, so a future deleted door fails here instead of
 * handing partners a 404 link (round 4: links.verify pointed at a door deleted
 * in round 3).
 */

const express = require('express');

process.env.INTEROP_PARTNER_API_KEYS = JSON.stringify({ 'test-partner': 'valid-partner-key' });

jest.mock('../../middleware/auth-middleware', () => ({
    authenticateProvider: (req, _res, next) => next(),
}));
jest.mock('../../services/prisma-database', () => ({
    prisma: {
        certificate: { findFirst: jest.fn(), findMany: jest.fn(), update: jest.fn() },
        plantingCycle: { findFirst: jest.fn() },
        harvestBatch: { findFirst: jest.fn() },
        lot: { findFirst: jest.fn() },
        traceQrSecurity: { findFirst: jest.fn() },
    },
}));
jest.mock('../../services/crypto/signature-service', () => ({
    getSignatureService: jest.fn(() => ({
        sign: jest.fn().mockResolvedValue('mock-signature'),
        verify: jest.fn().mockResolvedValue(true),
        getPublicKey: jest.fn().mockResolvedValue('mock-public-key'),
    })),
}));
jest.mock('../../shared/logger', () => ({ error: jest.fn(), warn: jest.fn(), info: jest.fn() }));

const core = require('../../routes/api/interoperability/interoperability-core');
const router = require('../../routes/api/integration/interoperability');

const MOUNT = '/api/interoperability';
const BASE = 'https://gacpth.com';
const CERT = {
    id: 'cert-1',
    certificateNumber: 'GACP-TH-2569-A3F7B2',
    status: 'ACTIVE',
    issuedDate: new Date('2026-01-01'),
    expiryDate: new Date('2027-01-01'),
    farmName: 'ฟาร์ม',
    applicantName: 'สมชาย',
    cropType: 'ขมิ้นชัน',
    userId: 'user-1',
};

function mountedPatterns() {
    return router.stack
        .filter((l) => l.route)
        .flatMap((l) => {
            const methods = Object.keys(l.route.methods);
            return methods.includes('get')
                ? [new RegExp(`^${MOUNT}${l.route.path.replace(/:[^/]+/g, '[^/]+')}$`)]
                : [];
        });
}

function collectLinks(obj, out = []) {
    if (obj && typeof obj === 'object') {
        for (const [k, v] of Object.entries(obj)) {
            if (k === 'links' && v && typeof v === 'object') {
                Object.values(v).forEach((u) => typeof u === 'string' && out.push(u));
            } else collectLinks(v, out);
        }
    }
    return out;
}

describe('interoperability payload links resolve to mounted GET routes', () => {
    const patterns = mountedPatterns();
    const payloads = {
        envelope: () => core.buildCertificateEnvelope(CERT, BASE),
        trustRecord: () => core.buildTrustRecord(CERT),
    };

    test('router exposes GET routes (walker sanity)', () => {
        expect(patterns.length).toBeGreaterThan(3);
    });

    for (const [name, build] of Object.entries(payloads)) {
        test(`${name}: every link is a mounted route`, () => {
            const links = collectLinks(build());
            expect(links.length).toBeGreaterThan(0);
            for (const url of links) {
                const path = url.replace(BASE, '').split('?')[0];
                expect({ url, mounted: patterns.some((re) => re.test(path)) }).toEqual({
                    url,
                    mounted: true,
                });
            }
        });
    }
});
