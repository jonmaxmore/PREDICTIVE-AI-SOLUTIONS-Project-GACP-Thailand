/**
 * `/` is the login front door — operator decision 2026-08-14
 * (design note 2026-08-14-login-front-door-design §3.3). ThaID
 * and หมอพร้อม are ministry-mandated entry paths, so the first screen an
 * anonymous visitor lands on must be the chooser at /auth. Before this, the
 * chooser was mounted at /auth with no route in the product leading to it:
 * `/` served the marketing landing and every login link went straight to the
 * old local form.
 *
 * The real `next/navigation` redirect() throws NEXT_REDIRECT to unwind the
 * render, and the global mock in jest.setup.tsx does not export redirect at
 * all (only the hooks), so this file supplies its own module mock and asserts
 * on the call — the page component is a plain function, so it is invoked
 * directly rather than rendered.
 */
import { redirect } from 'next/navigation';
import RootRedirect from '../page';

jest.mock('next/navigation', () => ({
    redirect: jest.fn(),
}));

const redirectMock = redirect as unknown as jest.Mock;

describe('/ (marketing root)', () => {
    beforeEach(() => {
        redirectMock.mockClear();
    });

    it('redirects to the /auth chooser', () => {
        RootRedirect();
        expect(redirectMock).toHaveBeenCalledWith('/auth');
    });

    it('renders no landing markup of its own — the redirect is the whole page', () => {
        expect(RootRedirect()).toBeUndefined();
    });
});
