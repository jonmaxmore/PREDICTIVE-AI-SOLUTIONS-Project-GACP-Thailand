# GACP Certification Platform

> **ลิขสิทธิ์ © 2569 มหาวิทยาลัยราชภัฏสวนสุนันทา สงวนลิขสิทธิ์**
>
> ซอฟต์แวร์นี้พัฒนาขึ้นภายใต้โครงการวิจัย "การพัฒนาระบบการผลิตสมุนไพรไทยตามแนวทางปฏิบัติทางการเกษตรและเก็บเกี่ยวที่ดีของพืชสมุนไพร เพื่อยกระดับมาตรฐานสู่สากล (GACP)" สัญญาเลขที่ C05F680149 ซึ่งได้รับทุนสนับสนุนจากหน่วยบริหารและจัดการทุนด้านการเพิ่มความสามารถในการแข่งขันของประเทศ (บพข.)
>
> มหาวิทยาลัยอนุญาตให้บริษัท พรีดิกทีฟ เอไอ โซลูชัน จำกัด ในฐานะผู้ร่วมให้ทุนโครงการ ใช้ซอฟต์แวร์นี้ตามข้อตกลงระหว่างมหาวิทยาลัยกับบริษัท
>
> ผู้อื่นจะทำซ้ำ ดัดแปลง เผยแพร่ หรือนำไปใช้เชิงพาณิชย์ ไม่ว่าทั้งหมดหรือบางส่วน ต้องได้รับอนุญาตเป็นลายลักษณ์อักษรจากมหาวิทยาลัยราชภัฏสวนสุนันทาก่อน การเปิดให้อ่านซอร์สโค้ดนี้ไม่ถือเป็นการอนุญาตให้ใช้สิทธิใด ๆ
>
> *Copyright © 2026 Suan Sunandha Rajabhat University. All rights reserved. Developed under research contract C05F680149, funded by the Program Management Unit for Competitiveness (PMUC). Predictive AI Solution Co., Ltd., as a co-funder, is permitted to use this software under its agreement with the University. Any other copying, modification, distribution or commercial use requires prior written permission from the University. Public access to this source code grants no licence.*
>
> ดูประกาศฉบับเต็มที่ [LICENSE](LICENSE) / See [LICENSE](LICENSE).

**Status:** อยู่ระหว่างการพัฒนาและทดสอบ ยังไม่เปิดให้บริการจริง (pre-production, v3.0)
**Stack:** Next.js, Node.js 24 (Express), PostgreSQL, Prisma, Docker, Nginx · package manager: pnpm

A comprehensive digital platform for **Good Agricultural and Collection Practices (GACP)** certification, enabling Applicants to apply for certification and officers to trace compliance from seed to sale.

---

## Quick Start

### Option A: Docker (Recommended)
The easiest way to run the full stack (Frontend + Backend + DB + Nginx).

```bash
docker-compose up -d --build
```
*   **Web App:** [http://localhost](http://localhost) (via Nginx)
*   **API:** [http://localhost/api](http://localhost/api)
*   **Database:** Port `5432` · ค่าเชื่อมต่ออ่านจาก environment (`DB_USER` / `DB_PASSWORD` / `DB_NAME`) ไม่มีรหัสผ่านใน README

### Option B: Local Development
Run services individually for active development.

**1. Database**
```bash
docker-compose up -d postgres redis
```

**2. Install (ครั้งเดียว ที่ราก repo)**
```bash
pnpm install --frozen-lockfile
```

**3. Backend (Port 8000)**
```bash
pnpm --filter gacp-backend dev
```

**4. Frontend (Port 3000)**
```bash
pnpm --filter web-app dev
```

---

## Testing & Verification

We have automated scripts to verify the core flows:

```bash
# ERP Regression Gate (Full Loop Verification)
node scripts/test/run-regression-gate.js

# Auth Hardening + Security Conventions Gate
npm run gate:auth-hardening

# Full Journey Matrix (lint + test + e2e + uat)
npm run test:journey:full
```

---

## Operations

### Backups
Automated backup script uses `pg_dump` from within the container.
```bash
# Creates .sql file in /backups folder
node scripts/db/backup-db.js
```

### Test accounts (Development)
บัญชีทดสอบสร้างด้วย `scripts/db/seed-test-health-users.js` บนฐานข้อมูล local เท่านั้น · README ไม่เก็บรหัสผ่าน

---

## Documentation Resources
*   **[Repository Naming Standard](docs/standards/repository-naming-and-structure.md)** - file/folder/path naming and safe refactor rules.
*   **[Scripts Handbook](scripts/readme.md)** - canonical scripts for regression/UAT/release gates.
*   **[System Architecture (TH)](docs/architecture/01-system-architecture-th.md)** · **[EN](docs/architecture/01-system-architecture-en.md)**
*   **[Operations runbooks](docs/operations/runbooks/)** - deploy and data-repair procedures (operator-run).

---

## สถานะ / Status

ระบบสำหรับการรับรองมาตรฐาน GACP ของสมุนไพรไทย อยู่ระหว่างการพัฒนาและทดสอบ ยังไม่เปิดให้บริการจริง ข้อมูลในระบบขณะนี้ใช้เพื่อการทดสอบเท่านั้น

## ลิขสิทธิ์ / Copyright

ลิขสิทธิ์ © 2569 มหาวิทยาลัยราชภัฏสวนสุนันทา สงวนลิขสิทธิ์ ประกาศฉบับเต็มและส่วนประกอบของบุคคลที่สามอยู่ที่ [LICENSE](LICENSE)

Copyright © 2026 Suan Sunandha Rajabhat University. All rights reserved. See [LICENSE](LICENSE) for the full notice and third-party components.
