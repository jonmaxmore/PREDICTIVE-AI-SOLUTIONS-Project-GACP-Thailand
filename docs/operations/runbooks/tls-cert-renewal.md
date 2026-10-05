# Runbook — TLS Certificate Renewal (gacpth.com)

**Status:** active
**Owner:** platform operator (jonmaxmore)
**Last reviewed:** 2026-04-29
**Tooling:** `scripts/maintenance/fix-certbot-renewal.sh`

This runbook covers renewing the public TLS certificate for `gacpth.com`
(production droplet `203.0.113.10`). The certificate is issued by
Let's Encrypt and was originally configured with `authenticator =
standalone`, which conflicts with the host nginx already binding port
80. Without the fix below, `certbot renew` silently fails and HTTPS
goes down on **2026-06-03** (the current cert's `notAfter`). Recorded
as Phase 1 #1.12 of the 2026-04-27 audit.

> **TL;DR** — on the production droplet:
> ```bash
> sudo bash /opt/gacp-platform/scripts/maintenance/fix-certbot-renewal.sh
> ```
> The script switches certbot from standalone to webroot, patches the
> host nginx vhost to serve the ACME challenge, switches the
> `/opt/gacp-platform/nginx/ssl/*` files to symlinks pointing at
> `/etc/letsencrypt/live/...`, and verifies with
> `certbot renew --dry-run`. Idempotent — safe to re-run.

---

## 1. When to run this

Run when **any** of these symptoms appear:

- The scheduled "Verify TLS cert renewal" scheduled routine
  (`trig_012sXTTWq7k2PF1tTF1gh1gQ`, fires 2026-05-27) reports status
  **ALERT** with `notAfter < 2026-06-10`.
- A browser visit to `https://gacpth.com` warns about an expired or
  near-expiry certificate.
- `echo | openssl s_client -servername gacpth.com -connect gacpth.com:443 2>/dev/null | openssl x509 -noout -dates`
  shows `notAfter` within 14 days.
- `certbot renew --dry-run` on the droplet exits non-zero with
  `address already in use` on port 80.

Run **before 2026-06-03** to avoid a cert outage. The window of safe
action is roughly 2026-05-20 → 2026-06-01.

## 2. Pre-flight on the droplet

```bash
ssh root@203.0.113.10

# Confirm the cert and its current expiry
openssl x509 -in /etc/letsencrypt/live/152-42-218-251.sslip.io/fullchain.pem -noout -dates

# Confirm the script exists at the expected path
ls -l /opt/gacp-platform/scripts/maintenance/fix-certbot-renewal.sh

# Snapshot current nginx config + renewal config (the script also does
# this, but a manual snapshot before running anything is cheap insurance)
cp -a /etc/nginx /root/nginx-backup-$(date +%Y%m%d-%H%M%S)
cp -a /etc/letsencrypt /root/letsencrypt-backup-$(date +%Y%m%d-%H%M%S)
```

If `git status` inside `/opt/gacp-platform/` is dirty, see Section 6
(server-state hygiene) before running the renewal — clean the tree
first so a rollback is straightforward.

## 3. Run the script

```bash
sudo bash /opt/gacp-platform/scripts/maintenance/fix-certbot-renewal.sh
```

What it does:

1. Snapshots the nginx vhost and the certbot renewal conf.
2. Creates `/var/www/certbot` (the webroot for ACME challenges).
3. Patches the host nginx vhost so a `location /.well-known/acme-challenge/`
   block serves files from `/var/www/certbot` **before** the existing
   redirect-to-HTTPS rule.
4. Reloads nginx (`nginx -t && systemctl reload nginx`).
5. Switches `/opt/gacp-platform/nginx/ssl/{fullchain.pem,privkey.pem}`
   from regular files to symlinks pointing into
   `/etc/letsencrypt/live/152-42-218-251.sslip.io/`. The host nginx
   continues to read the same `/opt/gacp-platform/nginx/ssl/*` paths,
   so no nginx config change is needed for that side.
6. Edits the certbot renewal config to set
   `authenticator = webroot` and `webroot_path = /var/www/certbot`.
7. Adds a deploy-hook script at
   `/etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh` that runs
   `systemctl reload nginx` after every successful renewal.
8. Runs `certbot renew --dry-run` to prove the new path works.

## 4. Verify

```bash
# 1. Dry-run renewal succeeds (this is the load-bearing check)
sudo certbot renew --dry-run
# Expected: "Congratulations, all simulated renewals succeeded"

# 2. The deploy-hook is in place
ls -l /etc/letsencrypt/renewal-hooks/deploy/reload-nginx.sh
# Expected: executable, owned by root

# 3. Symlinks land in the right place
ls -l /opt/gacp-platform/nginx/ssl/
# Expected: fullchain.pem and privkey.pem are symlinks pointing into
# /etc/letsencrypt/live/152-42-218-251.sslip.io/

# 4. Force an actual renewal NOW so we don't depend on the cron timer
sudo certbot renew --force-renewal
# Expected: succeeds, new notAfter is ~90 days in the future

# 5. Public probe sees the new cert
echo | openssl s_client -servername gacpth.com -connect gacpth.com:443 2>/dev/null | openssl x509 -noout -dates
# Expected: notAfter is the new date (≈ today + 90 days)

# 6. Browser sanity-check
#    - Open https://gacpth.com — green padlock, no warning
#    - Click padlock → Connection details → certificate is valid
```

If step 1 fails, **do not force-renew** (step 4) — investigate first.
The dry-run failing without a forced renewal still leaves the prior
cert in place, so HTTPS keeps working until 2026-06-03.

## 5. Re-arm the verification routine

Once renewal succeeds, the existing one-time routine
(`trig_012sXTTWq7k2PF1tTF1gh1gQ`) will fire on 2026-05-27 and report
status **OK**. To keep coverage going past the next renewal cycle
(every ~60 days for cert life of 90 days), schedule a follow-up routine
two months after the actual renewal date. Use the same prompt template
— only the title and `run_once_at` change.

## 6. Server-state hygiene before renewal

The 2026-04-27 audit captured 1,895 dirty files and 23 untracked
services on the production droplet at the time of v3.1.0 deploy
(snapshots in `/root/gacp-snapshots/`). If the droplet's
`/opt/gacp-platform/` is dirty when you run the renewal script:

1. Inspect dirty files: `cd /opt/gacp-platform && git status`
2. If everything is generated artefacts (logs, build outputs, snapshot
   files), commit nothing — just don't break the working tree:
   stash with `git stash push -u -m 'pre-renewal-stash'`
3. Run the renewal script.
4. After verification, decide whether to drop the stash
   (`git stash drop`) or keep it for forensic review.

This keeps the renewal action scoped to the certbot/nginx changes the
script intends, and prevents a renewal-time mishap from accidentally
destroying any unrelated in-flight work the server holds.

## 7. Rollback

If the script fails partway through and the renewal is broken:

```bash
# 1. Restore nginx config from snapshot
cp -a /root/nginx-backup-<TIMESTAMP>/. /etc/nginx/
nginx -t && systemctl reload nginx

# 2. Restore certbot renewal config from snapshot
cp -a /root/letsencrypt-backup-<TIMESTAMP>/. /etc/letsencrypt/

# 3. Confirm prior cert still works
echo | openssl s_client -servername gacpth.com -connect gacpth.com:443 2>/dev/null | openssl x509 -noout -dates
```

The previous cert remains valid until 2026-06-03 in the worst case, so
a failed migration buys time, not an outage — provided you do not run
`--force-renewal` until the dry-run succeeds.

## 8. Failure-mode quick reference

| Symptom | Cause | Fix |
| --- | --- | --- |
| `address already in use` on port 80 | Standalone authenticator still set, host nginx is bound to :80 | Re-run script (idempotent); verify `authenticator = webroot` in `/etc/letsencrypt/renewal/152-42-218-251.sslip.io.conf` |
| `404 not found` on `/.well-known/acme-challenge/...` during dry-run | Webroot path wrong, or nginx vhost ordering wrong (challenge block must come BEFORE redirect-to-HTTPS) | Inspect `/etc/nginx/sites-enabled/gacp-production.conf`, ensure the challenge block sits at the top of the `:80` server block |
| Cert renews but browser still shows old cert | nginx didn't reload | `systemctl reload nginx`; confirm deploy-hook script is executable |
| `Domain validation failed` from Let's Encrypt | DNS doesn't currently point gacpth.com → 203.0.113.10 | Cloudflare A record sanity check; resolve before retrying |

## Related

- `scripts/maintenance/fix-certbot-renewal.sh` — the script itself
- `nginx/gacp.production.conf` — the host nginx vhost source of truth
- `docs/operations/deploy-runbook.md` — broader deploy procedure
- ADR-013: Platform-Neutral Production Strategy (DigitalOcean baseline)
