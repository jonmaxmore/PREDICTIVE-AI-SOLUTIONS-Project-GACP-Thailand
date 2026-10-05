/**
 * ============================================================================
 * Playwright Fixtures — Iter 23 (extended Iter 25, Iter 26)
 * ============================================================================
 * Shared test fixtures for the new /playwright suite. Distinct from the
 * existing /e2e suite (which runs against a live backend on Docker) — this
 * new suite is API-mocked so it can run against a stock `npm run dev`
 * frontend without seeding a database first.
 *
 * Auth helpers (all delegate to the shared `applySession` dual-write
 * seeder — canonical `accessToken`/`user` + legacy `auth_token`/`auth_user`
 * localStorage keys, plus BOTH middleware cookies `auth_token` and
 * `provider_token`):
 *   - loginAsHealthUser       — HEALTH role on /health/** routes
 *   - loginAsAccountDtam      — ACCOUNT_DTAM finance reviewer role
 *   - loginAsScheduler        — SCHEDULER role (Iter 25, B25-A scheduler queue)
 *   - loginAsAuditor          — AUDITOR role (Iter 25, B25-B onsite audit field app)
 *   - loginAsAccountPlatform  — ACCOUNT_PLATFORM role (Iter 26, VAT report
 *                               + Output VAT export on /provider/accounting/reports)
 *   - loginAsAdmin            — ADMIN role (Iter 26, period-close UI when
 *                               available; serves as the "BOTH" book-side
 *                               combined accounting view)
 *
 * Browser helpers:
 *   - mockApi             — register a JSON mock for any /api/** route
 *   - mockGeolocation     — override navigator.geolocation for GPS tests
 *     (Iter 25, used by auditor field-app to bypass real device GPS)
 */

import type { Page, Route } from '@playwright/test';

export type HealthUserFixture = {
    id: string;
    healthId: string;
    firstName: string;
    lastName: string;
    email: string;
    role: 'HEALTH';
};

export type AccountDtamFixture = {
    id: string;
    username: string;
    firstName: string;
    lastName: string;
    email: string;
    role: 'ACCOUNT_DTAM';
};

export type SchedulerFixture = {
    id: string;
    username: string;
    firstName: string;
    lastName: string;
    email: string;
    role: 'SCHEDULER';
};

export type AuditorFixture = {
    id: string;
    username: string;
    firstName: string;
    lastName: string;
    email: string;
    auditorName: string;
    role: 'AUDITOR';
};

export type AccountPlatformFixture = {
    id: string;
    username: string;
    firstName: string;
    lastName: string;
    email: string;
    role: 'ACCOUNT_PLATFORM';
};

export type AdminFixture = {
    id: string;
    username: string;
    firstName: string;
    lastName: string;
    email: string;
    role: 'ADMIN';
};

const DEFAULT_HEALTH: HealthUserFixture = {
    id: 'health-user-iter23',
    healthId: '1234567890123',
    firstName: 'สมชาย',
    lastName: 'ใจดี',
    email: 'somchai.e2e@test.local',
    role: 'HEALTH',
};

const DEFAULT_DTAM: AccountDtamFixture = {
    id: 'dtam-account-iter23',
    username: 'finance-reviewer',
    firstName: 'อนงค์',
    lastName: 'ทรัพย์ดี',
    email: 'finance.e2e@test.local',
    role: 'ACCOUNT_DTAM',
};

const DEFAULT_SCHEDULER: SchedulerFixture = {
    id: 'scheduler-iter25',
    username: 'scheduler-1',
    firstName: 'ปรียา',
    lastName: 'จัดสรร',
    email: 'scheduler.e2e@test.local',
    role: 'SCHEDULER',
};

const DEFAULT_AUDITOR: AuditorFixture = {
    id: 'auditor-iter25',
    username: 'auditor-1',
    firstName: 'สมศรี',
    lastName: 'ใจดี',
    email: 'auditor.e2e@test.local',
    auditorName: 'นาง สมศรี ใจดี',
    role: 'AUDITOR',
};

const DEFAULT_ACCOUNT_PLATFORM: AccountPlatformFixture = {
    id: 'platform-account-iter26',
    username: 'platform-finance',
    firstName: 'พิมพ์ใจ',
    lastName: 'รักษาบัญชี',
    email: 'platform.finance.e2e@test.local',
    role: 'ACCOUNT_PLATFORM',
};

const DEFAULT_ADMIN: AdminFixture = {
    id: 'admin-iter26',
    username: 'admin-1',
    firstName: 'อภิวัฒน์',
    lastName: 'ผู้ดูแลระบบ',
    email: 'admin.e2e@test.local',
    role: 'ADMIN',
};

/**
 * Minimal JWT-like token. The frontend's auth-service decodes the payload
 * but does not verify the signature (HS256 verification is server-side),
 * so a hand-rolled base64 token is enough for the client-side gates we
 * need to pass.
 *
 * ENCODING: standard base64, NOT base64url. The Edge middleware's
 * `decodeJwtPayload` (src/lib/middleware-helpers.ts) calls bare `atob()`
 * on the payload segment — base64url characters ('-'/'_', produced e.g.
 * by Thai claims like `auditorName`) make atob throw, the role decodes
 * to null, and the middleware bounces the session to the provider login
 * (observed live on /provider/audits/*). The client-side decoder
 * (auth-service-jwt.ts) normalizes base64url→base64 before atob, so
 * plain base64 is the one encoding BOTH decoders accept.
 */
function makeFakeJwt(payload: Record<string, unknown>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64');
    const body = Buffer.from(
        JSON.stringify({
            ...payload,
            iat: Math.floor(Date.now() / 1000),
            exp: Math.floor(Date.now() / 1000) + 60 * 60, // +1h
        }),
    ).toString('base64');
    return `${header}.${body}.signature-not-verified-client-side`;
}

export interface ApplySessionOptions {
    /**
     * The user record persisted to localStorage. `role` drives both the
     * JWT role claim default and whether the /api/auth/provider/me mock
     * is registered (skipped for HEALTH — that endpoint is staff-only).
     */
    user: Record<string, unknown> & { role: string };
    /**
     * Extra claims for the fake JWT. Defaults to `{ sub, email, role }`
     * pulled from `user`. Middleware decodes `role` from this payload to
     * gate /provider/** + /admin/** (+ the /health/** role check).
     */
    tokenPayload?: Record<string, unknown>;
}

/**
 * Shared session seeder — the single implementation behind every
 * `loginAsX` helper below.
 *
 * DUAL-WRITE CONTRACT (2026-07, session-key migration):
 *   - localStorage gets BOTH key generations:
 *       canonical  `accessToken` + `user`        — what AuthService reads
 *                                                  today (STORAGE_KEYS in
 *                                                  src/lib/services/auth-service.types.ts)
 *       legacy     `auth_token`  + `auth_user`   — kept so any straggler
 *                                                  reader keeps working and
 *                                                  the suite survives a
 *                                                  rollback of the rename
 *   - BOTH middleware cookies are set (src/middleware.ts):
 *       `auth_token`     — gates /health/**
 *       `provider_token` — gates /provider/** + /admin/**
 *     The same JWT is used for both; middleware only base64-decodes the
 *     payload for the role claim, signatures are never verified client-side.
 *   - For staff (non-HEALTH) roles a baseline mock for
 *     GET /api/auth/provider/me is registered that echoes the seeded user.
 *     Several provider pages hard-gate on that endpoint (e.g.
 *     /provider/dashboard router.replaces to the provider login when it
 *     fails — src/app/provider/dashboard/page.tsx). Specs can override it:
 *     later page.route registrations win.
 *
 * Returns the minted token so callers can layer bespoke cookies on top.
 */
export async function applySession(page: Page, options: ApplySessionOptions): Promise<string> {
    const { user } = options;
    const tokenPayload = options.tokenPayload ?? {
        sub: user.id,
        email: user.email,
        role: user.role,
    };
    const token = makeFakeJwt(tokenPayload);
    const userJson = JSON.stringify(user);

    await page.addInitScript(
        ({ token, userJson }) => {
            try {
                // Canonical keys (AuthService STORAGE_KEYS)
                window.localStorage.setItem('accessToken', token);
                window.localStorage.setItem('user', userJson);
                // Legacy keys — dual-write keeps old readers working
                window.localStorage.setItem('auth_token', token);
                window.localStorage.setItem('auth_user', userJson);
            } catch {
                // Storage may be unavailable in certain modes; tests will
                // catch the resulting redirect.
            }
        },
        { token, userJson },
    );

    const cookieUrl = page.url() && page.url() !== 'about:blank'
        ? page.url()
        : (process.env.E2E_BASE_URL || 'http://localhost:3000');
    await page.context().addCookies([
        { name: 'auth_token', value: token, url: cookieUrl },
        { name: 'provider_token', value: token, url: cookieUrl },
    ]).catch(() => {
        // ignore — non-fatal; localStorage init script is the primary path
    });

    if (String(user.role).toUpperCase() !== 'HEALTH') {
        await page.route(/\/api\/auth\/provider\/me(\?.*)?$/, async (route) => {
            if (route.request().method() !== 'GET') return route.fallback();
            await route.fulfill({
                status: 200,
                contentType: 'application/json',
                body: JSON.stringify({
                    success: true,
                    data: { ...user, canonicalRole: user.role },
                }),
            });
        });
    }

    return token;
}

/**
 * Seed the page with HEALTH user state so route guards on /health/**
 * resolve without bouncing through /auth/health/login. See
 * `applySession` for the dual-write key + cookie contract.
 */
export async function loginAsHealthUser(
    page: Page,
    overrides: Partial<HealthUserFixture> = {},
): Promise<HealthUserFixture> {
    const user: HealthUserFixture = { ...DEFAULT_HEALTH, ...overrides };
    await applySession(page, {
        // authType steers AuthService.resolveSessionCookieKey to the
        // health-side `auth_token` cookie slot on writes/logout.
        user: { ...user, authType: 'HEALTH_ID' },
        tokenPayload: {
            sub: user.id,
            healthId: user.healthId,
            email: user.email,
            role: user.role,
        },
    });
    return user;
}

export async function loginAsAccountDtam(
    page: Page,
    overrides: Partial<AccountDtamFixture> = {},
): Promise<AccountDtamFixture> {
    const user: AccountDtamFixture = { ...DEFAULT_DTAM, ...overrides };
    await applySession(page, {
        user,
        tokenPayload: {
            sub: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
        },
    });
    return user;
}

/**
 * Register a JSON mock for any /api/** route. Multiple calls stack — the
 * latest matching route wins. Body can be a plain object (will be
 * JSON-serialised) or a function that receives the Route for full control.
 */
export async function mockApi(
    page: Page,
    options: {
        route: string | RegExp;
        method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
        status?: number;
        body?: unknown | ((route: Route) => unknown);
        contentType?: string;
    },
): Promise<void> {
    const { route, method = 'GET', status = 200, body, contentType = 'application/json' } = options;
    await page.route(route, async (intercepted) => {
        const req = intercepted.request();
        if (req.method().toUpperCase() !== method.toUpperCase()) {
            return intercepted.fallback();
        }
        const resolved = typeof body === 'function' ? (body as (r: Route) => unknown)(intercepted) : body;
        await intercepted.fulfill({
            status,
            contentType,
            body: typeof resolved === 'string' ? resolved : JSON.stringify(resolved),
        });
    });
}

/**
 * Iter 25 — Seed SCHEDULER user state for /provider/scheduler/** routes.
 * Mirrors loginAsAccountDtam but with role=SCHEDULER, so the scheduler
 * queue page can render the AUDIT_FEE_PAID applications list and the
 * "จัดตาราง" assignment modal (B25-A backend POST /scheduler/assign).
 */
export async function loginAsScheduler(
    page: Page,
    overrides: Partial<SchedulerFixture> = {},
): Promise<SchedulerFixture> {
    const user: SchedulerFixture = { ...DEFAULT_SCHEDULER, ...overrides };
    await applySession(page, {
        user,
        tokenPayload: {
            sub: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
        },
    });
    return user;
}

/**
 * Iter 25 — Seed AUDITOR user state for /provider/audits/<id>/inspect routes.
 * The auditor field-app screen needs both the user record and a stable
 * `auditorName` so the inspection submission carries the correct identity
 * back to the B25-B onsite audit backend.
 */
export async function loginAsAuditor(
    page: Page,
    overrides: Partial<AuditorFixture> = {},
): Promise<AuditorFixture> {
    const user: AuditorFixture = { ...DEFAULT_AUDITOR, ...overrides };
    await applySession(page, {
        user,
        tokenPayload: {
            sub: user.id,
            username: user.username,
            email: user.email,
            auditorName: user.auditorName,
            role: user.role,
        },
    });
    return user;
}

/**
 * Iter 26 — Seed ACCOUNT_PLATFORM user state for /provider/accounting/**
 * routes (Output VAT / ภ.พ.30 report, period-close, AR aging). Both finance
 * roles read the same accounting pages (operator 2026-09-11); this one also
 * holds the accounting write buttons (canWriteAccounting) — `loginAsAccountDtam`
 * sees the same pages read-only (operator 2026-09-27 "กรมฯ ดูอย่างเดียว").
 */
export async function loginAsAccountPlatform(
    page: Page,
    overrides: Partial<AccountPlatformFixture> = {},
): Promise<AccountPlatformFixture> {
    const user: AccountPlatformFixture = { ...DEFAULT_ACCOUNT_PLATFORM, ...overrides };
    await applySession(page, {
        user,
        tokenPayload: {
            sub: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
        },
    });
    return user;
}

/**
 * Iter 26 — Seed ADMIN user state. An admin reads every accounting page and
 * chooses the AR-aging book side like every other viewer.
 * Used by the period-close test (Iter 26 Test 4-T2) which exercises
 * the privileged "ปิดงวด" action — gated to ADMIN in B26 backend.
 */
export async function loginAsAdmin(
    page: Page,
    overrides: Partial<AdminFixture> = {},
): Promise<AdminFixture> {
    const user: AdminFixture = { ...DEFAULT_ADMIN, ...overrides };
    await applySession(page, {
        user,
        tokenPayload: {
            sub: user.id,
            username: user.username,
            email: user.email,
            role: user.role,
        },
    });
    return user;
}

/**
 * Iter 25 — Override navigator.geolocation so the auditor field-app GPS
 * check-in resolves to a deterministic position without prompting the
 * real OS permission dialog. Uses Playwright's first-class
 * BrowserContext.setGeolocation() under the hood, which is preferred over
 * monkey-patching window.navigator (some pages use the modern
 * geolocation API which Playwright wires up natively).
 *
 * IMPORTANT: also grants the "geolocation" permission for the current
 * origin so the page does not see a PERMISSION_DENIED error.
 */
export async function mockGeolocation(
    page: Page,
    options: { lat: number; lng: number; accuracy?: number; origin?: string } = {
        lat: 13.7563,
        lng: 100.5018,
    },
): Promise<void> {
    const { lat, lng, accuracy = 10, origin } = options;
    const context = page.context();

    await context.setGeolocation({ latitude: lat, longitude: lng, accuracy });

    // Grant permission for the test origin. If caller did not supply an
    // origin, infer from baseURL via page.url() once the page is open;
    // otherwise default to wildcard (Playwright accepts no origin to mean
    // "all origins in this context").
    try {
        if (origin) {
            await context.grantPermissions(['geolocation'], { origin });
        } else {
            await context.grantPermissions(['geolocation']);
        }
    } catch {
        // Some browsers (Webkit on Linux) refuse geolocation grants;
        // tests that depend on it will surface the failure directly.
    }

    // Additionally inject a JS-side shim so any code path that calls
    // navigator.geolocation.getCurrentPosition before the page receives
    // the native event still resolves deterministically. This is a
    // belt-and-braces measure — Playwright's native geolocation wiring is
    // the primary path.
    await page.addInitScript(
        ({ lat, lng, accuracy }) => {
            const fixed: GeolocationPosition = {
                coords: {
                    latitude: lat,
                    longitude: lng,
                    accuracy,
                    altitude: null,
                    altitudeAccuracy: null,
                    heading: null,
                    speed: null,
                    toJSON() {
                        return {
                            latitude: lat,
                            longitude: lng,
                            accuracy,
                            altitude: null,
                            altitudeAccuracy: null,
                            heading: null,
                            speed: null,
                        };
                    },
                },
                timestamp: Date.now(),
                toJSON() {
                    return {
                        coords: this.coords,
                        timestamp: this.timestamp,
                    };
                },
            };
            try {
                Object.defineProperty(navigator, 'geolocation', {
                    configurable: true,
                    value: {
                        getCurrentPosition: (
                            success: PositionCallback,
                            _error?: PositionErrorCallback | null,
                        ) => {
                            success(fixed);
                        },
                        watchPosition: (
                            success: PositionCallback,
                            _error?: PositionErrorCallback | null,
                        ) => {
                            success(fixed);
                            return 1;
                        },
                        clearWatch: () => {
                            /* noop */
                        },
                    },
                });
            } catch {
                /* property may already be locked in some browsers; native path still works */
            }
        },
        { lat, lng, accuracy },
    );
}
