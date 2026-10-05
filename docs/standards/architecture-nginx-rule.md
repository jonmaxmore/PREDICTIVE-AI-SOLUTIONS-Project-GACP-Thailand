# Architecture Standard: Production Ingress and Reverse Proxy

## Rule

**For the current single-host production deployment, host nginx MUST sit at the public edge and Docker nginx MUST remain an internal router behind it.**

Any production deployment that exposes the backend or frontend containers directly to the internet is strictly considered **incorrect and non-compliant**.

## Rationale

1. **Edge isolation**: Host nginx owns public `:80/:443`, TLS termination, and request normalization.
2. **Internal routing**: Docker nginx handles application routing and rate-limiting without exposing app containers directly.
3. **Path correctness**: `/api/*` reaches `backend:8000` and `/` reaches `frontend:3000`.
4. **Operational safety**: Backend, frontend, Postgres, Redis, and MinIO remain internal or loopback-only.
5. **Release consistency**: Deploy scripts and CI can validate a single approved ingress shape.

## Implementation

The standard `docker-compose.production.yml` includes the internal Docker nginx service. On the host, `/etc/nginx/sites-available/gacp-platform.conf` is the public edge. The approved single-host topology is:

```yaml
Host nginx :80/:443
  -> 127.0.0.1:8080
    -> Docker nginx :80
      -> frontend:3000
      -> backend:8000
```

## Compliance checks

- `docker-compose.production.yml` must keep Docker nginx on `127.0.0.1:8080:80`.
- `frontend` and `backend` must not publish host ports in production compose.
- `deploy/nginx/gacp-platform.conf` must proxy public traffic to Docker nginx on loopback.
- `nginx/gacp.production.conf` must route `/api/*` to backend and `/` to frontend.

## Enterprise target

The topology above is the approved single-host baseline. It is **not** the highest-availability target.
For business-critical production, the preferred end state is:

- managed edge load balancer or WAF/CDN at the public boundary
- multiple app replicas across at least two failure domains
- managed HA database and HA cache
- object storage separated from the application host
- IaC, monitored rollouts, rollback automation, and restore drills

See `docs/standards/production-infrastructure-standard.md` for the canonical target state.
