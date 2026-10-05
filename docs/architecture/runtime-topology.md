# Runtime Topology — GACP Platform

> How the system runs in development and production.

## Components

| Service | Container | Port | Technology |
|---------|-----------|------|-----------|
| Backend | gacp-backend | 8000 | Node.js + Express + Prisma |
| Frontend | gacp-frontend | 3000 | Next.js App Router |
| Nginx | gacp-nginx | 80/443 | Reverse proxy + TLS |
| PostgreSQL | gacp-postgres | 5432 | Primary database |
| Redis | gacp-redis | 6379 | Cache + sessions |

## Network Topology

```
Internet → Cloudflare → Nginx (:443)
                          ├── /api/* → Backend (:8000)
                          └── /* → Frontend (:3000)
```

## Docker Compose Files

| File | Purpose | Use |
|------|---------|-----|
| `docker-compose.yml` | Local development | `docker compose up` |
| `docker-compose.production.yml` | Production deployment | `docker compose -f docker-compose.production.yml up -d` |

## Environment Variables (Critical)

| Variable | Required | Purpose |
|----------|----------|---------|
| DATABASE_URL | Yes | PostgreSQL connection string |
| JWT_SECRET | Yes | JWT signing key |
| REDIS_URL | Yes | Redis connection string |
| CORS_ORIGIN | Yes | Allowed CORS origins |
| PORT | Yes (default: 8000) | Backend listening port |

## Health Checks

| Service | Endpoint | Expected |
|---------|----------|----------|
| Backend | GET /api/health | `{"success": true, "version": "3.0.0"}` |
| Frontend | GET / | HTTP 200 |
| Nginx | curl http://127.0.0.1:80/health | Proxy to backend |

## Production Server
- IP: `203.0.113.10`
- Domain: `gacpth.com`
- TLS: Cloudflare managed
