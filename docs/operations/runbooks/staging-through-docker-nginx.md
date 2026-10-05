# Runbook — route staging through Docker nginx (single source of truth)

**Status:** active — operator executes on the VM. Infra proposes, operator runs (mandate §0).
**Owner:** platform operator
**Date:** 2026-08-08
**Scope:** `nginx/gacp.production.conf`, `deploy/nginx/staging.gacpth.com.conf`. Does **not** touch `deploy/nginx/gacp-platform.conf` (production's host vhost — unedited, and this runbook does not reload it for its own sake, only as a side effect of nothing).

## 0. What changed and why

Before this change, `staging.gacpth.com` bypassed Docker nginx entirely: host nginx proxied straight to `127.0.0.1:8001`/`127.0.0.1:3001` (the staging containers' loopback-only ports). That meant staging got none of what Docker nginx (`nginx/gacp.production.conf`) does for production — rate limiting, the security header set, gzip, and critically the `/api/session/` → frontend split (staging sent **all** of `/api/` to the backend, including session calls that production sends to the frontend).

The fix is **one shared file, not two**: `nginx/gacp.production.conf` now picks `backend:8000`/`frontend:3000` or `backend-staging:8000`/`frontend-staging:3000` by `$host`, via `map $host $backend_up` / `map $host $frontend_up` near the top of the file. `deploy/nginx/staging.gacpth.com.conf`'s three locations (`/api/`, `/uploads/`, `/`) now proxy to `127.0.0.1:8080` (Docker nginx) instead of the staging containers directly, and — the one line that makes the map work at all — **must keep forwarding the original `Host` header** (`proxy_set_header Host $host;`). If that header is ever dropped, staging traffic silently lands on the **production** containers. This is called out in-line at every location that sets it.

This same change also fixes a second, independently-confirmed bug: Docker nginx's `limit_req_zone`s key on `$binary_remote_addr`, and Docker nginx only ever sees connections from host nginx's egress address on `gacp-network` (confirmed via `/opt/gacp-platform/logs/nginx/access.log` — every line's `$remote_addr` was `172.18.0.1`, the network's gateway, `docker network inspect gacp-network` on the real host). Every visitor was one shared rate-limit bucket. `nginx/gacp.production.conf` now trusts **only** that one gateway address (`set_real_ip_from 172.18.0.1;` — not the `/16` it sits in) to restore the real visitor IP from `X-Forwarded-For`, which host nginx already sets correctly (it restores the real address from Cloudflare's `CF-Connecting-IP` at http scope in `deploy/nginx/gacp-platform.conf`, unedited by this change).

## 1. Before you start

- Both files in this change already passed `nginx -t` in a local sandbox (docker nginx config alone, and both host vhosts together) — see the PR's evidence. That is not a substitute for testing on the real host; do it again here, on the real config, before reloading anything.
- Read the full diff first. In particular: `nginx/gacp.production.conf` gained a new public location, `/__docker-nginx-real-ip-check` — it echoes back only what the caller sent (mirrors `/__access-check` in `deploy/nginx/gacp-platform.conf`), used in step 4 below.
- **Order matters and is not symmetric with rollback.** Deploy Docker nginx's new config **first**, host nginx's staging vhost **second**. If host nginx starts sending staging traffic to `:8080` before Docker nginx has the `$host` map loaded, that traffic hits Docker nginx's old, staging-unaware config — which means it lands on the **production** containers. Doing it in this order means that window never exists: until step 2b below, staging keeps working exactly as it does today (direct to `:8001`/`:3001`), untouched by anything in step 2a.

## 2a. Deploy Docker nginx's config (do this first)

```
sudo mkdir -p /root/nginx-backups
sudo cp /opt/gacp-platform/nginx/gacp.production.conf /root/nginx-backups/gacp.production.conf.bak-$(date +%Y%m%d-%H%M%S)
```

Update `/opt/gacp-platform/nginx/gacp.production.conf` to match this PR (however your normal deploy step gets the file onto the VM — this runbook does not prescribe that part).

**2a-0 — check that the container can even SEE the new file (do not skip).** This config is a
*single-file* bind mount, and a single-file bind mount pins the file's **inode**, not its path.
`git pull` replaces files by rename → new inode → the running container keeps reading the file
as it was when the container started. Found live on VM-0-3-ubuntu 2026-08-08: the container
(up 12 days) still served a config containing a CSP block that the repo had removed — while
`nginx -t` and `nginx -s reload` inside it read that same dead inode, so both would
"succeed" while deploying nothing.

```
md5sum /opt/gacp-platform/nginx/gacp.production.conf | cut -c1-8
docker exec gacp-nginx md5sum /etc/nginx/conf.d/default.conf | cut -c1-8
```

- **Hashes equal** → the mount is live; use the reload path below.
- **Hashes differ** → the mount is pinned to a dead inode. `nginx -t`/`reload` inside the
  container are meaningless — they validate and reload the OLD file. You must restart the
  container so the mount re-resolves the path:

  ```
  docker restart gacp-nginx
  docker ps --filter name=gacp-nginx --format '{{.Status}}'
  ```

  A few seconds of downtime for `gacpth.com` (measured 2026-08-08: its newest access-log
  entry was two days old — bots only). If the container does not come back `Up`, the new
  config is broken: restore the backup and `docker restart gacp-nginx` again.
  Then re-run the two `md5sum` lines — they must now match.

If the hashes matched (live mount), deploy by reload:

```
docker exec gacp-nginx nginx -t
```

Expect `syntax is ok` / `test is successful`. If it fails, stop — do not reload. Restore the backup and go to step 5.

```
docker exec gacp-nginx nginx -s reload
```

Production traffic is unaffected by either path: the map's `default` branch is unchanged production behaviour, and nothing yet points staging at this container.

**2a-9 — HARD GATE before 2b.** Do not proceed until the *running* nginx demonstrably
contains the staging map:

```
docker exec gacp-nginx nginx -T 2>/dev/null | grep -c 'backend-staging:8000'
```

Must print **1 or more**. If it prints `0`, the running config has no staging map, and step 2b
would route `staging.gacpth.com` into the **production** containers against `gacp_db` — the
silent failure mode §0 warns about. Stop and repeat 2a-0.

> Permanent fix worth considering (compose change, operator decision): mount the `nginx/`
> **directory** instead of the single file. Directory bind mounts resolve names on every open,
> so a replaced file is picked up by plain `reload` and this whole trap disappears.

## 2b. Deploy the staging host vhost (do this second)

```
sudo mkdir -p /root/nginx-backups
sudo cp /etc/nginx/sites-available/staging.gacpth.com.conf /root/nginx-backups/staging.gacpth.com.conf.bak-$(date +%Y%m%d-%H%M%S)
```

Backups go to `/root/nginx-backups/`, **not** `sites-available/` or `sites-enabled/` — a stray backup file left in either of those was previously loaded as live config and caused a silent `conflicting server name` warning (`docs/operations/runbooks/restrict-site-to-one-ip.md`, confirmed on this origin 2026-07-25). Do not repeat that.

Update `/etc/nginx/sites-available/staging.gacpth.com.conf` to match this PR. Then:

```
sudo nginx -t
```

Expect `syntax is ok` / `test is successful` with **no `[warn]` lines** — a warning here usually means a second copy of the vhost exists somewhere in `sites-enabled/`.

```
sudo systemctl reload nginx
```

## 3. Verify both domains still work

```
curl -sI https://gacpth.com/api/health
curl -sI https://staging.gacpth.com/api/health
```

Expect `200` (or `401`/`404` per the route — anything but `502`/`504`/timeout) from both.

## 4. Verify real-IP restoration is actually working (this is the fix, not a guess)

From your own machine (a real client, not the VM):

```
curl -s https://gacpth.com/__docker-nginx-real-ip-check
curl -s https://staging.gacpth.com/__docker-nginx-real-ip-check
```

`remote_addr=` in the response must be **your own public IP** (check it independently: `curl -s https://api.ipify.org`). If it instead shows `172.18.0.1` or any other `172.x` address, real-IP restoration is not working — `set_real_ip_from` no longer matches the container's actual peer (see step 6, gateway drift) — traffic still flows, but every visitor is back to one shared rate-limit bucket. This is a silent failure mode: nothing else about the site looks broken when this happens.

## 5. Verify the header set is identical between domains (the proof this task asked for)

```
curl -sI https://gacpth.com/api/health | sort > /root/nginx-backups/prod-headers.txt
curl -sI https://staging.gacpth.com/api/health | sort > /root/nginx-backups/staging-headers.txt
diff /root/nginx-backups/prod-headers.txt /root/nginx-backups/staging-headers.txt
```

Expect the diff to show only what is *supposed* to differ: `Date`, `Content-Length`, and staging's extra `X-Environment: staging` / `X-Robots-Tag: noindex, nofollow, noarchive` (set by the staging host vhost itself, not Docker nginx — deliberate, so staging stays identifiable). `Strict-Transport-Security`, `X-Frame-Options`, `X-Content-Type-Options`, `Referrer-Policy`, and rate-limit behaviour should **not** appear in the diff — if any of those differ, stop and compare the two nginx configs against this PR before going further.

## 6. After every `docker compose down` + `up` that touches `gacp-network` — not just this first install

Docker keeps a network's existing subnet across a normal recompose, but a full `docker network rm` + recreate can assign a **different** subnet, which changes the gateway address `set_real_ip_from` trusts. This fails silently (step 4's symptom, not an outage). Check it every time:

```
docker network inspect gacp-network -f '{{(index .IPAM.Config 0).Gateway}}'
grep -o 'set_real_ip_from [0-9.]*' /opt/gacp-platform/nginx/gacp.production.conf
```

These two values must match. If they don't: edit `set_real_ip_from` in `nginx/gacp.production.conf` to the new gateway, then repeat step 2a (`nginx -t` → reload). Re-run step 4 afterward to confirm.

## 7. Rollback

Reverse order from deploy — host vhost first, so staging is immediately back on its old, independently-working path regardless of whatever state Docker nginx is left in:

```
sudo cp /root/nginx-backups/staging.gacpth.com.conf.bak-<timestamp> /etc/nginx/sites-available/staging.gacpth.com.conf
sudo nginx -t
sudo systemctl reload nginx
```

```
sudo cp /root/nginx-backups/gacp.production.conf.bak-<timestamp> /opt/gacp-platform/nginx/gacp.production.conf
docker exec gacp-nginx nginx -t
docker exec gacp-nginx nginx -s reload
```

Re-run step 3 (both domains healthy) after rollback.

## 8. Known residual risk (flagged, not fixed here)

- **Trust boundary is a single host address, confirmed once.** If `gacp-network`'s gateway changes (step 6) and nobody re-runs that check, real-IP restoration degrades silently back to a shared bucket — it does not error or alert. There is no automated check for this yet; it is a manual step in this runbook.
- **The map's fallback direction is "unknown Host → production."** Confirmed in a local sandbox test: a request with a missing or unrecognized `Host` header lands on the production containers, not an error. This is the correct fail-safe *for production* (an attacker can't use a bad Host header to reach staging's data), but it is also exactly the failure mode described in step 0 if `deploy/nginx/staging.gacpth.com.conf` ever stops forwarding `Host` correctly: staging traffic goes to production, not to an error page. Nothing currently alerts on that condition either.
- **`gacpth.com` traffic is currently very low** (per the operator: latest access-log entry 2026-08-06, mostly bot traffic), which lowers the real-world blast radius of a mistake here — but `staging.gacpth.com` is the side with active real usage right now, so steps 3–5 are not optional on the basis of production being quiet.
