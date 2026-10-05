# Runbook · preview.gacpth.com (สภาพแวดล้อมซ่อน)

**สถานะเอกสาร:** เขียนจากไฟล์ในรีโปและจากข้อเท็จจริงที่ตรวจบนเครื่อง 2026-08-22
ยังไม่มีการรันบนเครื่องจริง ทุกขั้นด้านล่างต้องรันโดยผู้ประสานงานแล้วบันทึกผลจริงกลับมา

## preview คืออะไร และไม่ใช่อะไร

**คือ** เครื่องเดียวกับ staging และ production (203.0.113.10) รัน `main` ล่าสุด
เปิด public เต็มตามมติ operator 2026-08-22 (ไม่มี gate ไม่มี allowlist IP) ใช้ **ฐานข้อมูล Supabase dev
ตัวเดียวกับที่ทดสอบบน laptop** เพื่อให้สิ่งที่เห็นบน preview คือชุดข้อมูลเดียวกับที่เห็นตอน
ทดสอบเครื่องตัวเอง ไม่ใช่ข้อมูลอีกชุดที่ค่อย ๆ เพี้ยนออกจากกัน

**ไม่ใช่** สภาพแวดล้อมสำหรับลูกค้า ไม่ใช่ที่ทดสอบการจ่ายเงินจริง และไม่ใช่ตัวแทนของ
production ในเชิงประสิทธิภาพ เพราะแบ่ง CPU และดิสก์กับอีกสองสแตกบนเครื่องเดียวกัน

**ต่างจาก staging ตรงไหน** staging ส่งทราฟฟิกผ่าน docker nginx (127.0.0.1:8080) แล้วให้
คอนเทนเนอร์นั้นเลือก upstream จาก Host header · preview **ไม่ผ่าน** docker nginx แต่ยิงตรง
ไป 127.0.0.1:8002 และ 127.0.0.1:3002 เพราะการเพิ่ม preview ลง `$host` map ของ docker nginx
แปลว่าต้องแก้ `nginx/gacp.production.conf` ซึ่งเป็นไฟล์ที่ production ใช้อยู่ และการ reload
ไฟล์นั้นต้อง `docker restart gacp-nginx` (production สะดุด 3-5 วินาที) ราคานี้แพงเกินไป
สำหรับสภาพแวดล้อมที่ไม่มีใครเห็น · ผลที่ตามมาคือทุกอย่างที่ docker nginx เคยแจกให้ ต้อง
เขียนซ้ำใน `deploy/nginx/preview.gacpth.com.conf` เอง (security header, การแยก
`/api/session/` ไปฝั่ง frontend, การแยก `/api/webapp-version`) ยกเว้น rate limiting ที่
**ไม่มีบน preview** เพราะ zone ประกาศอยู่ใน http block ของ docker nginx

## ตารางพอร์ตและชื่อ

| | production | staging (ของเก่า จะปลด) | preview |
|---|---|---|---|
| backend container | `gacp-backend` | `gacp-backend-staging` | `gacp-backend-preview` |
| frontend container | `gacp-frontend` | `gacp-frontend-staging` | `gacp-frontend-preview` |
| พอร์ต backend (loopback) | ไม่เปิด | 8001 | **8002** |
| พอร์ต frontend (loopback) | ไม่เปิด | 3001 | **3002** |
| ฐานข้อมูล | `postgres:5432/gacp_db` | `postgres:5432/gacp_staging` | **Supabase pooler** |
| redis db index | 0 | 1 | **2** |
| compose project | `gacp-platform` | `gacp-platform` | **`gacp-preview`** |

พอร์ต 8002/3002 เลือกมาเพื่อไม่ชนกับคู่ `gacp-*-staging` ที่ยังค้างอยู่ ทั้งสองชุดอยู่ร่วมกัน
ได้จนกว่าจะปลดของเก่าในขั้นตอน (g)

---

## (a) DNS ที่ Cloudflare (ต้องให้ operator ทำ)

ขั้นตอนนี้ agent และผู้ประสานงานทำแทนไม่ได้ ต้องเข้า Cloudflare dashboard ของโดเมน
`gacpth.com`

1. DNS → Records → Add record
2. Type `A` · Name `preview` · IPv4 `203.0.113.10`
3. **Proxy status: Proxied** (เมฆสีส้ม) ห้ามเป็น DNS only เด็ดขาด เพราะถ้าไม่ proxied
   ผู้ใช้จะวิ่งเข้า origin ตรง ๆ แล้วเจอใบรับรอง self-signed CN=gacpth.com กลายเป็น
   `ERR_CERT_AUTHORITY_INVALID` และ WAF ก็จะไม่ทำงาน
4. TTL: Auto
5. SSL/TLS mode ต้องเป็นค่าเดียวกับที่ staging ใช้อยู่คือ **Full** (ไม่ใช่ Full strict)
   เพราะ origin ใช้ใบรับรอง self-signed ที่ CN ไม่ครอบ `preview.gacpth.com`
   ค่านี้ตั้งระดับโดเมน ถ้า staging ใช้งานได้อยู่แล้วก็ไม่ต้องแก้อะไร

ตรวจว่า DNS มาแล้ว

```bash
dig +short preview.gacpth.com
# ต้องได้ IP ของ Cloudflare ไม่ใช่ 203.0.113.10 ตรง ๆ
```

## (b) ติดตั้ง vhost ของ host nginx

```bash
cd /opt/gacp-platform && git fetch origin && git checkout main && git pull
sudo cp deploy/nginx/preview.gacpth.com.conf /etc/nginx/sites-available/preview.gacpth.com.conf
sudo ln -sfn /etc/nginx/sites-available/preview.gacpth.com.conf \
             /etc/nginx/sites-enabled/preview.gacpth.com.conf
sudo nginx -t && sudo systemctl reload nginx
```

`nginx -t` ต้องผ่านก่อน reload เสมอ ถ้า `nginx -t` แดงแล้ว reload ไป nginx จะยัง
เสิร์ฟจาก config เก่าในหน่วยความจำ ทุกอย่างดูปกติ จนกระทั่ง restart ครั้งถัดไปแล้ว
nginx ไม่กลับมา

vhost นี้พึ่งตัวแปรระดับ http ที่ประกาศไว้ใน `deploy/nginx/gacp-platform.conf` และติดตั้ง
อยู่ใน `/etc/nginx/conf.d` บนเครื่องแล้ว ตรวจให้ครบก่อน reload

```bash
sudo grep -rl 'connection_upgrade|set_real_ip_from' /etc/nginx/conf.d /etc/nginx/sites-enabled
```

ตัวแปรที่ต้องมี: `$connection_upgrade` และ `set_real_ip_from` ชุดของ Cloudflare (preview ไม่ใช้ตัวแปรของ gate) · ถ้าขาดตัวใดตัวหนึ่ง `nginx -t` จะฟ้อง
`unknown variable` ซึ่งเป็นวิธีที่ถูกต้องที่ความผิดพลาดนี้จะโผล่

หลัง reload **ต้องรอสักครู่ก่อน curl ตรวจ** เคยเจอ curl แข่งกับ reload แล้วอ่านผลผิดไปหนึ่งรอบ

## (c) สร้าง /opt/gacp-platform/.env.preview

```bash
cd /opt/gacp-platform
sudo cp .env.preview.example .env.preview
sudo chmod 600 .env.preview && sudo chown root:root .env.preview
sudo nano .env.preview
```

ค่าที่ต้องกรอกให้ตรงกับ laptop จริง ๆ ไม่ใช่ค่าใหม่

- `DATABASE_URL` คัดลอกทั้งบรรทัดจาก `.env` ของ laptop (โฮสต์
  `aws-1-ap-southeast-2.pooler.supabase.com:5432` ยิงจากเครื่องนี้ถึง ทดสอบแล้ว 2026-08-22)
- `ENCRYPTION_KEY`, `HMAC_KEY`, `MASTER_ENCRYPTION_KEY` ต้องเป็นค่าเดียวกับ laptop
  เพราะคีย์ชุดนี้ใช้เข้ารหัสฟิลด์ PII และคอลัมน์ `*Hmac` ในฐานข้อมูลชุดเดียวกัน
  ถ้าใช้คนละค่า แถวที่เขียนจากฝั่งหนึ่งจะอ่านจากอีกฝั่งได้เป็น `[PII_DECRYPT_FAILED]`
- `AUTH_LOOKUP_USE_HMAC`, `APP_FK_USE_TOKEN`, `ENABLE_PDPA_FIELD_ENCRYPTION`
  ต้องตั้งเท่ากับ laptop ด้วยเหตุผลเดียวกัน
- `REDIS_URL` ใช้รหัสผ่านของ `gacp-redis` ที่รันอยู่ (ค่าเดียวกับ `REDIS_PASSWORD` ใน
  `.env.production` ของเครื่อง) และลงท้ายด้วย `/2`
- `HEALTH_JWT_SECRET`, `PROVIDER_JWT_SECRET`, `SESSION_SECRET`, `PAYMENT_WEBHOOK_SECRET`
  ตั้งค่าใหม่เฉพาะ preview ได้ ห้ามคัดลอกจาก production

ห้าม `git add` ไฟล์นี้ `.gitignore` กันไว้แล้ว แต่ก็ยังตรวจซ้ำได้ด้วย
`git -C /opt/gacp-platform status --short | grep env.preview` ต้องไม่มีอะไรออกมา

### ตัวเลือกเสริม คีย์ลงลายเซ็น

ใบรับรองที่ออกจาก laptop ลงลายเซ็นด้วยคู่กุญแจ RSA ของ laptop และฐานข้อมูลเก็บแค่
`signatureKeyId` ไม่ได้เก็บ public key (`apps/backend/prisma/schema/certification.prisma:99-107`)
แปลว่า preview ซึ่งสร้างคู่กุญแจของตัวเองจะ **ตรวจลายเซ็นใบเก่าไม่ผ่าน** ถึงจะเปิดหน้าใบรับรอง
ได้ตามปกติก็ตาม ถ้าต้องการให้ลายเซ็นตรงกันทั้งสองฝั่ง ให้คัดลอกคู่กุญแจของ laptop เข้าไป
ครั้งเดียวก่อนรันครั้งแรก และ `RSA_PRIVATE_KEY_PASSPHRASE` ต้องเป็นค่าเดียวกันด้วย

```bash
# ทำครั้งเดียว หลังจาก deploy รอบแรกสร้าง volume แล้ว
docker run --rm -v gacp-preview-signing-keys:/keys -v /root/laptop-keys:/in:ro \
    alpine sh -c 'cp /in/private.pem /in/public.pem /keys/ && chown -R 1001:1001 /keys'
docker restart gacp-backend-preview
```

## (d) รัน deploy-preview.sh

```bash
cd /opt/gacp-platform
sudo bash scripts/deploy/deploy-preview.sh
```

สคริปต์จะ clone หรือ fetch `/tmp/gacp-build` ที่ `origin/main` แล้ว build ทั้งสอง image
ด้วย build-arg ของ preview ตรวจ `GIT_SHA` ที่ฝังในตัว image แล้วจึง `up -d` และรอ
healthcheck เขียวทั้งคู่

รอบเย็นครั้งแรกใช้เวลาประมาณ backend 55 วินาที และ frontend 280 วินาที รอบอุ่นประมาณ
10 วินาทีต่อ image

สิ่งที่สคริปต์นี้ **ไม่ทำ** และตั้งใจไม่ทำ

- ไม่แตะ `docker-compose.production.yml` หรือ `docker-compose.staging.yml`
- ไม่แตะ `/etc/nginx` และไม่ reload nginx
- **ไม่รัน migration อัตโนมัติ** เพราะฐานข้อมูล Supabase dev เป็นชุดเดียวกับที่ laptop
  ใช้ทดสอบอยู่ตอนนี้ ปกติ schema ตรงอยู่แล้วเพราะ apply จาก laptop ไปก่อน
  ถ้าจำเป็นต้อง migrate จริงให้เติม `--migrate` หรือรันคำสั่งที่สคริปต์พิมพ์ออกมาเอง

ปักหมุด commit ที่ต้องการได้

```bash
sudo bash scripts/deploy/deploy-preview.sh --sha 687494c681b2a54d0630e5d061101690c0bf6ca9
```

## (e) การเข้าถึง — preview เปิด public เต็ม (มติ operator 2026-08-22)

preview **ไม่มี** ประตู prelaunch ไม่มีคุกกี้ ไม่มี allowlist IP และไม่มีการจำกัดตามประเทศ
ใครที่รู้ URL ก็เปิดได้ทันที สิ่งเดียวที่อยู่หน้า preview คือ proxy ค่าเริ่มต้นของ Cloudflare
(เราไม่ได้เพิ่มกฎ WAF ใด ๆ) ตามคำสั่ง operator "จะเปิด public แบบสมบูรณ์"

ผลที่ตามมาที่ต้องรู้:
- ข้อมูลทดสอบบน preview คือฐานข้อมูล Supabase ชุดเดียวกับที่ใช้ทดสอบบนเครื่อง dev
  อย่าใส่ข้อมูลจริงของเกษตรกรลงไป
- vhost นี้ไม่มี rate limit ระดับ host (zone ของ limit_req อยู่ใน Docker nginx ที่ preview ข้ามไป)
  ถ้า preview ถูกยิงหนัก ให้เปิด rate limiting ของ Cloudflare ก่อน ไม่ต้องแก้ nginx

## (f) ตรวจว่าเสิร์ฟบิลด์ที่ต้องการจริง

```bash
bash /tmp/gacp-build/scripts/ops/which-build.sh https://preview.gacpth.com
curl -sk https://preview.gacpth.com/api/health
```

`which-build.sh` ยิง `/api/webapp-version` แล้วเทียบ commit กับ `origin/main` ต้องได้
"ตรงกับ origin/main แล้ว เป็นบิลด์ล่าสุด" หรือระบุจำนวน commit ที่ตามหลังอย่างชัดเจน
ถ้าได้ "ไม่ทราบรุ่นบิลด์" แปลว่า `GIT_SHA` ว่างตอน build ต้อง build ใหม่

การตรวจผ่านพอร์ตตรง (127.0.0.1:3002) พิสูจน์แค่ว่าคอนเทนเนอร์ถูก ยังไม่พิสูจน์ว่า nginx
ส่งถูก 2026-08-14 เคยมี endpoint ที่ผ่านการทดสอบพอร์ตตรงแล้วถูก nginx บังเงียบ ๆ
บนโดเมนจริง ดังนั้นต้อง curl บนโดเมนจริงเสมอ

ตรวจว่า QR ชี้ถูกโฮสต์ด้วย เปิดหน้าใบรับรองบน preview แล้วดูว่า URL ใน QR ขึ้นต้นด้วย
`https://preview.gacpth.com/verify/` ไม่ใช่ `https://gacpth.com/verify/` ถ้าชี้ผิดแปลว่า
`X-Forwarded-Host` หายไปที่ชั้น nginx หรือ `PUBLIC_VERIFY_HOST_ALLOWLIST` ไม่มี
`preview.gacpth.com` ทั้งสองส่วนต้องมีพร้อมกัน

## (g) ปลดคู่ gacp-*-staging ของเก่า

คู่นี้เข้าไม่ถึงและเก่าค้างอยู่ (image tag `local-fd61813835f3` ชี้ `postgres:5432/gacp_staging`)
ปลดได้ **หลังจาก preview ผ่านขั้นตอน (f) แล้วเท่านั้น** เพราะพอร์ตคนละชุดอยู่แล้ว จึงไม่ต้อง
รีบ

```bash
# 1. เก็บหลักฐานสภาพเดิมไว้ก่อน
docker inspect gacp-backend-staging gacp-frontend-staging > /root/staging-pair-before-retire.json

# 2. หยุดและลบเฉพาะสองคอนเทนเนอร์นี้ ห้ามใช้ compose down กับไฟล์ staging
#    เพราะไฟล์นั้น merge กับ compose ของ production
docker stop gacp-backend-staging gacp-frontend-staging
docker rm   gacp-backend-staging gacp-frontend-staging

# 3. เอา vhost ของ staging ออกก็ต่อเมื่อ operator ยืนยันว่าไม่ใช้ staging.gacpth.com แล้ว
#    ถ้ายังไม่ยืนยัน ข้ามข้อนี้ไป
```

**อย่าเพิ่งลบ volume** `gacp_staging_uploads`, `gacp_staging_storage`,
`gacp_staging_signing_keys` เก็บไว้อย่างน้อยหนึ่งรอบสัปดาห์ ในนั้นมีเอกสารที่อัปโหลดไว้
และคู่กุญแจที่ใช้ลงลายเซ็นใบรับรองของฐาน `gacp_staging` ลบแล้วเอาคืนไม่ได้ preview
ไม่ได้ใช้ volume ชุดนี้ จึงลบทีหลังได้อย่างปลอดภัยเมื่อ operator สั่ง

```bash
# เมื่อ operator สั่งแล้วเท่านั้น
docker volume rm gacp_staging_uploads gacp_staging_storage gacp_staging_signing_keys
```

## (h) ภายหลัง เลื่อน preview ขึ้นเป็น staging โดยไม่ต้อง build ใหม่

เมื่อ preview นิ่งแล้วและอยากให้ `staging.gacpth.com` ชี้มาที่สแตกเดียวกัน ทำได้โดยแก้
upstream ที่ host nginx อย่างเดียว ไม่ต้อง build image ใหม่

1. สำรอง vhost เดิมด้วยลายเซ็นเนื้อไฟล์ ไม่ใช่เวลา

```bash
sudo cp /etc/nginx/sites-enabled/staging.gacpth.com.conf \
        /root/nginx-bak-staging-$(date +%Y%m%d-%H%M%S).conf
```

2. ใน vhost ของ staging เปลี่ยน `proxy_pass http://127.0.0.1:8080;` ให้ชี้
   `http://127.0.0.1:8002` สำหรับ `/api/` และ `/uploads/` และชี้ `http://127.0.0.1:3002`
   สำหรับ `location /` แล้วคัดลอกบล็อก `/api/session/` กับ `= /api/webapp-version`
   จาก `preview.gacpth.com.conf` มาด้วย มิฉะนั้น session จะ 404 และ which-build.sh
   จะอ่านคำตอบของ backend แทน frontend

3. เพิ่ม `staging.gacpth.com` ใน `PUBLIC_VERIFY_HOST_ALLOWLIST` ให้ครบ (ค่าตั้งต้นใน
   `.env.preview.example` มีอยู่แล้ว) และเพิ่ม `CORS_ORIGIN` ให้รับสองโฮสต์
   `CORS_ORIGIN` รับค่าคั่นจุลภาคได้ (`apps/backend/server.js` `parseOriginList`)

4. `sudo nginx -t && sudo systemctl reload nginx` แล้วรอสักครู่ก่อน curl ตรวจ

5. ถอยกลับด้วยการคัดลอกไฟล์สำรองกลับที่เดิม แล้ว `nginx -t && systemctl reload nginx`

หมายเหตุ ถ้าเลื่อนขั้นแบบนี้ staging จะเปลี่ยนไปใช้ฐานข้อมูล Supabase dev ทันที ไม่ใช่
`gacp_staging` เดิมอีกต่อไป ข้อนี้เป็นการตัดสินใจของ operator ไม่ใช่ผลข้างเคียงของการ
แก้ nginx

---

## สิ่งที่การออกแบบนี้ไม่ได้แก้

- **ไม่มี rate limiting บน preview** zone `api_general` / `api_auth` / `api_upload`
  ประกาศอยู่ใน http block ของ docker nginx ซึ่ง preview ไม่ผ่าน และ preview เปิด public
  ถ้าถูกยิงหนัก ให้เปิด rate limiting ของ Cloudflare ก่อน (ไม่ต้องแก้ nginx)
- **ไม่มี mock IdP บน preview** ตัวบอกสล็อต staging อยู่ใน `docker-compose.staging.yml`
  ไฟล์เดียวเท่านั้น และมีเทสต์
  (`apps/backend/__tests__/unit/staging-slot-compose-pin.test.js`) ที่สแกนไฟล์
  `docker-compose*.yml` ทุกไฟล์เพื่อกันไม่ให้ตัวบอกนี้โผล่ที่อื่น preview จึงใช้ผู้ให้บริการ
  ยืนยันตัวตนชุดจริงเหมือน production ตามเจตนา
- **ไม่ตรวจลายเซ็นใบรับรองเก่า** ตามที่อธิบายในหัวข้อ (c) ตัวเลือกเสริม
- **ไฟล์ที่อัปโหลดไม่ตามมาจาก laptop** ฐานข้อมูลใช้ร่วมกันก็จริง แต่ไฟล์จริงอยู่บนดิสก์
  ของ laptop ส่วน preview มี volume ของตัวเอง แถวเอกสารเก่าจะเปิดไฟล์ไม่ได้บน preview
  และไฟล์ที่อัปโหลดบน preview จะเปิดไม่ได้จาก laptop ทางแก้ที่แท้จริงคือใช้ object storage
  ร่วมกัน ซึ่งอยู่นอกขอบเขตงานนี้
- **ยังไม่มีใครรันจริง** ทุกคำสั่งในเอกสารนี้ตรวจแบบ static เท่านั้น (`bash -n`,
  โครงสร้าง YAML, การเทียบ directive กับ vhost ของ staging) ยังไม่มีการรัน
  `docker compose config` และ `nginx -t` เพราะ laptop ไม่มี docker และ nginx

## แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุที่พบบ่อยที่สุด | ตรวจอย่างไร |
|---|---|---|
| 403 ทุกหน้า | อุปกรณ์ยังไม่ผ่านประตูคุกกี้ | เปิด `/__access-check` ดู `blocked=` |
| 502 ทุกหน้า | คอนเทนเนอร์ไม่ขึ้น หรือ vhost ยังไม่ติดตั้ง | `docker ps --filter name=gacp-.*-preview` |
| หน้าโหลดแต่ API 404 หมด | สร้าง image ด้วย `NEXT_PUBLIC_API_URL` ที่มี `/api` ต่อท้าย | build ใหม่โดยใช้ origin เปล่า |
| ล็อกอินแล้วหลุดเอง | `/api/session/` วิ่งไป backend | ตรวจว่ามีบล็อก `location /api/session/` ใน vhost (nginx เลือก prefix ที่ยาวกว่าเองอยู่แล้ว ลำดับในไฟล์ไม่มีผล) |
| which-build ตอบ SHA แปลก | `/api/webapp-version` วิ่งไป backend | ตรวจว่ามี `location = /api/webapp-version` |
| QR ชี้ `gacpth.com` | `X-Forwarded-Host` หาย หรือ allowlist ไม่มี preview | ตรวจทั้ง vhost และ `PUBLIC_VERIFY_HOST_ALLOWLIST` |
| `[PII_DECRYPT_FAILED]` | `ENCRYPTION_KEY` ไม่ตรงกับ laptop | เทียบค่ากับ `.env` ของ laptop |
| แอปพังทั้งระบบหลัง deploy | frontend คุยกับ backend ของ production | ตรวจ `INTERNAL_API_URL=http://backend-preview:8000` |

## ไฟล์ที่เกี่ยวข้อง

- `docker-compose.preview.yml` · สองบริการของ preview
- `.env.preview.example` · แม่แบบตัวแปรสภาพแวดล้อม
- `deploy/nginx/preview.gacpth.com.conf` · vhost ของ host nginx
- `scripts/deploy/deploy-preview.sh` · สคริปต์ build และ deploy
- `docs/operations/runbooks/build-images-on-the-box.md` · กับดักสามข้อของการ build
- `docs/operations/domain-access.md` · ประตู prelaunch และการหมุน token
