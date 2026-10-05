# Provider Decision Record Template

Last updated: 2026-03-08

## 1. Decision metadata

- Decision date: `________________`
- Reviewers: `________________`
- Current runtime provider: `________________`
- Candidate providers reviewed: `________________`

## 2. Business and reliability targets

- Availability SLO target: `________________`
- RTO target: `________________`
- RPO target: `________________`
- Budget range: `________________`
- Expected 12-month growth assumption: `________________`

## 3. Scorecard summary

- Scorecard file: `docs/provider-evaluation-scorecard.csv`
- Evidence file: `docs/provider-evaluation-evidence-2026-03-08.md`
- Provider map file: `infra/providers/provider-map.json`
- Summary command:
  `npm run score:provider-evaluation`
- Weighted results:
  - AWS: `________________`
  - GCP: `________________`
  - Azure: `________________`
  - DigitalOcean: `________________`

## 4. Blockers and waivers

- Provider blockers identified:
  - `________________`
- Waivers approved:
  - `________________`

## 5. Decision

- Selected provider: `________________`
- Reason selected:
  - `________________`
- Providers not selected:
  - `________________`

## 6. Migration implications

- Edge migration required: `YES / NO`
- Database migration required: `YES / NO`
- Cache migration required: `YES / NO`
- Object storage migration required: `YES / NO`
- DNS cutover required: `YES / NO`
- Rollback anchor defined: `YES / NO`

## 7. Next action

- IaC owner: `________________`
- Provider map updated: `YES / NO`
- Initial migration phase approved:
  - `________________`
- Follow-up ADR or ticket:
  - `________________`
