# แผนผังเครื่อง VM-0-3-ubuntu — request เดินผ่านอะไรบ้าง

**เพราะอะไรถึงต้องมีเอกสารนี้:** วันที่ 2026-08-08 เราตอบคำถาม *"เว็บวิ่งผ่านคอนเทนเนอร์ไหน"*
ผิดสามครั้งติดกัน ทั้งที่อ่านจากคอนฟิกจริงบนเครื่องทุกครั้ง — เพราะไม่มีคอนฟิกไฟล์ใดไฟล์เดียว
ที่บอกเส้นทางทั้งเส้น และ **ชื่อคอนเทนเนอร์ไม่ตรงกับหน้าที่จริง** (`gacp-backend` ที่ไม่มีคำว่า
staging คือฝั่ง `gacpth.com` ส่วนเว็บที่เราใช้งานกันทุกวันคือ `gacp-backend-staging`)

ความรู้แบบนี้ต้องถูกเขียนไว้ ไม่ใช่ค้นใหม่ทุกครั้ง — และมันคือของที่ต้องใช้ตอนตั้งเครื่อง
production ใหม่ ถ้าลอกของเดิมมาโดยไม่รู้เส้นทางจริง จะได้ระบบที่ไม่เหมือนที่ทดสอบไว้

**สถานะระบบ ณ วันที่เขียน:** beta ทดสอบเสมือนจริง ยังไม่มีผู้ใช้จริง เครื่อง production ยังไม่ส่งมอบ
URL ที่ใช้อ้างอิงได้คือ `staging.gacpth.com` เท่านั้น

---

## เส้นทาง request (ยืนยันจากเครื่องจริง 2026-08-08)

```
                         ┌─ gacpth.com ─────────────────────────────────────────────┐
                         │                                                          │
ผู้ใช้ → Cloudflare (TLS) → host nginx :443 ─→ 127.0.0.1:8080                        │
                         │        │           = Docker `gacp-nginx` :80             │
                         │        │              ├─ /api/session/ → frontend:3000    │
                         │        │              ├─ /api/*        → backend:8000     │
                         │        │              ├─ /uploads/     → backend:8000     │
                         │        │              └─ /            → frontend:3000     │
                         │        │                    ↓                             │
                         │        │            gacp-backend / gacp-frontend          │
                         │        │                    ↓                             │
                         │        │                 gacp_db (21 MB)                  │
                         │                                                          │
                         └─ staging.gacpth.com ─────────────────────────────────────┘
                                  │
                                  ├─→ 127.0.0.1:8001 = gacp-backend-staging   (/api/, /uploads/)
                                  └─→ 127.0.0.1:3001 = gacp-frontend-staging  (/)
                                             ↓
                                       gacp_staging (28 MB)
```

**จุดที่สำคัญที่สุดในภาพนี้:** `staging.gacpth.com` **ข้าม Docker nginx ทั้งชั้น**
⇒ ทุกอย่างที่ตั้งไว้ใน `nginx/gacp.production.conf` ไม่เคยถูกทดสอบบน staging เลย
(รายละเอียดใน §"staging ไม่เหมือน production ตรงไหน")

## ไฟล์คอนฟิกอยู่ที่ไหน

| ชั้น | ไฟล์ในรีโป | ตำแหน่งบนเครื่อง |
|---|---|---|
| host nginx — vhost `gacpth.com` + ตัวแปร http scope | `deploy/nginx/gacp-platform.conf` | ติดตั้งใน `/etc/nginx/` |
| host nginx — vhost `staging.gacpth.com` | `deploy/nginx/staging.gacpth.com.conf` | ติดตั้งใน `/etc/nginx/` |
| Docker nginx (router ภายใน) | `nginx/gacp.production.conf` | bind-mount **read-only** → `/etc/nginx/conf.d/default.conf` |

Docker nginx **ไม่ทำ TLS และไม่ redirect** — มันฟัง :80 อย่างเดียว TLS จบที่ Cloudflare
แล้ว host nginx เป็นตัวรับต่อ (คอมเมนต์อธิบายไว้หัวไฟล์ `nginx/gacp.production.conf`)

แก้คอนฟิกทั้งสามผ่าน PR ได้ เพราะทั้งหมดอยู่ในรีโปและ working tree บนเครื่องสะอาด
**ห้ามแก้สดบนเครื่อง** — ไฟล์ Docker nginx ถูก mount read-only อยู่แล้ว ซึ่งบังคับข้อนี้ให้ครึ่งหนึ่ง

## คอนเทนเนอร์ 15 ตัว — ทั้งหมดอยู่ compose project เดียว `gacp-platform`

| กลุ่ม | คอนเทนเนอร์ |
|---|---|
| ฝั่ง `gacpth.com` | `gacp-backend` · `gacp-frontend` |
| ฝั่ง `staging.gacpth.com` | `gacp-backend-staging` · `gacp-frontend-staging` |
| ใช้ร่วมกัน | `gacp-postgres` · `gacp-redis` · `gacp-nginx` · `gacp-minio` |
| สังเกตการณ์ | `gacp-prometheus` · `gacp-grafana` · `gacp-loki` · `gacp-promtail` · `gacp-cadvisor` · `gacp-node-exporter` |
| เครื่องมือ | `gacp-pgadmin` |

**ไม่มีตัวไหนว่าง** — ทั้งสองชุดให้บริการโดเมนคนละโดเมน หยุดตัวใดตัวหนึ่งคือดับโดเมนนั้น

เครือข่าย: `gacp-nginx` อยู่บน `gacp-network` · คอนเทนเนอร์ `-staging` อยู่ทั้ง `gacp-network`
และ `gacp-staging-network` ⇒ **มีเครือข่ายร่วมกันแล้ว** Docker DNS จาก `gacp-nginx`
resolve ชื่อ `backend-staging` / `frontend-staging` ได้โดยไม่ต้องเพิ่ม network

## ฐานข้อมูล — instance เดียว 4 ฐาน

| ฐาน | ขนาด | ใครใช้ |
|---|---|---|
| `gacp_staging` | 28 MB | `staging.gacpth.com` ← **เว็บที่เราใช้และถ่ายภาพประกอบเอกสารทั้งหมด** |
| `gacp_db` | 21 MB | `gacpth.com` |
| `gacp_e2e_test` | 7.4 MB | e2e |
| `postgres` | 7.5 MB | maintenance |

`scripts/ci/full-gate.sh` สร้าง scratch DB ชื่อ `gacp_gate_<sha12>` ใน instance เดียวกันนี้
แล้วลบทิ้งด้วย trap — ชื่อถูกตรวจกับ allowlist `^gacp_gate_[0-9a-z_]+$` ก่อนแตะ SQL ใดๆ
จึงไม่มีทางไปโดน `gacp_db` / `gacp_staging`

## ทรัพยากรเครื่อง — และข้อจำกัดที่ตามมา

| | |
|---|---|
| CPU | 2 คอร์ |
| RAM | 7.1 GiB · ใช้ไป ~5.0 GiB · **ไม่มี swap** |
| ดิสก์ | 118 GB ใช้ไป 43% (ไม่ใช่คอขวด) |

**เครื่องนี้รัน full unit suite ไม่ไหว** — พิสูจน์แล้ว 2026-08-08: `npx jest` ตายด้วย
`OOMErrorHandler` / `Aborted (core dumped)` และคอนเทนเนอร์ทั้ง 15 ตัวรวมกันกินแค่ ~1.55 GiB
⇒ ปิดคอนเทนเนอร์ก็ไม่พอ · ที่เหลือกระจายอยู่กับ GitHub Actions runner,
agent ของผู้ให้บริการคลาวด์ และ next-server สองตัว

ผลกระทบต่อ gate: `suite-green` ใน `scripts/ci/full-gate.sh` รันบนเครื่องนี้ ⇒ **ผลของมัน
ขึ้นกับปริมาณแรมที่บังเอิญว่างอยู่ ณ วินาทีนั้น** เคยวิ่งจบครั้งหนึ่ง (2026-08-08 เช้า) และ
OOM อีกครั้งในวันเดียวกัน — จนกว่าจะมีเครื่องใหม่ ให้ถือว่าเช็กนี้ยังไม่น่าเชื่อถือ

**ห้ามเพิ่ม `--max-old-space-size` เพื่อแก้ OOM บนเครื่องนี้** — ไม่มี swap ⇒ เคอร์เนล
จะเป็นคนเลือกเหยื่อแทน และเหยื่ออาจเป็น `gacp-postgres` หรือคอนเทนเนอร์ที่ให้บริการอยู่

## staging ไม่เหมือน production ตรงไหน (ณ วันที่เขียน)

เพราะ `staging.gacpth.com` ข้าม Docker nginx สิ่งเหล่านี้จึง **ไม่เคยถูกทดสอบบน staging**:

| สิ่งที่ขาด | ผลถ้ามีปัญหา |
|---|---|
| rate limit 4 zone — `api_auth` 10r/s · `api_general` 50r/s · **`api_upload` 5r/m บน `/api/applications/`** · `limit_conn` 20 | เกษตรกรกรอกฟอร์มหลายขั้นตอนอาจเจอ 429 บน production โดยที่ staging ไม่มีวันเจอ |
| security headers — HSTS · X-Frame-Options · Permissions-Policy · Referrer-Policy (CSP อยู่ที่ชั้นแอป) | **เคยกัดจริงมาแล้ว** — `nginx/gacp.production.conf:182-196` บันทึกว่า CSP สองชั้นทำให้เบราว์เซอร์บังคับ *อินเตอร์เซกชัน* ของทั้งสองใบ literal ที่ nginx เคยเขียนไว้จึงลบ `${backendOrigin}`/`${tileOrigin}` ที่แอปคำนวณมาถูกแล้วทิ้ง (แผนที่ว่าง + รูปเอกสารถูกปฏิเสธ) · ตอนนี้ nginx **ไม่ตั้ง CSP** เจ้าของ header คือ `apps/web-app/src/middleware.ts:73-119` — ซึ่ง staging ที่ข้าม Docker nginx ก็ยังไม่ได้ทดสอบ header ที่เหลืออยู่ดี |
| `location /api/session/` → **frontend** (production) เทียบกับ `/api/` ทั้งก้อน → backend (staging) | path เดียวกันวิ่งคนละบริการระหว่างสองฝั่ง |
| gzip · cache rules ของ `/_next/static/` · `/pgadmin/` · `/stub_status` · deny ไฟล์ซ่อน | พฤติกรรม cache และการปิดกั้นต่างกัน |

สิ่งที่ staging **มี**ตรงกันแล้ว: `client_max_body_size 50M` · `/uploads/` ชี้ไป backend
(แก้ตามบทเรียนเดียวกับ production เมื่อ 2026-06-25) · deny ไฟล์ซ่อน/ไฟล์ backup ·
ประตูก่อนเปิดตัว `$gacp_prelaunch_deny` + endpoint `/__access-check` (ของที่ production ไม่มี)

## กับดักที่เสียเวลาไปแล้ว — อย่าเสียซ้ำ

| กับดัก | ความจริง |
|---|---|
| อ่าน `docker exec gacp-nginx cat /etc/nginx/conf.d/*.conf` แล้วคิดว่าเห็นเส้นทางครบ | นั่นคือ **ชั้นใน** เท่านั้น · เส้นทางจริงเริ่มที่ host nginx ซึ่งอยู่นอก Docker — ใช้ `sudo nginx -T` |
| เชื่อชื่อคอนเทนเนอร์ | `gacp-backend` (ไม่มี staging) = ฝั่ง `gacpth.com` · เว็บที่ใช้จริงคือ `-staging` |
| `docker logs gacp-nginx` ไม่มี access log แปลว่าไม่มีคนเข้า | access log เขียนลงไฟล์ (`/opt/gacp-platform/logs/nginx` ถูก mount) ไม่ได้ออก stdout |
| สรุปว่าคอนเทนเนอร์ว่างจาก `docker logs --tail 3` | ต้องนับทั้งช่วง — `-staging` มี log 2,169 บรรทัดใน 48 ชม. ซึ่งส่วนใหญ่เป็น cron ในแอป (`Revision Deadline Checker` รายชั่วโมง · `Work Activity SLA Monitor` ทุกครึ่งชั่วโมง) แต่ก็มี request จากเบราว์เซอร์จริงปนอยู่ |
| อ่าน `n_live_tup` จาก `pg_stat_user_tables` แล้วคิดว่าเป็นจำนวนแถวจริง | เป็นค่าประมาณจากตัวเก็บสถิติและ **ค้างได้นาน** — `gacp_db` รายงาน 16 ตารางทั้งที่มีข้อมูล 25 ตาราง · ต้อง `ANALYZE` ก่อนวัด หรือใช้ `count(*)` |

## เมื่อเครื่อง production มาถึง

ไม่ต้องย้ายข้อมูล — ระบบยังไม่มีผู้ใช้จริง ⇒ **ติดตั้งใหม่จาก SHA ที่ระบุชัด** แล้วชี้ DNS
ปลายทางที่ควรเป็น: สองเครื่องรูปร่างเดียวกัน เครื่องละหนึ่งชุด

| เครื่อง | เส้นทาง | ฐานข้อมูล |
|---|---|---|
| ใหม่ (production) | Cloudflare → host nginx → Docker nginx → `backend` / `frontend` | `gacp_db` |
| นี้ (staging) | Cloudflare → host nginx → Docker nginx → `backend-staging` / `frontend-staging` | `gacp_staging` |

**ก่อนย้าย** ควรทำให้ staging เดินผ่าน Docker nginx บนเครื่องนี้ก่อน เพื่อพิสูจน์ว่ารูปร่างนี้
ใช้ได้จริงในที่ที่พังแล้วไม่มีใครเดือดร้อน แทนที่จะไปพิสูจน์บนเครื่อง production วันแรก

`docker-compose*.yml` มี **7 ไฟล์** ในรีโป แต่ที่รันจริงคือ project `gacp-platform` เดียว
⇒ ก่อนตั้งเครื่องใหม่ ต้องรู้ให้แน่ว่าไฟล์ไหนคือของจริง อีก 6 ไฟล์ตรงกับความจริงแค่ไหนยังไม่มีใครตรวจ

---

**หลักฐานที่มาของทุกตัวเลขในหน้านี้:** ผลรันบนเครื่อง VM-0-3-ubuntu วันที่ 2026-08-08
(`sudo nginx -T` · `docker inspect` · `docker stats` · `pg_database_size` · `free -h` ·
`pg_stat_user_tables` หลัง `ANALYZE`) — ถ้าตัวเลขในหน้านี้ขัดกับเครื่อง **ให้เชื่อเครื่อง
แล้วแก้หน้านี้**
