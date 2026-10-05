# GACP Platform — Hand-off Document

> **Project**: GACP Certification System (ระบบรับรองมาตรฐาน GACP สมุนไพรไทย)
> **Version**: 3.0.0
> **Date**: March 16, 2026
> **Status**: ✅ Production-ready

---

## Executive Summary

The GACP Platform is a full-stack web application for managing Thai herbal certification under the Good Agricultural and Collection Practices (GACP) standard. It serves three user types:

1. **Health Users** (farmers/applicants) — submit certification applications, manage farms, upload documents, track progress
2. **Providers** (government officers) — review applications, conduct audits, issue certificates, manage scoring
3. **Administrators** — manage users, system settings, communications

---

## Technology Stack

| Layer | Technology | Version |
| :--- | :--- | :--- |
| Frontend | Next.js (App Router) | 14.x |
| Backend | Express.js (Node.js) | 4.x |
| Database | PostgreSQL (Prisma ORM) | 14+ |
| Cache | Redis | 7+ |
| Storage | MinIO / Local FS | — |
| Container | Docker Compose | — |
| Hosting | DigitalOcean | — |
| Domain | gacpth.com | Cloudflare |

---

## Quality Metrics

| Metric | Score | Notes |
| :--- | :---: | :--- |
| Code Review | **100/100** | 10-agent automated suite |
| Journey Tests | **208/208** (100%) | 20 agents in 95.8s |
| Quality Agents | **64/64** (100%) | 8 agents (typo, type, lint, LQA, alpha, beta, a11y, perf) |
| API Health | ✅ Online | gacpth.com/api/v1/health |
| Accessibility | Good | WCAG AA, 117 ARIA attrs, prefers-reduced-motion |

---

## Included Documentation

| Document | Description |
| :--- | :--- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | System architecture, data flow, service catalog |
| [API-REFERENCE.md](API-REFERENCE.md) | 60+ API endpoints, auth, rate limits |
| [DEVELOPMENT-GUIDE.md](DEVELOPMENT-GUIDE.md) | Setup, test accounts, commands, conventions |
| [README.md](README.md) | Project overview |

---

## Key Features

### For Health Users (Farmers)

- ✅ Application wizard (multi-step form)
- ✅ Document upload (14 drag-drop zones)
- ✅ Progress tracking with visual progress bar
- ✅ Payment via PromptPay QR
- ✅ Certificate viewing & renewal
- ✅ Farm & planting cycle management
- ✅ Notification center (email + in-app)

### For Providers (Officers)

- ✅ Application review dashboard
- ✅ 8-category GACP scoring engine
- ✅ Field audit checklist
- ✅ Document review & approval
- ✅ Certificate issuance
- ✅ Analytics & reporting

### For System

- ✅ JWT authentication with CSRF protection
- ✅ Role-based access control (RBAC)
- ✅ Rate limiting per endpoint
- ✅ Audit trail (immutable logs)
- ✅ Email & SMS notifications
- ✅ PDF generation (invoices, certificates)
- ✅ QR code traceability
- ✅ i18n support (Thai/English)
- ✅ Dark mode support
- ✅ Digital signatures (e-Sign)

---

## Deployment Checklist

- [ ] Set up PostgreSQL database
- [ ] Configure `.env.production` (see `.env.production.example`)
- [ ] Run `npx prisma migrate deploy`
- [ ] Build Docker images
- [ ] Start with `docker compose up -d`
- [ ] Verify health: `curl http://localhost:8000/health`
- [ ] Point domain DNS to server IP

---

## Known Limitations

1. **Mobile app** — `apps/mobile-app/` is a placeholder, not implemented
2. **SMS** — Uses mock service; production needs real SMS provider (e.g., ThaiBulkSMS)
3. **Email** — SMTP configuration required for production
4. **Object storage** — Falls back to local filesystem if MinIO not configured
5. **Redis** — Application runs without Redis (graceful degradation)

---

## Support

For technical questions, refer to the documentation files above or contact the development team.
