# UAT Readiness — mock inventory, DB-clear plan, execution gates

Compiled 2026-06-04 (read-only audit; no code/data deleted, no DB touched). This
is the evidence base for the owner's mandate: "clear mockups → clear DB → apply
design → carpet E2E → UAT → hardening loop." It exists so the destructive phases run
**confirm-and-go, not guess.**

## ⚠️ Why the destructive steps were NOT auto-executed (AFK)
- **DB wipe is irreversible + has a critical data-loss trap.** `bank_accounts`,
  `issuer_bank_accounts` (real finance account numbers, hand-entered after seed),
  `ReceiptSequence` (legally-sequential receipt/invoice numbering), `RoleGroup`,
  and `DocumentTemplate` have **NO re-seed with real values** — a naive
  `TRUNCATE ... CASCADE` or the stale `reset-for-handoff.js` would destroy them
  unrecoverably. Prod-shell DB ops are also classifier-gated (blocked AFK).
- **"Delete all mockups" is mostly intentional-by-design.** The inventory below
  shows the bulk of mock/stub markers are deliberate (WHT stub by legal directive,
  slip-flow replacing the gateway, API-first master-data, feature-flagged SOP,
  dev-only transport fallbacks). Deleting them blind = breaking real design.

Both confirm: these need the owner present + explicit target + backup.

## A. Mock / stub / placeholder inventory (replace-with-real worklist)

### True mockups to replace (high confidence)
| # | file:line | issue | effort |
|---|---|---|---|
| 1 | routes/api/applications/validation.js:51-79 | `/validation/land-check` fake geo (lat math, not PostGIS); no FE caller | M |
| 2 | web-app components/feature/dashboard-charts.tsx:15-24 | hardcoded "5-day historical trend" presented as real | M |
| 3 | routes/api/finance/credit-notes.js:161-194 + debit-notes.js:155-160 | `GET /:id/pdf` → 501 PDF_RENDER_NOT_WIRED (HTML template exists) | M |
| 4 | controllers/auth-controller/auth-session-security-handlers.js:81 | forgot-pw "Simulation Mode" + no email — **FIXED in PR #323 (BE-AUTH-03)** | done |
| 5 | (no file) BE-LAB-01 | `/labs` route entirely absent (lab-results feature unbuilt) | L |
| 6 | web-app features/permit-form/* + constants/document-slots.js (status:'STUB' ภ.ท.9-13) | permit forms unbuilt (slots/flags wired) | L |
| 7 | web-app features/permit-form/.../[invoice|receipt|quotation]-document.tsx (`*Demo` exports) | dead demo exports, no callers → delete/move to stories | S |
| 8 | config/secrets.js:434-450 | Vault/AWS/Azure backends are throw-stubs (only `env` works) | L (only if needed) |
| 9 | routes/api/system/analytics*.js (5 endpoints 501) | disabled analytics (stale SQL vs schema); zero FE callers | M each |

### Intentional / by-design — DO NOT "replace" without owner sign-off
WHT service+banner (legal — must not auto-deduct 3%); `MOCK_PROMPTPAY` gateway +
"simulated payment" (slip-flow is the real settlement, by design); master-data-
controller hardcoded (deliberate API-first config); SOP Builder behind
`feature.sop_library` flag; `PENDING_FINANCE_CONFIRMATION` bank placeholders
(guarded by boot-secret-guard; "replace" = Finance entering real numbers, not
code); dev-only SMS/email transport stubs (real prod paths exist).

## B. Clear-the-DB-for-UAT — SAFE procedure (owner runs/approves on the TARGET UAT DB)
**Use `apps/backend/scripts/clear-for-uat.js`** (added 2026-06-05) — it implements
this procedure with built-in guards and is the canonical tool. The manual steps
below document what it does.
1. **Confirm target** (must NOT be prod): `psql "$DATABASE_URL" -c "SELECT current_database(), inet_server_addr();"` — the chosen UAT target is **`gacp_staging`** (the separate staging DB per `docs/operations/staging-activation.md`), NEVER prod `gacp_db`. The script hard-refuses any DB named `gacp_db` or matching `/prod/i`.
2. **Backup first (mandatory):** `pg_dump --format=custom --no-owner --file=uat-preclear-<ts>.dump "$DATABASE_URL"` (proceed only if dump non-empty).
3. **Dry-run, then execute** the keep-allowlist wipe:
   ```bash
   # review the plan (no writes):
   CONFIRM_CLEAR_TARGET=gacp_staging node apps/backend/scripts/clear-for-uat.js
   # execute after backup:
   CONFIRM_CLEAR_TARGET=gacp_staging node apps/backend/scripts/clear-for-uat.js --execute
   ```
   The script resolves every table from Prisma's DMMF and `TRUNCATE ... RESTART IDENTITY CASCADE`s all 67 transactional tables in ONE transaction — so a newly-added model is wiped by default rather than silently left behind (the failure mode of the old hand-listed approach).
4. **KEEP (never wipe — 15 tables, enforced by the script's allowlist):** Organization, RoleGroup, DocumentTemplate, BankAccount, IssuerBankAccount, ReceiptSequence, SystemConfig, WizardStepConfig, CertificationStandard/Requirement, SupplementaryCriterion, PlantSpecies/DocumentRequirement, SlaPolicy, StageActivityConfig.
5. **Re-seed:** `node prisma/seed-gacp.js` (org + staff/test logins + sample apps). Do NOT re-run seed-bank-accounts / seed-receipt-sequences expecting real values (placeholders only).
6. **Verify:** the script auto-checks `issuer_bank_accounts`/`bank_accounts`/`receipt_sequences` are non-empty post-wipe and FAILS loudly otherwise. Confirm **`SELECT issuer_type, account_no FROM issuer_bank_accounts;`** still shows the REAL finance numbers (not PENDING).
- ⚠️ The shipped `scripts/reset-for-handoff.js` is STALE (missing Entity*/UserConsent/Quotation/CreditNote/JournalEntry/etc. + will throw on Restrict children). **Superseded by `clear-for-uat.js` — do not use the old one.**

## C. Execution order + gates (when owner is back)
1. **Merge open PRs first** (they ARE the "real" fixes): #319 bounce, #320 payment per-side, #321 gateway cleanup, #322 401-no-blanket-logout, #323 the 8 sweep fixes, #324 Sukhumvit Set design. (--admin merge gated → owner.)
2. **Deploy** merged main to the UAT/pilot env (rebuild BE+FE, run `prisma migrate deploy`).
3. **Replace true mockups** (A.1-3,5-9) per priority — each its own PR + tests.
4. **Clear DB for UAT** (B) — owner-confirmed target + backup.
5. **Carpet E2E** (FE+BE+DB) on the clean+real env.
6. **UAT** (human acceptance).
7. **hardening loop carpet** (re-run the 171-feature sweep — the hardening loop state already at 100% pre-mockup-replacement).
