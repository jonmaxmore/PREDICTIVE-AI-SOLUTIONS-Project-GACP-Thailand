# Server hygiene §12 audit — production droplet results

**Audit date:** 2026-04-28
**Host:** 203.0.113.20 (`ubantu-2p-webapp`), 18 days uptime
**Application version:** v3.4.0 (deployed during this session)
**Scope:** 35 read-only health checks + safe cleanups

---

## Summary

| Category | Status |
|---|---|
| System (uptime/load/memory) | ✅ Healthy |
| Disk (50% / 116G) | ✅ Comfortable |
| Containers (11 running, 0 unhealthy) | ✅ Healthy |
| TLS (`gacpth.com` cert) | ⚠️ 45 days remaining — auto-renew via certbot.timer confirmed |
| Backend/frontend version | ✅ v3.4.0 deployed + healthy |
| Database (29 MB, 7 conns) | ✅ Comfortable |
| Backup automation | ✅ `/etc/cron.d/gacp-backup` installed (02:17 daily) |
| Log rotation | ✅ `/etc/logrotate.d/gacp-platform` installed + validated |
| **Permissions** | 🔴 **2 007 world-writable files found — fixed during audit** |
| Husky hooks (cosmetic) | ✅ Tightened from 0o777 to 0o755/644 |
| SSH password auth | ⚠️ Enabled (6 keys present — safe to disable; deferred to operator) |

---

## Critical finding (fixed)

`find /opt/gacp-platform -type f -perm -o+w` returned **2 007** files
including `apps/backend/keys/private.pem`'s parent directory
(`drwxrwxrwx`), application source code, certificates, and PEM keys.

Likely root cause: a historical `chmod -R 777` or a tar/unzip extraction
without a sane umask. Once introduced, it was never noticed because the
running containers don't volume-mount source code from the host —
permissions on disk had no runtime impact.

**Risk:** any unprivileged shell user (or a compromised non-root service)
could rewrite application code or a private signing key, then wait for
the next deploy/restart to pick it up.

**Remediation applied:**
```bash
chmod 600 /opt/gacp-platform/apps/backend/keys/private.pem
chmod 644 /opt/gacp-platform/apps/backend/keys/public.pem
chmod -R o-w /opt/gacp-platform
```

After remediation: world-writable count = **0**. All `.sh` scripts retain
their owner/group `+x` bits. Upload + storage dirs (which the backend
container needs writable) preserved at `drwxrwxr-x`. Smoke tests
post-fix: `/api/health` 200, `/api/subscription/plans` 200, no
container went unhealthy.

---

## Other findings (deferred or info-only)

### 1. SSH password authentication enabled

`/etc/ssh/sshd_config`: `PasswordAuthentication yes`. The host has 6
keys in `/root/.ssh/authorized_keys`, so disabling password auth would
not lock anyone out. **Not changed during this audit** — needs explicit
operator OK because mistakes here can cost the host. Recommended:

```bash
sed -i 's/^PasswordAuthentication yes/PasswordAuthentication no/' /etc/ssh/sshd_config
systemctl reload ssh
```

### 2. TLS cert expiry — 45 days

`gacpth.com` cert expires `Jun 13 2026`. `certbot.timer` is active and
scheduled for `Wed 2026-04-29 05:00 UTC`, so auto-renewal will run
within the window. No manual action needed unless renewal fails (watch
`journalctl -u certbot.service` after the next firing).

### 3. Husky hooks world-writable (cosmetic)

`/opt/gacp-platform/.husky/_/` was `drwxrwxrwx` with hooks at 0o666.
These hooks only fire on `git commit` (which doesn't happen on prod),
so the runtime risk is nil — but tightened during the audit anyway:

```bash
chmod 755 /opt/gacp-platform/.husky/_
chmod 644 /opt/gacp-platform/.husky/_/.gitignore /opt/gacp-platform/.husky/_/*.sh
chmod 755 /opt/gacp-platform/.husky/_/*  # hook scripts
```

### 4. Docker dangling resources (cleaned)

5 dangling volumes + 1 dangling image were reported by the audit. After
`docker volume prune -f && docker image prune -f`: 0 B reclaimed —
meaning everything Docker labels "dangling" is actually still attached
to a stopped or stack-managed container. No leak.

### 5. `.env.production` permissions

`-rw------- root root` (0o600). Correct, no change needed.

---

## What was scheduled / installed

| Artifact | Path | Schedule |
|---|---|---|
| Postgres backup cron | `/etc/cron.d/gacp-backup` | daily 02:17 → `/var/log/gacp-backup.log` |
| Logrotate config | `/etc/logrotate.d/gacp-platform` | nginx daily/14 + ops weekly/12 |
| Certbot renewal | `certbot.timer` | daily 05:00 (already existed) |

The new logrotate config initially failed `logrotate -d` validation
because `/var/log` is `g+w` (Ubuntu default) and the config didn't
declare which user to `su` to. Fixed in commit `f3a3a08` on `main`:
added `su root root` to both rotation blocks.

---

## Carry-over for the operator

These items remain because they need explicit user judgment, not
because they couldn't be done now:

1. **Disable SSH password authentication** — see remediation snippet above
2. **Rotate any secret that may have been exposed** while source code +
   keys were world-writable. The blast radius depends on whether any
   non-root user ever had shell access on this host. If the answer is
   "only root, ever" (DigitalOcean droplet usually qualifies), no
   rotation is required.
3. **Document the remediation in the operator handover** so the next
   person inheriting the droplet doesn't repeat the original mistake
   (likely a `chmod -R 777` during a rushed install).

---

## Audit trail

Full audit script: ran inline at `/tmp/server-audit.sh` on the droplet.
Rerun anytime by re-executing the audit block from this conversation,
or paste the script back into `/tmp/server-audit.sh` and run.
