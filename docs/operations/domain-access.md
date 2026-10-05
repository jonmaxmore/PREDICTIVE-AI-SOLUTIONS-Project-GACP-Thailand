# ขอบเขตการเข้าถึงโดเมน (domain access)

ปรับปรุง 2026-08-05

## staging.gacpth.com — redirect หน้าเปล่า → หน้า login (ติดตั้งด้วยมือ 2026-08-05, **อยู่นอก git**)

`staging.gacpth.com/` (URL เปล่า) ถูกตั้งให้ **302 → `/auth/health/login`**

- **ที่ตั้ง**: `/etc/nginx/sites-available/staging.gacpth.com.conf` (block `listen 443`) — **host nginx นอก docker** จึง **ไม่ผิด freeze** (freeze ครอบเฉพาะ `docker compose up`)
- **สถานะใน git**: **ไม่มี** — เป็น server block ที่ operator แก้ด้วยมือบนเครื่อง (มี comment กำกับวันที่+เหตุผลในไฟล์แล้ว) · แบบเดียวกับ Cloudflare rule ด้านล่าง: อ่านโค้ดในรีโปอย่างเดียวจะไม่เห็น
- **เหตุผลชั่วคราว**: หน้า `/` ของ staging ยังไม่มี landing จริง — redirect ให้เข้า login ทันทีระหว่างสาธิต/ทดสอบ
- **วิธีถอน**: ลบ block redirect ออกจาก `staging.gacpth.com.conf` แล้ว `sudo nginx -t && sudo systemctl reload nginx` (host nginx — ไม่ต้อง deploy ไม่แตะ docker)
- **แผนถอนถาวร** (A-lane หลัง freeze ปลด): ตัดสินหน้า `/` ของ staging ให้เป็น redirect ในโค้ด (Next.js) หรือ landing จริง แล้ว **ถอน nginx patch นี้** เพื่อให้พฤติกรรมกลับมาอยู่ใน git ทั้งหมด

> ⚠️ ตระกูลเดียวกับ Cloudflare rule: **การตั้งค่าที่อยู่นอก git หายเงียบได้และไม่มี CI จับ** — ถ้ามีคนแก้/ลบ `staging.gacpth.com.conf` โดยไม่รู้ที่มา redirect จะหายโดยไม่มีอะไรเตือน · จึงบันทึกไว้ที่นี่

---

เอกสารนี้บันทึกว่า **ตอนนี้ใครเข้าถึงโดเมนไหนได้บ้าง และการบล็อกถูกบังคับที่ชั้นไหน**
เขียนขึ้นเพราะการบล็อก production ปัจจุบัน **ไม่ได้อยู่ใน git** จึงไม่มีทางรู้จากการอ่านโค้ดอย่างเดียว

## สรุปสถานะปัจจุบัน

| โดเมน | เข้าถึงได้ไหม | บล็อกที่ชั้นไหน |
|---|---|---|
| `gacpth.com` | **เข้าไม่ได้โดยตั้งใจ** | Cloudflare Security rules |
| `www.gacpth.com` | **เข้าไม่ได้โดยตั้งใจ** | Cloudflare Security rules |
| `staging.gacpth.com` | เข้าได้จาก IP ใน allowlist **หรือ อุปกรณ์ที่ถือ gate cookie** (ดูหัวข้อ cookie door) | nginx geo gate + cookie exempt |

## Cookie door ของ staging gate (เพิ่ม 2026-08-20 — lockout ครั้งที่ 4)

ประวัติ gate ล็อก operator เอง 4 ครั้ง: /32 pin → /128 pin → /64 prefix rotate → และสุดท้าย
**มือถือบนเครือข่าย AIS (`2001:44c8::/32`)** ซึ่งการไล่เติม prefix ไม่มีวันครอบได้ จึงเพิ่มช่องทางที่
ตามอุปกรณ์แทนตาม IP:

- เปิด `https://staging.gacpth.com/__gate?t=<token>` **ครั้งเดียว** บนอุปกรณ์ → ได้ cookie
  (`Secure; HttpOnly; SameSite=Lax`, อายุ 1 ปี) → เข้าได้จากทุกเครือข่ายตลอดอายุ cookie
- URL `/__gate` อยู่ใน exempt map จึงเปิดได้แม้กำลังโดนบล็อก — แต่มันแค่ **ตั้ง** cookie:
  token ผิด = cookie ไร้ค่า ยังโดน 403 เหมือนเดิม (ตัวตัดสินคือ map `$gacp_gate_cookie_ok`)
- **token อยู่นอก git**: `/etc/nginx/gacp-gate-token.conf` (root 600, บรรทัดเดียว: `"<hex>" 1;`)
  — include แบบ mask ใน `deploy/nginx/gacp-platform.conf` จึง fail-soft: ไฟล์หาย = ไม่มี cookie
  ใดผ่าน = gate ทำงานแบบเดิมเป๊ะ · rotate token = เขียนไฟล์ใหม่ + `nginx -s reload`
- โครงสร้าง config อยู่ใน git ทั้งหมด: `deploy/nginx/gacp-platform.conf` (maps) +
  `deploy/nginx/staging.gacpth.com.conf` (`location = /__gate`)

### เหตุการณ์ 2026-08-18 ที่พบระหว่างสอบสวน (บันทึกไว้กันงง)

พบไฟล์ `/etc/nginx/conf.d/00-gacp-prelaunch-gate.conf` หัวเขียนว่า "PUBLIC GO-LIVE
CONFIGURATION" ตั้ง `default 0` (เปิดทั้งโลก) mtime 2026-08-18 21:54 พร้อม reload —
**แต่ไม่เคยมีผลจริง** เพราะ geo ตัวเดียวกันถูกนิยามซ้ำใน `sites-enabled/gacp-platform.conf`
(`default 1`) และตัวหลังชนะ ⇒ ใครกดเปิด gate วันนั้นคิดว่าเปิดแล้วแต่จริงๆ ยังปิดอยู่ ·
geo ซ้ำสองที่แบบนี้อันตราย (ลำดับ include เปลี่ยน = ม่านพลิกเงียบๆ) จึงย้ายไฟล์ conf.d
คู่นั้นไปเก็บที่ `/etc/nginx/retired-2026-08-20/` เมื่อติดตั้ง cookie door — เหลือ gate
นิยามเดียวใน sites-enabled · ถ้าต้องการเปิดแพลตฟอร์มจริง แก้ `default 1` → `default 0`
ที่ `deploy/nginx/gacp-platform.conf` ที่เดียว (อ่าน runbook restrict-site-to-one-ip ก่อน)
| `dev.gacpth.com` | ยังไม่มี vhost ของตัวเอง | ดูหัวข้อ "ข้อควรระวัง" |
| `api.gacpth.com` | ยังไม่มี vhost ของตัวเอง | ดูหัวข้อ "ข้อควรระวัง" |

## production บล็อกที่ Cloudflare ไม่ใช่ nginx

การบล็อก `gacpth.com` และ `www.gacpth.com` เป็น **custom rule แบบ block ใน Cloudflare Security rules**
ผูกกับ hostname ทั้งสอง และ **บล็อกทุก IP ไม่มีข้อยกเว้น**

**ไม่ได้ใช้ nginx allowlist** สำหรับสองโดเมนนี้ เคยมีแผนจะทำแต่ยกเลิกเมื่อ 2026-08-04
เพราะการบล็อกที่ Cloudflare ทำได้แล้วและไม่ต้องแตะ server block

⚠️ **อย่าไปตามหาการบล็อกนี้ใน `deploy/nginx/`** — ไม่มี และจะไม่มี
สิ่งที่อยู่ใน `deploy/nginx/gacp-platform.conf` คือ geo gate ซึ่งเป็นคนละชั้นและยังทำงานอยู่ตามเดิม

## ความเสี่ยงที่ต้องรู้: การบล็อกนี้ไม่อยู่ใน git

Cloudflare rule เป็นค่าใน dashboard ไม่ใช่ไฟล์ในรีโป ผลที่ตามมา

- **ไม่มี code review** ใครที่มีสิทธิ์ใน dashboard แก้ได้ทันทีโดยไม่มีร่องรอยในรีโป
- **ไม่มี CI ตรวจ** ไม่มี test ตัวไหนจับได้ว่ากฎหายไป
- **หายเงียบได้จากการกระทำที่ดูไม่เกี่ยวกัน**
  - ถ้า **ย้าย DNS provider** ออกจาก Cloudflare กฎจะไม่ตามไปด้วย โดเมนจะเปิดทันที
  - ถ้า **ปิด proxy** (เปลี่ยน record จาก Proxied เป็น DNS only) ทราฟฟิกจะไม่ผ่าน Cloudflare อีก กฎจึงไม่ถูกบังคับ และ request จะวิ่งตรงเข้า origin
  - ทั้งสองกรณี **ไม่มีอะไรเตือน** และหน้าเว็บจะกลับมาเปิดสาธารณะโดยไม่มีใครรู้

ชั้นที่ยังเหลืออยู่ถ้ากฎ Cloudflare หายไปคือ nginx geo gate ซึ่ง **ยังบล็อกคนนอก allowlist อยู่**
แต่ต้องไม่พึ่งข้อนี้เป็นแผนหลัก เพราะ geo gate ถูกออกแบบมาคุมช่วงก่อนเปิดตัว ไม่ใช่มาตรการถาวร

## วิธีเปิดชั่วคราว

ตั้ง rule เป็น **Disabled** ที่ Cloudflare dashboard (Security rules) — มีผลทันที ไม่ต้อง deploy ไม่ต้องแตะเครื่อง
เปิดเสร็จแล้ว **ตั้งกลับเป็น Enabled ทันที** อย่าปล่อยค้าง

## ตอนเปิดใช้จริง (go-live) ต้องถอด rule นี้ออก

**ถอด ไม่ใช่แค่ Disabled** — rule ที่ปิดไว้เฉย ๆ จะกลายเป็นกับดักสำหรับคนที่มาดูทีหลัง
และต้องทบทวน geo gate ใน `deploy/nginx/gacp-platform.conf` ควบคู่กันด้วย เพราะถ้าถอดกฎ Cloudflare
อย่างเดียวแล้ว geo gate ยังตั้ง `default 1;` อยู่ ผู้ใช้ทั่วไปก็ยังเข้าไม่ได้ และอาการจะดูเหมือน go-live ล้มเหลว

## การสาธิต (demo)

**ใช้ `staging.gacpth.com` เท่านั้น** — `gacpth.com` เข้าไม่ได้โดยตั้งใจ ไม่ใช่ความผิดพลาด
ถ้าระหว่างสาธิตมีใครเปิด `gacpth.com` แล้วไม่ขึ้น นั่นคือพฤติกรรมที่ถูกต้อง

**การสาธิต QR ของใบรับรอง** ให้ **เปิดหน้าตรวจสอบบนเครื่องที่เชื่อมต่อได้แล้วฉายให้ดู**
ห้ามให้ผู้ชมสแกน QR ด้วยมือถือตัวเอง เพราะเส้นทางตรวจสอบสาธารณะ (`/verify/`) ยังไม่เปิด
และมีเงื่อนไขสามข้อที่ต้องแก้ก่อนจะเปิดได้ (บันทึกไว้ใน the backlog)
มือถือของผู้ชมอยู่นอก allowlist จึงจะได้หน้า block ไม่ใช่หน้าใบรับรอง

## ข้อควรระวัง: `dev.gacpth.com` และ `api.gacpth.com` ยังไม่มี vhost ของตัวเอง

DNS ของทั้งสองชี้มาที่เครื่องเดียวกันแล้ว แต่ในรีโปมี server block แค่สองชุด
คือ `gacpth.com localhost _` (`deploy/nginx/gacp-platform.conf`) และ `staging.gacpth.com`
(`deploy/nginx/staging.gacpth.com.conf`) และ **ไม่มี `default_server` ที่ไหนเลย**

เครื่องหมาย `_` ไม่ใช่ wildcard เป็นเพียงชื่อที่ไม่มีวันตรงกับ Host จริง เมื่อไม่มี server block ใดตรงกับ
`dev.gacpth.com` nginx จะใช้ server block แรกของ listen address นั้น ซึ่งเรียงตามชื่อไฟล์ใน
`sites-enabled/` แล้วได้ vhost ของ production **ทั้งสองชื่อจึงตกไปที่ stack production**

ผลคือคนที่อยู่ใน allowlist และคิดว่ากำลังทดลองบน dev จะกำลังทำงานกับข้อมูลจริง
รายละเอียดและหลักฐานอยู่ใน the backlog รายการวันที่ 2026-08-04

**ยังไม่ต้องแก้ตอนนี้** operator ตัดสินแล้วว่าไม่แยก vhost ในรอบนี้ เพราะไม่มีการแก้ server block แล้ว
แต่ต้องจัดการก่อนจะเปิดสิทธิ์ให้คนเพิ่มเข้ามาใช้ dev
