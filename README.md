# GACP

ระบบรับรองมาตรฐานแหล่งผลิต (ปลูก) เก็บเกี่ยวที่ดี และแปรรูปพืชกัญชา ตามแบบ กทล.1 ของกรมการแพทย์แผนไทยและการแพทย์ทางเลือก (DTAM) รุ่นที่ 2 เขียนใหม่ทั้งหมด

## หลักที่ยึด

- ยื่นตามกรมเป๊ะ: ชุดเอกสารบังคับคือ กทล.1 ส่วนที่ ๓ และกฎทุกข้อเป็นข้อมูลที่มีวันมีผล ไม่ใช่ค่าคงที่ในโค้ด
- เส้นงานเส้นตรง: สถานะคำขอชุดเดียว เปลี่ยนผ่าน service เดียว เงินแตะเส้นงานแค่สองจุด (งวดที่ 1 และงวดที่ 2)
- หนึ่งแนวคิดหนึ่งชื่อ: ทุกชื่ออยู่ใน [docs/glossary.md](docs/glossary.md) และถูกบังคับด้วย lint
- PDPA เข้ม: ไฟล์ private ทั้งหมด บันทึกทุกการเปิดดูของเจ้าหน้าที่ ไม่เก็บเลขบัตรประชาชนแบบอ่านได้

## โครง

```
apps/web/            Next.js: หน้าจอทุกบทบาท + Server Actions + Route Handlers
apps/automation/     งานอัตโนมัติ (pg-boss): หมดอายุใบเสนอราคา, กระทบยอด Stripe, render PDF
packages/domain/     state machine, requirement lens, quotation calculator (TypeScript บริสุทธิ์)
packages/contracts/  zod schemas = แหล่งเดียวของชื่อ field
packages/db/         Prisma schema, migrations, seeds (กฎเป็นข้อมูล)
packages/ui/         design tokens, primitives, Thai formatters
docs/                glossary, ADR, PDPA retention, บทเรียนจาก v1
scripts/             check-glossary.ts
```

## คำสั่ง

```bash
corepack pnpm install
corepack pnpm check            # typecheck + biome + glossary
corepack pnpm test             # unit (Vitest)
corepack pnpm test:integration # ต่อ Postgres จริง
corepack pnpm dev
```

ตัวแปรสภาพแวดล้อมทั้งหมดขึ้นต้นด้วย `GACP_` และประกาศไว้ใน `packages/contracts/src/env.ts` เท่านั้น ค่าจริงอยู่ใน `.env.local` (ไม่เข้า git)

## เอกสาร

- [Glossary และ naming policy](docs/glossary.md)
- [ADR 0001 หลักการ](docs/adr/0001-principles.md)
- [ADR 0002 stack](docs/adr/0002-stack.md)
- [ADR 0003 การยกเว้นกฎถิ่นที่อยู่ของข้อมูลชั่วคราว](docs/adr/0003-residency-waiver.md)
- [PDPA retention](docs/pdpa-retention.md)
- [บทเรียนจาก v1](docs/lessons-from-v1.md)
