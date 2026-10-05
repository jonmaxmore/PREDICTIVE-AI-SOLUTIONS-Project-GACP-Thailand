# Runbook — build image บนเครื่อง staging โดยไม่ใช้ GitHub Actions

**เขียนจากการรันจริง 2026-08-14** — ทุกตัวเลขในนี้วัดจริง ไม่ใช่ประมาณ
**ทำไมมี:** operator ตัดสิน 2026-08-14 ว่าไม่จ่ายค่า GitHub Actions ⇒ `build-images.yml`
ผลิต image ไม่ได้อีก · เส้นทางนี้คือเส้นทาง build จริงของโปรเจกต์ ไม่ใช่ fallback

## build

```bash
cd /tmp && rm -rf /tmp/gacp-build && git clone -q git@github.com:jonmaxmore/GACP-Certification-Application.git /tmp/gacp-build && cd /tmp/gacp-build
SHA=$(git rev-parse HEAD)
TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)

docker build -f apps/backend/Dockerfile \
    --build-arg GIT_SHA=$SHA --build-arg BUILT_AT=$TS \
    -t ghcr.io/jonmaxmore/gacp-backend:local-${SHA:0:12} .

docker build -f apps/web-app/Dockerfile \
    --build-arg GIT_SHA=$SHA --build-arg BUILT_AT=$TS \
    --build-arg NEXT_PUBLIC_API_URL=https://staging.gacpth.com \
    --build-arg NEXT_PUBLIC_PWA_ENABLED=false \
    --build-arg NEXT_PUBLIC_CHECKOUT_UI_ENABLED=true \
    -t ghcr.io/jonmaxmore/gacp-frontend:local-${SHA:0:12} .
```

| | เย็น (ครั้งแรก) | อุ่น (แก้เฉพาะ config/docs) |
|---|---|---|
| backend | 53.3 s | ~10 s |
| frontend | 276.6 s (`next build` กิน 181.6 s) | ~10 s |

รอบอุ่นเร็วเพราะ `ARG GIT_SHA` อยู่ **ล่างสุด** ของทั้งสอง Dockerfile — ของแพง (pnpm install,
prisma generate, next build) อยู่เหนือมันและ cache อยู่ · **อย่าย้าย ARG ขึ้น** ไม่งั้นทุก commit
คือ rebuild เต็ม

### กับดักที่เจอจริง

1. **`NEXT_PUBLIC_API_URL` ไม่มี `/api` ท้าย** — ค่าจริงจาก `docker-compose.staging.yml:174`
   คือ `https://staging.gacpth.com` เฉย ๆ · ใส่ `/api` = frontend เรียก API ผิดที่ทั้งแอป
2. **`--build-arg` ที่ Dockerfile ไม่ประกาศ `ARG` ไว้ จะถูกเมินเงียบ ๆ** — docker แค่เตือน
   `build-args were not consumed` ท้าย log แล้วสร้าง image ที่ flag ปิด · เช็คบรรทัดนั้นทุกครั้ง
3. **ค่า `NEXT_PUBLIC_*` ฝังตอน `next build`** — ตั้งบน container ที่รันอยู่ = ไม่มีผล ต้อง build ใหม่

## ตรวจก่อน deploy — แยก "ค่าเข้า image" ออกจาก "endpoint ตอบ"

```bash
docker run --rm --entrypoint sh ghcr.io/jonmaxmore/gacp-backend:local-${SHA:0:12} -c 'echo $GIT_SHA'
docker run --rm --name fe-probe -d -p 13000:3000 ghcr.io/jonmaxmore/gacp-frontend:local-${SHA:0:12} && sleep 8 && curl -s http://localhost:13000/api/webapp-version; docker rm -f fe-probe
```

⚠️ **การทดสอบพอร์ตตรงแบบนี้ข้าม nginx** — 2026-08-14 endpoint ที่ผ่านเทสต์นี้ถูก nginx บังเงียบ ๆ
บนโดเมนจริง (`/api/version` ชนกับ endpoint mobile ของ backend) · ผ่านตรงนี้ยังต้องผ่าน curl
บนโดเมนจริงหลัง deploy เสมอ

## deploy

```bash
cd /opt/gacp-platform && sudo IMAGE_TAG=local-${SHA:0:12} bash scripts/deploy/deploy-staging.sh
```

สคริปต์รู้จัก image ในเครื่องแล้ว (แก้ 2026-08-14 — เดิมบังคับต้องอยู่บน GHCR) · ลำดับใน
สคริปต์: preflight → **backup DB** → pull (ข้ามถ้ามี local) → **migrate** → recreate ·
migration ที่ ABORT (เช่น role ที่ map ไม่ได้) = สคริปต์หยุดก่อน recreate, DB ถูก rollback,
มี backup ให้ถอย — ดูวิธีแก้ใน `evidence/runtime-deploy-drift/task5/INDEX.md`

## พิพากษา

```bash
cd /tmp/gacp-build && bash scripts/probes/deploy-drift.sh; echo "exit=$?"
```

แถว staging ต้องหายจากรายการ FAIL · แถว production จากเครื่องนี้จะ FAIL เสมอ
(**Cloudflare WAF บล็อก IP เครื่องเองที่ชั้น edge** — แก้ได้เฉพาะใน Cloudflare dashboard)

## ชั้นที่ต้องรู้ก่อนแตะ nginx (เลือดจริงทั้งสามข้อ — 2026-08-14)

```
Cloudflare (WAF/challenge) → Host nginx :443 (TLS + prelaunch gate) → Docker nginx :8080 (routing ตาม $host) → containers
```

1. **conf ของ docker nginx เป็น bind mount รายไฟล์** — `git pull` เขียนไฟล์ใหม่ทับ (inode ใหม่)
   แต่ container ยังเห็น inode เก่า ⇒ `nginx -s reload` สำเร็จกับ **conf เก่า** · ต้อง
   `docker restart gacp-nginx` (สะดุด ~3-5 วิ ทั้ง prod+staging)
2. **host vhost อยู่ในรีโปที่ `deploy/nginx/`** — เครื่องรันสำเนา · ก่อนติดตั้งเวอร์ชันรีโป
   ต้องอ่าน **allowlist ของ prelaunch gate** ให้ครบ: ต้องมี IP สาธารณะของเครื่องเอง
   (curl จากเครื่องวิ่งผ่าน Cloudflare แล้วกลับมาด้วย IP นั้น ไม่ใช่ 127.0.0.1) และช่วง IP
   ของ operator (ISP หมุนรายวัน — /32 คือ lockout ตั้งเวลา)
3. **rollback ด้วยลายเซ็นเนื้อไฟล์ ไม่ใช่เวลา** — backup ตามฉบับดั้งเดิม: staging มี
   `127.0.0.1:8001` · prod มี `snippets/gacp-prelaunch-gate`:

```bash
sudo bash -c 'S=$(grep -l "127.0.0.1:8001" /root/nginx-bak-staging-*.conf | head -1); P=$(grep -l "snippets/gacp-prelaunch-gate" /root/nginx-bak-prod-*.conf | head -1); cp "$S" /etc/nginx/sites-enabled/staging.gacpth.com.conf && cp "$P" /etc/nginx/sites-enabled/gacp-platform.conf && nginx -t && systemctl reload nginx'
```

หลัง reload **ต้อง `sleep` ก่อน curl ตรวจ** — เคยเจอ curl แข่งกับ reload แล้วอ่านผลผิดหนึ่งรอบ
