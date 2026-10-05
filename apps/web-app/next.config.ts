import type { NextConfig } from "next";
import path from "node:path";
import withSerwistInit from "@serwist/next";

// Internal URL for server-side rewrites (uploads)
// Priority: INTERNAL_API_URL -> BACKEND_URL -> localhost:8000
// NOTE: /api/* is NOT rewritten here because app/api/[...path]/route.ts handles it.
const internalBackendUrl =
  process.env.INTERNAL_API_URL ||
  process.env.BACKEND_URL ||
  "http://localhost:8000";

// Public URL for browser traffic (Browser -> Next.js -> backend via proxy route)
const publicBackendUrl = process.env.NEXT_PUBLIC_API_URL || "http://localhost:3000";

// Keep PWA disabled by default until TLS/domain is fully trusted in production.
const pwaEnabled = process.env.NEXT_PUBLIC_PWA_ENABLED === "true";

const nextConfig: NextConfig = {
  // Standalone output for production deployment
  output: "standalone",
  outputFileTracingRoot: path.join(__dirname, "../.."),

  // Optimize images: serve modern formats (WebP/AVIF) automatically
  images: {
    formats: ["image/avif", "image/webp"],
    minimumCacheTTL: 60 * 60 * 24 * 30, // 30 days
  },

  // Transpile workspace packages (TypeScript source)
  transpilePackages: ["@gacp/validation", "@gacp/error-reporting"],

  // Rewrites for static assets served by backend
  async rewrites() {
    return [
      {
        source: "/uploads/:path*",
        destination: `${internalBackendUrl}/uploads/:path*`,
      },
    ];
  },

  // External packages for server
  serverExternalPackages: ["ioredis"],

  env: {
    NEXT_PUBLIC_API_URL: publicBackendUrl,
    NEXT_PUBLIC_PWA_ENABLED: pwaEnabled ? "true" : "false",
  },
};

const withSerwist = withSerwistInit({
  swSrc: "src/app/sw.ts",
  swDest: "public/sw.js",
  disable: process.env.NODE_ENV === "development" || !pwaEnabled,
  register: pwaEnabled,
});

// ERROR TRACKING (Sentry) — re-added 2026-10-02 by operator decision, with
// personal-data scrubbing. The SDK is initialised from src/instrumentation.ts
// (server) and src/instrumentation-client.ts (browser), and only when
// NEXT_PUBLIC_SENTRY_DSN is baked into the build; every event passes the shared
// scrubber in packages/error-reporting/src/scrub.js. The CSP admits exactly the
// DSN's ingest origin (src/middleware.ts).
//
// This export is deliberately NOT wrapped in `withSentryConfig`:
//   - no source-map upload in this branch (no auth token; follow-up in
//     docs/operations/sentry-error-tracking.md), and the wrapper's build
//     plugin would otherwise run at build time;
//   - its `tunnelRoute` option proxies events through this app's own origin,
//     which would bypass the CSP connect-src allowlist — never enable it.
export default withSerwist(nextConfig);
