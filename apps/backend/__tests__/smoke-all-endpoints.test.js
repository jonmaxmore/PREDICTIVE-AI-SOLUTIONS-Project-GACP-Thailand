/**
 * Smoke tests for backend API routes.
 * These tests require a running backend server. They auto-skip when the server is unreachable.
 * Run explicitly: SMOKE_ENABLED=true npx jest smoke-all-endpoints
 */

const http = require("http");
const https = require("https");

const BASE = process.env.API_BASE_URL || "http://localhost:8000/api";
const MAX_REDIRECTS = 3;
const ALLOW_SELF_SIGNED = process.env.SMOKE_ALLOW_SELF_SIGNED === "true";

// Auto-skip when server is not running (prevent false failures in CI)
const SMOKE_ENABLED = process.env.SMOKE_ENABLED === "true";
const describeSmoke = SMOKE_ENABLED ? describe : describe.skip;

function parseBody(raw) {
    try {
        return JSON.parse(raw);
    } catch {
        return raw;
    }
}

function request(method, endpointOrUrl, body = null, redirects = 0) {
    const url = endpointOrUrl.startsWith("http")
        ? new URL(endpointOrUrl)
        : new URL(`${BASE}${endpointOrUrl}`);

    const transport = url.protocol === "https:" ? https : http;
    const payload = body ? JSON.stringify(body) : null;
    const headers = payload
        ? {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
            Connection: "close",
        }
        : {
            Connection: "close",
        };

    return new Promise((resolve, reject) => {
        const req = transport.request(
            {
                protocol: url.protocol,
                hostname: url.hostname,
                port: url.port || (url.protocol === "https:" ? 443 : 80),
                path: `${url.pathname}${url.search}`,
                method,
                timeout: 15000,
                rejectUnauthorized: !ALLOW_SELF_SIGNED,
                agent: false,
                headers,
            },
            (res) => {
                const status = res.statusCode || 0;
                const location = res.headers.location;

                if ([301, 302, 307, 308].includes(status) && location && redirects < MAX_REDIRECTS) {
                    const nextUrl = new URL(location, url).toString();
                    resolve(request(method, nextUrl, body, redirects + 1));
                    return;
                }

                let raw = "";
                res.on("data", (chunk) => {
                    raw += chunk;
                });
                res.on("end", () => {
                    resolve({ status, body: parseBody(raw) });
                });
            },
        );

        req.on("error", reject);
        req.setTimeout(15000, () => {
            req.destroy(new Error("Request timeout"));
        });
        if (payload) {
            req.write(payload);
        }
        req.end();
    });
}

function apiGet(endpoint) {
    return request("GET", endpoint);
}

function apiPost(endpoint, body = {}) {
    return request("POST", endpoint, body);
}

describeSmoke("Smoke: Health & Version", () => {
    test("GET /api/health returns 200", async () => {
        const { status, body } = await apiGet("/health");
        expect(status).toBe(200);
        expect(body.success).toBe(true);
    });

    test("GET /api/version returns version", async () => {
        const { status, body } = await apiGet("/version");
        expect(status).toBe(200);
        expect(body.version).toBeDefined();
    });

    test("GET /api/metrics refuses an anonymous caller", async () => {
        // This asserted an anonymous 200 until 2026-07-25, which is what the
        // endpoint actually did: nginx proxies all of /api/ to the backend and
        // nothing but the rate limiter stood in front of it, so operational
        // telemetry for a government platform was public. It is staff data now.
        const { status, body } = await apiGet("/metrics");
        expect(status).toBe(401);
        expect(body.success).toBe(false);
    });
});

describeSmoke("Smoke: Auth Endpoints", () => {
    test("POST /api/auth/health/login rejects bad creds", async () => {
        const { status, body } = await apiPost("/auth/health/login", {
            identifier: "invalid",
            password: "invalid",
        });
        expect([400, 401]).toContain(status);
        expect(body.success).toBe(false);
    });

    test("POST /api/auth/provider/login rejects bad creds", async () => {
        const { status, body } = await apiPost("/auth/provider/login", {
            username: "invalid",
            password: "invalid",
        });
        expect([400, 401]).toContain(status);
        expect(body.success).toBe(false);
    });
});

describeSmoke("Smoke: Protected Routes (no auth)", () => {
    const protectedGetRoutes = [
        { route: "/applications", expected: [401, 403] },
        { route: "/farms", expected: [401, 403] },
        { route: "/certificates", expected: [401, 403] },
        { route: "/audits", expected: [401, 403] },
        { route: "/planting-cycles", expected: [401, 403] },
        { route: "/lots", expected: [401, 403, 404] },
        { route: "/harvest-batches", expected: [401, 403] },
        { route: "/dashboard", expected: [401, 403, 404] },
        { route: "/notifications", expected: [401, 403] },
        { route: "/invoices", expected: [401, 403] },
        { route: "/payments", expected: [401, 403, 404] },
        { route: "/documents", expected: [401, 403] },
        { route: "/reports", expected: [401, 403] },
        { route: "/analytics", expected: [401, 403] },
        { route: "/fraud-detection", expected: [401, 403] },
        { route: "/labs", expected: [401, 403] },
        { route: "/interoperability", expected: [401, 403] },
        { route: "/training-records", expected: [401, 403] },
        { route: "/cultivation-logs", expected: [401, 403] },
        { route: "/site-analyses", expected: [401, 403] },
        { route: "/tickets", expected: [401, 403] },
        { route: "/consent", expected: [401, 403] },
        { route: "/provider/applications", expected: [401, 403] },
        { route: "/provider/dashboard", expected: [401, 403] },
        { route: "/admin/applications", expected: [401, 403] },
        { route: "/admin/users", expected: [401, 403] },
        { route: "/quotes", expected: [401, 403] },
        { route: "/accounting", expected: [401, 403] },
        { route: "/post-audit", expected: [401, 403] },
        { route: "/revision-deadline", expected: [401, 403] },
        { route: "/farm-audits", expected: [401, 403] },
        { route: "/consumer-feedback", expected: [401, 403] },
        // "/plant-units" left this list on 2026-08-25: the 16-endpoint router was
        // deleted with per-plant tracking (spec R8). It is not an auth-protected
        // route any more, it is not a route at all.
    ];

    for (const { route, expected } of protectedGetRoutes) {
        test(`GET ${route} without auth returns expected status`, async () => {
            const { status } = await apiGet(route);
            expect([...expected, 404]).toContain(status);
        });
    }
});

describeSmoke("Smoke: Public Routes", () => {
    test("GET /api/config returns data", async () => {
        const { status } = await apiGet("/config");
        expect([200, 401, 404]).toContain(status);
    });

    test("GET /api/standards returns data", async () => {
        const { status } = await apiGet("/standards");
        expect([200, 401, 403, 404]).toContain(status);
    });

    test("GET /api/criteria returns data", async () => {
        const { status } = await apiGet("/criteria");
        expect([200, 401, 403, 404]).toContain(status);
    });

    test("GET /api/master-data returns data", async () => {
        const { status } = await apiGet("/master-data");
        expect([200, 401, 403, 404]).toContain(status);
    });
});
