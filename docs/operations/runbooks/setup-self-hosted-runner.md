# Runbook — ติดตั้ง GitHub self-hosted runner บนเครื่อง staging (2026-08-06)

> **SUPERSEDED 2026-08-14 — อย่าเดินตามใบนี้เว้นแต่ operator สั่งใหม่**
> operator ตัดสิน 2026-08-14 ว่า **ไม่จ่ายค่า GitHub Actions** ⇒ job ไม่ dispatch แม้แต่ไป
> self-hosted (the change log 2026-08-14 · `.github/workflows/runner-dispatch-probe.yml`
> บันทึกอาการ "เข้าคิว, runner Idle → ติด billing") · สิ่งที่ใบนี้สัญญาว่าจะปลดล็อก ถูกส่งมอบ
> ด้วยเส้นทางอื่นแล้ว: `docs/operations/runbooks/build-images-on-the-box.md` (build) และ
> `docs/operations/runbooks/full-gate-on-staging.md` (gate เต็ม → `evidence/gate/<sha>.json`)
> เก็บไฟล์นี้ไว้เผื่อวันหนึ่ง billing กลับมาเท่านั้น — ข้อความข้างล่างเป็นบริบทของ 2026-08-06
>
> ผู้รัน: **operator เท่านั้น** (agent ไม่มีทางเข้าเครื่อง — L-008/no-agent-ssh)
> เหตุผล: โควตา GitHub-hosted Actions (2,000 นาที/เดือน) หมด ทำให้ CI ทั้งระบบไม่ start ตั้งแต่ 2026-08-06 09:06 UTC
> (`reports/orchestrator/2026-08-06-ci-outage/DIAGNOSIS.md`) — runner ของเราเอง = GitHub ไม่คิดนาที
> **ข้อเท็จจริงเครื่อง (operator ยืนยัน 2026-08-06): เครื่องนี้ใช้ staging เท่านั้น — production ยังไม่ได้ทำจริง**
> ⇒ stack ชื่อ "production" บนเครื่องเป็นของทดลอง เคลียร์ได้ · เอกสารเก่าที่พูดถึง "production บนเครื่องนี้" ให้อ่านด้วยบริบทนี้

## ขั้น 1 — เคลียร์ stack production ที่ไม่ใช้ (คืน CPU/RAM/disk ให้ runner)

ดูก่อนว่ามีอะไรรันอยู่ — **อย่าข้ามขั้นนี้**:
```bash
docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}'
docker compose ls
df -h
```
หยุดและลบเฉพาะ stack production (container + network — **ยังไม่ลบข้อมูล**):
```bash
cd /opt/gacp-platform   # หรือ path ที่วาง compose จริง
docker compose -f docker-compose.production.yml down --remove-orphans
```
ถ้ายืนยันว่า volume ฝั่ง production ไม่มีข้อมูลที่ต้องเก็บ (⚠️ ย้อนไม่ได้):
```bash
docker compose -f docker-compose.production.yml down -v
```
เก็บกวาด image เก่าคืนพื้นที่ (ไม่แตะ image ที่ staging ใช้อยู่):
```bash
docker image prune -af --filter "until=168h"
df -h   # ตรวจผล
```
⚠️ **ห้ามแตะ**: stack staging + volume ของ staging DB + `/var/backups/gacp/`

## ขั้น 2 — เตรียม user แยกสำหรับ runner

```bash
sudo useradd -m -s /bin/bash runner
sudo usermod -aG docker runner
sudo mkdir -p /opt/actions-runner && sudo chown runner:runner /opt/actions-runner
```

## ขั้น 3 — ลงทะเบียน runner (token ต้องเอาจากหน้าเว็บ — agent ดึงให้ไม่ได้)

1. เปิด `https://github.com/jonmaxmore/GACP-Certification-Application/settings/actions/runners` → **New self-hosted runner** → เลือก Linux x64
2. GitHub จะโชว์คำสั่ง download + config **พร้อม token สด (หมดอายุ ~1 ชม.)** — copy จากหน้าจอนั้นมารันในนาม user `runner`:
```bash
sudo -iu runner
cd /opt/actions-runner
# วางคำสั่ง curl + tar จากหน้า GitHub (เวอร์ชันล่าสุด ณ วันติดตั้ง)
./config.sh --url https://github.com/jonmaxmore/GACP-Certification-Application \
  --token <TOKEN-จากหน้าจอ> --name gacp-staging-runner \
  --labels self-hosted,linux,x64 --unattended
exit
cd /opt/actions-runner && sudo ./svc.sh install runner && sudo ./svc.sh start
```
3. ตรวจ: หน้า Runners ต้องเห็น `gacp-staging-runner` สถานะ **Idle (เขียว)** · บนเครื่อง: `sudo ./svc.sh status`

## ขั้น 4 — เปิดใช้กับ CI

1. **หลัง runner เป็น Idle แล้วเท่านั้น** → merge PR #819 (มี ci.yml ที่สลับ `runs-on` เป็น `[self-hosted, linux]` ครบ 19 jobs แล้ว) — merge ก่อน runner online จะทำให้ทุก job ค้างคิวเฉยๆ
2. Push อะไรก็ได้ / re-run workflow บน main → ดู run แรกจนจบ — **run เขียวแรกบน main คือหลักฐานปลด Law 3.5** (`[ACTIVE — ยังไม่ยืนยันบน runner]`) — agent จะเสนอ diff the project rules ให้ทันทีที่เห็น
3. Job เดียววิ่งต่อครั้งต่อ runner — ถ้าอยากขนาน: ติด runner เพิ่มใน dir ใหม่ (`/opt/actions-runner-2` ทำซ้ำขั้น 3) 2-3 ตัวกำลังดี

## ขั้น 5 — ดูแลระยะยาว

- Runner auto-update ตัวเอง · ตรวจสุขภาพ: `sudo ./svc.sh status` + หน้า Runners
- Disk: CI จะสะสม image/cache — ตั้ง cron `docker system prune -af --filter "until=336h"` รายสัปดาห์
- ⚠️ **ถ้าวันหน้าเปิด repo เป็น public**: ต้องปิด "Run workflows from fork PRs" ก่อน — ห้ามให้โค้ดคนนอกวิ่งบนเครื่องเรา
- Nightly E2E (`e2e-staging-nightly.yml`) และ workflow อื่นยังชี้ ubuntu-latest — สลับตามทีหลังเมื่อ ci.yml นิ่งแล้ว

## สิ่งที่ใบนี้เคยตั้งใจจะปลดล็อก — และใครส่งมอบจริง (อัปเดต 2026-08-14)

| ที่เคยเขียนไว้ | ของจริงวันนี้ |
|---|---|
| "run เขียวแรกบน main = หลักฐานปลด Law 3.5" | Law 3.5 ไม่มีแล้ว — v3 ยุบเข้า L4 (the project rules §0) · หลักฐานที่ใช้จริงคือ attestation `evidence/gate/<sha>.json` จาก full-gate บนเครื่อง (probe `gate-attestation`) |
| R-R2-1 integration บน Postgres จริง | full-gate check `integration-pg` (required) + `migrate-deploy` — `scripts/ci/full-gate-checks.txt` |
| probe-gate proof ครั้งแรก | full-gate check `probe-ci` (required) รัน `scripts/ci/probe-gate.js` ทั้งกอง |
| merge กลับมาเดินตาม tiered-merge | เดินอยู่ — เกณฑ์อยู่ที่ the project rules §5 โดยใช้ full-gate บนเครื่องแทน CI |
