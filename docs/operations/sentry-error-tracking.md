# Error tracking with Sentry (PII-scrubbed)

Sentry was re-added on 2026-10-02 by operator decision. Personal-data scrubbing is the first requirement. This page replaces `sentry-installation-guide-2026-05-17.md`, which describes code that no longer exists.

## What it is

| | Backend (Express) | Web app (Next.js 15) |
|---|---|---|
| SDK | `@sentry/node` 11 | `@sentry/nextjs` 11 |
| Sentry project | backend project | web project |
| Turned on by | `SENTRY_DSN` (runtime env) | `NEXT_PUBLIC_SENTRY_DSN` (**build arg**: `next build` inlines it) |
| Init | `apps/backend/config/sentry.js`, called at the top of `server.js` | `src/instrumentation-client.ts` (browser), `src/instrumentation.ts` (Node server). The edge middleware is not instrumented. |
| Release | `GIT_SHA` build arg, already in the image | the same `GIT_SHA` build arg: the Dockerfile bakes it as `NEXT_PUBLIC_SENTRY_RELEASE` for the browser, and the server reads it at runtime |
| Environment | `SENTRY_ENVIRONMENT`, else `GACP_DEPLOY_SLOT`, else `NODE_ENV` | browser: `NEXT_PUBLIC_SENTRY_ENVIRONMENT`, else the page's hostname (one image serves demo and staging); server: `SENTRY_ENVIRONMENT` |
| Traces | `SENTRY_TRACES_SAMPLE_RATE`, default 0.05 | `NEXT_PUBLIC_SENTRY_TRACES_SAMPLE_RATE`, default 0.05 |
| Not used | profiling, local variables | Session Replay, the feedback widget, `withSentryConfig`, `tunnelRoute` |

**Off by default.** With no DSN, the backend never loads the SDK and the browser never fetches the SDK chunk. Nothing is sent. The tests prove this at the wire (see the evidence index).

A DSN is an ingest-only key: it can send events, not read them. It is still deploy configuration. It goes in the env file or the build arg, and never in the repository.

## Turning it on, per environment

The operator does this at deploy time. Both DSNs are in `/home/ubuntu/work/state/sentry/dsn.env`: `SENTRY_DSN_BACKEND` and `SENTRY_DSN_WEB`.

| Where | Set |
|---|---|
| staging backend | `SENTRY_DSN=<backend DSN>` in `/opt/gacp-platform/.env.staging`. The staging overlay forwards it and sets `SENTRY_ENVIRONMENT=staging`. |
| demo backend | `SENTRY_DSN=<backend DSN>` in `.env.demo`. The demo compose file already sets `SENTRY_ENVIRONMENT=demo`. |
| web image (serves both) | `docker build -f apps/web-app/Dockerfile --build-arg NEXT_PUBLIC_SENTRY_DSN=<web DSN> --build-arg GIT_SHA=$SHA ...`. Compose sets `SENTRY_ENVIRONMENT` per frontend container for the server side. |

The middleware's CSP adds exactly the DSN's ingest origin (scheme and host) to `connect-src`. It adds no wildcard and never the key. A web image built without the DSN has no Sentry host in its CSP.

Check after deploy: `docker exec gacp-backend-staging node scripts/sentry-smoke.js`. The script sends one error marked `[TEST]` with a fake ID through the same init and Express handler. It prints the event id, the ingest HTTP status and the message as sent. It never prints the DSN. Look the event id up in Sentry and confirm that the fake ID is absent.

## What is scrubbed

There is one module for both sides: `packages/error-reporting/src/scrub.js`. It runs in three places:

1. **What the SDK collects at all** (`dataCollection`, SDK 11). SDK 11 removed `sendDefaultPii`, and every `dataCollection` default is on: cookies, all headers, request and response bodies, query strings, DB query data and local variables. On 2026-10-02 we measured a request body leaving in a span attribute under those defaults. All of it is switched off. `sendDefaultPii: false` is still set for older SDKs.
2. **`beforeSend`, `beforeSendTransaction` and `beforeBreadcrumb`.** Traces are sent as transaction events (`traceLifecycle: 'static'`), so `beforeSendTransaction` sees every span. The SDK 11 default (`'stream'`) bypasses it.
3. **The transport.** Every envelope is scrubbed again just before it is sent. Session items (IP, user email as `did`) and streamed spans never pass `beforeSend`. Attachments, replays, profiles and feedback are dropped outright. If an envelope cannot be scrubbed, it is not sent.

What is removed:
- **Requests:** the body, cookies, `env` and **the whole query string, on every route**. A search box sends names (`/provider/applications?q=…`), and SDK 11 copies URLs into breadcrumbs and `request.url` whatever `dataCollection` says. Every header except content-type, content-length, accept*, user-agent, host, origin, referer, x-request-id and x-api-version is dropped, so Authorization is gone. Referer and Origin are cut to origin and path.
- **URLs everywhere** (breadcrumbs, spans, trace data, free text): the query and the fragment are dropped. A path segment that carries Thai text, whitespace or one of the patterns below becomes `[Filtered]`.
- **Prisma errors:** the message is cut to the operation and its summary line, for example ``Invalid `user.create()` invocation: Argument `password` is missing.`` Prisma prints the call's whole argument tree, values included.
- **User:** only `id`, and only when it is a UUID. No name, email or IP.
- **Patterns** in messages, exception values, transaction names, spans, breadcrumbs, extra, contexts and tags:
  - Postgres `DETAIL:` lines, `Key (col)=(…)` and `Failing row contains (…)`;
  - 13-digit national and tax IDs, in ASCII or Thai digits, with any single `-`, `.` or space between digits;
  - emails, including `%40`;
  - Thai mobile and landline numbers (`0…`, `+66…`, with dots, brackets or Thai digits);
  - JWTs, Bearer and Basic credentials;
  - Stripe `pi_`, `cs_` and `seti_` ids and client secrets, `sk_` and `rk_` keys, `whsec_`;
  - the password in a `postgres://` URL;
  - `password=` and `token=`-style pairs.
- **Keys:** a value is replaced whole when its key contains `name`, `address`, `phone`, `mobile`, `email`, `passport`, `citizen`, `national`, `tax`, `juristic`, `registration`, `birth`, `contact`, `holder`, `person`, `applicant`, a credential word or a coordinate word. The same applies when one of the key's words is `pid`, `dob`, `tel`, `lat`, `lng` or `ip`. `apps/backend/__tests__/unit/sentry-pii-schema-fields.test.js` reads every field of `prisma/schema/*.prisma` and fails if a personal-looking column is not covered.
- **Tags and console lines:** a tag value with Thai text is replaced. A console breadcrumb that carried any pattern, or any Thai text, is dropped, because a name cannot be told apart from prose. Fetch, XHR and HTTP breadcrumbs lose their bodies and headers.
- **Kept:** the error type, the stack trace with source context, the mechanism, release, environment, trace and span ids, and SDK contexts (OS, runtime, browser).

What it cannot see: a person's **name inside an error message** ("ไม่พบ นายสมชาย ใจดี") has no shape that a pattern can match. Exception messages are kept, because they are the point of an error report.
- **Hand-written free text:** a name or address typed without any recognisable shape, in a message the code builds, is not detected. That includes Thai text in an exception message and an unencoded value with spaces after `?` in a logged line.
- **Latin-script names** ("Mana Testfive") are not detected anywhere outside a named field. Only key-based removal and URL/Thai-text rules apply to them. Names are removed where they sit in a named field, not inside prose. Do not build error messages from names. The server-side scrubber below is the second layer.

## Second layer: Sentry project settings (operator, once per project)

In **both** projects, under Settings → Security & Privacy:
- **Data Scrubber: on.** Also turn on "Use Default Scrubbers".
- **Prevent Storing of IP Addresses: on.**
- Optional: add `nationalId`, `idCard`, `taxId`, `phone` to "Additional Sensitive Fields".

## Follow-ups (not in this branch)

- **Source maps.** They are not uploaded, because no auth token is set. Stack frames show built code. Uploading needs a Sentry auth token as a build secret and `withSentryConfig` (or `sentry-cli`) in the image build, with telemetry off and `tunnelRoute` never enabled.
- **SDK 12** removes `traceLifecycle: 'static'` and `beforeSendTransaction`. Before upgrading, move span scrubbing to `beforeSendSpan`. The transport gate already scrubs streamed spans, and `apps/backend/__tests__/unit/sentry-express-envelope.test.js` fails if a span leaks.
- **Edge runtime** (the Next middleware) is not instrumented.
