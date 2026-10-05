const SESSION_COOKIE_NAMES = ['auth_token', 'provider_token', 'refresh_token', 'csrf_token'] as const;

export type SessionCookieName = (typeof SESSION_COOKIE_NAMES)[number];

export function isValidSessionCookieName(value: unknown): value is SessionCookieName {
    return SESSION_COOKIE_NAMES.includes(value as SessionCookieName);
}

export function getSessionCookieNames(): readonly SessionCookieName[] {
    return SESSION_COOKIE_NAMES;
}

export function getSessionCookieOptions(cookieName: SessionCookieName) {
    const isProduction = process.env.NODE_ENV === 'production';

    return {
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
        sameSite: 'lax' as const,
        httpOnly: cookieName !== 'csrf_token',
        secure: isProduction,
    };
}

export function getExpiredSessionCookieOptions(cookieName: SessionCookieName) {
    return {
        ...getSessionCookieOptions(cookieName),
        maxAge: 0,
    };
}
