# 🚀 PRODUCTION DEPLOYMENT PLAN

## Current topology note (2026-03-08)

- Public `:80/:443` are served by host nginx.
- Docker nginx is internal-only and binds `127.0.0.1:8080:80` in `docker-compose.production.yml`.
- Treat `docs/network-diagram.md` and `docs/standards/production-infrastructure-standard.md` as the canonical source of truth for production ingress.
## แผนการรันระบบ GACP บน Production (มืออาชีพ)

---

## 🏗️ Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                         INTERNET                             │
└──────────────────────┬──────────────────────────────────────┘
                       │
                       ▼
┌─────────────────────────────────────────────────────────────┐
│  NGINX (Reverse Proxy)                                       │
│  - Port 80 (HTTP) → Redirect to HTTPS                       │
│  - Port 443 (HTTPS) - Public Entry Point                    │
│  - Rate Limiting, Security Headers                          │
│  - Static File Caching                                      │
└──────────┬───────────────────────────────┬──────────────────┘
           │                               │
           ▼                               ▼
┌─────────────────────┐      ┌─────────────────────────────┐
│  Frontend           │      │  Backend API                │
│  (Next.js)          │      │  (Node.js + Express)        │
│  - Port 3000        │      │  - Port 8000                │
│  - Internal only    │      │  - Internal only            │
└─────────────────────┘      └───────────┬─────────────────┘
                                         │
                                         ▼
                            ┌─────────────────────────────┐
                            │  PostgreSQL 15              │
                            │  - Port 5432 (Internal)     │
                            │  - Persistent Volume        │
                            └─────────────────────────────┘
                                         ▲
                                         │
                            ┌─────────────────────────────┐
                            │  Redis 7                    │
                            │  - Port 6379 (Internal)     │
                            │  - Cache & Sessions         │
                            └─────────────────────────────┘
```

---

## 📁 โครงสร้างไฟล์ที่ถูกต้อง

### Docker Compose Structure
```
.
├── docker-compose.yml              ← Development
├── docker-compose.production.yml   ← Production (ใช้ไฟล์นี้)
├── docker-compose.qa.yml          ← QA Testing
└── docker/
    └── nginx/
        ├── default.conf            ← Dev Config
        └── production.conf         ← Production Config
```

### สิ่งที่ควรมีใน Repository
```
apps/
├── backend/
│   ├── Dockerfile
│   └── ...
├── web-app/
│   ├── Dockerfile
│   └── ...
└── mobile-app/          ← Optional (ถ้าไม่ใช้ลบออก)

docker/
└── nginx/
    ├── default.conf     ← MUST HAVE
    └── production.conf  ← MUST HAVE

nginx/
├── ssl/                 ← SSL Certificates (ไม่ต้อง commit)
│   ├── gacp.crt
│   └── gacp.key
└── nginx.qa.conf       ← QA Config

docs/
├── CURRENT_SYSTEM_architecture-legacy.md
├── MEMBERSHIP_SYSTEM_CURRENT.md
├── APPLICATION_WORKFLOW_CURRENT.md
├── system-audit-report.md
├── CLEANUP_PLAN.md
└── PRODUCTION_DEPLOYMENT_PLAN.md (ไฟล์นี้)
```

---

## 🚀 ขั้นตอนการ Deploy Production

### Step 1: Environment Setup

```bash
# 1.1 Copy environment template
cp .env.production.template .env.production

# 1.2 Edit .env.production
nano .env.production
```

**Required Variables:**
```bash
# Database
DB_USER=gacp
DB_PASSWORD=<strong-password-here>
DB_NAME=gacp_db

# JWT Secrets (generate with: openssl rand -base64 32)
HEALTH_JWT_SECRET=<random-32-char-secret>
PROVIDER_JWT_SECRET=<different-random-secret>
JWT_SECRET=<optional-health-fallback-secret>

# Encryption (32 characters)
ENCRYPTION_KEY=<32-char-encryption-key>

# Public URLs
PUBLIC_API_URL=https://your-domain.com
PUBLIC_WEB_URL=https://your-domain.com

# Email (if enabled)
EMAIL_ENABLED=true
SMTP_HOST=smtp.gmail.com
SMTP_USER=noreply@your-domain.com
SMTP_PASS=<app-password>
```

### Step 2: SSL Certificates

```bash
# 2.1 Create SSL directory
mkdir -p nginx/ssl

# 2.2 Copy certificates
cp your-certificate.crt nginx/ssl/gacp.crt
cp your-private.key nginx/ssl/gacp.key

# 2.3 Set permissions
chmod 600 nginx/ssl/gacp.key
chmod 644 nginx/ssl/gacp.crt
```

### Step 3: Build & Deploy

```bash
# 3.1 Stop existing containers
docker-compose -f docker-compose.production.yml down

# 3.2 Pull latest images (or build)
docker-compose -f docker-compose.production.yml pull
# OR
docker-compose -f docker-compose.production.yml build --no-cache

# 3.3 Start services
docker-compose -f docker-compose.production.yml up -d

# 3.4 Run migrations
docker-compose -f docker-compose.production.yml exec backend npx prisma migrate deploy

# 3.5 Seed initial data (if needed)
docker-compose -f docker-compose.production.yml exec backend npm run seed:production
```

### Step 4: Verify Deployment

```bash
# Check all services are running
docker-compose -f docker-compose.production.yml ps

# Check logs
docker-compose -f docker-compose.production.yml logs -f

# Health check
curl https://your-domain.com/api/health
```

---

## 🔒 Security Checklist

### Network Security
- [ ] ไม่ expose database port (5432) ออกนอก
- [ ] ไม่ expose redis port (6379) ออกนอก
- [ ] ไม่ expose backend port (8000) ออกนอก
- [ ] มี firewall ปิด port ที่ไม่ใช้

### Application Security
- [ ] JWT secrets แรงพอ (32+ chars, random)
- [ ] Cookie secure flag = true
- [ ] CORS จำกัด domain
- [ ] Rate limiting เปิดใช้งาน
- [ ] Security headers ครบถ้วน

### Data Security
- [ ] Database backup อัตโนมัติ
- [ ] Encryption key แยกเก็บ
- [ ] SSL certificate ไม่หมดอายุ

---

## 📊 Monitoring & Logging

### Health Checks
```bash
# Check all services
docker-compose -f docker-compose.production.yml ps

# Check specific service
docker-compose -f docker-compose.production.yml logs backend
docker-compose -f docker-compose.production.yml logs postgres
docker-compose -f docker-compose.production.yml logs nginx
```

### Log Rotation
```bash
# Setup logrotate for nginx logs
cat > /etc/logrotate.d/gacp-nginx << EOF
/var/log/gacp/nginx/*.log {
    daily
    rotate 14
    compress
    delaycompress
    missingok
    notifempty
    create 0644 www-data www-data
    sharedscripts
    postrotate
        [ -f /var/run/nginx.pid ] && kill -USR1 \$(cat /var/run/nginx.pid)
    endscript
}
EOF
```

---

## 🔄 Backup Strategy

### Database Backup
```bash
#!/bin/bash
# backup-db.sh

BACKUP_DIR="/backups/gacp"
DATE=$(date +%Y%m%d_%H%M%S)

# Create backup
docker exec gacp-postgres pg_dump -U gacp gacp_db > $BACKUP_DIR/backup_$DATE.sql

# Compress
gzip $BACKUP_DIR/backup_$DATE.sql

# Keep only last 7 days
find $BACKUP_DIR -name "backup_*.sql.gz" -mtime +7 -delete
```

### Cron Job
```bash
# Run backup daily at 2 AM
0 2 * * * /path/to/backup-db.sh
```

---

## 🚨 Rollback Plan

### ถ้า Deploy ผิดพลาด

```bash
# 1. Stop new version
docker-compose -f docker-compose.production.yml down

# 2. Restore previous images
docker tag gacp-backend:backup gacp-backend:latest
docker tag gacp-frontend:backup gacp-frontend:latest

# 3. Start with old version
docker-compose -f docker-compose.production.yml up -d

# 4. Restore database (ถ้าจำเป็น)
docker exec -i gacp-postgres psql -U gacp gacp_db < backup_file.sql
```

---

## 📞 Emergency Contacts

| บทบาท | ชื่อ | เบอร์โทร |
|-------|------|----------|
| System Admin | ... | ... |
| Database Admin | ... | ... |
| Developer Lead | ... | ... |

---

## ✅ Post-Deployment Checklist

- [ ] Website เปิดได้ https://your-domain.com
- [ ] API health check ผ่าน
- [ ] Login ได้ (Health + Provider)
- [ ] สมัครสมาชิกได้
- [ ] สร้าง Application ได้
- [ ] อัปโหลดไฟล์ได้
- [ ] Database backup ทำงาน
- [ ] Logs ถูกต้อง
- [ ] Monitoring alerts ทำงาน

---

**เอกสารเวอร์ชั่น:** 1.0  
**อัปเดตล่าสุด:** 2026-02-05  
**ผู้จัดทำ:** Kimi Code CLI
