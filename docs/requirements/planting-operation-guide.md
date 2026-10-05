# PLANTING OPERATION GUIDE (Health / Provider / Admin)

Last updated: 2026-02-15  
Scope: `web + backend runtime` (production)

## 1) Purpose

This guide defines how the planting module is operated in real use.
The module must keep traceability clear from:

`Farm -> Plot -> Cycle -> Plant Unit -> Harvest Batch -> Packaging Lot -> Public QR`

## 2) Core principles

- A plant unit always belongs to one plot assignment in a planting cycle.
- A lot always maps back to one source plot through its batch.
- Plot-cycle QR is mandatory for each plot used in a cycle.
- Public trace reveals required trace data only (no sensitive owner data).
- Data integrity issues (over-plan, unassigned units) must be resolved before harvest.

## 3) Health role (Applicant-side runtime)

### 3.1 Open a cycle

Path: `/health/planting/new`

Required:
- Select farm with active certificate
- Select at least one plot
- Set `allocated area (sqm)` and `planned plant count` per plot

Result:
- Cycle created
- Optional auto generation of plant units

### 3.2 Execute cycle

Path: `/health/planting/:id`

Standard sequence:
1. Generate plant units
2. Record daily activities
3. Generate plot QR for each plot
4. Harvest and create batch/lot split by plot

Blocking rules before harvest:
- No active certificate -> block
- Unassigned plant units -> block
- Over-plan units -> block
- No plant units -> block

## 4) Provider role (read-only verification)

Paths:
- `/provider/planting`
- `/provider/planting/:id`

Provider checks:
- Plot-level source consistency
- Unit summary parity with cycle plan
- Batch/Lot split integrity
- Trace public link availability

Provider has no write actions in planting cycle runtime.

## 5) Admin role (oversight)

Paths:
- `/admin/planting`
- `/admin/planting/:id`

Admin focus:
- Data quality trends
- Legacy data flags
- Exception cycles (over-plan / unassigned)
- Cross-screen parity and auditability

## 6) Plot QR and trace policy

- Generate endpoint: `POST /api/planting-cycles/:id/plot-qrs/generate`
- List endpoint: `GET /api/planting-cycles/:id/plot-qrs`
- Public resolve: `GET /api/trace/plot-cycle/:qrCode`

Public trace must include:
- Farm context (name + area context)
- Plot/cycle identity
- Cultivation method
- Unit and trace summaries
- Integrity status

## 7) Integrity operations

Endpoints:
- `GET /api/planting-cycles/:id/integrity`
- `GET /api/planting-cycles/integrity/report`

Operational script:
- `node apps/backend/scripts/report-planting-integrity.js --healthId <healthId>`

Interpretation:
- `overPlanCount > 0` => adjust/reconcile before harvest
- `unassignedCount > 0` => map units to plots before harvest
- `isLegacyDataIssue = true` => historical data kept for transparency

## 8) Incident handling

If health user reports mismatch:
1. Validate cycle integrity endpoint
2. Validate plot QR list
3. Validate unit list by `cyclePlotId`
4. Validate harvest batch/lot split history
5. Re-run integrity report script and capture evidence

## 9) Handoff checklist for new engineers

- Read `docs/system-map.md`
- Read `docs/active-api-surface.md`
- Read `docs/planting-runtime-blueprint.md`
- Read this file before changing planting business logic
