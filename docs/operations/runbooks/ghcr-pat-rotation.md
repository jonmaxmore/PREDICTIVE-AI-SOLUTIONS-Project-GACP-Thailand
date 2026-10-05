# Runbook — GHCR PAT Rotation (Production Deploys Blocked)

**Status:** active for the *legacy pull path* only
**Owner:** platform operator (jonmaxmore)
**Last reviewed:** 2026-04-29 · **truth-checked 2026-08-14**
**Tooling:** `scripts/maintenance/fix-ghcr-pat.sh`

> **Read this first (2026-08-14).** No new image reaches GHCR any more:
> `.github/workflows/build-images.yml` cannot run (operator ruled Actions unpaid —
> the change log 2026-08-14), and images are now built on the box
> (`docs/operations/runbooks/build-images-on-the-box.md`), with
> `scripts/deploy/deploy-staging.sh` skipping the pull when a local image exists.
> So a GHCR PAT only matters when pulling an **old** tag that was pushed before
> that date. If a deploy fails on `pull`, first ask whether it should be pulling
> at all — the answer is usually "build it on the box instead".

This runbook covers the case where production deploys fail at the
`docker compose pull` step with `error from registry: denied`. The cause
is almost always that the GHCR Personal Access Token (PAT) registered on
the droplet has expired, been revoked, or was never persisted. Recorded
as Phase 1 #1.13 of the 2026-04-27 audit.

> **TL;DR** — generate a new fine-grained PAT in GitHub, then on the
> production droplet:
> ```bash
> sudo GHCR_PAT='ghp_...' bash /opt/gacp-platform/scripts/maintenance/fix-ghcr-pat.sh
> ```
> The script logs in to ghcr.io, verifies the auth entry was written,
> test-pulls one of the GACP images, and (optionally) re-runs
> `deploy-production.sh`.

---

## 1. When to run this

Run when **any** of these symptoms appear:

- `scripts/deploy/deploy-production.sh` fails inside step 5 (rolling
  restart) with a `denied` or `unauthorized` error from `ghcr.io`.
- `docker compose -f docker-compose.production.yml pull` returns
  `error from registry: denied`.
- `cat /root/.docker/config.json` shows no entry under `"auths"` for
  `ghcr.io` (or shows one but the credential is rejected when used).
- The cron-scheduled "GHCR PAT health" routine flagged a 401 on probe.

PATs expire on the date set during creation. The current PAT was
generated for v3.1.0 on 2026-04-26 and has a finite lifetime. Rotate
**before expiry** rather than waiting for a deploy to break.

## 2. Generate a new fine-grained PAT

This step happens in the GitHub web UI as the user `jonmaxmore`. It
cannot be automated and must be done by a human with access to the
GitHub account that owns the GACP repo.

1. Open https://github.com/settings/personal-access-tokens (Fine-grained
   tokens — not classic).
2. Click **Generate new token**.
3. Settings:
   - **Token name:** `gacp-droplet-ghcr-pull-<YYYYMMDD>` (e.g.
     `gacp-droplet-ghcr-pull-20260527`)
   - **Expiration:** 90 days (one quarter — matches the JWT secret
     rotation cadence in `secret-rotation.md`)
   - **Resource owner:** `jonmaxmore`
   - **Repository access:** "Only select repositories" →
     `jonmaxmore/GACP-Certification-Application`
   - **Permissions** → expand **Repository permissions**:
     - **Packages:** Read-only
     - All other permissions: **No access**
4. Click **Generate token**.
5. **Copy the token immediately** — GitHub shows it once. It looks like
   `github_pat_11AAA...` (fine-grained) or `ghp_...` (classic, if you
   accidentally created a classic token instead).
6. Record the new token's expiry date in your operator calendar so you
   rotate it before it lapses.

> ⚠️ **Do not paste the token into any shared document, chat, ticket
> system, or this repository.** Treat it like a database password. If
> you accidentally paste it anywhere, revoke it from
> https://github.com/settings/personal-access-tokens immediately and
> generate a new one.

## 3. Apply the PAT on the production droplet

SSH to the droplet as the operator user. The script `fix-ghcr-pat.sh`
expects the PAT in the `GHCR_PAT` env var so the value never appears in
shell history or process listings.

```bash
ssh root@203.0.113.10

# Pass PAT via env var (no shell history, no ps leak)
read -rs -p "Paste GHCR PAT: " GHCR_PAT
export GHCR_PAT
bash /opt/gacp-platform/scripts/maintenance/fix-ghcr-pat.sh
unset GHCR_PAT
```

What the script does:

1. Calls `docker login ghcr.io -u jonmaxmore --password-stdin`.
2. Checks `/root/.docker/config.json` to confirm the auth entry was
   written.
3. Test-pulls `ghcr.io/jonmaxmore/gacp-backend:deploy-production-latest`
   (read-only) to prove the token works — the name the script actually uses
   (`scripts/maintenance/fix-ghcr-pat.sh:39`) and the compose default
   (`docker-compose.production.yml:74`). Earlier revisions of this runbook said
   `gacp-platform-backend`, which is not a repository that was ever pushed.
4. Optionally re-invokes `scripts/deploy/deploy-production.sh` if you
   pass `--rerun-deploy` as the second argument.

## 4. Verify

```bash
# Confirm auth entry exists
jq '.auths["ghcr.io"]' /root/.docker/config.json
# Expected: { "auth": "...base64..." } — non-null

# Confirm pull works
docker pull ghcr.io/jonmaxmore/gacp-backend:deploy-production-latest
# Expected: image digest line, no "denied" error
# (tag pushed before 2026-08-14 — nothing newer exists in GHCR, see the note at the top)

# Confirm deploy-production.sh now passes its pull step
sudo bash /opt/gacp-platform/scripts/deploy/deploy-production.sh --dry-run
# Expected: Step 5 (image pull) reports OK
```

If any of the above fails:

- Re-check the PAT scope. The fine-grained token must have **Packages →
  Read-only** for this specific repository.
- Re-check the username. The token is tied to `jonmaxmore`; the
  `docker login` command must use that as `-u`.
- Confirm the token has not been revoked at
  https://github.com/settings/personal-access-tokens.

## 5. Revoke the previous PAT

After the new PAT is verified working, revoke the old one:

1. https://github.com/settings/personal-access-tokens
2. Find the previous `gacp-droplet-ghcr-pull-*` entry.
3. Click **Revoke**.

This minimizes the window during which two valid PATs grant access to
the same image stream.

## 6. Schedule the next rotation

The "expiry day minus 7 days" check is the same pattern used for TLS
cert renewal (see `tls-cert-renewal.md`). Either:

- Set a calendar reminder for 7 days before the new PAT's expiry.
- Or schedule a one-time scheduled check to verify the auth-entry
  health one week before expiry, mirroring the TLS routine
  (`trig_012sXTTWq7k2PF1tTF1gh1gQ` is the template).

## 7. Failure-mode quick reference

| Symptom | Cause | Fix |
| --- | --- | --- |
| `denied` on pull, but PAT just rotated | Old PAT cached in `~/.docker/config.json` for the wrong user | Run `docker logout ghcr.io` then re-run the script |
| `denied` and `jq` says auth entry exists | Token doesn't have Packages: Read for this repo | Regenerate with the correct scope (Section 2 step 3) |
| Token not accepted at all (`unauthorized`) | Token is for the wrong account, or is a classic token used in fine-grained-only context | Confirm Section 2 used Fine-grained tokens UI; confirm `Resource owner = jonmaxmore` |
| Script writes auth entry but pull still fails | The image package's visibility is set to private and the PAT user doesn't have read on the package | Visit https://github.com/users/jonmaxmore/packages/container/gacp-platform-backend/settings and confirm the user is granted Read |

## Related

- `scripts/maintenance/fix-ghcr-pat.sh` — the script itself
- `scripts/deploy/deploy-production.sh` — the deploy that depends on this
- `docs/operations/deploy-runbook.md` — the broader deploy procedure
- `docs/operations/runbooks/secret-rotation.md` — sister runbook for app
  secrets
