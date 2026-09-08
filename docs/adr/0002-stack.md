# ADR 0002: Stack และเวอร์ชันที่พิน

สถานะ: ยอมรับ · วันที่: 2026-09-08 (ตรวจเวอร์ชันจาก npm registry วันนี้)

## บริบท

เครื่องพัฒนาคือ Windows 10 มี Node 24.19, corepack 0.35, git ไม่มี Docker ไม่มี PostgreSQL ทีมเล็ก (operator + Claude) ต้องการเครื่องมือมาตรฐานน้อยชิ้น TypeScript ปลายทางถึงปลายทาง และโดเมนที่ทดสอบได้โดยไม่มี framework

## การตัดสินใจ

| ชั้น | เลือก | เวอร์ชัน (latest วันนี้) | หมายเหตุ |
|---|---|---|---|
| Runtime | Node.js 24 LTS · pnpm ผ่าน corepack | pnpm 12.3.4 | ไม่ติดตั้ง pnpm global ใช้ `corepack pnpm` ตาม `packageManager` |
| ภาษา | TypeScript | ล่าสุด 7.0.2 · **พิน `^5.9`** | TS 7 (คอมไพเลอร์ native) เพิ่งออก ยังไม่ยืนยันความเข้ากันได้กับ Next/Prisma/Biome จะย้ายเมื่อทั้งสามประกาศรองรับ · เปิด `erasableSyntaxOnly` แล้ว จึงไม่มี `enum` ให้ต้องแก้ |
| Web + BFF | Next.js App Router + React | next 16.3.4 · react 19.2.8 | แอปเดียว `apps/web` ไม่มี backend แยก |
| งานอัตโนมัติ | pg-boss บน Postgres | 12.30.0 | `apps/automation` ไม่มี Redis |
| DB | PostgreSQL บน Supabase (demo, staging) | Postgres 17 | Prisma ต่อ pooler (6543) + direct (5432) · ไม่ใช้ Supabase JS/publishable key |
| ORM | Prisma | client 7.10.0 · **พิน 7.10.0** ทั้ง CLI และ client | CLI `latest` บน registry คือ 8.0.0-rc ไม่ใช้ rc · Prisma 7 ต้องใช้ driver adapter (`@prisma/adapter-pg` 7.10.0 + `pg`) |
| Contract | Zod | 4.5.4 | `packages/contracts` เป็นแหล่งเดียวของชื่อ field และ env |
| UI | Tailwind CSS + shadcn/ui primitives + Sarabun (self-host) | tailwindcss 4.3.3 · react-hook-form 7.87.0 · @hookform/resolvers 5.9.1 | |
| Auth | openid-client + jose (OIDC code flow + PKCE + nonce + ตรวจ id_token) | 6.8.8 · 6.2.12 | providers: ThaID, MorPhrom (โครง), DevLocal |
| ไฟล์ | Supabase Storage ผ่าน S3-compatible adapter · file-type ตรวจ magic bytes | file-type 22.0.2 | |
| PDF | Playwright/Chromium ใน `apps/automation` | playwright 1.63.0 | ปัด pdfkit (Thai shaping) |
| เงิน | Stripe หลัง `PaymentGateway` interface | stripe 22.6.1 | test mode จนกว่า operator สั่ง live |
| Observability | pino · OpenTelemetry | pino 10.3.1 · @opentelemetry/api 1.9.1 | |
| Test | Vitest (unit, integration กับ Postgres จริง) · Playwright (walks) | vitest 5.0.0 · @playwright/test 1.63.0 | |
| Lint/format | Biome · `scripts/check-glossary.ts` | @biomejs/biome 2.5.12 | แทน ESLint + Prettier |
| Monorepo | pnpm workspaces + Turborepo | turbo 2.10.12 | |
| Deploy | Docker (web, automation) + docker-compose บน box 43.134.175.51 | | dev.demo.gacpth.com · dev.staging.gacpth.com |

## ทางเลือกที่ปัด

- Express/Fastify/NestJS แยก backend: การแยก FE/BE คือต้นเหตุ "required มี 3 เจ้าของ" ใน v1
- Drizzle: เทียบเท่า Prisma สำหรับงานนี้ ทีมคุ้น Prisma มากกว่า; ทบทวนได้ถ้าต้อง SQL-first หนัก
- Redis/bull: pg-boss ทำงานเดียวกันบน Postgres ที่มีอยู่แล้ว
- Google Fonts runtime, CDN ต่างประเทศ: self-host ทั้งหมดเพื่อไม่มี runtime call นอกระบบที่ไม่จำเป็น

## ค้างตัดสิน

- ฐานข้อมูล dev/test บนเครื่อง Windows ที่ไม่มี Docker: `embedded-postgres` (ไบนารีใน node_modules) หรือติดตั้ง PostgreSQL 17 ผ่าน winget (operator ตัดสิน)
- อัปเกรด TypeScript 7 เมื่อ Next.js, Prisma และ Biome ประกาศรองรับ
