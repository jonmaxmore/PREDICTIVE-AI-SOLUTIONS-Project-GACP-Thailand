/**
 * LoginChooser — every OAuth button's state comes from the backend registry.
 *
 * What this suite exists to stop: the file used to carry
 * `const THAID_AWAITING_CREDENTIALS = true` (login-chooser.tsx:164) and the
 * old smoke test asserted exactly four "เร็ว ๆ นี้" badges. That literal WAS
 * the bug — no credential an operator delivered could ever clear a badge
 * without a code change and a deploy. States now arrive from
 * `GET /api/auth/idp/providers` (states only: `{key, state}`), so the matrix
 * below is expressed as fetch responses, not as constants in the component.
 *
 * Harness note: this repo does NOT ship @testing-library/react (see
 * apps/web-app/package.json devDependencies and the note in
 * RootLangUpdater.test.tsx). The interactive cases therefore use the repo's
 * createRoot + act idiom (dashboard-fetch-error.test.tsx) and read the Radix
 * Dialog out of document.body, which is where it portals under jsdom. The
 * copy-only cases keep renderToStaticMarkup, exactly as before.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, expect, it, afterEach, beforeEach, jest } from '@jest/globals';
import fs from 'node:fs';
import path from 'node:path';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import LoginChooser from '../login-chooser';

declare global {

    var IS_REACT_ACT_ENVIRONMENT: boolean | undefined;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

type FetchMock = ReturnType<typeof installBackend>;

/** One canned authorize-url reply, keyed by provider — see `installBackend`. */
type AuthorizeOverride = { ok: boolean; body: unknown };

/**
 * One stub for both calls the chooser makes: the states feed and, when a
 * button is actually usable, that provider's own authorize-url. The
 * authorize-url reply deliberately carries NO url by default so jsdom is
 * never asked to navigate; the assertion that matters is WHICH path was
 * requested, because "thaid" used to be hardcoded into that path too.
 *
 * `authorizeOverrides` (T6): lets a test hand a SPECIFIC provider's
 * authorize-url call a not-ready catalog envelope (`{code, messageTh, ...}`)
 * instead of the generic empty-success default — needed to exercise the
 * always-enterable in-flow-message path, which reads the response body.
 */
function installBackend(
    states: Record<string, string> | 'reject',
    authorizeOverrides: Record<string, AuthorizeOverride> = {},
) {
    // `init` (2nd arg) is unused by the fixture logic below but IS asserted
    // on by the R-B tests further down — idpFetch always forces
    // credentials:'include', and the URL is now the absolute backend
    // origin (http://localhost:8000/...), not a bare /api/... path routed
    // through the Next proxy.
    const fetchMock = jest.fn(async (input: unknown, _init?: RequestInit) => {
        const url = String(input);
        if (url.includes('/api/auth/idp/providers')) {
            if (states === 'reject') {
                throw new Error('providers feed down');
            }
            return {
                ok: true,
                json: async () => ({
                    success: true,
                    data: {
                        providers: Object.entries(states).map(([key, state]) => ({
                            key,
                            state,
                            // Mirror the real endpoint: enabled is the backend's
                            // resolved verdict. In these fixtures the test env is
                            // non-production, so enabled ⇔ state is enabled or
                            // staging_only — matching stateResolvesEnabled().
                            enabled: state === 'enabled' || state === 'staging_only',
                        })),
                    },
                }),
            };
        }
        if (url.includes('/authorize-url')) {
            const match = /\/idp\/([^/]+)\/authorize-url/.exec(url);
            const providerKey = match ? match[1] : '';
            const override = authorizeOverrides[providerKey];
            if (override) {
                return { ok: override.ok, json: async () => override.body };
            }
            return { ok: true, json: async () => ({ success: true, data: {} }) };
        }
        throw new Error(`unexpected fetch: ${url}`);
    });
    (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
    return fetchMock;
}

const ALL_COMING_SOON = {
    local: 'enabled',
    healthid: 'coming_soon',
    providerid: 'coming_soon',
    thaid: 'coming_soon',
    mock: 'coming_soon',
};

describe('LoginChooser — provider states come from the registry', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;
    const realFetch = globalThis.fetch;

    beforeEach(() => {
        jest.clearAllMocks();
    });

    afterEach(() => {
        if (root) {
            act(() => {
                root?.unmount();
            });
            root = null;
        }
        if (container) {
            container.remove();
            container = null;
        }
        (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
    });

    function mount() {
        container = document.createElement('div');
        document.body.appendChild(container);
        act(() => {
            root = createRoot(container!);
            root.render(<LoginChooser />);
        });
    }

    async function flush(rounds = 20) {
        for (let i = 0; i < rounds; i++) {
            await act(async () => {
                await Promise.resolve();
            });
        }
    }

    async function mountWith(
        states: Record<string, string> | 'reject',
        authorizeOverrides: Record<string, AuthorizeOverride> = {},
    ): Promise<FetchMock> {
        const fetchMock = installBackend(states, authorizeOverrides);
        mount();
        await flush();
        return fetchMock;
    }

    function findButton(needle: string): HTMLButtonElement {
        const match = Array.from(container!.querySelectorAll('button')).find((b) =>
            (b.textContent ?? '').includes(needle),
        );
        if (!match) {
            throw new Error(`no button containing "${needle}"; rendered: ${container!.textContent}`);
        }
        return match;
    }

    async function click(button: HTMLButtonElement) {
        await act(async () => {
            button.click();
        });
        await flush(5);
    }

    const authorizeCalls = (fetchMock: FetchMock) =>
        fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/authorize-url'));

    /**
     * Read the OPEN dialog, never document.body: the two sub-labels on the
     * cards already say "(กรมการปกครอง)" and "(สำนักสุขภาพดิจิทัล)", so a
     * body-wide assertion for those words passes without any dialog at all.
     * Radix renders DialogContent with role="dialog" into a body portal.
     */
    function openDialog(): HTMLElement {
        const dialog = document.querySelector<HTMLElement>('[role="dialog"]');
        if (!dialog) {
            throw new Error('no open [role="dialog"] in the document');
        }
        return dialog;
    }

    it('asks the registry for states on mount — states only, no auth, no config', async () => {
        const fetchMock = await mountWith(ALL_COMING_SOON);
        // R-B: the states feed goes straight to the backend origin via
        // idpFetch, not through the universal Next proxy — the URL is now
        // absolute (http://localhost:8000/...), never a bare /api/... path.
        expect(fetchMock.mock.calls.map((c) => String(c[0])))
            .toContain('http://localhost:8000/api/auth/idp/providers');
        const [, init] = fetchMock.mock.calls.find(
            (c) => String(c[0]).includes('/api/auth/idp/providers'),
        )! as [string, RequestInit];
        expect(init?.credentials).toBe('include');
    });

    it('enabled provider: no badge, and the click hits THAT provider’s authorize-url', async () => {
        const fetchMock = await mountWith({ ...ALL_COMING_SOON, healthid: 'enabled' });

        const healthBtn = findButton('เข้าด้วย Health ID');
        expect(healthBtn.textContent).not.toContain('รอการเชื่อมต่อ');
        expect(healthBtn.textContent).not.toContain('ตรวจสถานะไม่ได้');
        expect(healthBtn.disabled).toBe(false);

        await click(healthBtn);
        // The whole point of generalising beginThaid → beginIdp: the path
        // carries the provider key instead of the literal "thaid". R-B: the
        // authorize-url POST also goes direct-origin with credentials
        // included — the idp_state cookie it sets must survive to the
        // callback POST, which the old proxied relative path dropped.
        expect(authorizeCalls(fetchMock)).toContain('http://localhost:8000/api/auth/idp/healthid/authorize-url');
        const [, init] = fetchMock.mock.calls.find(
            (c) => String(c[0]).includes('/authorize-url'),
        )! as [string, RequestInit];
        expect(init?.credentials).toBe('include');
    });

    // T6 adaptation (operator directive 2026-08-19): the ORIGINAL pin here
    // clicked the ThaID button and asserted no OAuth call fired. ThaID is
    // now one of the two always-enterable cards (see the dedicated T6
    // describe block below for its NEW-contract counterpart), so this pin's
    // subject moved to Provider ID — the one card the directive left
    // untouched — to keep testing the thing the pin always meant to test:
    // a truly-gated provider does not fire on click while not ready.
    it('coming_soon provider (providerid — unaffected by T6): still visible, badged, and the click starts no OAuth call', async () => {
        const fetchMock = await mountWith(ALL_COMING_SOON);

        const providerBtn = findButton('เข้าด้วย Provider ID');
        expect(providerBtn.textContent).toContain('รอการเชื่อมต่อ');

        await click(providerBtn);
        // A button the registry says is not ready must not fire an OAuth call
        // and land on a 503 — the old beginThaid did exactly that.
        expect(authorizeCalls(fetchMock)).toHaveLength(0);
    });

    // T6 adaptation: the ORIGINAL pin asserted the waiting DIALOG named
    // กรมการปกครอง. ThaID no longer opens that dialog at all (Ruling 4) —
    // the "which department" honesty this pin protected now lives in the
    // IN-FLOW message instead (see the T6 describe block's
    // "AUTH_PROVIDER_DISABLED renders the operator-directed copy" test,
    // which asserts the same กรมการปกครอง substring in the new surface).
    // What this pin protects now: the dialog path is well and truly gone
    // for this card.
    it('the ThaID card no longer opens the waiting dialog (T6) — a real POST fires instead', async () => {
        const fetchMock = await mountWith(ALL_COMING_SOON);
        await click(findButton('เข้าด้วย ThaID'));
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(authorizeCalls(fetchMock)).toContain('http://localhost:8000/api/auth/idp/thaid/authorize-url');
    });

    // T6 adaptation: same move as the ThaID pin above, for Health ID. The
    // "which department" honesty (สำนักสุขภาพดิจิทัล) now lives in the T6
    // describe block's in-flow-message test.
    it('the Health ID card no longer opens the waiting dialog (T6) — a real POST fires instead', async () => {
        const fetchMock = await mountWith(ALL_COMING_SOON);
        await click(findButton('เข้าด้วย Health ID'));
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        expect(authorizeCalls(fetchMock)).toContain('http://localhost:8000/api/auth/idp/healthid/authorize-url');
    });

    // T6 adaptation: the ORIGINAL pin clicked Health ID (then still
    // dialog-gated) and asserted no call fired. Health ID is now
    // always-enterable, so the "click starts nothing while not ready"
    // assertion moved to Provider ID (still gated); a new companion
    // assertion below confirms the CONTRAST — Health ID's click fires even
    // while the states feed itself is down, exactly as the directive
    // intends ("regardless of the provider state from GET /providers").
    it('fetch failure fails closed: every IdP button is badged ตรวจสถานะไม่ได้; providerid starts nothing, healthid still fires (T6)', async () => {
        const fetchMock = await mountWith('reject');

        for (const label of ['เข้าด้วย Health ID', 'เข้าด้วย ThaID', 'เข้าด้วย Provider ID']) {
            expect(findButton(label).textContent).toContain('ตรวจสถานะไม่ได้');
        }
        await click(findButton('เข้าด้วย Provider ID'));
        expect(authorizeCalls(fetchMock)).toHaveLength(0);

        // Fail-closed still leaves the temporary local doors open — the page
        // must not become a dead end when the states feed is down.
        expect(container!.innerHTML).toContain('href="/auth/health/login"');
        expect(container!.innerHTML).toContain('href="/auth/provider/login"');

        // and the dialog says WHY, rather than reusing the "coming soon" lie.
        expect(openDialog().textContent).toContain('ตรวจสถานะ');

        // T6 contrast: Health ID is always-enterable, so its click fires the
        // real POST even though the states feed itself is down (unknown).
        await click(findButton('เข้าด้วย Health ID'));
        expect(authorizeCalls(fetchMock)).toContain('http://localhost:8000/api/auth/idp/healthid/authorize-url');
    });

    it('a malformed states payload is treated as failure, not as "everything enabled"', async () => {
        const fetchMock = jest.fn(async (input: unknown) => {
            if (String(input).includes('/api/auth/idp/providers')) {
                return { ok: true, json: async () => ({ success: true, data: {} }) };
            }
            throw new Error(`unexpected fetch: ${String(input)}`);
        });
        (globalThis as unknown as { fetch: unknown }).fetch = fetchMock;
        mount();
        await flush();

        expect(findButton('เข้าด้วย ThaID').textContent).toContain('ตรวจสถานะไม่ได้');
    });

    it('while the states are still loading, providerid is not clickable and no badge lies (T6: thaid/healthid stay live)', async () => {
        // Never-settling feed = the loading window. A badge here would be a
        // guess, and guessing is what this ticket removes.
        (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(
            () => new Promise(() => undefined),
        );
        mount();

        // T6 adaptation: the ORIGINAL pin asserted the ThaID button was
        // disabled during the loading window. ThaID (like Health ID) is now
        // always-enterable and is NEVER disabled by `status`, loading
        // included — the click just fires the real POST immediately and
        // lets the backend answer. The "still disabled while loading"
        // protection moved to Provider ID, the one card left untouched.
        const providerBtn = findButton('เข้าด้วย Provider ID');
        expect(providerBtn.disabled).toBe(true);
        expect(providerBtn.textContent).not.toContain('รอการเชื่อมต่อ');
        expect(providerBtn.textContent).not.toContain('ตรวจสถานะไม่ได้');

        const thaidBtn = findButton('เข้าด้วย ThaID');
        expect(thaidBtn.disabled).toBe(false);
        expect(thaidBtn.textContent).not.toContain('รอการเชื่อมต่อ');
        expect(thaidBtn.textContent).not.toContain('ตรวจสถานะไม่ได้');
    });
});

/**
 * T6 — operator directive 2026-08-19 (progress.md Ruling 4): "ไม่ใช่แค่
 * ป๊อปอัพออก แต่ต้องกดปุ่ม ThaiD กับ หมอพร้อม เข้าไปได้จริง". Self-contained
 * on purpose (same convention as the "reverse pin" describe block further
 * down) rather than reusing the first describe's scoped helpers.
 */
describe('LoginChooser — T6 press-through: thaid/healthid always enterable', () => {
    let container: HTMLDivElement | null = null;
    let root: Root | null = null;
    const realFetch = globalThis.fetch;

    afterEach(() => {
        if (root) {
            act(() => {
                root?.unmount();
            });
            root = null;
        }
        if (container) {
            container.remove();
            container = null;
        }
        (globalThis as unknown as { fetch: unknown }).fetch = realFetch;
    });

    async function mountWith(
        states: Record<string, string> | 'reject',
        authorizeOverrides: Record<string, AuthorizeOverride> = {},
    ): Promise<FetchMock> {
        const fetchMock = installBackend(states, authorizeOverrides);
        container = document.createElement('div');
        document.body.appendChild(container);
        await act(async () => {
            root = createRoot(container!);
            root.render(<LoginChooser />);
        });
        for (let i = 0; i < 20; i++) {
            await act(async () => Promise.resolve());
        }
        return fetchMock;
    }

    function findButton(needle: string): HTMLButtonElement {
        const match = Array.from(container!.querySelectorAll('button')).find((b) =>
            (b.textContent ?? '').includes(needle),
        );
        if (!match) {
            throw new Error(`no button containing "${needle}"; rendered: ${container!.textContent}`);
        }
        return match;
    }

    async function click(button: HTMLButtonElement) {
        await act(async () => {
            button.click();
        });
        for (let i = 0; i < 5; i++) {
            await act(async () => Promise.resolve());
        }
    }

    const authorizeCalls = (fetchMock: FetchMock) =>
        fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/authorize-url'));

    /**
     * Scoped to the `role="alert"` element itself, NOT `container.textContent`
     * — the card's own sub-label already says "(กรมการปกครอง)"/
     * "(สำนักสุขภาพดิจิทัล)" regardless of any notice, so a container-wide
     * substring check would pass even if the in-flow message never rendered
     * at all (the same false-positive trap `openDialog()` above documents
     * for the dialog case).
     */
    function findAlert(): HTMLElement {
        const alert = container!.querySelector<HTMLElement>('[role="alert"]');
        if (!alert) {
            throw new Error(`no [role="alert"] in the document; rendered: ${container!.textContent}`);
        }
        return alert;
    }

    const COMING_SOON_STATES = {
        local: 'enabled',
        healthid: 'coming_soon',
        providerid: 'coming_soon',
        thaid: 'coming_soon',
    };

    // Pin (a): healthid card in coming_soon state → click fires the
    // authorize-url POST directly. No dialog opens first.
    it('healthid in coming_soon state: click fires the authorize-url POST (was: dialog, no POST)', async () => {
        const fetchMock = await mountWith(COMING_SOON_STATES);
        const healthBtn = findButton('เข้าด้วย Health ID');
        expect(healthBtn.disabled).toBe(false);
        expect(healthBtn.textContent).toContain('รอการเชื่อมต่อ'); // badge still informational

        await click(healthBtn);
        expect(authorizeCalls(fetchMock)).toContain('http://localhost:8000/api/auth/idp/healthid/authorize-url');
        expect(document.querySelector('[role="dialog"]')).toBeNull();
    });

    // Pin (b), part 1: the ONE not-ready code this call actually returns
    // today (AUTH_PROVIDER_DISABLED) renders the operator-directed honest
    // copy from the local map — confirms the local map wins when the code
    // IS listed (resolveErrorCode's own precedence), and that it names the
    // right department, closing the gap the two deleted waiting-dialog
    // pins used to cover.
    it('AUTH_PROVIDER_DISABLED renders the operator-directed in-flow copy (local map wins; names the right department)', async () => {
        const fetchMock = await mountWith(COMING_SOON_STATES, {
            thaid: {
                ok: false,
                body: {
                    success: false,
                    code: 'AUTH_PROVIDER_DISABLED',
                    error: 'This authentication provider is not open for sign-in yet',
                    message: 'This authentication provider is not open for sign-in yet',
                    messageTh: 'ข้อความ catalog ทั่วไป ไม่ใช่ข้อความที่คาดหวัง',
                },
            },
        });
        await click(findButton('เข้าด้วย ThaID'));
        expect(authorizeCalls(fetchMock)).toContain('http://localhost:8000/api/auth/idp/thaid/authorize-url');
        expect(document.querySelector('[role="dialog"]')).toBeNull();
        const alertText = findAlert().textContent ?? '';
        expect(alertText).toContain('ThaID ยังไม่เปิดให้เชื่อมต่อ');
        expect(alertText).toContain('ยังไม่ได้รับการตั้งค่าเชื่อมต่อกับกรมการปกครอง');
        // proves the local map — not the generic catalog messageTh — won.
        expect(alertText).not.toContain('ข้อความ catalog ทั่วไป ไม่ใช่ข้อความที่คาดหวัง');
    });

    // Pin (b), part 2: an unmapped not-ready code falls through to the
    // backend's own `messageTh` — the resolver's documented preference,
    // reused as-is from client-view.tsx's idiom.
    it('an unmapped not-ready code renders the backend messageTh (messageTh preferred)', async () => {
        const fetchMock = await mountWith(COMING_SOON_STATES, {
            healthid: {
                ok: false,
                body: {
                    success: false,
                    code: 'AUTH_PROVIDER_NOT_CONFIGURED',
                    error: 'Authentication provider configuration is incomplete',
                    message: 'Authentication provider configuration is incomplete',
                    messageTh: 'ข้อความทดสอบเฉพาะเคสนี้จาก backend',
                },
            },
        });
        await click(findButton('เข้าด้วย Health ID'));
        expect(authorizeCalls(fetchMock)).toContain('http://localhost:8000/api/auth/idp/healthid/authorize-url');
        expect(findAlert().textContent).toContain('ข้อความทดสอบเฉพาะเคสนี้จาก backend');
    });

    // Pin (c): the local (password) card is unaffected — still present,
    // still the same href, even after an in-flow notice has rendered on a
    // sibling card in the SAME door.
    it('local card is unaffected: same hrefs, unchanged, even after an in-flow notice renders', async () => {
        await mountWith(COMING_SOON_STATES, {
            thaid: { ok: false, body: { success: false, code: 'AUTH_PROVIDER_DISABLED' } },
        });
        await click(findButton('เข้าด้วย ThaID'));
        expect(findAlert().textContent).toContain('ThaID ยังไม่เปิดให้เชื่อมต่อ');

        expect(container!.innerHTML).toContain('href="/auth/health/login"');
        expect(container!.innerHTML).toContain('href="/auth/provider/login"');
        const localLink = Array.from(container!.querySelectorAll('a')).find(
            (a) => a.getAttribute('href') === '/auth/health/login',
        );
        expect(localLink?.textContent).toContain('เข้าด้วยเลขบัตรประชาชน + รหัสผ่าน (ชั่วคราว)');
    });

    // Pin (d): an enabled thaid still fires the exact same authorize-url
    // POST an always-enterable click does — the redirect flow is untouched,
    // not a parallel code path.
    it('enabled thaid: the redirect-flow POST is untouched', async () => {
        const fetchMock = await mountWith({ ...COMING_SOON_STATES, thaid: 'enabled' });
        const thaidBtn = findButton('เข้าด้วย ThaID');
        expect(thaidBtn.textContent).not.toContain('รอการเชื่อมต่อ');
        expect(thaidBtn.textContent).not.toContain('ตรวจสถานะไม่ได้');

        await click(thaidBtn);
        expect(authorizeCalls(fetchMock)).toContain('http://localhost:8000/api/auth/idp/thaid/authorize-url');
        const [, init] = fetchMock.mock.calls.find(
            (c) => String(c[0]).includes('/authorize-url'),
        )! as [string, RequestInit];
        expect(init?.credentials).toBe('include');
    });
});

describe('LoginChooser — copy and structure that no provider state can change', () => {
    const html = renderToStaticMarkup(<LoginChooser />);

    it('renders the approved h1 and subtitle copy', () => {
        expect(html).toContain('เข้าสู่ระบบ');
        // INVERTED 2026-09-06. The subtitle this line approved read "เชื่อมต่อบริการ
        // การแพทย์แผนไทยและการแพทย์ทางเลือก ผ่านระบบนัดหมาย ปรึกษาแพทย์ และติดตามการรักษา
        // ออนไลน์" — telemedicine copy on the front door of a GACP certification platform.
        // Nothing here books an appointment or tracks a treatment. Seen when the operator
        // opened the page on a phone after the demo curtain came down; a test that pins
        // wrong copy as "approved" is how wrong copy survives review.
        expect(html).toContain('GACP');
        expect(html).toContain('ยื่นคำขอ');
        expect(html).not.toContain('ปรึกษาแพทย์');
    });

    it('renders both doors with equal-weight titles', () => {
        expect(html).toContain('สำหรับประชาชน');
        expect(html).toContain('เกษตรกร');
        expect(html).toContain('สำหรับเจ้าหน้าที่');
    });

    it('keeps all three mandated IdP entries on the page whatever their state', () => {
        expect(html).toContain('Health ID');
        expect(html).toContain('ThaID');
        expect(html).toContain('Provider ID');
    });

    it('routes the citizen local-login link to the real health login page', () => {
        expect(html).toContain('href="/auth/health/login"');
        expect(html).toContain('เข้าด้วยเลขบัตรประชาชน + รหัสผ่าน (ชั่วคราว)');
    });

    it('routes the officer local-login link to the real provider login page', () => {
        expect(html).toContain('href="/auth/provider/login"');
        expect(html).toContain('เข้าด้วยเลขบัตร + รหัสผ่าน (ชั่วคราว)');
    });

    it('marks the local door as the transitional path (spec §3.5)', () => {
        expect(html).toContain('ช่องทางชั่วคราวระหว่างรอการเชื่อมต่อระบบยืนยันตัวตนกลาง');
    });

    it('renders the REAL department seal — permission to use it was granted (operator, 2026-09-06)', () => {
        // Until 2026-09-06 this page deliberately showed a dashed "รอตรา ครุฑ"
        // placeholder, because using the official mark without permission is
        // forbidden. The operator confirmed the permission that day
        // ("ผ่านการได้รับอนุญาตแล้ว"), so the placeholder retires and the real
        // seal takes its slot — and the placeholder must never come back.
        expect(html).toContain('/images/dtam-seal.png');
        expect(html).not.toContain('รอตรา');
    });

    // operator 2026-10-03: "เอาคำนี้ออก" — the footnote about the seal approval,
    // the registry and the temporary password is gone from the login page.
    it('carries no footnote about the seal approval, the registry or a temporary password', () => {
        const text = html.replace(/<[^>]+>/g, ' ');
        expect(text).not.toContain('ตราครุฑอย่างเป็นทางการอยู่ระหว่างขออนุมัติ');
        expect(text).not.toContain('อ่านจากทะเบียนของระบบโดยตรง');
        expect(text).not.toContain('รหัสผ่านชั่วคราวได้เสมอ');
    });

    it('the facade dialog is closed by default (no attempted real IdP navigation)', () => {
        // Radix Dialog is closed on initial render, so its portal content is
        // absent from the SSR tree — nothing here should look like an IdP
        // redirect. (SVG icons legitimately carry an `xmlns="http://..."`
        // attribute, so this checks `href="http.."` specifically, not any
        // occurrence of the substring.)
        expect(html).not.toMatch(/href="https?:\/\//);
    });

    it('holds no hardcoded provider status anywhere in the source', () => {
        const src = fs.readFileSync(path.join(__dirname, '..', 'login-chooser.tsx'), 'utf8');
        expect(src).not.toMatch(/THAID_AWAITING_CREDENTIALS/);
        // The old copy asserted "ยังไม่เปิดใช้งานในระบบนี้" about the IdPs in
        // prose — a second frozen status claim that the registry cannot reach.
        expect(src).not.toMatch(/ยังไม่เปิดใช้งานในระบบนี้/);
    });
});


describe('reverse pin: nothing simulated may render on /auth, whatever the feed says (operator 2026-08-14)', () => {
    // Self-contained on purpose: the main describe's helpers are scoped to it.
    let demoContainer: HTMLDivElement | null = null;
    let demoRoot: Root | null = null;
    const realFetchHere = globalThis.fetch;

    // spec §7.1 — these three words must be unreachable on the page in every
    // feed state. The old pins asserted the exact string 'ทดลองระบบ (DEMO)',
    // which any reworded strip would have walked straight past.
    const FORBIDDEN = ['ทดลอง', 'จำลอง', 'DEMO'];

    afterEach(async () => {
        await unmountBare();
        (globalThis as unknown as { fetch: unknown }).fetch = realFetchHere;
    });

    async function mountBare() {
        demoContainer = document.createElement('div');
        document.body.appendChild(demoContainer);
        await act(async () => {
            demoRoot = createRoot(demoContainer!);
            demoRoot.render(<LoginChooser />);
        });
        for (let i = 0; i < 20; i++) {
            await act(async () => Promise.resolve());
        }
    }

    async function unmountBare() {
        if (demoRoot) {
            await act(async () => demoRoot!.unmount());
            demoRoot = null;
        }
        demoContainer?.remove();
        demoContainer = null;
    }

    function expectNoDemoCopy() {
        for (const word of FORBIDDEN) {
            // document.body, not the mount container: Radix portals dialog
            // content to the body, so a forbidden word that only renders
            // inside an opened notice would escape a container-scoped pin
            // (T5 audit finding, 2026-08-14).
            expect(document.body.textContent).not.toContain(word);
        }
    }

    // Feed stub in the shape the real endpoint serves: `{data:{providers:[…]}}`.
    function stubFeed(data: unknown) {
        (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(async () => ({
            ok: true,
            json: async () => ({ success: true, data }),
        }));
    }

    it('stale backend ที่ยังส่ง mock:enabled มา — หน้าต้องไม่ render คำต้องห้ามใด ๆ', async () => {
        stubFeed({
            providers: [
                { key: 'thaid', state: 'coming_soon', enabled: false },
                { key: 'healthid', state: 'coming_soon', enabled: false },
                { key: 'local', state: 'enabled', enabled: true },
                { key: 'mock', state: 'enabled', enabled: true },
            ],
        });
        await mountBare();
        expectNoDemoCopy();
    });

    it('ทุกสถานะ feed (loading / error / ปกติ) — ไม่มีคำต้องห้าม', async () => {
        const feeds: Array<() => void> = [
            // loading: fetch ไม่ resolve
            () => {
                (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(
                    () => new Promise(() => {}),
                );
            },
            // error: feed ล่ม
            () => {
                (globalThis as unknown as { fetch: unknown }).fetch = jest.fn(async () => {
                    throw new Error('down');
                });
            },
            // ปกติ: ทะเบียนหลังรื้อ (ไม่มี mock)
            () =>
                stubFeed({
                    providers: [
                        { key: 'thaid', state: 'coming_soon', enabled: false },
                        { key: 'healthid', state: 'coming_soon', enabled: false },
                        { key: 'providerid', state: 'coming_soon', enabled: false },
                        { key: 'local', state: 'enabled', enabled: true },
                    ],
                }),
        ];
        for (const installFeed of feeds) {
            installFeed();
            await mountBare();
            expectNoDemoCopy();
            await unmountBare();
        }
    });
});

/**
 * ประโยคแรกที่คนอ่านบนประตูหน้าสุด ต้องเป็นเรื่องของแพลตฟอร์มนี้
 *
 * จนถึง 2026-09-06 มันเขียนว่า "เชื่อมต่อบริการการแพทย์แผนไทยและการแพทย์ทางเลือก ผ่านระบบ
 * นัดหมาย ปรึกษาแพทย์ และติดตามการรักษาออนไลน์" ซึ่งเป็นคำโฆษณาของบริการโทรเวชกรรม ไม่ใช่
 * ระบบรับรอง GACP · เกษตรกรที่เปิดหน้านี้เพื่อยื่นคำขอปลูกอ่านแล้วมีเหตุผลให้คิดว่ามาผิดที่
 *
 * เจอตอน operator เปิดหน้านี้จากมือถือหลังเปิดม่าน demo ไม่ใช่จากการอ่านโค้ด
 */
describe('หน้าเลือกช่องทางเข้าระบบ บอกว่าที่นี่คือระบบอะไร', () => {
    // ตัดคอมเมนต์ทั้งก้อน (ทั้ง {/* */} และ /* */ และ //) — คำอธิบายว่าทำไมประโยคเก่าถึงผิด
    // ต้องไม่ถูกอ่านว่าประโยคเก่ายังอยู่
    const source = readFileSync(join(__dirname, '..', 'login-chooser.tsx'), 'utf8')
        .replace(/\{\/\*[\s\S]*?\*\/\}/g, '')
        .replace(/\/\*[\s\S]*?\*\//g, '')
        .replace(/^\s*\/\/.*$/gm, '');

    it('ไม่บรรยายตัวเองเป็นบริการนัดหมาย/ปรึกษาแพทย์/ติดตามการรักษา', () => {
        const wrong = ['นัดหมาย', 'ปรึกษาแพทย์', 'ติดตามการรักษา', 'โทรเวชกรรม']
            .filter((phrase) => source.includes(phrase));
        expect(wrong).toEqual([]);
    });

    it('บอกสิ่งที่ทำได้จริงบนแพลตฟอร์มนี้', () => {
        expect(source).toContain('GACP');
        expect(source).toMatch(/ยื่นคำขอ/);
    });
});
