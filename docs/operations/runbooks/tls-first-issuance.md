# Runbook — first trusted TLS certificate for gacpth.com

**Status:** active
**Owner:** platform operator (jonmaxmore)
**Applies to:** `gacpth.com`, fronted by Cloudflare
**Companion:** `tls-cert-renewal.md` (renewal of a cert that already exists)

> **Origin IP has moved.** DNS now points at `203.0.113.10`. The companion
> runbook still names `203.0.113.10`; treat that as historical.

## Checked on 2026-07-25 — Cloudflare is configured correctly

Verify these before touching anything, because all four were already right and
changing them would break a working setup:

| Setting | Value | Correct? |
| --- | --- | --- |
| SSL/TLS → encryption mode | **Full** | yes — the origin is self-signed, which is exactly what Full is for |
| Edge Certificates | `gacpth.com, *.gacpth.com` Universal, **Active**, expires 2026-10-09 | yes |
| DNS records (`gacpth.com`, `www`, `api`, `staging`) | all **Proxied** (orange cloud) → `203.0.113.10` | yes |
| Client resolution | `nslookup gacpth.com` → `172.67.194.122`, `104.21.20.214`, `2606:4700::…` | yes — those are Cloudflare |

With that in place a visitor gets Cloudflare's trusted certificate and there is
no warning. **If a browser still shows `ERR_CERT_AUTHORITY_INVALID`, it is not
reaching Cloudflare** — see "The browser remembers" below before changing any
Cloudflare setting.

### Two changes that look like fixes and are not

- **Do not switch to Flexible.** It leaves the Cloudflare→origin leg
  unencrypted, so national ID numbers and passwords cross that hop in clear
  text. Full is correct.
- **Do not switch to Full (Strict)** while the origin serves the self-signed
  bootstrap certificate — the site goes down immediately. The upgrade path is:
  SSL/TLS → Origin Server → Create Certificate, install it at
  `nginx/ssl/gacp.crt|.key` on the origin, *then* switch to Strict.

## Root cause, found 2026-07-25: the origin firewall allowed one IP

The certificate error was a symptom. `ufw` on the origin carried exactly three
rules, all naming a single home/office address:

```
[1] 22/tcp   ALLOW IN   198.51.100.30
[2] 80/tcp   ALLOW IN   198.51.100.30
[3] 443/tcp  ALLOW IN   198.51.100.30
```

Cloudflare was blocked along with everyone else, so `www.gacpth.com` and
`api.gacpth.com` returned **522 Connection Timed Out** — Cloudflare's own
certificate served fine, nothing wrong with TLS at the edge. The operator's
machine, being the one allowed address, reached the origin **directly**,
bypassing Cloudflare, and met the self-signed certificate. That is the whole
explanation for "only my machine can open it, and even then with a warning".

Everything else was healthy the entire time: nginx up for three days listening
on `0.0.0.0:80` and `0.0.0.0:443`, fifteen containers healthy, and
`curl -ki https://127.0.0.1/ -H 'Host: gacpth.com'` returning `HTTP/2 200` with
120 KB of HTML.

**Note that this restriction is not in the repository.** Nothing in
`nginx/*.conf` or `deploy/nginx/*.conf` limits the public site by IP. It was
applied by hand on the host, which is why reading the repo says the site is
public while the site is not. When a symptom and the code disagree, check the
host.

### The fix

Allow Cloudflare's published ranges rather than opening the ports to everyone —
the origin then only accepts traffic that came through Cloudflare, which is
stronger than the single-IP rule it replaces:

```bash
for ip in $(curl -s https://www.cloudflare.com/ips-v4) $(curl -s https://www.cloudflare.com/ips-v6); do
  sudo ufw allow from "$ip" to any port 443 proto tcp
  sudo ufw allow from "$ip" to any port 80  proto tcp
done
sudo ufw reload && sudo ufw status numbered
```

Then remove the direct web access, keeping **only** the SSH rule:

```bash
sudo ufw delete allow from 198.51.100.30 to any port 443 proto tcp
sudo ufw delete allow from 198.51.100.30 to any port 80  proto tcp
```

Leaving those two in place keeps a path that bypasses Cloudflare's WAF and rate
limiting, and it is the path that serves the self-signed certificate — the
source of a day of confusion. Removing them makes the certificate error
unreachable rather than merely unlikely.

**Do not delete the port 22 rule.** That is SSH; without it the host becomes
unreachable.

If 522 persists after this, the next layer is the cloud provider's own firewall
(the host is on Tencent Cloud at `203.0.113.10`) — its Security Group must also
permit 80 and 443.

## Known, unrelated: duplicate staging vhost

`systemctl status nginx` reports:

```
nginx: [warn] conflicting server name "staging.gacpth.com" on 0.0.0.0:443, ignored
```

Two vhosts declare the same `server_name`, so nginx silently ignores the second
and `staging.gacpth.com` may be served by whichever it kept. Production is
unaffected. Check `ls /etc/nginx/sites-enabled/` and remove the duplicate.

## The browser remembers

Clicking through the interstitial once (ขั้นสูง → ดำเนินการต่อ) stores a
per-profile exception, and HSTS state persists separately. A machine that has
ever accepted the warning cannot tell you whether the fix worked, and a machine
that saw the warning before the DNS records were proxied may keep showing it.

Test in this order:

1. **Incognito window** → `https://gacpth.com`. Different profile, no stored
   exception. If this works, the fix is already in and only the main profile
   needs clearing.
2. From PowerShell — this fails loudly on an untrusted chain:
   ```powershell
   curl.exe -sSI https://gacpth.com
   ```
   A response carrying `server: cloudflare` means the certificate is trusted.
   `521`/`522`/`525` instead means Cloudflare cannot reach the origin — a
   different problem, fixed on the server (port 443 closed, nginx down, or the
   host firewall blocking Cloudflare's ranges).
3. Clear stored state on the main profile:
   `chrome://net-internals/#hsts` → **Delete domain security policies** →
   `gacpth.com`, then restart the browser.
4. Confirm what the client actually resolves, and that nothing local is pinning
   the origin:
   ```powershell
   ipconfig /flushdns
   nslookup gacpth.com                                  # expect 104.x / 172.67.x
   notepad C:\Windows\System32\drivers\etc\hosts        # no gacpth.com line
   ```
   A `hosts` entry pointing at the origin IP bypasses Cloudflare on that one
   machine and produces exactly this certificate error — which is what makes it
   look like the site is restricted to a single machine when it is not.

## The symptom

Every browser, on every machine, refuses `https://gacpth.com` with:

```
NET::ERR_CERT_AUTHORITY_INVALID
การเชื่อมต่อของคุณไม่เป็นส่วนตัว
```

**This is not an IP restriction and not a firewall.** Nothing in this repo
limits the public site to one machine — `deploy/nginx/gacp-platform.conf`
serves `location /` with no `allow`/`deny` at all. There is also no MAC-address
restriction anywhere, and there could not be: a MAC address never leaves the
local network segment, so a server cannot see the visitor's.

## What the error actually means

`AUTHORITY_INVALID` means the certificate is signed by an issuer the browser
does not trust — a **self-signed certificate**. Distinguish it from its
neighbours, because they point at different fixes:

| Chrome error | Meaning |
| --- | --- |
| `ERR_CERT_AUTHORITY_INVALID` | self-signed, or unknown CA ← **this one** |
| `ERR_CERT_DATE_INVALID` | expired or not yet valid |
| `ERR_CERT_COMMON_NAME_INVALID` | valid cert, wrong hostname |

The origin is serving the bootstrap certificate that
`scripts/deploy/setup-host-nginx.sh` generates when no real one is present:

```bash
openssl req -x509 -nodes -days 365 -newkey rsa:2048 \
  -keyout "$KEY" -out "$CRT" -subj "/C=TH/ST=Bangkok/O=GACP/CN=gacpth.com"
```

Its CN is right, which is why the error is `AUTHORITY_INVALID` rather than
`COMMON_NAME_INVALID`. That certificate is **correct by design** — but only as
the origin leg behind Cloudflare, never as what a visitor's browser sees.

Your own machine most likely works because it clicked through the warning once
(ขั้นสูง → ดำเนินการต่อ) and the browser remembered the exception. That is what
makes this look like an IP allowlist when it is not.

Note also `tls-cert-renewal.md`: a real Let's Encrypt certificate did exist, but
it was issued for **`152-42-218-251.sslip.io`**, not `gacpth.com`, and its
renewal was broken (`authenticator = standalone` fighting the host nginx on
port 80). Its `notAfter` was **2026-06-03**.

## Pick the architecture, then follow one path

### Path A — Cloudflare in front (what the deploy scripts assume)

Visitors get Cloudflare's trusted certificate; the self-signed origin cert stays
and is fine.

1. Cloudflare → DNS → `gacpth.com` A record → `203.0.113.10`,
   **Proxy status = Proxied (orange cloud)**. A grey cloud sends browsers
   straight at the origin, which is exactly the current symptom.
2. Cloudflare → SSL/TLS → Overview → mode = **Full**.
3. Hardening, once that works: install a Cloudflare **Origin Certificate**
   (Dashboard → SSL/TLS → Origin Server) at `nginx/ssl/gacp.crt|.key`, then
   switch the mode to **Full (strict)**.

Verify:

```bash
# from any machine, not the server
curl -sSI https://gacpth.com | head -1
dig +short gacpth.com                    # should be Cloudflare IPs, not the droplet
```

### Path B — no Cloudflare, a real Let's Encrypt certificate on the origin

1. DNS `gacpth.com` (and `www`) A → `203.0.113.10`, no proxy. Confirm it has
   propagated before asking for a certificate — Let's Encrypt validates over
   the public DNS, and failed attempts count against the rate limit:

   ```bash
   dig +short gacpth.com                 # must return 203.0.113.10
   ```

2. Ports 80 and 443 open to `0.0.0.0/0` in **both** the cloud firewall
   (DigitalOcean → Networking → Firewalls) and on the host:

   ```bash
   sudo ufw status
   sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
   ```

   Port 80 must stay open even though everything redirects to HTTPS — the ACME
   HTTP-01 challenge is served over plain HTTP.

3. Prepare the ACME webroot and the nginx location that serves it. The existing
   maintenance script already does exactly this, and it is idempotent:

   ```bash
   sudo bash /opt/gacp-platform/scripts/maintenance/fix-certbot-renewal.sh
   ```

   It creates `/var/www/certbot`, patches the host vhost to serve
   `/.well-known/acme-challenge/` from there **before** the HTTPS redirect, and
   switches the renewal config off `standalone`.

4. Issue the certificate for the real domain. Use `--webroot`, never
   `--standalone` — nginx holds port 80 and standalone would fail:

   ```bash
   sudo certbot certonly --webroot -w /var/www/certbot \
     -d gacpth.com -d www.gacpth.com \
     --email <operator@example.go.th> --agree-tos --non-interactive
   ```

5. Point nginx at it with **symlinks**, not copies, so a renewal takes effect
   without anyone remembering to re-copy:

   ```bash
   sudo ln -sf /etc/letsencrypt/live/gacpth.com/fullchain.pem \
               /opt/gacp-platform/nginx/ssl/gacp.crt
   sudo ln -sf /etc/letsencrypt/live/gacpth.com/privkey.pem \
               /opt/gacp-platform/nginx/ssl/gacp.key
   sudo nginx -t && sudo systemctl reload nginx
   ```

6. Prove renewal works now rather than discovering it in 90 days — that is the
   failure this platform already had once:

   ```bash
   sudo certbot renew --dry-run
   # Expected: "Congratulations, all simulated renewals succeeded"
   ```

## Verify from a machine that has never visited the site

A browser that once accepted the warning will keep accepting it, so it cannot
tell you whether the fix worked. Check from somewhere clean:

```bash
echo | openssl s_client -connect gacpth.com:443 -servername gacpth.com 2>/dev/null \
  | openssl x509 -noout -issuer -subject -dates
```

Expect an issuer of `Let's Encrypt` (Path B) or `Cloudflare Inc` (Path A), a
subject of `CN=gacpth.com`, and a `notAfter` in the future. An issuer of
`O=GACP` is the self-signed bootstrap certificate — the fix has not taken.

## Do not "fix" this by removing access controls

`deploy/nginx/gacp-platform.conf` and `nginx/gacp.production.conf` restrict
three things by IP. All three are correct and none of them affect the public
site:

| Location | Why it is restricted |
| --- | --- |
| `/stub_status` | nginx metrics for the Prometheus exporter |
| `/pgadmin/` | **the database administration console** |
| `/\.` and `*.bak|sql|log|ini` | config and backup files |

Opening `/pgadmin/` would put a database console for a government platform on
the public internet. The certificate is the problem; these are not.
