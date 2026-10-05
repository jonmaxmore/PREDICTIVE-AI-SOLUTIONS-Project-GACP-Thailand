/**
 * autosave-lost-reply (staging walk 2026-10-02): a 2xx whose body cannot be read is a LOST
 * REPLY, not a server refusal. The server answered "OK" and then the body never arrived (a
 * mobile connection dropping after the headers), so whatever the request did has probably
 * happened. api-client used to fold it into the same `{ success:false, error:'Invalid server
 * response' }` as nothing in particular, and the autosave painted it red as a server failure.
 *
 * The fix is ADDITIVE: `transportFailure` names the three no-usable-reply cases. `error`,
 * `code`, `status` and `errorCode` keep exactly their old values, so no existing caller
 * that reads them changes behaviour.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import { ApiClient } from '../api-client';

const realFetch = globalThis.fetch;
type FetchMock = jest.Mock<(...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>>;

function response(status: number, opts: { contentType?: string; json?: () => Promise<unknown>; text?: () => Promise<string> }): Response {
    return {
        ok: status >= 200 && status < 300,
        status,
        headers: { get: (name: string) => (name.toLowerCase() === 'content-type' ? (opts.contentType ?? 'application/json') : null) },
        json: opts.json ?? (() => Promise.resolve({})),
        text: opts.text ?? (() => Promise.resolve('')),
    } as unknown as Response;
}

describe('api-client: a reply that never arrived is named, additively', () => {
    let client: ApiClient;
    let fetchMock: FetchMock;

    beforeEach(() => {
        client = new ApiClient();
        fetchMock = jest.fn() as FetchMock;
        (globalThis as { fetch: typeof fetch }).fetch = fetchMock as unknown as typeof fetch;
    });
    afterEach(() => {
        (globalThis as { fetch: typeof fetch }).fetch = realFetch;
    });

    it('200 whose JSON body is cut off: UNREADABLE_REPLY, with the old error text and no status/code', async () => {
        fetchMock.mockResolvedValueOnce(response(200, { json: () => Promise.reject(new TypeError('network error')) }));
        const res = await client.post('/applications/draft', { a: 1 });
        expect(res).toEqual({ success: false, error: 'Invalid server response', transportFailure: 'UNREADABLE_REPLY' });
    });

    it('200 that is not JSON at all (an HTML page in its place): UNREADABLE_REPLY', async () => {
        fetchMock.mockResolvedValueOnce(response(200, { contentType: 'text/html', text: () => Promise.resolve('<html></html>') }));
        const res = await client.post('/applications/draft', { a: 1 });
        expect(res).toEqual({ success: false, error: 'Invalid server response', transportFailure: 'UNREADABLE_REPLY' });
    });

    it('a dropped connection: NETWORK, same error text as before', async () => {
        fetchMock.mockRejectedValueOnce(new TypeError('Failed to fetch'));
        const res = await client.post('/applications/draft', { a: 1 });
        expect(res).toEqual({ success: false, error: 'Unable to connect to server', transportFailure: 'NETWORK' });
    });

    it('a timeout: TIMEOUT, same error text as before', async () => {
        const abort = new Error('aborted');
        abort.name = 'AbortError';
        fetchMock.mockRejectedValueOnce(abort);
        const res = await client.post('/applications/draft', { a: 1 });
        expect(res).toEqual({ success: false, error: 'Request timeout. Please try again', transportFailure: 'TIMEOUT' });
    });

    it.each([400, 409, 500, 503])('an HTTP %s carries no transportFailure (the server did answer)', async (status) => {
        fetchMock.mockResolvedValueOnce(response(status, { json: () => Promise.resolve({ success: false, error: 'x', code: 'X' }) }));
        const res = await client.post('/applications/draft', { a: 1 });
        expect(res.success).toBe(false);
        expect(res.status).toBe(status);
        expect('transportFailure' in res).toBe(false);
    });

    it('a readable 200 is unchanged', async () => {
        fetchMock.mockResolvedValueOnce(response(200, { json: () => Promise.resolve({ success: true, data: { id: 'a' } }) }));
        const res = await client.post('/applications/draft', { a: 1 });
        expect(res).toEqual({ success: true, data: { id: 'a' } });
    });
});
