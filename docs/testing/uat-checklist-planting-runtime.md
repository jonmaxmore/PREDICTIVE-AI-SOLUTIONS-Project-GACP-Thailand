# UAT CHECKLIST - PLANTING RUNTIME (Health / Provider / Admin)

Last updated: 2026-02-15
Environment: production-like

## A) Health user scenarios

### UAT-P01 Open cycle from existing plots
- [ ] Login with health account
- [ ] Open `/health/planting/new`
- [ ] Only eligible farms (active certificate) are selectable
- [ ] Select 1+ plots and assign sqm + planned plants
- [ ] Save cycle successfully
- [ ] System redirects to `/health/planting/:id`

### UAT-P02 Generate plant units
- [ ] Click `Create plant units`
- [ ] Unit generation follows remaining quota
- [ ] Units appear under selected cycle/plot
- [ ] Unit list count matches summary metrics

### UAT-P03 Plot-level QR
- [ ] Open `Plots and QR` tab
- [ ] Click generate/refresh plot QR
- [ ] Each plot has its own QR
- [ ] Open public plot-cycle trace page successfully

### UAT-P04 Record activities
- [ ] Open activity page from cycle detail
- [ ] Record activity with valid scope/type
- [ ] Activity appears in timeline/list
- [ ] Activity appears in cycle history

### UAT-P05 Harvest and split by plot
- [ ] Open harvest modal
- [ ] Enter per-plot harvest weights and packaging rows
- [ ] System blocks invalid packaging totals
- [ ] System creates batch/lot split by plot
- [ ] Trace tab shows new batch/lot counts

### UAT-P06 Blocking policies
- [ ] No certificate -> generation/harvest blocked
- [ ] Unassigned units -> harvest blocked
- [ ] Over-plan units -> harvest blocked
- [ ] Closed cycle -> generation/harvest blocked

## B) Provider scenarios (read-only)

### UAT-P07 Provider planting overview
- [ ] Open `/provider/planting`
- [ ] Cycle list shows integrity summary
- [ ] No write actions are present

### UAT-P08 Provider cycle detail
- [ ] Open `/provider/planting/:id`
- [ ] Verify plot/unit/trace relationships
- [ ] Verify public trace links exist where expected

## C) Admin scenarios

### UAT-P09 Admin planting governance
- [ ] Open `/admin/planting`
- [ ] Integrity flags visible (over-plan/unassigned/legacy)
- [ ] Open `/admin/planting/:id` and verify chain visibility

## D) Data integrity and parity

### UAT-P10 Cross-screen parity
- [ ] Dashboard counts match list/detail counts
- [ ] Unit totals match API pagination totals
- [ ] Plot progress totals match per-plot quotas

### UAT-P11 API parity
- [ ] `GET /api/planting-cycles/:id` matches UI detail
- [ ] `GET /api/planting-cycles/:id/plot-qrs` matches UI plot QR list
- [ ] `GET /api/planting-cycles/:id/integrity` matches UI integrity alert

## E) Security and privacy

### UAT-P12 Public trace privacy
- [ ] Public plot trace returns required trace data
- [ ] No owner PII leakage
- [ ] Integrity status is exposed correctly

### UAT-P13 Tenant isolation
- [ ] Health user cannot access another user cycle
- [ ] Provider/admin access follows role policy

## F) Regression gate

Run and capture evidence:
- [ ] `pnpm --dir apps/backend run test -- --passWithNoTests --ci --forceExit`
- [ ] `pnpm --dir apps/web-app lint`
- [ ] `pnpm --dir apps/web-app run test -- --runInBand --passWithNoTests`
- [ ] `pnpm --dir apps/web-app build`
- [ ] `node scripts/run-regression-gate.js`

## Verdict format

- PASS: all items complete, no blocker
- PASS WITH ISSUE: non-blocking issues documented with owner/date
- FAIL: any blocker in flow, integrity, or security
