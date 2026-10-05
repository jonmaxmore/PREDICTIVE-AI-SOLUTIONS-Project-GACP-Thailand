/**
 * @jest-environment node
 *
 * proxy-forward.test.ts — buildForwardHeaders active-entity forwarding.
 *
 * reports/design-cleanup-2026-08-21/01-IDENTITY-AND-VOCABULARY.md B1: the
 * web app's api-client sends `x-active-entity-id` so the backend's
 * active-entity middleware can scope a request to the workspace the user
 * picked. This shared header builder (used by BOTH
 * src/app/api/auth/health/[...path]/route.ts and
 * src/app/api/auth/provider/[...path]/route.ts) forwarded Content-Type,
 * Cookie, Authorization, x-csrf-token, X-Forwarded-For, X-Real-IP,
 * Forwarded, User-Agent, and X-Request-ID — but never x-active-entity-id,
 * so a health user acting through these auth-proxied routes always ran as
 * their default (personal) entity regardless of the workspace they picked.
 */
import { NextRequest } from 'next/server';
import { buildForwardHeaders } from './proxy-forward';

describe('buildForwardHeaders — active-entity header forwarding (B1)', () => {
    it('forwards x-active-entity-id unchanged when the caller sent it', () => {
        const request = new NextRequest('http://localhost:3000/api/auth/health/me', {
            method: 'GET',
            headers: { 'x-active-entity-id': 'ent-community-456' },
        });

        const headers = buildForwardHeaders(request, { cookieName: 'auth_token' });

        expect(headers['x-active-entity-id']).toBe('ent-community-456');
    });

    it('does not invent the header when the caller sent none', () => {
        const request = new NextRequest('http://localhost:3000/api/auth/health/me', { method: 'GET' });

        const headers = buildForwardHeaders(request, { cookieName: 'auth_token' });

        expect(headers['x-active-entity-id']).toBeUndefined();
    });
});
