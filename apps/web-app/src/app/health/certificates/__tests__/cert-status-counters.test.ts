/**
 * Cert summary counters — case-insensitive status (walkthrough 2026-07-10).
 *
 * Live defect seen in a real-browser walkthrough on staging: the stats row on
 * /health/certificates read 0 ใช้งานได้ / 0 ใกล้หมดอายุ / 0 หมดอายุ while ONE
 * active certificate card (badge ใช้งานได้, 1,064 days left) rendered directly
 * below. Root cause: the backend stores/returns Certificate.status LOWERCASE
 * ('active' — schema default; the route even ships a lowercased
 * canonicalStatus), but the counters compared strictly against 'ACTIVE', so
 * every active cert fell out of all three buckets. The card's badge helper
 * doesn't check 'ACTIVE' at all (falls through on days-left), which is why the
 * card and the counters contradicted each other on screen.
 */

import { describe, expect, it } from '@jest/globals';
import { getCertBadgeKind, getCertCounters, getDaysRemaining } from '../cert-status';

const daysFromNow = (d: number) => new Date(Date.now() + d * 24 * 60 * 60 * 1000).toISOString();

describe('getCertCounters', () => {
    it('counts a LOWERCASE "active" cert with >90 days left as active (live prod shape)', () => {
        const { activeCount, expiringCount, expiredCount } = getCertCounters([
            { status: 'active', expiryDate: daysFromNow(1064) },
        ]);
        expect(activeCount).toBe(1);
        expect(expiringCount).toBe(0);
        expect(expiredCount).toBe(0);
    });

    it('counts UPPERCASE "ACTIVE" the same way (case-insensitive)', () => {
        expect(getCertCounters([{ status: 'ACTIVE', expiryDate: daysFromNow(200) }]).activeCount).toBe(1);
    });

    it('active cert with <90 days left counts as expiring, either casing', () => {
        const certs = [
            { status: 'active', expiryDate: daysFromNow(30) },
            { status: 'ACTIVE', expiryDate: daysFromNow(45) },
        ];
        const { activeCount, expiringCount } = getCertCounters(certs);
        expect(activeCount).toBe(0);
        expect(expiringCount).toBe(2);
    });

    it('lowercase "expired" and past-expiry both count as expired', () => {
        const { expiredCount } = getCertCounters([
            { status: 'expired', expiryDate: daysFromNow(400) },
            { status: 'active', expiryDate: daysFromNow(-1) },
        ]);
        expect(expiredCount).toBe(2);
    });

    it('every cert lands in exactly one bucket (no cert vanishes from the summary)', () => {
        const certs = [
            { status: 'active', expiryDate: daysFromNow(1064) },
            { status: 'ACTIVE', expiryDate: daysFromNow(10) },
            { status: 'EXPIRED', expiryDate: daysFromNow(500) },
            { status: 'revoked', expiryDate: daysFromNow(-5) },
        ];
        const { activeCount, expiringCount, expiredCount } = getCertCounters(certs);
        expect(activeCount + expiringCount + expiredCount).toBe(certs.length);
    });
});

describe('getCertBadgeKind (card badge must agree with the counters)', () => {
    it('REVOKED cert with a FUTURE expiry is NOT active/green (triad follow-up)', () => {
        // A revoked cert keeps its future expiryDate; the old fallthrough painted
        // it green "ใช้งานได้". It must read as expired/invalid.
        expect(getCertBadgeKind('revoked', 1000)).toBe('expired');
        expect(getCertBadgeKind('REVOKED', 1000)).toBe('expired');
    });

    it('active cert: green when >90 days, amber when <90, expired when past', () => {
        expect(getCertBadgeKind('active', 200)).toBe('active');
        expect(getCertBadgeKind('ACTIVE', 30)).toBe('expiring');
        expect(getCertBadgeKind('active', -1)).toBe('expired');
    });

    it('unknown/empty status is never green', () => {
        expect(getCertBadgeKind('', 500)).toBe('expired');
        expect(getCertBadgeKind('SUSPENDED', 500)).toBe('expired');
    });

    it('badge kind and counter bucket agree for the same cert (no contradiction)', () => {
        const certs = [
            { status: 'active', expiryDate: daysFromNow(1000) },
            { status: 'active', expiryDate: daysFromNow(30) },
            { status: 'revoked', expiryDate: daysFromNow(1000) },
            { status: 'expired', expiryDate: daysFromNow(-1) },
        ];
        const counters = getCertCounters(certs);
        const kinds = certs.map(c => getCertBadgeKind(c.status, getDaysRemaining(c.expiryDate)));
        expect(kinds.filter(k => k === 'active').length).toBe(counters.activeCount);
        expect(kinds.filter(k => k === 'expiring').length).toBe(counters.expiringCount);
        expect(kinds.filter(k => k === 'expired').length).toBe(counters.expiredCount);
    });
});
