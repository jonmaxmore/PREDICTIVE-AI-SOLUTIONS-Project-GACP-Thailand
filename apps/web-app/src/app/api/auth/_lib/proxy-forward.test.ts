/**
 * @jest-environment node
 *
 * proxy-forward.test.ts — R2 (remove workspace mode): the retired
 * `x-active-entity-id` header is not forwarded by the shared header builder.
 */
import { NextRequest } from 'next/server';
import { buildForwardHeaders } from './proxy-forward';

describe('buildForwardHeaders — retired active-entity header', () => {
    it('the proxy does not forward x-active-entity-id', () => {
        const request = new NextRequest('http://localhost:3000/api/auth/health/me', {
            method: 'GET',
            headers: { 'x-active-entity-id': 'ent-community-456' },
        });

        const headers = buildForwardHeaders(request, { cookieName: 'auth_token' });

        expect(headers['x-active-entity-id']).toBeUndefined();
    });
});
