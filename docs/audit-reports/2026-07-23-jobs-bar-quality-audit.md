# 🍎 Jobs-Bar Quality Audit — GACP Certification Platform

**วันที่:** 2026-07-23 ·
**วิธีตรวจ:** multi-agent evidence audit (ตัวตรวจ 7 มิติ + adversarial verification 30 รายการ + ผู้ตัดสินสุดท้าย รวม 38 agents / 535 tool calls) **ควบคู่กับการรันแอพจริง** — Next.js dev server + Playwright ถ่ายหน้าจอ 9 เส้นทาง × 2 viewport (desktop 1440×900, iPhone 390×844) และอ่าน console จริง ·
**กฎ:** ทุกข้ออ้างมี `file:line` และผ่านการพยายามหักล้าง (refute) โดย agent อิสระก่อนบันทึก — ข้อที่หักล้างสำเร็จถูกตัดทิ้งหรือลดระดับแล้ว ·
**เกณฑ์:** 10/10 = คุณภาพที่ทีม Apple ยุค Steve Jobs ยอมปล่อยออกจากประตู

---

## สรุปผู้บริหาร

| คำถาม | คำตอบ |
|---|---|
| ไฟล์ในเครื่อง = GitHub หรือไม่ | **ตรงกัน 100%** — local HEAD = `origin/main` = `0fc3eba` ไม่มี diff, working tree สะอาด |
| เวอร์ชันของโปรเจกต์สอดคล้องกันหรือไม่ | **ไม่** — มี 4 ตัวตน: root `2.0.0`, web/backend `3.0.0`, mobile `1.0.0+1`, git tag `v3.7.6` และแท็ก v3.3.0–v3.7.6 **ไม่อยู่ในประวัติของ main เลย** (ชี้ไปไทม์ไลน์เก่าที่ถูกทิ้ง, ตรวจด้วย `git merge-base --is-ancestor`) ส่วน CHANGELOG หยุดที่ 3.2.1 (2026-05-05) — ~430 PR ไม่ถูกบันทึก รวมถึง security fixes |
| แอพรันได้จริง เห็นจริงหรือไม่ | **ได้** — ทุกหน้า public เรนเดอร์สำเร็จ (HTTP 200/404 ตามคาด) ทั้ง 2 viewport; พบ hydration-mismatch error ทุกหน้า (18/18) → แก้ใน PR นี้แล้ว พิสูจน์ซ้ำ = 0 |
| คะแนนเทียบมาตรฐาน Jobs-era Apple | **4/10** — "a competent B-grade portal, roughly half the distance to something Jobs-era Apple would let out the door" |

### Scorecard

| มิติ | คะแนน | ประเด็นหลัก |
|---|---|---|
| Visual design craft | 3.5/10 | ระบบ token ดี แต่ถูก execution ทรยศ: CSS ผิด syntax จริงบนหน้า auth, dark mode ขาวบนขาว, เขียว 5 palette |
| UX & product flow | 5.5/10 | wizard 8 ขั้นทำดีจริง แต่หน้า verify ประกาศใบรับรองแท้ว่า "ไม่ถูกต้อง" เมื่อ network ล้ม |
| Thai language & typography | 5.5/10 | สะกดสะอาด ไม่มี mojibake แต่ผสม ท่าน/คุณ, letter-space ตัวไทยฝ่ากฎตัวเอง, date helper 3 ชุด |
| Accessibility | 6/10 | ลงทุนจริงเกินมาตรฐานราชการ แต่ dialog ทำมือ 10 ตัวไม่มี focus trap |
| Frontend performance | 4.5/10 | SPA ซ่อนใน App Router: 'use client' 313 ไฟล์, ฟอนต์ TTF ดิบ ~510KB, fetch waterfall |
| Code quality & architecture | 5.5/10 | frontend strict-TS ระดับ elite + test 476 ไฟล์ แต่ backend JS 75k บรรทัดไม่มี type, error framework กลางเป็น dead code |
| Release & version hygiene | 2/10 | เวอร์ชัน 4 ค่าขัดแย้ง, แท็กคนละไทม์ไลน์, CHANGELOG ถูกทิ้ง, README quick start รันไม่ได้จริง |
| **รวม (ผู้ตัดสินสุดท้าย)** | **4/10** | ค่าเฉลี่ยมิติ = 4.6 แต่ถูกดึงลงโดยจุดทำลายความเชื่อมั่นสาธารณะ + release hygiene |

### ช่องว่างใหญ่ที่สุดเทียบ Apple ยุค Jobs

> **"ไม่มีใครเป็นเจ้าของงานเก็บจบ (No one owns the finish)"** — ทุกมิติเจอรูปแบบเดียวกัน: ทีม*เขียนกฎของตัวเอง แล้ว ship สิ่งที่ฝ่าฝืนกฎนั้นในไฟล์เดียวกัน* — คอมเมนต์ "No-Tracking-On-Thai" ตามด้วย `tracking-wide` บนตัวไทยห่างไป 40 บรรทัด; token system ที่ถูกทับด้วย `!important`; error framework กลางที่ 0/179 route ใช้; Dialog primitive (มี focus trap ครบ) ที่ถูก bypass ด้วย `aria-modal` div ทำมือ 10 ตัว; CHANGELOG ที่ถูกทิ้งมา ~430 PR ตัวอย่างเชิงสัญลักษณ์คือหน้า public verify — หน้าเดียวที่มีหน้าที่คือ "ความเชื่อมั่น" กลับขึ้น hero สีแดง "ใบรับรองไม่ถูกต้อง" ทุกครั้งที่ backend สะดุด (`catch { return null }` → heroTone='danger') ทำให้ใบรับรองแท้ของเกษตรกรถูกประกาศต่อสาธารณะว่าปลอมโดยไม่ใช่ความผิดของเขา ความเป็น Apple ไม่ใช่แค่มีรสนิยม — ทีมนี้มีอยู่แล้วอย่างพิสูจน์ได้ — แต่คือการสร้าง*กลไกบังคับ* (lint rules, CI gates, single source of truth) ให้ product ไม่สามารถ ship ในสภาพที่ขัดกับกฎของตัวเองได้ กลไกนั้นแทบไม่มีอยู่เลย

---

## แก้แล้วใน PR นี้

**fix(ui): hydration-mismatch error ทุกหน้า** — `ThemeScript` เขียน `class` + `data-color-scheme` ลง `<html>` ก่อน React hydrate ทำให้ React log error ทุก page load (พิสูจน์: 18/18 route×viewport) → เพิ่ม `suppressHydrationWarning` บน `<html>` (สัญญาเดียวกับ next-themes) — พิสูจน์ซ้ำหลังแก้: **18 → 0** (เหลือเฉพาะ 503 ของ `/api/system-config/public` เพราะ backend ไม่ได้รันใน sandbox ซึ่งเป็นไปตามคาด) · typecheck ผ่าน · CI เขียวครบ 4 workflow

---

## Top-10 สิ่งที่ต้องแก้ (เรียงตามความสำคัญต่อเกษตรกร)

| # | Effort | รายการ | ไฟล์ |
|---|---|---|---|
| 1 | S | หยุดประกาศใบรับรองแท้ว่า "Invalid" เมื่อ fetch ล้ม — ใช้ discriminated result + สถานะกลาง "ไม่สามารถตรวจสอบได้ในขณะนี้" พร้อมปุ่ม retry | `apps/web-app/src/app/(public)/verify/[cert-number]/page.tsx:36-44` |
| 2 | S | ครอบ `hsl()` ให้ตัวแปร HSL-triple เปล่า ~20 จุดในสไตล์ชีต auth — ตอนนี้ปุ่ม outline/ภาษาบน register + forgot-password **ไร้เส้นขอบและโปร่งใสจริง** เพราะ `border: 1px solid 150 12% 85%` เป็น CSS ที่ invalid | `apps/web-app/src/styles/globals-components-auth.css` |
| 3 | S | แยก dictionary key ให้ 4 พื้นผิวบนแดชบอร์ดเกษตรกรที่ตอนนี้ใช้ "สถานะดำเนินการ" ร่วมกันหมด (รวมถึงการ์ด to-do ที่บอกว่าเกษตรกรต้องทำอะไรต่อ) | `apps/web-app/src/app/health/dashboard/client-view.tsx:167,209,288,306` |
| 4 | M | แก้ dark mode: แทน `bg-white` ที่ไม่มี `dark:` (~191 จุด รวม Button variants) ด้วย token `bg-card` — ตอนนี้ toggle ใน settings ทำหน้า landing/pricing อ่านไม่ออก | `apps/web-app/src/app/(marketing)/page.tsx:337` + `button.tsx:17-25` |
| 5 | S | แก้ contrast ต่ำกว่า AA: `text-white/40` ที่ 10px bold (~2.4:1) และ text ≤10px 211 จุด — ผู้ใช้จำนวนมากเป็นเกษตรกรสูงวัยอ่านตัวไทยบนมือถือกลางแดด | `apps/web-app/src/app/(auth)/forgot-password/page.tsx:152` |
| 6 | S | ลบ `tracking-wide`/`font-black` ออกจากข้อความไทยทุกจุด (18+ component) + เพิ่ม eslint rule กันถาวร | `apps/web-app/src/components/marketing/marketing-section.tsx:80`, `Footer.tsx:93` |
| 7 | M | สร้าง modal ทำมือ 10 ตัวใหม่บน Dialog primitive ที่มีอยู่แล้ว (ได้ focus trap, Escape, focus restore ฟรี) | `apps/web-app/src/components/admin/ForceStatusModal.tsx:181` |
| 8 | M | Subset ฟอนต์ Sukhumvit Set เป็น woff2 (~510KB → ~100KB), preload weight 400, ลบ @fontsource weight ที่ไม่ใช้ 10 ชุด | `apps/web-app/src/styles/globals.css:13` |
| 9 | L | ฆ่า client-side fetch waterfall: แดชบอร์ดยิง `/me` ซ้ำ 2 ครั้งแล้วลอง endpoint ต่อคิวสูงสุด 3 ตัว — resolve role ครั้งเดียวใน AuthProvider | `apps/web-app/src/app/provider/dashboard/page.tsx:119` |
| 10 | M | กู้ระเบียบ release: ประกาศเวอร์ชัน canonical เดียว (เช่น 3.8.0), sync manifest ทั้ง 4, ตัด tag บน HEAD จริง, backfill CHANGELOG, ใช้ changesets/release-please เป็น merge gate | `package.json:3`, `CHANGELOG.md` |

**หมายเหตุ:** metadata อ้าง `og-image.png` + `apple-touch-icon.png` ที่ไม่มีไฟล์จริง (ยืนยันแล้ว: `public/images/` มีแค่โลโก้) — แชร์ลิงก์ผ่าน LINE/Facebook จะไม่มีภาพพรีวิว และเพิ่มลงหน้าจอ iOS ไม่มีไอคอน ควรใช้ file convention ของ App Router (`src/app/opengraph-image.png`, `src/app/apple-icon.png`) เพื่อให้ build ตรวจเองได้ (`apps/web-app/src/app/layout.tsx:53`)

---

## รายละเอียดรายมิติ (เฉพาะข้อที่ผ่านการยืนยันแล้ว)

### 1. Visual design craft — 3.5/10

- **[major]** Dark mode: การ์ด landing ขาวบนขาว — heading ใช้ `text-foreground` ซึ่งใน `.dark` เป็นขาว 95% บนการ์ด `bg-white` ที่ไม่ flip (`(marketing)/page.tsx:337,259`); Button variants `default/secondary/outline/white` มีปัญหาเดียวกัน; FAQ ถูก patch แล้วครึ่งเดียว → ดูเหมือนถูกทิ้ง
- **[major]** สไตล์ชีต auth ใช้ token แบบ HSL triple โดยไม่ครอบ `hsl()` ~20 จุด → เส้นขอบ/พื้นหลังหายจริงบน register:489, forgot-password:220 (ทุกชีตอื่นครอบถูก เช่น `globals-premium.css:44`)
- **[major]** เขียว 5 palette / เทา 3 ตระกูล: `emerald-*` 450 ครั้งใน 121 ไฟล์ ทั้งที่มี token `primary`/`leaf`/`brand-*`; CTA "เริ่มสมัคร" ตัวเดียวกันบน viewport เดียว เป็น `rounded-md bg-emerald-600` (header) กับ pill `leaf` (hero)
- **[major]** กฎ typography ไทยถูกเขียนแล้วฝ่าฝืนในไฟล์เดียวกัน: `tracking-wide` บนตัวไทย 40 บรรทัดใต้คอมเมนต์ที่ห้าม; `font-weight:900` ใต้คอมเมนต์ที่อธิบายว่าทำไมต้องเลิกใช้
- **[major]** Radius token ถูกทับด้วย `!important` (`globals.css:228`) ดัน primitive ไปค่า arbitrary
- **[minor]** Button primitive มี 13 variants — 5 คู่เหมือนกันหรือต่างแค่เงา 1 เส้น

### 2. UX & product flow — 5.5/10

- **[major]** หน้า public verify แสดง "ใบรับรองไม่ถูกต้อง" (hero แดง) กับ**ความล้มเหลวของ network** ไม่ใช่แค่ใบรับรองปลอม — `fetchCertificate` คืน `null` ทั้งกรณี 404 และ network error
- **[major]** wizard ซ้อน progress indicator 4 ชั้น และเลข step ใน URL ขัดกับเลขที่แสดง (`application-step-page.tsx:265-303`)
- **[major]** เครื่องมือหลังได้ใบรับรอง (ที่กฎหมายกำหนด) อยู่ใน hub "เพิ่มเติม" ที่เข้าถึงได้จากปุ่ม Profile ปุ่มเดียว
- **[minor]** `/verify` ระดับบนเปิด portal ระดับ developer (sha256, payload hash, signature hex) ให้ประชาชนเห็น — ควรเป็นฟอร์มกรอกเลขใบรับรองอย่างเดียว แล้วย้ายเครื่องมือไป `/verify/tools`
- **[minor]** Help center เป็นทางตันของ navigation เมื่อเข้าจากใน portal
- จุดแข็งที่ยืนยันแล้ว: journey สมัครหลัก (wizard 8 ขั้น + draft resume ฝั่ง server + auto-save + scroll-to-error + skeletons) ทำดีจริง

### 3. Thai language & typography — 5.5/10

- **[major]** "สถานะดำเนินการ" ป้ายเดียวใช้กับ 4 สิ่งที่ต่างกันบนหน้าที่เกษตรกรเห็นบ่อยที่สุด
- **[major]** 18+ component ใส่ letter-spacing ให้ตัวไทย (ฝ่าฝืนกฎที่โปรเจกต์เขียนเอง)
- **[major]** ตัวช่วยวันที่ไทย 3 ชุดแข่งกัน; หน้า trace รั่ววันที่ Gregorian ตาม locale เครื่อง (`trace/[qr-code]/client-view.tsx:458`)
- **[minor]** ผสมระดับภาษา ท่าน/คุณ + "ลุยเลย!" บนหน้าเดียวกัน; `ของGACP Thaiฯ` ติดกันไม่มีวรรค; ๆ ใช้ 2 convention
- **[minor]** ไม่มี line-height สำหรับตัวไทย (สระบน-ล่าง + วรรณยุกต์ต้องการ leading มากกว่า Latin)

### 4. Accessibility — 6/10

- **[major]** dialog `aria-modal` ทำมือ 10 ตัวไม่มี focus trap/initial focus; modal ฝั่ง admin ไม่มีแม้แต่ Escape — ทั้งที่ `DialogPrimitive` ที่ทำครบมีอยู่แล้วใน `components/ui/primitives/dialog.tsx`
- **[major]** skip link เป็น anchor ตายบนทุก route `/admin` (ไม่มี `id="main-content"`)
- **[major]** contrast ต่ำกว่า AA: ขาว 40–60% ที่ 10px bold บน gradient
- **[minor]** aria-label ภาษาอังกฤษ 32 จุดในแอพ `lang="th"`; framer-motion ไม่เคารพ `prefers-reduced-motion` (แก้ได้ 1 บรรทัดด้วย `<MotionConfig reducedMotion="user">`)
- จุดแข็ง: Radix primitives, skip link ภาษาไทย, aria-label ไทย 112 จุด, aria-live, a11y test เฉพาะทาง — เกินมาตรฐาน portal ราชการมาก

### 5. Frontend performance — 4.5/10

- **[major]** ดึงข้อมูลฝั่ง client ทั้งหมด ('use client' 313 ไฟล์): แดชบอร์ด = JS parse → `/me` ×2 → endpoint เรียงคิวสูงสุด 3 — หลายวินาทีของ skeleton บน 3G/4G ชนบท
- **[major]** ฟอนต์แบรนด์ TTF ดิบ ~510KB ไม่ subset ไม่ preload + @fontsource weight ที่ไม่ใช้ 10 ชุด
- **[major]** `og-image`/`apple-touch-icon` ใน metadata ไม่มีไฟล์จริง
- **[major]** recharts ถูก bundle แบบ static เพื่อ bar chart 1 ตัว
- **[minor]** axios อยู่ใน root client bundle เพื่อ GET 1 ครั้ง; `force-dynamic` ถูกก๊อป 39 จุดรวมถึงหน้า legal ที่ควร static

### 6. Code quality & architecture — 5.5/10

- **[major]** error framework กลาง (`shared/errors.js`) เป็น dead code — 0/179 route ใช้ `asyncHandler`; envelope 2 แบบแข่งกัน; มี branch จัดการ Mongo error ทั้งที่ระบบใช้ Prisma/Postgres
- **[major]** `requireAdmin` ถูกเขียนซ้ำใน 6+ route file และ drift จาก middleware กลาง
- **[major]** 61/179 route import Prisma ตรง ข้าม service layer
- **[major]** backend JS ~75k บรรทัดไม่มี type ข้าง frontend strict-TS; god service (`entity-service.js` 1,707 บรรทัด)
- **[minor]** โครง scaffolding ว่างถูก commit; ชื่อไฟล์ปน kebab/Pascal (89:31); suppress hook-deps 28 จุด
- จุดแข็ง: frontend `strict` + `noUncheckedIndexedAccess`, `as any` ~3 จุด / 858 ไฟล์; test backend 476 ไฟล์ ต่อ source 593 ไฟล์

### 7. Release & version hygiene — 2/10

- **[major]** เวอร์ชัน 4 ค่าขัดแย้ง + แท็ก v3.3.0–v3.7.6 อยู่คนละไทม์ไลน์กับ main (ยืนยันด้วย git) — ตอบคำถาม "production รันเวอร์ชันอะไร" ไม่ได้ ซึ่งเป็นประเด็น compliance สำหรับระบบราชการที่ถือ PII ประชาชน
- **[major]** CHANGELOG ถูกทิ้ง ~430 PR (รวม #682 2FA-bypass, #685 PII-wipe)
- **[major]** README quick start รันไม่ได้ตามที่เขียน (สั่ง npm ในโปรเจกต์ pnpm, ข้ามขั้น env); ลิงก์เอกสาร 2/4 ตาย
- **[major]** ไฟล์ fuzzing/debug (`cases_22.tsv`, `results_22.*`, `test-reports/`) ถูก track ที่ root
- **[major]** รายงาน audit เก่าที่ root ยืนยัน finding ที่โค้ดปัจจุบันแก้ไปแล้ว — คนอ่านแยกไม่ออกว่าอะไรยังจริง

---

## สิ่งที่ทำได้มาตรฐานสูงจริง (ยืนยันแล้ว)

1. **วินัย type + test ฝั่ง frontend ระดับ elite** — strict + noUncheckedIndexedAccess, `as any` ~3 จุดใน 858 ไฟล์; backend test 476 ไฟล์ รวม test เฉพาะทางอย่าง a11y (aria-sort, label association) และ no-fabricated-fees
2. **การลงทุน accessibility เกินมาตรฐานราชการมาก** — Radix primitives, skip link ไทย, lang updater ตอนสลับ TH/EN, aria-live
3. **Journey สมัครหลักทำด้วยความประณีตจริง** — wizard 8 ขั้น + server-side draft resume + auto-save + scroll-to-error + telemetry ที่เคารพ PDPA (Sentry replay off, trace 0.1)

## คำตัดสิน

ถ้า Steve Jobs เห็นแอพนี้วันนี้ เขาจะเห็น*รสนิยม*ที่มีอยู่จริง (token system, กฎ typography ไทยที่เขียนไว้อย่างเข้าใจ, wizard ที่ใส่ใจ) — แล้วเขาจะถามคำถามเดียว: *"ถ้าคุณรู้ว่าอะไรถูก ทำไมคุณ ship สิ่งที่ผิด?"* ระยะทางจาก 4/10 ไป 8+/10 ไม่ใช่การมีไอเดียดีขึ้น แต่คือการทำ 10 ข้อข้างบนให้จบ และสร้างกลไก (lint/CI gate) ที่ทำให้การถอยหลังเป็นไปไม่ได้ — งานส่วนใหญ่เป็น S/M effort และ #1–#3 ทำจบได้ในวันเดียว
