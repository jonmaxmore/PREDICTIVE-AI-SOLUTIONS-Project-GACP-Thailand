# 🚀 Production Deployment Guide

## Current topology note (2026-03-08)

- Public `:80/:443` belong to host nginx, not the Docker nginx container.
- `docker-compose.production.yml` keeps Docker nginx on `127.0.0.1:8080:80`.
- Canonical references: `docs/network-diagram.md`, `docs/standards/architecture-nginx-rule.md`, `docs/standards/production-infrastructure-standard.md`.

## การอัปเดตระบบใหม่ (Payment-First Flow)

### โครงสร้าง Production
```
Docker Compose (Production)
├── nginx (Port 80/443) ← Entry Point
├── backend (Port 8000) ← Internal Only
├── frontend (Port 3000) ← Internal Only
├── postgres (Port 5432) ← Internal Only
└── redis (Port 6379) ← Internal Only
```

### การเปลี่ยนแปลงที่สำคัญ

#### 1. Database Schema (Prisma)
- ✅ เพิ่ม `PaymentTransaction` model
- ✅ เพิ่ม fields สำหรับ payment (phase1, phase2)
- ✅ เพิ่ม fields สำหรับ preview

#### 2. New API Endpoints
```
POST   /api/payments/phase1/:id
POST   /api/payments/phase2/:id
GET    /api/payments/status/:id
GET    /api/payments/url/:id
POST   /api/webhooks/payment
GET    /api/preview/applications/:id/preview
POST   /api/preview/applications/:id/prepare-preview
GET    /api/provider/scheduler/queue
POST   /api/provider/scheduler/assign-reviewer
POST   /api/provider/scheduler/approve-document
POST   /api/provider/scheduler/schedule-audit
GET    /api/provider/scheduler/stats
```

#### 3. New Frontend Pages
- `/health/applications/preview` - ตรวจสอบข้อมูลก่อนจ่ายเงิน
- `/health/applications/payment` - ผลการชำระเงิน

---

## ขั้นตอน Deployment

### Step 1: Database Migration
```bash
# ใน container หรือ local
cd apps/backend
npx prisma migrate dev --name add_payment_flow
```

### Step 2: Environment Variables
เพิ่มใน `.env.production`:
```env
# Payment Gateway
PAYMENT_GATEWAY=OMISE
PAYMENT_PUBLIC_KEY=pk_live_xxx
PAYMENT_SECRET_KEY=sk_live_xxx
PAYMENT_WEBHOOK_SECRET=whsec_xxx

# Frontend URL
FRONTEND_URL=https://your-domain.com
```

### Step 3: Build & Deploy
```bash
# วิธีที่ 1: ใช้ script
double-click: start-production.bat

# วิธีที่ 2: Manual
docker-compose -f docker-compose.production.yml down
docker-compose -f docker-compose.production.yml build --no-cache
docker-compose -f docker-compose.production.yml up -d
```

### Step 4: Verify
```bash
# Check containers
docker ps

# Check logs
docker-compose -f docker-compose.production.yml logs -f

# Test API
curl http://localhost/api/health
```

---

## Webhook Configuration

### Payment Gateway Dashboard
ตั้งค่า Webhook URL:
```
https://your-domain.com/api/webhooks/payment
```

### กำหนด Webhook Secret
ใน `.env.production`:
```env
PAYMENT_WEBHOOK_SECRET=whsec_xxx
```

---

## Cleanup Development Files

ลบไฟล์ที่ไม่จำเป็นออกจาก production:
```
.vscode/launch.json (ใช้เฉพาะ dev)
.vscode/tasks.json (ใช้เฉพาะ dev)
start-dev.bat (ใช้เฉพาะ dev)
```

**เก็บไว้:**
```
docker-compose.production.yml
docker/
nginx/
apps/backend/
apps/web-app/
```

---

## Testing Production Flow

### 1. Health Flow
1. สร้าง Draft
2. ไปหน้า Preview
3. ชำระเงิน 5,000 บาท
4. ตรวจสอบเข้าคิว

### 2. Scheduler Flow
1. ดูคิวที่ `/api/provider/scheduler/queue`
2. Assign Reviewer
3. Approve Document → สร้าง Phase 2
4. รอชำระ 25,000 บาท
5. Schedule Audit

### 3. Webhook Test
```bash
curl -X POST https://your-domain.com/api/webhooks/payment \
  -H "X-Webhook-Signature: xxx" \
  -d '{"invoiceId":"INV-xxx","status":"SUCCESS"}'
```

---

## Rollback Plan

ถ้ามีปัญหา:
```bash
# Rollback ไป version เก่า
docker-compose -f docker-compose.production.yml down
git checkout <previous-commit>
docker-compose -f docker-compose.production.yml up --build -d
```

---

**หมายเหตุ:** ระบบ production ใช้ nginx เป็น gateway เท่านั้น ไม่มีการ expose port 5000 หรือ 3000 โดยตรง
