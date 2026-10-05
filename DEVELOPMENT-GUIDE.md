# GACP Platform — Development Guide

> Quick start guide for new developers joining the project.

---

## Prerequisites

- **Node.js** 18+ (LTS recommended)
- **PostgreSQL** 14+ (or Docker)
- **Redis** 7+ (optional, for caching)
- **npm** 9+ (comes with Node.js)

## Getting Started

### 1. Clone & Install

```bash
git clone https://github.com/jonmaxmore/GACP-Certification-Application.git
cd GACP-Certification-Application

# Install backend dependencies
cd apps/backend && npm install

# Install frontend dependencies  
cd ../web-app && npm install
```

### 2. Database Setup

```bash
# Copy env template
cd apps/backend
cp .env.example .env

# Edit .env — set DATABASE_URL
# Example: DATABASE_URL="postgresql://gacp:password@localhost:5432/gacp"

# Run Prisma migrations
npx prisma migrate dev

# Seed initial data
npx prisma db seed
```

### 3. Start Development Servers

```bash
# Terminal 1: Backend (port 3000)
cd apps/backend
npm run dev

# Terminal 2: Frontend (port 3001)
cd apps/web-app
npm run dev
```

Open `http://localhost:3001` in your browser.

### 4. Test Accounts

| Role | ID Number | Password |
|:---|:---|:---|
| Health User | 1234567890123 | password123 |
| Provider | provider001 | password123 |
| Admin | admin001 | admin123 |

---

## Running Backend Tests Without Docker

The backend jest suite runs **engine-less out of the box** — no Docker, no
PostgreSQL, no `DATABASE_URL` required. Under jest (`NODE_ENV=test` or a
`JEST_WORKER_ID`), `services/prisma-database.js` swaps in a noop Prisma stub
instead of exiting, so a plain `npm test` works on a fresh clone:

```bash
cd apps/backend
npm test
```

Setting a **dummy** `DATABASE_URL` (any `postgresql://` string — no server
needs to be listening) makes the module take the real initialization path,
which enables the fuller test set:

```bash
cd apps/backend
DATABASE_URL="postgresql://gacp:gacp@localhost:5432/gacp_test" npm test
```

Outside of tests, behavior is unchanged: the backend still refuses to start
without a valid `DATABASE_URL` (Docker-only stance).

### Pointing Acceptance Scripts at Another Environment

The acceptance `.mjs` scripts in `apps/web-app/playwright/` default to
`https://staging.gacpth.com` but accept a base-URL override via env:

| Variable | Scripts |
|:---|:---|
| `WALK_BASE_URL` | `a-z-lifecycle.mjs`, `role-walkthrough.mjs`, `queue-reviewer-distribute.mjs`, `slip-approve.mjs`, `workflow-queue-drive.mjs`, `accounting-farm-deep.mjs` |
| `EVIDENCE_BASE_URL` | `acceptance-evidence-capture.mjs` |

Example — run the role walkthrough against a local frontend:

```bash
cd apps/web-app
WALK_BASE_URL="http://localhost:3001" node playwright/role-walkthrough.mjs
```

---

## Key Commands

```bash
# Run tests
cd apps/backend && npm test

# Run code review (10 agents)
node scripts/review/run-all-review-agents.js

# Run journey tests (20 agents)
node scripts/test/journey/run-all-journey-tests.js

# Build frontend
cd apps/web-app && npm run build

# Generate Prisma client
cd apps/backend && npx prisma generate
```

---

## Project Conventions

### File Naming
- **Frontend pages**: `page.tsx` (Next.js App Router)
- **Frontend components**: `kebab-case.tsx` (e.g., `document-uploader.tsx`)
- **Backend services**: `kebab-case.js` (e.g., `payment-service.js`)
- **Backend middleware**: `kebab-case.js` (e.g., `auth-middleware.js`)

### Code Style
- **Backend**: CommonJS (`require`/`module.exports`)
- **Frontend**: ES Modules (`import`/`export`)
- **Formatting**: Prettier (see `.prettierrc`)
- **Linting**: ESLint (see `eslint.config.js`)
- **CSS**: Tailwind CSS with custom design tokens in `globals.css`

### Git Workflow
- Branch from `main`
- Commit format: `type: description` (e.g., `feat: add payment validation`)
- Push to `main` for production deployment

---

## Environment Variables

See `apps/backend/.env.example` for full list. Key variables:

| Variable | Purpose | Required |
|:---|:---|:---:|
| `DATABASE_URL` | PostgreSQL connection string | ✅ |
| `JWT_SECRET` | Token signing secret | ✅ |
| `NODE_ENV` | `development` or `production` | ✅ |
| `REDIS_URL` | Redis connection string | ❌ |
| `SMTP_HOST` | Email server host | ❌ |
| `MINIO_ENDPOINT` | Object storage endpoint | ❌ |

---

## Deployment

Use the `/deploy` workflow or run manually:

> **Deploying is an operator action. Agents propose; they do not run it, and do
> not hold an SSH key.** The block that used to sit here printed a root SSH command
> against the production host plus a manual rebuild, which contradicts
> the project rules Law 3.1 and the project rules's permission matrix (`merge / deploy / keys`
> = operator only). Removed 2026-08-06.

Deploy from the GitHub Actions tab:

| target | workflow | trigger |
|---|---|---|
| staging | `Deploy to Staging (manual)` | `workflow_dispatch` — operator picks the image tag |
| production | `Production Release Workflow` | operator-initiated |

The image is built on push to `main` by `Build & Push Container Images`. The SSH
credential lives in GitHub Secrets (`PRODUCTION_SSH_KEY`) and is used only inside
those workflow runs. Runbook: `docs/operations/runbooks/` (staging deploy, #785).

---

## Useful Links

- **Production**: https://gacpth.com
- **API Health**: https://gacpth.com/api/v1/health
- **API Docs** (dev only): http://localhost:3000/api-docs
