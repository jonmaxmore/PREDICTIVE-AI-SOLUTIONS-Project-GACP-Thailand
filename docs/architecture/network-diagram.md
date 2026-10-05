# GACP Runtime Network Diagram (Required Topology)

Last updated: 2026-03-08

Source of truth:
- `docker-compose.production.yml`
- `nginx/gacp.production.conf`
- `apps/backend/server.js`
- `apps/backend/routes/api/webhooks.js`

## 1) Production network diagram (the one we must use)

```mermaid
flowchart TB
  subgraph Internet["Public Network"]
    HealthUser["Health User Browser"]
    PROVIDERUser["Provider/Admin Browser"]
    PublicUser["Public QR Scanner Browser"]
    MobileApp["Mobile App (release mode)"]
    PaymentGateway["Payment Gateway"]
    Operator["Operator (SSH)"]
  end

  CloudFirewall["DigitalOcean Cloud Firewall: gacp-production\nAllow: 80/tcp (all), 443/tcp (all), 22/tcp (operator IP only), 2222/tcp (operator IP only)\nDeny: all other inbound"]

  subgraph Host["Deployment Host"]
    HostNginx["Host nginx\nPublic: 80/443"]

    subgraph DockerNet["Docker Network: gacp-network (bridge)"]
      DockerNginx["docker nginx\nHost loopback: 127.0.0.1:8080 -> :80"]
      Frontend["frontend (Next.js)\nInternal: 3000 only"]
      Backend["backend (Node.js/Express)\nInternal: 8000 only"]
      Postgres["postgres\nInternal: 5432 only"]
      Redis["redis\nInternal: 6379 only"]
      MinIO["minio\nInternal: 9000\nHost loopback only: 127.0.0.1:9000,9001"]
    end
  end

  HealthUser -->|"HTTPS :443"| CloudFirewall
  PROVIDERUser -->|"HTTPS :443"| CloudFirewall
  PublicUser -->|"HTTPS :443"| CloudFirewall
  MobileApp -->|"HTTPS :443"| CloudFirewall
  PaymentGateway -->|"HTTPS :443"| CloudFirewall
  Operator -->|"SSH :2222 (operator IP only)"| CloudFirewall

  CloudFirewall -->|"pass :80/:443"| HostNginx
  CloudFirewall -->|"pass :2222"| Host

  HostNginx -->|"Loopback proxy 127.0.0.1:8080"| DockerNginx
  DockerNginx -->|"Route / -> frontend:3000"| Frontend
  DockerNginx -->|"Route /api/* -> backend:8000"| Backend

  Frontend -->|"INTERNAL_API_URL (SSR/server actions)"| Backend
  Backend -->|"Prisma read/write"| Postgres
  Backend -->|"Cache + Bull queues"| Redis
  Backend -->|"Object storage (S3-compatible API)"| MinIO
```

## 2) Required network rules

- All inbound traffic passes through DigitalOcean Cloud Firewall (`gacp-production`) first.
- Cloud Firewall allows: port 80/tcp (all), port 443/tcp (all), port 22/tcp (operator IP only), port 2222/tcp (operator IP only). All other inbound is denied.
- SSH access uses port 2222 from outside. Port 22 is restricted to operator IP at cloud firewall level.
- Public ingress must go through host `nginx` only (`80/443`).
- Docker `nginx` must bind to loopback only (`127.0.0.1:8080:80`) on single-host production.
- `frontend:3000` and `backend:8000` must stay internal-only.
- `postgres:5432` and `redis:6379` must stay internal-only.
- `minio` console and API are host-loopback bound only (`127.0.0.1`), not public.
- Payment callbacks come through `POST /api/webhooks/payment` via nginx.
