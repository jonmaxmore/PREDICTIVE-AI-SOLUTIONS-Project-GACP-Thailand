# Runbook — keeping gacpth.com private before go-live

**Status:** active
**Owner:** platform operator (jonmaxmore)
**Applies to:** `gacpth.com` and `staging.gacpth.com` behind Cloudflare, origin `203.0.113.10`

## What this is for

The platform is still being built and must not be reachable by the public. This
is how that is done, why it is done at this layer and not another, and — the
part that matters most — what to do when it locks you out.

## Two layers, two different questions

The mistake worth not repeating is treating this as one problem. It is two.

| | `ufw` on the origin | **host nginx** |
| --- | --- | --- |
| Question it answers | which *proxy* may connect to this machine | which *visitor* may enter the site |
| Sees the real visitor address | no — only Cloudflare's edge | yes, via `CF-Connecting-IP` |
| Correct setting | 80/443 open to Cloudflare's ranges only, 22 to the operator | deny all, allow the operator |

`ufw` was originally set to allow one address on 22, 80 and 443. That is not a
private site, it is a broken one:

- **Cloudflare was blocked along with everyone else**, so every visitor got
  `522 Connection Timed Out`. The site was down for the world, not private.
- The one allowed machine reached the origin **directly**, bypassing Cloudflare,
  and so met the origin's self-signed certificate — `ERR_CERT_AUTHORITY_INVALID`
  on the operator's own government platform.

Doing it in nginx instead avoids both: the operator's traffic still terminates at
Cloudflare and still gets Cloudflare's trusted certificate, outsiders get a clean
`403`, and Cloudflare's WAF and rate limiting stay in the path.

## The gate

`deploy/nginx/gacp-platform.conf` declares it at http scope, so both vhosts use
the same list:

```nginx
geo $remote_addr $gacp_prelaunch_blocked_ip {
    default 1;                      # <- GO-LIVE: set to 0 to open the platform
    198.51.100.30/32          0;    # operator workstation
    2403:6200:88a4:b3fa::/64  0;    # operator IPv6 prefix
    127.0.0.1/32              0;
    ::1/128                   0;
}
```

`1` means blocked. An address gets in only by being named. Longest prefix wins,
so a `/32` can carve an exception out of an allowed `/64`.

Three details that are load-bearing:

- **It matches `$remote_addr`, not `$realip_remote_addr`.** After
  `real_ip_header CF-Connecting-IP`, `$remote_addr` is the visitor.
  `$realip_remote_addr` is Cloudflare's edge — the same value for every visitor
  on earth, so an allowlist keyed on it admits everyone or nobody depending on
  which Cloudflare datacentre answered.
- **The IPv6 entry is a `/64`, not the exact address supplied.** SLAAC privacy
  extensions rotate the last 64 bits, usually daily. Pinning
  `2403:6200:88a4:b3fa:183a:3109:547d:de30/128` would lock the operator out
  overnight, and the symptom would be indistinguishable from a broken gate.
- **It defaults to deny.** A typo in a CIDR locks people out. The opposite
  default would open the platform and nothing would visibly break.

`scripts/ci/check-access-allowlist.js` re-reads the file and evaluates real
addresses through real prefix arithmetic, so none of the three regresses
silently — **but only when somebody runs it**. As of 2026-08-14 it has no
automated invoker: its blocking job was `.github/workflows/topology-guard.yml:47`
and GitHub Actions is permanently unavailable (the change log 2026-08-14), and it
has no row in `scripts/ci/local-gate.sh` or `scripts/ci/full-gate-checks.txt`.
Run it by hand — `pnpm check:access-allowlist` — **before every install of this
conf**. The 2026-08-14 lockout (every user, including the operator, 403 on
staging — the change log same date) is what skipping it costs.

## Adding an address

Edit the `geo` block, one line per address or CIDR, value `0`. Then:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

## When you are locked out

Do not open the site to everyone to find out whether that fixes it. Ask nginx
what address it thinks you are — this endpoint answers even to a blocked
address, and returns only information the caller itself sent:

```bash
curl -s https://gacpth.com/__access-check
```

```
remote_addr=198.51.100.30
via=162.158.1.1
cf_connecting_ip=198.51.100.30
x_forwarded_for=198.51.100.30
blocked=0
```

Read it like this:

| What you see | What it means | Fix |
| --- | --- | --- |
| `blocked=0` | you are allowed; the problem is elsewhere (DNS, certificate, upstream) | see below |
| `remote_addr` is your address, `blocked=1` | your address is not on the list, or it changed | add it to the `geo` block |
| `remote_addr` equals `via` | real-IP restoration is not working — nginx sees Cloudflare, not you | check `set_real_ip_from` covers Cloudflare's current ranges and that `gacp-platform.conf` is the file actually loaded |
| `cf_connecting_ip` empty | the request did not come through Cloudflare | you are hitting the origin directly; expect a certificate warning too |
| connection times out, no response at all | `ufw` is blocking, not nginx | see the firewall section |

## Firewall — the part that stays forever

```bash
sudo ufw status numbered
```

Ports 80 and 443 should be open **to Cloudflare's ranges only**, and port 22 to
the operator. If 80/443 are allowed from a single non-Cloudflare address, that is
the old broken setup and it produces `522` for the world:

```bash
# Re-apply Cloudflare's ranges (safe to re-run).
for ip in $(curl -s https://www.cloudflare.com/ips-v4) $(curl -s https://www.cloudflare.com/ips-v6); do
    sudo ufw allow proto tcp from "$ip" to any port 80,443 comment 'cloudflare'
done
sudo ufw status
```

Leave this in place after go-live. It is what keeps the origin from being reached
directly, which is also what stops anyone bypassing the nginx gate.

## Verifying it works

From the operator machine:

```bash
curl -sSI https://gacpth.com/ | head -1        # expect HTTP/2 200
curl -s  https://gacpth.com/__access-check     # expect blocked=0
```

From a phone on mobile data, or any other network:

```bash
curl -sSI https://gacpth.com/ | head -1        # expect HTTP/2 403
```

A `403` carrying `server: cloudflare` is the gate working. A `522` is the
firewall blocking Cloudflare — the old failure, not this one.

## `conflicting server name` warnings

```
nginx: [warn] conflicting server name "staging.gacpth.com" on 0.0.0.0:80, ignored
```

nginx does not fail on this. It warns, then serves whichever block it parsed
first — decided by filename order inside the include glob. The site's behaviour
can therefore change because somebody renamed a file.

This repository declares the name exactly once, in
`deploy/nginx/staging.gacpth.com.conf` (one `:80` block and one `:443` block,
which is correct and is not a conflict). The server-name conflict detector lives
in `scripts/ci/check-access-allowlist.js:202-240` — and, like the allowlist half
above, **nothing runs it for you** since Actions went away (see the note in the
previous section). So a warning on the server means a **second copy exists on the
server**. Find it:

```bash
sudo grep -rn 'server_name.*staging\.gacpth\.com' /etc/nginx/
ls -la /etc/nginx/sites-enabled/ /etc/nginx/conf.d/
```

The usual cause is that Debian/Ubuntu includes `sites-enabled/*` with **no
extension filter**, so an editor backup or a copy left beside the real file is
loaded as config too. Confirmed on this origin on 2026-07-25:

```
gacp-platform.conf                      -> sites-available/gacp-platform.conf
staging.gacpth.com.conf                 -> sites-available/staging.gacpth.com.conf
staging.gacpth.com.conf.bak-apisession     <- a real file, 3,310 bytes, also loaded
```

Move it out of `sites-enabled/` rather than deleting it — it is somebody's
backup, and it is the only copy of whatever they were preserving:

```bash
sudo mv /etc/nginx/sites-enabled/staging.gacpth.com.conf.bak-apisession /root/
```

Remove the extra file or symlink — not the real one — then:

```bash
sudo nginx -t && sudo systemctl reload nginx
```

`nginx -t` must print `syntax is ok` and `test is successful` with **no `[warn]`
lines**.

## `unknown directive "http2"`

```
nginx: [emerg] unknown directive "http2" in .../staging.gacpth.com.conf:41
```

`http2 on;` as a standalone directive needs nginx >= 1.25.1. This origin runs an
older build. Use the inline form, which every nginx since 1.9.5 accepts and
which `gacp-platform.conf` already used:

```nginx
listen 443 ssl http2;
listen [::]:443 ssl http2;
```

This failure mode is worth understanding rather than just fixing: `nginx -t`
fails, `systemctl reload` fails, and **the running process keeps serving from
the config it already has in memory**. The site looks fine. It stays looking
fine until the next restart or reboot, at which point nginx does not come back
at all. So a failed reload is not a warning to come back to later — the
configuration on disk is the one that will be used next time the machine starts.

A jest test pins both vhosts to the inline form so this cannot return through
the repository.

## Before go-live: what the gate breaks

**Set `default 0;` before the platform serves the public.** While it is `1`,
everything below is unreachable for everyone except the allowlist, and several of
them are the point of the platform:

| Surface | Where | What breaks |
| --- | --- | --- |
| Public QR verification | `apps/backend/server.js:160` — `/api/trace`, deliberately `origin: '*'` | A citizen scanning a GACP QR code on a herbal product cannot verify it. Pharmacies, exporters and e-commerce partners verify through this same path. |
| Public verify pages | `apps/web-app/src/app/verify/**`, `verify-identity/**` | The trust surface a certificate points at returns 403. |
| Applicant portal | `/health/**` | No farmer can register, submit, or track an application. |
| Provider / auditor portal | `/provider/**` | No DTAM officer can review or schedule. |
| Mobile app | Flutter client against the same origin | Every screen fails. |

Uptime probes and any external webhook receiver are blocked too. If a payment
provider or partner calls back into this platform, allowlist that source
alongside the operator or the callback is silently lost.

ACME (`/.well-known/acme-challenge/`) and `/__access-check` are exempt by design
— the first so certificate renewal does not fail sixty days later with no visible
cause, the second so being blocked stays diagnosable.

## If the operator's address changes often

`198.51.100.30` is a consumer broadband address and is very likely dynamic. Two
ways to survive a reassignment:

- Widen the entry to the ISP's block — weaker, but it survives.
- Better: **Cloudflare Zero Trust → Access**, free for up to 50 users. It gates
  on an emailed one-time code instead of an address, so it works from any
  network and needs no edit when the address moves. The nginx gate can then be
  narrowed to Cloudflare's ranges alone.

## Go-live checklist

1. Set `default 0;` in the `geo` block, `nginx -t`, reload.
2. Confirm from an outside network: `https://gacpth.com` loads, and a QR
   verification URL resolves.
3. Re-check that `ufw` still allows 80/443 **only** from Cloudflare's ranges.
4. Refresh Cloudflare's ranges if they have changed:
   `https://www.cloudflare.com/ips-v4` and `-v6`.
