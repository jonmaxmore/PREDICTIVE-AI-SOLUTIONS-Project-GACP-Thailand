# Database Migration Instructions
## คำแนะนำการรัน Migration สำหรับ DTAM Requirements

> **เอกสารนี้เลิกใช้แล้ว (superseded) เก็บไว้เป็นบันทึกเหตุการณ์เท่านั้น**
>
> ทุกคำสั่งด้านล่างอ้างถึง `apps/backend/prisma/schema.prisma` ซึ่งเป็นไฟล์เดียวที่ถูกลบไปตั้งแต่
> 2026-03-12 (commit 3120e673) ตอนแยก schema เป็นโฟลเดอร์ `apps/backend/prisma/schema/`
> ตอนนี้ schema ที่ถูกต้องคือโฟลเดอร์ และทุกคำสั่ง Prisma ต้องส่ง `--schema prisma/schema`
> ถ้าคุณต้องรัน migration จริง ให้ใช้ `docs/deployment/preview-deploy-runbook.md`
> หรือขั้นตอน deploy ใน `.github/workflows/production.yml`
>
> คำสั่งที่ถูกต้องวันนี้:
>
> ```bash
> docker exec -it gacp-backend sh -lc "cd /app/apps/backend && npx prisma migrate deploy --schema prisma/schema"
> ```

---

## ⚠️ สถานะปัจจุบัน

**Schema File:**
- Local file: `apps/backend/prisma/schema.prisma` (2,097 lines) ✅ **Updated**
- Container file: `prisma/schema.prisma` (1,479 lines) ❌ **Not synced**

**Issue:** Container ไม่เห็นไฟล์ schema ที่อัปเดตแล้ว (เนื่องจาก volume mount หรือ caching)

---

## 🔧 วิธีแก้ไข

### วิธีที่ 1: Rebuild Container (แนะนำ)

```bash
# 1. หยุดและลบ container เดิม
docker-compose down

# 2. Rebuild backend image
docker-compose build backend

# 3. สร้าง container ใหม่
docker-compose up -d

# 4. รัน migration
docker exec gacp-backend npx prisma migrate dev --name add_dtam_requirements

# หรือใช้ db push (ถ้าไม่ต้องการสร้าง migration file)
docker exec gacp-backend npx prisma db push
```

### วิธีที่ 2: Copy Schema เข้า Container

```bash
# Copy schema file เข้า container
docker cp apps/backend/prisma/schema.prisma gacp-backend:/app/prisma/schema.prisma

# รัน migration
docker exec gacp-backend npx prisma db push

# Restart container
docker restart gacp-backend
```

### วิธีที่ 3: ใช้ docker-compose.dev.yml (Development Mode)

```bash
# ถ้ามีไฟล์ docker-compose.dev.yml ที่ mount volume แบบ realtime
docker-compose -f docker-compose.yml -f docker-compose.dev.yml up -d

# จากนั้นรัน migration
docker exec gacp-backend npx prisma migrate dev --name add_dtam_requirements
```

---

## ✅ หลังจาก Migration สำเร็จ

### ตรวจสอบว่า Tables ถูกสร้างแล้ว

```bash
# ตรวจสอบ tables ใหม่
docker exec gacp-postgres psql -U gacp -d gacp_db -c "\dt"

# ควรเห็น tables เหล่านี้:
# - water_sources
# - seed_sources
# - fertilizer_records
# - controlled_environments
# - packaging_details
# - drying_processes
# - application_bundles
```

### ตรวจสอบ API

```bash
# Test API Health
curl http://localhost/api/health

# ควรได้ response:
# {
#   "success": true,
#   "version": "2.0.0",
#   ...
# }
```

### Test New API Endpoints

```bash
# 1. Water Sources API
curl http://localhost/api/water-sources/plot/[PLOT_ID] \
  -H "Authorization: Bearer [TOKEN]"

# 2. Seed Sources API  
curl http://localhost/api/seed-sources/cycle/[CYCLE_ID] \
  -H "Authorization: Bearer [TOKEN]"

# 3. Fertilizer Records API
curl http://localhost/api/fertilizer-records/cycle/[CYCLE_ID] \
  -H "Authorization: Bearer [TOKEN]"

# 4. Application Bundles API
curl http://localhost/api/application-bundles/my \
  -H "Authorization: Bearer [TOKEN]"
```

---

## 🔥 ถ้า Migration ล้มเหลว

### กรณี 1: Conflict กับตารางเดิม

```bash
# Reset database (ระวัง: ข้อมูลจะหายหมด)
docker exec gacp-backend npx prisma migrate reset --force

# หรือใช้ db push ด้วย --accept-data-loss
docker exec gacp-backend npx prisma db push --accept-data-loss
```

### กรณี 2: Prisma Client ไม่ sync

```bash
# Generate Prisma Client ใหม่
docker exec gacp-backend npx prisma generate

# Restart backend
docker restart gacp-backend
```

### กรณี 3: Database connection error

```bash
# ตรวจสอบว่า PostgreSQL รันอยู่
docker ps | grep postgres

# ถ้าไม่รัน ให้ start
docker-compose up -d postgres

# รอ 10 วินาทีแล้วลองใหม่
sleep 10
docker exec gacp-backend npx prisma db push
```

---

## 📋 Migration Checklist

- [ ] Backend container เห็น schema.prisma ไฟล์ล่าสุด (2,097 lines)
- [ ] รัน `prisma migrate dev` หรือ `prisma db push` สำเร็จ
- [ ] Tables ใหม่ถูกสร้างในฐานข้อมูล (ตรวจสอบด้วย `\dt`)
- [ ] Prisma Client ถูก generate ใหม่
- [ ] Backend restart สำเร็จ
- [ ] API health check ผ่าน
- [ ] Test API endpoints ใหม่ทำงานได้

---

## 🆘 ติดต่อ Support

หากมีปัญหาในการ migration:
1. ตรวจสอบ logs: `docker logs gacp-backend`
2. ตรวจสอบ database logs: `docker logs gacp-postgres`
3. ตรวจสอบว่า schema file มี models ใหม่หรือไม่

---

**สร้างเมื่อ:** 2026-02-05  
**สำหรับ:** DTAM Requirements Implementation
