/**
 * checkout-service.test.ts — W2-03 D1: createCheckout() live/mock switch.
 *
 * Contract locked here (dispatch D1 spec, backend contract confirmed by
 * spec-reader):
 *
 *   live mode (default — getCheckoutApiMode() !== 'mock'):
 *     - POSTs '/payments/checkout' with EXACTLY { applicationId, milestone }
 *       (the api client auto-prefixes '/api' itself — no extra fields, ever)
 *     - returns the api client's envelope verbatim, no reshaping
 *     - `mockScenario` is IGNORED — a leaked mock knob must never divert a
 *       real payment call into fixture land
 *
 *   mock mode (NEXT_PUBLIC_CHECKOUT_API_MODE='mock'):
 *     - never touches the network (api.post not called)
 *     - resolves the fixture for the requested scenario after ~300ms so the
 *       loading state is actually visible in the UI
 *     - unknown / missing scenario → HAPPY (fail-safe to the boring path)
 *
 * Fixture values themselves (M1: 5500/385/5885/5885 THB) are pinned here
 * against the confirmed backend contract so a drive-by edit to the fixtures
 * file fails loudly.
 *
 * `api` is mocked per repo convention — see
 * __tests__/admin-service-b28-endpoint-urls.test.ts.
 */
import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';

import { api } from '@/lib/api/api-client';
import {
    CONFLICT_409,
    HAPPY,
    HAPPY_NON_SUMMING,
    SERVER_ERROR_500,
    TIMEOUT,
} from '../__fixtures__/checkout-fixtures';
import { createCheckout } from '../checkout-service';

jest.mock('@/lib/api/api-client', () => ({
    api: {
        post: jest.fn(),
    },
}));

const mockedPost = api.post as jest.MockedFunction<typeof api.post>;

const ORIGINAL_API_MODE = process.env.NEXT_PUBLIC_CHECKOUT_API_MODE;

afterEach(() => {
    if (ORIGINAL_API_MODE === undefined) {
        delete process.env.NEXT_PUBLIC_CHECKOUT_API_MODE;
    } else {
        process.env.NEXT_PUBLIC_CHECKOUT_API_MODE = ORIGINAL_API_MODE;
    }
    jest.useRealTimers();
});

beforeEach(() => {
    mockedPost.mockReset();
    mockedPost.mockResolvedValue({ success: true, data: undefined });
});

describe('createCheckout — live mode', () => {
    beforeEach(() => {
        delete process.env.NEXT_PUBLIC_CHECKOUT_API_MODE;
    });

    it('POSTs /payments/checkout with exactly { applicationId, milestone }', async () => {
        await createCheckout({ applicationId: 'app-1', milestone: 'M1' });
        expect(mockedPost).toHaveBeenCalledTimes(1);
        expect(mockedPost).toHaveBeenCalledWith('/payments/checkout', {
            applicationId: 'app-1',
            milestone: 'M1',
        });
        // toEqual is exact-keys — an extra field in the body fails this.
        expect(mockedPost.mock.calls[0][1]).toEqual({
            applicationId: 'app-1',
            milestone: 'M1',
        });
    });

    it("returns the api client's envelope verbatim", async () => {
        const envelope = {
            success: false as const,
            error: 'CHECKOUT_MILESTONE_NOT_PAYABLE',
            status: 409,
            code: 'CHECKOUT_MILESTONE_NOT_PAYABLE',
        };
        mockedPost.mockResolvedValue(envelope);
        const result = await createCheckout({ applicationId: 'app-1', milestone: 'M2' });
        expect(result).toBe(envelope);
    });

    it('ignores mockScenario entirely — still calls the real endpoint', async () => {
        const liveEnvelope = { success: true as const, data: { checkoutOrderId: 'co_live_1' } };
        mockedPost.mockResolvedValue(liveEnvelope);
        const result = await createCheckout({
            applicationId: 'app-1',
            milestone: 'M1',
            mockScenario: 'conflict',
        });
        expect(mockedPost).toHaveBeenCalledTimes(1);
        expect(result).toBe(liveEnvelope);
        expect(result).not.toBe(CONFLICT_409);
    });

    it("treats a typo'd mode env value as live (fail-safe)", async () => {
        process.env.NEXT_PUBLIC_CHECKOUT_API_MODE = 'Mock';
        await createCheckout({ applicationId: 'app-1', milestone: 'M1' });
        expect(mockedPost).toHaveBeenCalledTimes(1);
    });
});

describe('createCheckout — mock mode', () => {
    beforeEach(() => {
        process.env.NEXT_PUBLIC_CHECKOUT_API_MODE = 'mock';
        jest.useFakeTimers();
    });

    async function resolveAfterMockLatency<T>(promise: Promise<T>): Promise<T> {
        await jest.advanceTimersByTimeAsync(300);
        return promise;
    }

    it('never calls the network and resolves HAPPY when no scenario is given', async () => {
        const result = await resolveAfterMockLatency(
            createCheckout({ applicationId: 'app-1', milestone: 'M1' }),
        );
        expect(mockedPost).not.toHaveBeenCalled();
        expect(result).toBe(HAPPY);
    });

    it('resolves HAPPY for an unknown scenario value', async () => {
        const result = await resolveAfterMockLatency(
            createCheckout({ applicationId: 'app-1', milestone: 'M1', mockScenario: 'nonsense' }),
        );
        expect(result).toBe(HAPPY);
    });

    it("resolves CONFLICT_409 for 'conflict'", async () => {
        const result = await resolveAfterMockLatency(
            createCheckout({ applicationId: 'app-1', milestone: 'M1', mockScenario: 'conflict' }),
        );
        expect(mockedPost).not.toHaveBeenCalled();
        expect(result).toBe(CONFLICT_409);
    });

    it("resolves SERVER_ERROR_500 for 'server-error'", async () => {
        const result = await resolveAfterMockLatency(
            createCheckout({ applicationId: 'app-1', milestone: 'M1', mockScenario: 'server-error' }),
        );
        expect(result).toBe(SERVER_ERROR_500);
    });

    it("resolves (not hangs, not rejects) TIMEOUT for 'timeout'", async () => {
        const result = await resolveAfterMockLatency(
            createCheckout({ applicationId: 'app-1', milestone: 'M1', mockScenario: 'timeout' }),
        );
        expect(result).toBe(TIMEOUT);
    });

    it('holds the promise for ~300ms so the loading state is visible', async () => {
        let settled = false;
        const promise = createCheckout({ applicationId: 'app-1', milestone: 'M1' }).then((r) => {
            settled = true;
            return r;
        });
        // Not yet — 299ms in, the UI must still be showing its spinner.
        await jest.advanceTimersByTimeAsync(299);
        expect(settled).toBe(false);
        await jest.advanceTimersByTimeAsync(1);
        await promise;
        expect(settled).toBe(true);
    });
});

describe('checkout fixtures — pinned to the confirmed backend contract', () => {
    it('HAPPY carries the full M1 success shape (5500/385/5885/5885 THB — one fee, no DTAM figure)', () => {
        expect(HAPPY).toEqual({
            success: true,
            data: {
                checkoutOrderId: 'co_mock_1',
                paymentIntentId: 'pi_mock_1',
                clientSecret: 'pi_mock_1_secret_mock',
                milestone: 'M1',
                breakdown: {
                    platformFeeNet: 5500,
                    platformFeeVat: 385,
                    platformFeeGross: 5885,
                    totalPayableAmount: 5885,
                },
            },
        });
    });

    it('HAPPY sums: platformFeeGross === totalPayableAmount', () => {
        const b = HAPPY.data!.breakdown;
        expect(b.platformFeeGross).toBe(b.totalPayableAmount);
        expect(b.platformFeeNet + b.platformFeeVat).toBe(b.platformFeeGross);
    });

    it('HAPPY_NON_SUMMING deliberately does NOT sum — it exists to prove the UI renders the response instead of computing money', () => {
        const b = HAPPY_NON_SUMMING.data!.breakdown;
        // If someone "fixes" the fixture so it sums again, the D2 render test
        // it powers can no longer distinguish "renders response" from
        // "recomputes locally" — fail here first, loudly.
        expect(b.platformFeeGross).not.toBe(b.totalPayableAmount);
        expect(b.totalPayableAmount).toBe(9999);
    });

    it('CONFLICT_409 matches the FE-visible error envelope', () => {
        expect(CONFLICT_409).toEqual({
            success: false,
            error: 'CHECKOUT_ALREADY_IN_PROGRESS',
            status: 409,
            code: 'CHECKOUT_ALREADY_IN_PROGRESS',
        });
    });

    it('SERVER_ERROR_500 matches the catch-all failure envelope', () => {
        expect(SERVER_ERROR_500).toEqual({
            success: false,
            error: 'CHECKOUT_FAILED',
            status: 500,
        });
    });

    it('TIMEOUT matches the api-client timeout envelope — no status, no code', () => {
        expect(TIMEOUT).toEqual({
            success: false,
            error: 'Request timeout. Please try again',
        });
        expect(TIMEOUT).not.toHaveProperty('status');
        expect(TIMEOUT).not.toHaveProperty('code');
    });
});
