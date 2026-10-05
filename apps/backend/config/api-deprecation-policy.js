/**
 * Sunset dates for deprecated HTTP endpoints.
 *
 * Why this lives in `config/` and not beside the route
 * ---------------------------------------------------
 * `routes/`, `services/`, `jobs/` and `middleware/` must not read `process.env`
 * directly: every such read is counted by the env-direct ratchet
 * (scripts/probes/ratchet.sh) precisely because a knob that only exists inside a
 * route handler is invisible to anyone reading the configuration. The same rule
 * put the signing-key questions in `config/signing-key-policy.js`; a sunset date
 * is the same kind of value — deployment-visible policy, not request logic.
 *
 * What a sunset date is
 * ---------------------
 * RFC 8594: the value a deprecated endpoint returns in its `Sunset` header, the
 * date after which the caller must expect the route to be gone. It is a promise
 * made to integrators, so it belongs somewhere a release owner can read it —
 * see docs/architecture/deprecation-register.md, which lists the same routes.
 *
 * The env override exists so a staging rehearsal can bring a sunset forward and
 * watch the integrations that still call the old route fail there rather than in
 * production. Production is expected to run the dated default below.
 *
 * @module config/api-deprecation-policy
 */

'use strict';

/**
 * `POST /api/planting-cycles/:id/harvest` — the single-shot legacy harvest
 * recorder, superseded by `POST /api/planting-cycles/:id/harvest-batches`
 * (per-plot batches). Dated end of 2026 so integrators get a full season's
 * notice, since a cultivation cycle is measured in months.
 */
const HARVEST_LEGACY_SUNSET =
    process.env.PLANTING_HARVEST_LEGACY_SUNSET || 'Wed, 31 Dec 2026 23:59:59 GMT';

module.exports = {
    HARVEST_LEGACY_SUNSET,
};
