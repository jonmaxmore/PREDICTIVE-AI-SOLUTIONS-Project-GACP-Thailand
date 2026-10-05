/**
 * The last word under /api — a JSON one.
 *
 * Measured on the running demo backend 2026-09-08: nothing caught an unmatched
 * /api path, so the request fell through to Express's default finalhandler and
 * came back as an HTML error page (~1.1 KB, and on that host carrying an
 * injected Cloudflare challenge script). Every JSON client — the web app's
 * api-client, an integrating ministry, a generated SDK — received a document it
 * could not parse:
 *
 *   GET    /api/plots            404 "<!DOCTYPE html>…"
 *   DELETE /api/applications/my  404 "<!DOCTYPE html>…"   ← the path exists for GET
 *
 * The second line is the sharper problem. 404 says "no such resource" when the
 * resource is fine and only the verb is wrong, so a client cannot tell a typo in
 * the path from a typo in the method. RFC 9110 §15.5.6 has a status for exactly
 * that — 405, with an `Allow` header naming the methods that do exist — and this
 * handler answers it by asking the router which verbs are registered for the
 * path before concluding the path is unknown.
 *
 * MOUNT ORDER MATTERS: this must come AFTER every /api router and BEFORE the
 * global error handler. Mounted earlier it would swallow real routes.
 *
 * Guarded by __tests__/integration/api-answers-json-not-html.test.js.
 */

const HTTP_METHODS = ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'];

/**
 * Which methods this Express app has actually registered for `pathname`.
 *
 * Walks the router stack rather than guessing. Returns [] when the path matches
 * no route at all, which is what separates 405 from 404.
 */
function methodsRegisteredFor(app, pathname) {
    const found = new Set();
    const router = app?._router || app?.router;
    const stack = router?.stack;
    if (!Array.isArray(stack)) { return []; }

    const walk = (layers, mountedAt) => {
        for (const layer of layers) {
            if (layer.route) {
                const full = joinPath(mountedAt, layer.route.path);
                if (pathMatches(full, pathname)) {
                    for (const [method, on] of Object.entries(layer.route.methods || {})) {
                        if (on) { found.add(method.toUpperCase()); }
                    }
                }
                continue;
            }
            const nested = layer.handle?.stack;
            if (Array.isArray(nested)) {
                walk(nested, joinPath(mountedAt, mountPathOf(layer)));
            }
        }
    };

    try { walk(stack, ''); } catch { return []; }
    if (found.size > 0) { found.add('OPTIONS'); }
    return HTTP_METHODS.filter((m) => found.has(m));
}

/**
 * Recover a router's mount path from its regexp — Express does not keep the string.
 *
 * The first version of this stopped at the FIRST separator, so a router mounted
 * at a path with more than one segment came back as only its first segment:
 *
 *     use('/audit/scheduling', r)   ->  '/audit'      <- wrong
 *     use('/auth/health', r)        ->  '/auth'       <- wrong
 *
 * Measured on the running system 2026-09-09, that produced BOTH failure
 * directions at once:
 *
 *   DELETE /api/audit/scheduling/queue   404   (GET exists there -> should be 405)
 *   DELETE /api/auth/login               405 Allow: POST
 *   POST   /api/auth/login               404   <- following our own Allow header
 *
 * The second pair is the serious one. `/api/auth/login` is not a route at all —
 * the login doors are /api/auth/health/login and /api/auth/provider/login — but
 * the truncated mount made `/auth` + `/login` look like a registered path, so the
 * API advertised a login endpoint that does not exist and named the method to use
 * on it. An integrating client or generated SDK that trusts `Allow` is sent
 * straight into a 404.
 *
 * Express compiles `use('/a/b')` to `/^\/a\/b\/?(?=\/|$)/i`, so the whole
 * prefix is there — it just has to be read to the end rather than to the first
 * separator. A mount whose recovered path still carries regex syntax (a mount
 * with a :param, which this codebase does not currently use) is reported as
 * unknown: that costs a 405 and answers 404 instead, which is the safe direction.
 * Fabricating a path is not.
 */
function mountPathOf(layer) {
    const source = layer?.regexp?.source;
    if (!source || layer?.regexp?.fast_slash) { return ''; }
    // Everything between the anchor and the optional trailing slash IS the mount.
    const m = /^\^(.*?)\\\/\?(?:\(\?=|\$)/.exec(source);
    if (!m || !m[1]) { return ''; }
    const recovered = m[1].replace(/\\(.)/g, '$1');
    // A recovered path must be a literal path, not a pattern. Anything else means
    // we could not read this mount, and guessing is how the bug above happened.
    if (!/^(?:\/[A-Za-z0-9._~-]+)+$/.test(recovered)) { return ''; }
    return recovered;
}

function joinPath(a, b) {
    const left = String(a || '').replace(/\/+$/, '');
    const right = String(b || '');
    if (!right || right === '/') { return left || '/'; }
    return left + (right.startsWith('/') ? right : '/' + right);
}

/** Compare a registered route path (which may carry :params) with a concrete pathname. */
function pathMatches(routePath, pathname) {
    if (routePath === pathname) { return true; }
    const routeParts = routePath.split('/').filter(Boolean);
    const pathParts = pathname.split('/').filter(Boolean);
    if (routeParts.length !== pathParts.length) { return false; }
    return routeParts.every((part, i) => part.startsWith(':') || part === pathParts[i]);
}

function apiNotFoundHandler(req, res) {
    const pathname = req.originalUrl.split('?')[0];
    const allowed = methodsRegisteredFor(req.app, pathname);

    if (allowed.length > 0 && !allowed.includes(String(req.method).toUpperCase())) {
        res.set('Allow', allowed.join(', '));
        return res.status(405).json({
            success: false,
            code: 'METHOD_NOT_ALLOWED',
            error: 'Method Not Allowed',
            message: `${req.method} is not supported for this endpoint. Allowed: ${allowed.join(', ')}.`,
            messageTh: `ปลายทางนี้ไม่รองรับวิธี ${req.method} · ที่รองรับ: ${allowed.join(', ')}`,
            path: pathname,
            method: req.method,
            allow: allowed,
            requestId: req.id || null,
            timestamp: new Date().toISOString(),
        });
    }

    return res.status(404).json({
        success: false,
        code: 'ROUTE_NOT_FOUND',
        error: 'Not Found',
        message: `No route matches ${req.method} ${pathname}.`,
        messageTh: 'ไม่พบปลายทางนี้ในระบบ',
        path: pathname,
        method: req.method,
        requestId: req.id || null,
        timestamp: new Date().toISOString(),
    });
}

module.exports = { apiNotFoundHandler, methodsRegisteredFor };
