# Runbook — Secret Rotation

**Status:** active
**Owner:** platform operator
**Last reviewed:** 2026-04-28
**Tooling:** `scripts/maintenance/rotate-secret.sh`

This runbook covers rotating shared secrets stored in
`/opt/gacp-platform/.env.production` on the production droplet.

> **TL;DR** — for everything except `ENCRYPTION_KEY`:
> ```bash
> sudo /opt/gacp-platform/scripts/maintenance/rotate-secret.sh HEALTH_JWT_SECRET
> ```
> The script atomically rewrites the env file, restarts the backend,
> smoke-tests `/api/health`, and rolls back on failure.

---

## 1. When to rotate

| Secret | Routine cadence | Immediate (out-of-cycle) |
| --- | --- | --- |
| `HEALTH_JWT_SECRET` | Quarterly | On suspected leak; on offboarding of anyone who saw `.env.production` |
| `PROVIDER_JWT_SECRET` | Quarterly | Same as above |
| `QR_SIGNATURE_FALLBACK_SECRET` | Quarterly | On suspected leak (re-signs all newly issued QR codes — old QR codes verifying with the prior secret continue to work via the fallback path until they expire) |
| `PAYMENT_WEBHOOK_SECRET` | Annually | On suspected leak; coordinate with the PSP because they hold the matching half |
| `ENCRYPTION_KEY` | Annually — but only via the data re-encryption procedure (Section 5) | On suspected key compromise — see Section 5; this is not a simple secret swap |
| `MASTER_ENCRYPTION_KEY` | Same as `ENCRYPTION_KEY` | Same as `ENCRYPTION_KEY` |

**Always rotate immediately if:**
- A copy of `.env.production` was emailed, pasted into chat, or committed
  to git (even briefly).
- A staff member with droplet SSH access leaves.
- A backup containing `.env.production` was lost or copied off-site
  unexpectedly.
- A dependency advisory implicates one of the secret consumers (e.g.
  jsonwebtoken CVE).

---

## 2. How to rotate (standard secrets)

For `HEALTH_JWT_SECRET`, `PROVIDER_JWT_SECRET`,
`QR_SIGNATURE_FALLBACK_SECRET`, `PAYMENT_WEBHOOK_SECRET`:

```bash
# On the production droplet, as root:
sudo /opt/gacp-platform/scripts/maintenance/rotate-secret.sh <SECRET_NAME>
```

The script:
1. Backs up `.env.production` to
   `/var/backups/gacp/env-rotations/.env.production-<timestamp>.bak`
   (mode 0600).
2. Generates a new 64-char URL-safe base64 secret from `/dev/urandom`.
3. Atomically rewrites the matching line in `.env.production`.
4. Restarts the `backend` container with `docker compose up -d --no-deps backend`.
5. Smoke-tests `http://127.0.0.1:8000/api/health` (up to 30s).
6. Rolls back automatically on smoke-test failure.
7. Appends an audit line to `/var/log/gacp-secret-rotations.log`.

The rotator refuses to:
- Run as a non-root user.
- Touch a secret name not in its allow-list.
- Add a *new* line to `.env.production` (the secret must already exist).

---

## 3. Verify after rotation

```bash
# 1. Check the audit log captured the rotation.
sudo tail -5 /var/log/gacp-secret-rotations.log

# 2. Watch backend logs for ~5 minutes — auth errors here would indicate
#    a coordination problem (e.g. another service still has the old key).
sudo docker compose -f /opt/gacp-platform/docker-compose.production.yml \
    logs --tail=500 -f backend

# 3. End-to-end smoke: log in via the web UI.
#    JWT_SECRET rotation invalidates all existing user sessions — that's
#    expected. Users must re-authenticate. This is the desired behaviour
#    for an out-of-cycle (suspected leak) rotation.

# 4. For PAYMENT_WEBHOOK_SECRET specifically: confirm with the PSP that
#    the matching half on their side is in sync. New webhooks should
#    verify; in-flight ones may briefly fail.
```

---

## 4. Rollback

The script auto-rollbacks on smoke-test failure. To roll back manually
later:

```bash
# Find the most recent backup.
ls -lt /var/backups/gacp/env-rotations/ | head -5

# Restore (replace TIMESTAMP).
sudo cp /var/backups/gacp/env-rotations/.env.production-<TIMESTAMP>.bak \
    /opt/gacp-platform/.env.production
sudo chmod 0600 /opt/gacp-platform/.env.production

# Restart backend with the restored env.
cd /opt/gacp-platform
sudo docker compose --env-file .env.production \
    -f docker-compose.production.yml up -d --no-deps backend
```

Confirm `/api/health` returns 200, then log the rollback to
`/var/log/gacp-secret-rotations.log` manually.

---

## 5. ENCRYPTION_KEY — special case (DO NOT use rotate-secret.sh blindly)

`ENCRYPTION_KEY` and `MASTER_ENCRYPTION_KEY` protect data **at rest** —
encrypted columns in PostgreSQL and any envelope-encrypted blobs.
Rotating these secrets without re-encrypting the dependent rows leaves
that data **unrecoverable** — there is no decryption key for it any more.

**`rotate-secret.sh` refuses by default** to rotate either of these keys
unless `I_HAVE_REENCRYPTED_DATA=yes` is set in the environment. Do not
set that flag without going through the full procedure below.

### 5.1 Correct procedure (high level)

This is a multi-step migration, not a one-shot script:

1. **Schedule a maintenance window.** Encrypted data is read-mostly; the
   migration must take an exclusive lock on the affected tables for
   long enough to re-encrypt every row.
2. **Stage a new key.** Add `ENCRYPTION_KEY_NEXT=<new>` alongside the
   current `ENCRYPTION_KEY` in `.env.production` (the codepath must
   already support a "next" key — confirm in the encryption module
   before scheduling the window; if not, that's a prerequisite engineering
   task).
3. **Re-encrypt data.** Run the migration that:
   - reads each encrypted column with the current `ENCRYPTION_KEY`,
   - re-encrypts under `ENCRYPTION_KEY_NEXT`,
   - writes back transactionally.
   The migration is idempotent and resumable.
4. **Cut over.** Once every row is re-encrypted under the new key:
   move `ENCRYPTION_KEY_NEXT` → `ENCRYPTION_KEY`, drop the
   `ENCRYPTION_KEY_NEXT` line. Restart backend.
5. **Verify** by reading a sample of encrypted columns from each table.
6. **Audit-log** the rotation at `/var/log/gacp-secret-rotations.log`
   manually (the standard rotator was bypassed).

### 5.2 If you only need to invalidate the OLD key

If the threat model is "someone may have seen the old key", but the
data itself is not high-risk-on-disclosure, an alternative to a full
re-encryption migration is:

- Mark the affected rows for **forced refresh on next access** (the
  application re-encrypts on read), and
- Accept that any row that is never read again will retain old-key
  ciphertext.

This is a product decision, not a runbook decision. Loop in product
ownership before going this route.

---

## 6. Authorisation

| Secret | Who may rotate |
| --- | --- |
| `HEALTH_JWT_SECRET`, `PROVIDER_JWT_SECRET` | Platform operator (sudo on droplet) |
| `QR_SIGNATURE_FALLBACK_SECRET` | Platform operator |
| `PAYMENT_WEBHOOK_SECRET` | Platform operator + PSP coordination |
| `ENCRYPTION_KEY`, `MASTER_ENCRYPTION_KEY` | Platform operator + product owner sign-off (see Section 5) |

Every rotation is audit-logged in `/var/log/gacp-secret-rotations.log`
with timestamp, secret name, actor (`SUDO_USER`), and backup path.

---

## 7. Related

- `scripts/maintenance/rotate-secret.sh` — the rotator itself
- `scripts/backup/install-cron.sh` — daily DB backup (runs out of `/etc/cron.d`)
- `deploy/logrotate/gacp-platform.conf` — rotates the audit log so it
  doesn't grow unbounded
- `docs/operations/deploy-runbook.md` — broader deploy operations
