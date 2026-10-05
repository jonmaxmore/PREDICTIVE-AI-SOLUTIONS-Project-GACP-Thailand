# Partner Interoperability API — onboarding

Machine-to-machine (M2M) API for partner agencies (e.g. MOPH, FDA) to **pull
certificate / traceability data** from the GACP platform.

> **Common mistake (this doc exists because a partner hit it):** there is **no
> "health-ID login"** for the API. The 13-digit national-ID + password login is
> only for the applicant **web portal** (`/auth/health`). The API authenticates
> with a **per-partner API key** sent in the `x-api-key` header — see below.

---

## 1. Base URL (the "domain")

| Environment | Base |
|---|---|
| Production | `https://gacpth.com/api/interoperability/v1` |
| Staging (sandbox) | `https://staging.gacpth.com/api/interoperability/v1` |

## 2. Authentication

Send your issued secret in the **`x-api-key`** header on every protected call:

```
x-api-key: <your-partner-secret>
```

- No header → `401 { "code": "PARTNER_KEY_MISSING" }`
- Wrong key → `401 { "code": "PARTNER_KEY_INVALID" }`
- Keys are matched timing-safe; the platform is **fail-closed** (no key configured ⇒ everything 401).
- There is no Bearer/JWT, no OAuth, no login call. Just the header.

To get a key, contact the platform operator (provisioning steps in §5).

## 3. Endpoints

### Public — no key required
| Method · Path | Returns |
|---|---|
| `GET /trust/public-key` | Platform signing public key + fingerprint |
| `GET /verification?certificateNumber=` | Certificate validity/status (public facts only, 30 req/IP/min) |
| `GET /data-contracts/traceability` | Traceability data schema (contract) |
| `GET /event-contracts/trace-events` | Trace-event schema (contract) |
| `POST /signatures/verify` | Verify a signature `{ payload, signature, publicKey }` |

### Partner-key required (`x-api-key`) — rate-limited
| Method · Path | Returns |
|---|---|
| `GET /trust/registry` | Bulk certificate registry (cert data + PII, up to 1000 rows) |
| `GET /trust/revocations` | Revoked certificates |
| `GET /certificates/:certificateNumber/e-certificate` | Full e-certificate (data + PII + signature) |
| `GET /certificates/:certificateNumber/signed-envelope` | Signed envelope (+ publicKey, fingerprint) |
| `GET /trace/events/:entityType/:entityId` | Trace events for an entity |

`:entityType` is upper-cased server-side; values that carry trace events include
`PLANTING_CYCLE`, `HARVEST_BATCH`, `PACKAGING_LOT` (coordinate the exact
type/id with the operator, or discover ids via `/trust/registry`).

## 4. Examples

```bash
# Bulk certificate registry (the usual "pull the data/log" call)
curl -H "x-api-key: $KEY" \
  "https://gacpth.com/api/interoperability/v1/trust/registry"

# One full e-certificate
curl -H "x-api-key: $KEY" \
  "https://gacpth.com/api/interoperability/v1/certificates/GACP-2026-000123/e-certificate"

# Public — verify a certificate (no key)
curl "https://gacpth.com/api/interoperability/v1/verification?certificateNumber=TH-GACP-123-2569"
```

All responses are JSON `{ "success": true, "data": ... }` (or `{ "success": false, "code": ... }`).

---

## 5. Provisioning a partner key (operator / owner only)

The backend service runs with an **explicit compose `environment:` list and no
`env_file`**, so a value in `.env.production` only reaches the container if it is
also a compose passthrough. That passthrough was added in
`fix/interop-partner-api-key-passthrough` — **it must be deployed first**, otherwise
setting the env var silently has no effect.

1. **Deploy the compose passthrough** (merge + promote `fix/interop-partner-api-key-passthrough`, then `git pull` on the droplet so `docker-compose.production.yml` carries `INTEROP_PARTNER_API_KEYS=${INTEROP_PARTNER_API_KEYS:-}`).
2. **Generate a secret:** `openssl rand -hex 32`
3. **Set it in the host env** (`/opt/gacp-platform/.env.production`), JSON `{partnerId: secret}` — merge if multiple partners already exist:
   ```
   INTEROP_PARTNER_API_KEYS='{"moph":"<secret-1>","fda":"<secret-2>"}'
   ```
4. **Recreate the backend** (picks up the env; keys are read at boot):
   ```bash
   sudo docker compose --env-file .env.production -f docker-compose.production.yml \
     up -d --no-deps backend
   ```
5. **Verify:** `curl -H "x-api-key: <secret>" https://gacpth.com/api/interoperability/v1/trust/registry` → `200`.
6. **Hand the partner:** base URL (§1) + their secret + this doc. Rotate by editing the JSON + recreating.

Mechanism: `middleware/partner-api-key.js` (`requirePartnerApiKey`), regression test
`__tests__/unit/interoperability-partner-auth.test.js` (8/8). Convention mirrors
`PARTNER_TRACE_API_KEY` / `LAB_API_KEY`. Storing only salted hashes is future hardening.

---

## 6. Universal code resolver — `GET /v1/resolve?code=` (DTAM Next, 2026-07-08)

**The one-call answer to "what is this scanned QR/code + its provenance?"**
Partner-key required (same `x-api-key` + 120 req/15 min limiter — quota is
**per partner**, not per IP). Every partner call is access-logged
(`partner_access_logs`: partnerId, path, code, resolved entity, status, ip).

```
GET /api/interoperability/v1/resolve?code=<scanned string, URL-encoded>
x-api-key: <partner secret>
```

Accepts ANY of the live identifier shapes:

| Input shape | Resolves to |
|---|---|
| `GACP-*` (e.g. `GACP-TH-2569-A3F7B2`) | `CERTIFICATE` |
| `UNIT-*` (plant display code) / `PU-*` (plant QR) | `PLANT_UNIT` |
| `BATCH-*` (batch number) / `BT-*` (regenerated batch QR) | `HARVEST_BATCH` |
| `LOT-*` | `PACKAGING_LOT` first, then legacy `HARVEST_BATCH` (two retired batch-number generators also emitted `LOT-*`) |
| Bare UUID | `TraceQrSecurity` index first (plot-cycle QRs + batch/lot QR UUIDs), then cascade: certificate → plant unit → planting cycle → harvest batch → lot |
| Full URL (`https://gacpth.com/trace/plant/PU-…`, `/trace/plot-cycle/<uuid>`, `/trace/batch/<id>`, `/trace/lot/<id>`, `/verify/<cert>`, legacy doubled `/trace/trace/plant/…`) | normalized, then typed probe |

**Response (200):**

```json
{
  "success": true, "resolved": true, "code": "<input>",
  "matched": { "entityType": "HARVEST_BATCH", "entityId": "…", "keyKind": "batchNumber" },
  "provenance": { "batchNumber": "…", "farm": { "name": "…", "province": "…", "district": "…" },
                  "certificateNumber": "GACP-TH-…", "certificateStatus": "ACTIVE" },
  "trust": { "trustStatus": "ACTIVE", "valid": true },
  "seal": { "sealed": true, "status": "ACTIVE", "scanCount": 7 },
  "links": { "traceEvents": "/api/interoperability/v1/trace/events/HARVEST_BATCH/<id>",
             "publicTrace": "/trace/batch/<id>" }
}
```

- **Unknown code → 404** `{ "resolved": false, "probed": [...] }` (the probe trail).
- **Upstream fault → 500** (never a false "not found" — a DB error fails loudly).
- **PII posture:** never contains `applicantName` or any national ID — farm
  name/province/district + certificate number/status only. Follow-up detail
  comes from `links.traceEvents` (partner-gated) or the public trace pages.
- `entityType` values: `CERTIFICATE · PLANT_UNIT · PLANTING_CYCLE ·
  PLANTING_CYCLE_PLOT · HARVEST_BATCH · PACKAGING_LOT`. For
  `PLANTING_CYCLE_PLOT`, `links.traceEvents` points at the parent
  `PLANTING_CYCLE` (the events endpoint has no plot type).
- Clients MUST tolerate unknown `trustStatus` strings beyond
  `ACTIVE/REVOKED/EXPIRED/INVALID` (raw statuses can pass through).

**Plant-unit provenance (ตอบครบใน call เดียว):** scanning a plant code/QR
(`UNIT-…` / `PU-…`) returns the full seed-to-sale chain —

```json
{
  "matched": { "entityType": "PLANT_UNIT", "keyKind": "plantQr" },
  "provenance": {
    "plant":  { "code": "UNIT-2026-AB12-00001", "status": "HARVESTED",
                "plantedAt": "…", "harvestedAt": "…" },
    "plot":   { "name": "แปลง A1", "solarSystem": "GREENHOUSE", "plannedPlantCount": 120 },
    "cycle":  { "status": "HARVESTING", "plantedCount": 120, "estimatedPlantCount": 150 },
    "batch":  { "batchNumber": "BATCH-2026-000123" },
    "lots":   [ { "lotNumber": "LOT-2026-000123-A" } ],
    "farm":   { "name": "…", "province": "…", "district": "…" },
    "certificateNumber": "GACP-TH-…", "certificateStatus": "ACTIVE"
  }
}
```

`batch: null` + `lots: []` for a plant not yet harvested; `plot: null` when the
unit was never assigned to a plot.

### DTAM Next quick-start (ต้นน้ำ → กลางน้ำ/ปลายน้ำ)

1. Owner provisions key `dtam-next` per §5.
2. Scan flow: `GET /v1/resolve?code=<scan>` → classify + provenance in one call.
3. Deep provenance timeline: follow `links.traceEvents`.
4. Certificate trust checks / bulk sync: `GET /v1/verification?certificateNumber=`
   (public), `GET /v1/trust/registry`, `GET /v1/trust/revocations?since=` (partner).
5. Signature verification: `GET /v1/trust/public-key` + `POST /v1/signatures/verify`.

Known limits (v1, by design): trace-event `eventId`s are per-request (not stable
for sync dedupe — use `entityId`+`eventType`+`occurredAt`); no single-call
lot→batch→cycle lineage expansion (stitch via `links`); resolver treats bare
UUIDs by the fixed probe order documented above.
