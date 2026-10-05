# Runbook: หมุนรหัสผ่านฐานข้อมูล PostgreSQL

**สถานะ:** active
**เจ้าของ:** platform operator
**เขียนเมื่อ:** 2026-08-04
**ที่มา:** INCIDENT-2026-08-04 เปลี่ยนรหัสผ่านฐานข้อมูลแล้ว staging ล่ม ไม่มี alert แจ้ง
รู้ตัวตอนมีคนลอง login
**เครื่องมือ:** ไม่มีสคริปต์อัตโนมัติ งานนี้ทำด้วยมือทั้งหมด ดูเหตุผลข้อ 0.2
**เอกสารคู่กัน:** `docs/operations/env-layering.md` อธิบายว่าค่า env แต่ละตัวมาจากชั้นไหน

---

## 0. อ่านก่อนเริ่ม

### 0.1 สามเรื่องที่ทำให้รอบที่แล้วล่ม

1. **prod กับ staging ใช้ role ฐานข้อมูลตัวเดียวกัน** และใช้คอนเทนเนอร์ postgres
   ตัวเดียวกัน แยกแค่ชื่อฐานข้อมูล
   หลักฐาน `docker-compose.staging.yml:8-9` (คอมเมนต์ระบุว่าใช้ postgres คอนเทนเนอร์เดียวกัน
   แยกฐานข้อมูล) เทียบ `docker-compose.production.yml:89` กับ `docker-compose.staging.yml:67`
   ทั้งสองบรรทัดอ่าน `${DB_USER:-gacp}` และ `${DB_PASSWORD:?...}` ตัวเดียวกัน
   **หมุนรหัสหนึ่งครั้ง กระทบสองระบบ ถ้าแก้ที่เดียว อีกที่จะล่มทันที**

2. **สคริปต์หมุนความลับที่มีอยู่ใช้กับงานนี้ไม่ได้**
   `scripts/maintenance/rotate-secret.sh:55-62` มี allow-list เพียงหกตัว
   ไม่มี `DB_PASSWORD` และไม่มี `DATABASE_URL`
   ต่อให้เพิ่มเข้าไปก็ยังไม่ครบ เพราะสคริปต์แตะเฉพาะ `.env.production` (`:39`)
   และ recreate เฉพาะ service `backend` (`:222`) ไม่เคยแตะฝั่ง staging

3. **`DB_PASSWORD` ไม่มีอยู่ในคอนเทนเนอร์** จึงห้ามดึงค่าจากคอนเทนเนอร์มาใช้
   รายการ `environment:` ของ backend prod (`docker-compose.production.yml:86-197`)
   และของ backend-staging (`docker-compose.staging.yml:63-142`)
   ส่งเข้าไปเฉพาะ `DATABASE_URL` ไม่มีบรรทัด `DB_PASSWORD` เลย
   `docker exec ... printenv DB_PASSWORD` จึงคืนค่าว่างเสมอ ดูข้อ 3

### 0.2 ทำไมไม่มีสคริปต์

`scripts/maintenance/rotate-secret.sh` ออกแบบมาสำหรับความลับที่ **มีที่เก็บที่เดียว**
คือหนึ่งบรรทัดใน `.env.production` แล้ว restart backend
รหัสฐานข้อมูลไม่ใช่แบบนั้น มันถูกถือไว้อย่างน้อยห้าที่พร้อมกัน และหนึ่งในนั้นคือ
ตัวฐานข้อมูลเอง ซึ่งเปลี่ยนได้ด้วย `ALTER USER` เท่านั้น
การอัตโนมัติเรื่องนี้ต้องออกแบบใหม่ทั้งชุด อยู่นอกขอบเขตของ runbook นี้

### 0.3 ห้ามพึ่ง alert

ตอนนี้ **ไม่มี alert ทำงานอยู่เลย** อ่านข้อ 9 ก่อนเริ่ม การยืนยันทุกขั้นต้องทำด้วยมือ
ตาม checklist ข้อ 7

---

## 1. รายการทุกที่ที่ถือรหัสนี้ ต้องครบทุกช่อง

จุดขายของ runbook นี้คือความครบ รอบที่แล้วล่มเพราะแก้ไม่ครบ
พิมพ์ตารางนี้ออกมาแล้วติ๊กทีละช่อง

### 1.1 ต้องแก้ทุกครั้ง ห้ามข้าม

| # | ที่อยู่ | หลักฐาน file:line | ต้องทำอะไร |
| --- | --- | --- | --- |
| 1 | ตัว role ในฐานข้อมูลเอง | ไม่มีสคริปต์ในรีโป · `docker-compose.production.yml:317` ส่ง `POSTGRES_PASSWORD` เข้า container postgres แต่มีผลเฉพาะตอน initdb ครั้งแรกเท่านั้น | `ALTER USER` ดูข้อ 5 ขั้นที่ 3 |
| 2 | `/opt/gacp-platform/.env.production` บรรทัด `DB_PASSWORD=` | แม่แบบ `.env.production.example:12` · ไฟล์จริงถูก ignore ที่ `.gitignore:24` | แก้ค่า |
| 3 | `/opt/gacp-platform/.env.production` บรรทัด `DATABASE_URL=` | แม่แบบ `.env.production.example:14` | แก้ค่า แม้ compose จะประกอบทับที่ `docker-compose.production.yml:89` แต่ `scripts/deploy/deploy-production.sh:47` บังคับให้บรรทัดนี้มีค่า และคนที่มาอ่านทีหลังจะเชื่อค่านี้ ปล่อยให้ค้างเป็นค่าเก่าคือวางกับดักไว้ให้คนถัดไป |
| 4 | `/opt/gacp-platform/.env.staging` บรรทัด `DB_PASSWORD=` | ไฟล์จริงถูก ignore ที่ `.gitignore:25` · วิธีสร้างอยู่ที่ `docs/operations/staging-activation.md:59` · ด่านตรวจบังคับว่าต้องมีค่าไม่ว่างที่ `scripts/deploy/deploy-staging.sh:33,66-72` | แก้ค่า **ช่องที่ลืมรอบที่แล้ว** |
| 5 | `/opt/gacp-platform/.env.staging` บรรทัด `DATABASE_URL=` | ติดมาจากการ `cp .env.production .env.staging` ตาม `docs/operations/staging-activation.md:59` | แก้ค่าด้วยเหตุผลเดียวกับช่อง 3 |
| 6 | คอนเทนเนอร์ `gacp-backend` | `docker-compose.production.yml:89` ประกอบ `DATABASE_URL` ตอน `up` | recreate ดูข้อ 5 ขั้นที่ 4 |
| 7 | คอนเทนเนอร์ `gacp-backend-staging` | `docker-compose.staging.yml:67` | recreate ในรอบเดียวกับช่อง 6 |
| 8 | คอนเทนเนอร์ blue หรือ green ถ้าเปิดใช้อยู่ | `docker-compose.bluegreen.yml:52` เป็น anchor `&backend_env` และถูกใช้ซ้ำที่ `:111` | recreate ถ้ามีตัวไหนรันอยู่ ตรวจด้วย `docker ps --filter name=gacp-backend-` |

### 1.2 ต้องตรวจ อาจต้องแก้ ขึ้นกับว่าเปิดใช้อยู่หรือไม่

| # | ที่อยู่ | หลักฐาน file:line | หมายเหตุ |
| --- | --- | --- | --- |
| 9 | pgAdmin server ที่บันทึกรหัสไว้ | service อยู่ที่ `docker-compose.production.yml:336-357` เก็บข้อมูลใน volume `pgadmin_data` | **ตรวจจากรีโปไม่ได้** ต้องเข้าเว็บ pgAdmin แล้วดูว่ามี server ที่ติ๊ก save password ไว้หรือไม่ ถ้ามีต้องอัปเดต |
| 10 | postgres-exporter | `monitoring/docker-compose.monitoring.yml:109` ใช้ `DATA_SOURCE_NAME: ${DATABASE_URL}` | เป็นสแตกแยกตาม `monitoring/README.md:23` และ job ถูกคอมเมนต์ไว้ที่ `monitoring/prometheus.yml:33-35` ตรวจว่ารันอยู่ไหมด้วย `docker ps --filter name=gacp-postgres-exporter` |
| 11 | role `gacp_app` ของงาน RLS บน staging | `apps/backend/scripts/rls/prototype-staging-setup.sql:85` ตั้งรหัสให้ role นี้ · ใช้ผ่าน `GACP_APP_DATABASE_URL` ที่ `apps/backend/scripts/rls/prototype-probe.js:58` | เป็นคนละรหัสกับ role หลัก ไม่ต้องหมุนพร้อมกัน แต่ต้องรู้ว่ามีอยู่ ตรวจว่ามี role นี้จริงไหมด้วยคำสั่งในข้อ 7.5 |
| 12 | สคริปต์สำรองข้อมูลที่ต่อผ่าน TCP | `scripts/backup/backup-system.sh:55` ใช้ `-h localhost` | ต้องรันจริงหลังหมุนเพื่อดูว่ายังทำงาน ดูข้อ 7.6 · ส่วน `scripts/backup/pg-backup.sh:80` ไม่ระบุ `-h` จึงต่อผ่าน unix socket ซึ่งอาจไม่ต้องใช้รหัส ยืนยันด้วยการรันจริงเช่นกัน |
| 13 | ที่เก็บรหัสของทีม เช่น password manager หรือบันทึกส่วนตัว | ไม่มีในรีโป | อัปเดตให้ตรง มิฉะนั้นรอบหน้าจะมีคนใช้รหัสเก่า |

### 1.3 เจอจากการ grep แต่ห้ามแตะ

ถ้าค้นด้วย `git grep -nE 'DATABASE_URL|DB_PASSWORD|POSTGRES_PASSWORD'` จะเจอที่เหล่านี้
ทั้งหมดเป็นค่าใช้แล้วทิ้งของ CI หรือของเครื่อง dev **ไม่ใช่รหัสจริง** และไม่เกี่ยวกับการหมุนรอบนี้

| ที่อยู่ | หลักฐาน file:line |
| --- | --- |
| service container ของ CI | `.github/workflows/ci.yml:408,441,481,498,647,688,694,701,833,864,900,950,957` |
| CI ชุด golden | `.github/workflows/backend-qc-golden.yml:20,68,75` |
| CI ชุด production check | `.github/workflows/production.yml:97` |
| สแตก QA บนเครื่อง | `docker-compose.qa.yml:12-14,48` |
| สแตก dev บนเครื่อง | `docker-compose.yml:14-16,49` |
| สแตก local-prod | `docker-compose.local-prod.yml:54,122-124` |
| สแตกทดสอบ | `docker-compose.test.local.yml:11-13` อ่านจาก `.env.test.local` ที่ `:61` |
| สคริปต์ dev บน Windows | `scripts/deploy/local-deploy.ps1:112` · `scripts/deploy/deploy-qa-local.ps1:118` · `scripts/deploy/deploy-qa-local.sh:113` |
| ตัวสร้างไฟล์ตัวอย่าง | `scripts/security/generate-env-template.js:20` |
| แม่แบบที่ commit ได้ | `.env.production.example:12,14` · `.env.local.example:10,12` · `apps/backend/.env.example:7` · `apps/backend/.env.production.example:27` |

**ข้อยกเว้นเดียว** ถ้ารหัสที่กำลังหมุนคือรหัสเดียวกับที่ปรากฏในไฟล์เหล่านี้
แปลว่ารหัสจริงเคยถูก commit ลงรีโป กรณีนั้น **หยุดทันที** อย่าแก้เงียบ
รายงาน operator ก่อน เพราะงานจริงคือการถือว่ารหัสรั่วแล้วและต้องตรวจ git history
(ตาม the project rules ข้อ 7 เรื่อง secret ใน git history)

---

## 2. เตรียมก่อนลงมือ

### 2.1 ชุดอักขระของรหัสใหม่ เรื่องนี้ทำให้ต่อไม่ได้ทั้งที่รหัสถูก

รหัสนี้จะถูกฝังลงใน connection string รูปแบบ
`postgresql://<ผู้ใช้>:<รหัสผ่าน>@<โฮสต์>:<พอร์ต>/<ชื่อฐานข้อมูล>` ที่
`docker-compose.production.yml:89` และ `docker-compose.staging.yml:67`

อักขระที่ **ห้ามใช้** แบ่งเป็นสองกลุ่ม

| กลุ่ม | อักขระ | เหตุผล |
| --- | --- | --- |
| ชนไวยากรณ์ URL | at, colon, slash, hash, question mark, percent, ampersand, equals, plus, ช่องว่าง | ทำให้ตัว `DATABASE_URL` ที่ `docker-compose.production.yml:89` และ `docker-compose.staging.yml:67` ถูกตัดผิดตำแหน่ง |
| ชนไวยากรณ์ shell | single quote, double quote, dollar, backslash, backtick | สคริปต์ deploy เอาค่าไปวางในสตริงของ shell ที่ `scripts/deploy/deploy-staging.sh:122` |

ที่ปลอดภัยคือ ตัวอักษร A ถึง Z, a ถึง z, ตัวเลข 0 ถึง 9, ขีดล่าง และขีดกลาง

นอกจากนี้ค่าจะถูกอ่านกลับด้วย `grep ... | cut -d= -f2-`
(`scripts/deploy/deploy-staging.sh:85,87,122`) จึง **ห้ามครอบด้วยเครื่องหมายคำพูด**
ในไฟล์ env และไฟล์ต้องเป็น LF ไม่ใช่ CRLF ไม่งั้นจะมีตัว carriage return ติดไปกับรหัส

สร้างรหัสที่ปลอดภัยกับทุกข้อข้างบน ใช้แนวเดียวกับที่ `scripts/maintenance/rotate-secret.sh:145`
ทำอยู่แล้ว คือแปลงอักขระที่ชนกับ URL ทิ้ง

```bash
# 32 ไบต์สุ่ม แปลงเป็น base64 แล้วตัด = / + ออก เหลือแต่อักขระที่ปลอดภัยกับ URL
NEW_DB_PASSWORD="$(head -c 32 /dev/urandom | base64 | tr -d '\n=' | tr '/+' '_-')"
```

### 2.2 สำรองก่อนแตะอะไร

```bash
cd /opt/gacp-platform

# 1. สำรองฐานข้อมูล
sudo bash scripts/backup/pg-backup.sh

# 2. สำรองไฟล์ env ทั้งสองใบ พร้อม timestamp
TS="$(date -u +%Y%m%dT%H%M%SZ)"
sudo mkdir -p /var/backups/gacp/env-rotations
sudo chmod 0700 /var/backups/gacp/env-rotations
for f in .env.production .env.staging; do
    sudo cp "$f" "/var/backups/gacp/env-rotations/${f}-${TS}.bak"
    sudo chmod 0600 "/var/backups/gacp/env-rotations/${f}-${TS}.bak"
done
ls -l /var/backups/gacp/env-rotations/ | tail -5
```

### 2.3 เก็บรหัสเดิมไว้จนกว่าจะยืนยันเสร็จ

ต้องมีรหัสเดิมอยู่ในมือตลอดขั้นตอน ไม่งั้น rollback ไม่ได้
เก็บไว้ใน shell variable ของ session ที่กำลังทำงาน อย่าเขียนลงไฟล์ชั่วคราวที่ไม่ได้ลบ

```bash
# อ่านรหัสเดิมจากไฟล์ ไม่ใช่จากคอนเทนเนอร์ ดูเหตุผลข้อ 3
OLD_DB_PASSWORD="$(sudo grep -E '^DB_PASSWORD=' /opt/gacp-platform/.env.production | head -1 | cut -d= -f2-)"
: "${OLD_DB_PASSWORD:?หยุด อ่านรหัสเดิมจาก .env.production ไม่ได้ ตรวจว่าไฟล์มีบรรทัด DB_PASSWORD= จริง}"
echo "อ่านรหัสเดิมได้ ความยาว ${#OLD_DB_PASSWORD} ตัวอักษร"
```

---

## 3. ขั้นตอนบังคับ ตรวจว่าค่าไม่ว่างก่อนใช้เสมอ

### 3.1 สิ่งที่เกิดขึ้นจริงรอบที่แล้ว

คำสั่งหน้าตาแบบนี้ **ทำลายระบบเงียบ ๆ** ห้ามใช้เด็ดขาด

```bash
# ตัวอย่างของผิด ห้ามคัดลอกไปใช้
NEW_PW="$(docker exec gacp-backend-staging printenv DB_PASSWORD)"
docker exec -i gacp-postgres psql -U <ผู้ใช้ฐานข้อมูล> \
    -c "ALTER USER <ผู้ใช้ฐานข้อมูล> PASSWORD '$NEW_PW';"
```

เกิดอะไรขึ้นทีละขั้น

1. `printenv DB_PASSWORD` คืนค่าว่าง เพราะตัวแปรนี้ไม่เคยถูกส่งเข้าคอนเทนเนอร์
   รายการ `environment:` ของ backend-staging คือ `docker-compose.staging.yml:63-142`
   ส่งเข้าไปเฉพาะ `DATABASE_URL` ที่ `:67` ไม่มีบรรทัด `DB_PASSWORD`
   ฝั่ง prod ก็เหมือนกัน `docker-compose.production.yml:86-197`
2. `printenv` คืน exit code ที่ไม่ใช่ศูนย์ แต่อยู่ใน `$( )` ของการกำหนดค่าตัวแปรธรรมดา
   ซึ่ง `set -e` ไม่จับ สคริปต์จึงเดินต่อ
3. `$NEW_PW` ว่าง คำสั่งจึงกลายเป็น `PASSWORD ''` คือ **ตั้งรหัสเป็นค่าว่าง**
4. psql ตอบ `ALTER ROLE` แปลว่าสำเร็จ ไม่มี error ไม่มีคำเตือน
5. ตั้งแต่วินาทีนั้นการเชื่อมต่อใหม่ทุกครั้งล้มเหลว แต่การเชื่อมต่อที่เปิดค้างอยู่แล้ว
   ยังทำงานต่อ ระบบจึงดูเหมือนปกติจนกว่าจะมีคนทำสิ่งที่ต้องเปิดการเชื่อมต่อใหม่
   ซึ่งรอบนี้คือการ login

หมายเหตุข้อ 5 เป็นพฤติกรรมของ PostgreSQL ที่ยืนยันตัวตนตอนเปิดการเชื่อมต่อ
**ตรวจจากรีโปไม่ได้** ยืนยันได้ด้วยการรันคำสั่งในข้อ 7.3 เทียบกับข้อ 7.4

### 3.2 กฎเหล็กสามข้อ

1. **ห้ามอ่านรหัสจากคอนเทนเนอร์** อ่านจากไฟล์ env เท่านั้น หรือรับจากมือคนพิมพ์
2. **ทุกค่าที่ดึงมาได้ ต้องตรวจว่าไม่ว่างก่อนใช้** และหยุดทันทีถ้าว่าง
3. **ห้ามส่งค่าที่อาจว่างเข้าคำสั่งที่เขียนข้อมูล** ไม่ว่าจะสะดวกแค่ไหน

### 3.3 แบบที่ถูก เขียนให้หยุดเองเมื่อค่าว่าง

วางบล็อกนี้ไว้หัวทุก session ที่ทำงานนี้

```bash
set -Eeuo pipefail

# require_nonempty <ชื่อตัวแปร> <ข้อความเมื่อว่าง>
# ใช้รูปแบบ ${VAR:?ข้อความ} ซึ่ง bash จะหยุดทั้ง session ทันทีเมื่อค่าว่างหรือไม่ถูกตั้ง
require_nonempty() {
    local name="$1" msg="$2"
    local val="${!name:-}"
    if [ -z "$val" ]; then
        echo "หยุด ${name} ว่าง ${msg}" >&2
        return 1
    fi
}

# read_env_value <ไฟล์> <คีย์>
# คืนค่าออกมาทาง stdout และคืน exit code 1 เมื่อไม่พบหรือค่าว่าง
read_env_value() {
    local file="$1" key="$2" val
    [ -r "$file" ] || { echo "หยุด อ่านไฟล์ ${file} ไม่ได้" >&2; return 1; }
    val="$(grep -E "^${key}=" "$file" | head -1 | cut -d= -f2- | tr -d '\r')"
    [ -n "$val" ] || { echo "หยุด ไม่พบค่า ${key} ที่ไม่ว่างใน ${file}" >&2; return 1; }
    printf '%s' "$val"
}
```

วิธีใช้ รับรหัสใหม่จากคนพิมพ์แล้วตรวจก่อนเสมอ

```bash
read -rsp 'พิมพ์รหัสผ่านใหม่: ' NEW_DB_PASSWORD; echo
read -rsp 'พิมพ์ซ้ำอีกครั้ง: '  NEW_DB_PASSWORD_2; echo

: "${NEW_DB_PASSWORD:?หยุด รหัสผ่านใหม่ว่าง}"
[ "$NEW_DB_PASSWORD" = "$NEW_DB_PASSWORD_2" ] \
    || { echo 'หยุด พิมพ์สองครั้งไม่ตรงกัน' >&2; exit 1; }
[ "${#NEW_DB_PASSWORD}" -ge 24 ] \
    || { echo "หยุด รหัสสั้นเกินไป ได้ ${#NEW_DB_PASSWORD} ตัว ต้องอย่างน้อย 24" >&2; exit 1; }
# ตรวจแบบ allowlist ปลอดภัยกว่าการไล่ห้ามทีละตัว
case "$NEW_DB_PASSWORD" in
    *[!A-Za-z0-9_-]*)
        echo 'หยุด รหัสมีอักขระนอกชุดที่อนุญาต ดูข้อ 2.1' >&2; exit 1 ;;
esac
unset NEW_DB_PASSWORD_2
echo "รหัสใหม่ผ่านการตรวจ ความยาว ${#NEW_DB_PASSWORD} ตัวอักษร"
```

ทำไม `${VAR:?ข้อความ}` ถึงสำคัญ มันทำให้ bash จบ session ทันทีที่ค่าว่าง
ต่างจากการเขียน `"$VAR"` เฉย ๆ ที่จะกลายเป็นสตริงว่างแล้วเดินต่อ
ซึ่งเป็นสิ่งที่เกิดขึ้นในข้อ 3.1

---

## 4. ลำดับที่ปลอดภัย ทำอะไรก่อนหลัง

PostgreSQL เก็บรหัสได้ **ค่าเดียวต่อหนึ่ง role** จึงไม่มีทางหมุนโดยไม่มีช่วงรอยต่อเลย
สิ่งที่ทำได้คือทำให้ช่วงนั้นสั้นที่สุดและเกิดตอนที่เราเฝ้าดูอยู่

### 4.1 ลำดับที่ใช้ แก้ไฟล์ให้ครบก่อน แล้วค่อยแตะฐานข้อมูล

```
1. สำรอง (ข้อ 2.2)
2. แก้ไฟล์ env ทุกใบให้เป็นรหัสใหม่          <- ยังไม่มีผลกับระบบที่รันอยู่
3. เตรียมคำสั่ง recreate ไว้ในหน้าจอ พร้อมกด  <- ลดเวลาช่วงรอยต่อ
4. ALTER USER ในฐานข้อมูล                    <- ช่วงรอยต่อเริ่มตรงนี้
5. recreate backend และ backend-staging ทันที <- ช่วงรอยต่อจบตรงนี้
6. ยืนยันตาม checklist ข้อ 7                 <- ห้ามข้าม
```

**เหตุผลที่แก้ไฟล์ก่อน** ไฟล์ env ไม่มีผลกับคอนเทนเนอร์ที่รันอยู่แล้ว
ค่าถูกใช้ตอน `docker compose up` เท่านั้น (`docker-compose.production.yml:89`)
การแก้ไฟล์ล่วงหน้าจึงไม่ทำให้อะไรพัง และทำให้ขั้นที่ 5 เหลือแค่พิมพ์คำสั่งเดียว

**เหตุผลที่ห้ามสลับ 4 กับ 5** ถ้า recreate ก่อน `ALTER USER` คอนเทนเนอร์ใหม่จะถือ
รหัสใหม่ที่ฐานข้อมูลยังไม่รู้จัก แอปจะต่อไม่ได้ตั้งแต่วินาทีแรก และช่วงรอยต่อจะยาว
เท่ากับเวลาที่ใช้พิมพ์ `ALTER USER`

**เหตุผลที่ 4 กับ 5 ต้องติดกัน** ระหว่างสองขั้นนี้ ฐานข้อมูลรู้รหัสใหม่แล้ว
แต่แอปยังถือรหัสเก่า การเชื่อมต่อใหม่ทุกรายการจะล้มเหลว

### 4.2 ทางเลือกแบบไม่มีช่วงรอยต่อเลย

ถ้ารับช่วงรอยต่อสิบวินาทีไม่ได้ ต้องทำแบบ expand แล้วค่อย contract ตาม the project rules ข้อ 3.10
คือสร้าง role ใหม่ ให้สิทธิ์เท่าเดิม ย้ายแอปไปใช้ role ใหม่ทีละสแตก แล้วค่อยลบ role เก่า
วิธีนี้ต้องวางแผนเรื่องความเป็นเจ้าของ object และ default privileges แยกต่างหาก
**ไม่อยู่ในขอบเขตของ runbook นี้** และต้องมีแผนของตัวเองก่อนลงมือ

---

## 5. ขั้นตอนจริง

รันทั้งหมดใน session เดียวบน droplet โดยมีบล็อกจากข้อ 3.3 โหลดไว้แล้ว
ทุก `<...>` คือที่ให้เติมค่าจริง อย่าพิมพ์ค่าจริงลงเอกสารหรือแชท

### ขั้นที่ 1 ตรวจสถานะตั้งต้น

```bash
cd /opt/gacp-platform

# คอนเทนเนอร์อะไรรันอยู่บ้าง จะได้รู้ว่าต้อง recreate อะไร
docker ps --format 'table {{.Names}}\t{{.Status}}' | grep -E 'gacp-(backend|postgres|pgadmin)'

# ค่าที่คอนเทนเนอร์เห็นตอนนี้ ปิดบังรหัสแล้ว
docker exec gacp-backend         printenv DATABASE_URL | sed -E 's#(://[^:]+:)[^@]+@#\1REDACTED@#'
docker exec gacp-backend-staging printenv DATABASE_URL | sed -E 's#(://[^:]+:)[^@]+@#\1REDACTED@#'
```

จดชื่อ role และชื่อฐานข้อมูลที่เห็นไว้ใช้ในขั้นถัดไป

### ขั้นที่ 2 แก้ไฟล์ env ทั้งสองใบ ช่อง 2 ถึง 5 ของข้อ 1.1

ใช้ `awk` ไม่ใช่ `sed` เพราะรหัสอาจมีอักขระที่ `sed` ตีความเป็น regex
วิธีนี้ยืมมาจาก `scripts/maintenance/rotate-secret.sh:159-170` ที่ทำแบบเดียวกันด้วยเหตุผลเดียวกัน
(คอมเมนต์อธิบายเหตุผลอยู่ที่ `:156-158`)

```bash
: "${NEW_DB_PASSWORD:?หยุด ยังไม่ได้ตั้งรหัสใหม่ ทำข้อ 3.3 ก่อน}"

replace_key() {
    local file="$1" key="$2" value="$3" tmp
    [ -w "$file" ] || { echo "หยุด เขียนไฟล์ ${file} ไม่ได้" >&2; return 1; }
    grep -qE "^${key}=" "$file" \
        || { echo "หยุด ไม่พบบรรทัด ${key}= ใน ${file} ปฏิเสธการเพิ่มบรรทัดใหม่" >&2; return 1; }
    tmp="$(mktemp "${file}.XXXXXX")"
    chmod 0600 "$tmp"
    NEWVAL="$value" awk -v key="$key" '
        { if (substr($0, 1, length(key) + 1) == key "=") { print key "=" ENVIRON["NEWVAL"] }
          else { print } }
    ' "$file" > "$tmp"
    mv "$tmp" "$file"
    chmod 0600 "$file"
}

DB_USER_VAL="$(read_env_value /opt/gacp-platform/.env.production DB_USER)"
DB_NAME_VAL="$(read_env_value /opt/gacp-platform/.env.production DB_NAME)"
STAGING_DB_NAME_VAL="$(read_env_value /opt/gacp-platform/.env.staging STAGING_DB_NAME)"

# ช่อง 2 และ 3
replace_key /opt/gacp-platform/.env.production DB_PASSWORD "$NEW_DB_PASSWORD"
replace_key /opt/gacp-platform/.env.production DATABASE_URL \
    "postgresql://${DB_USER_VAL}:${NEW_DB_PASSWORD}@postgres:5432/${DB_NAME_VAL}?schema=public"

# ช่อง 4 และ 5 ใบที่ลืมรอบที่แล้ว
replace_key /opt/gacp-platform/.env.staging DB_PASSWORD "$NEW_DB_PASSWORD"
replace_key /opt/gacp-platform/.env.staging DATABASE_URL \
    "postgresql://${DB_USER_VAL}:${NEW_DB_PASSWORD}@postgres:5432/${STAGING_DB_NAME_VAL}?schema=public"
```

ตรวจทันทีว่าแก้ติดจริง โดยไม่แสดงค่า

```bash
for f in /opt/gacp-platform/.env.production /opt/gacp-platform/.env.staging; do
    for k in DB_PASSWORD DATABASE_URL; do
        printf '%s %s -> %s\n' "$f" "$k" \
            "$(read_env_value "$f" "$k" | sha256sum | cut -c1-12)"
    done
done
```

ค่า hash ของ `DB_PASSWORD` ในสองไฟล์ต้องเท่ากัน ถ้าไม่เท่าแปลว่ายังไม่ครบ หยุดแล้วแก้

### ขั้นที่ 3 ALTER USER ในฐานข้อมูล ช่อง 1

เตรียมคำสั่งของขั้นที่ 4 ไว้ในอีกหน้าต่างก่อน แล้วค่อยรันขั้นนี้

**วิธีที่แนะนำ ใช้ `\password` ของ psql**
เพราะรหัสไม่ผ่าน argument ของคำสั่ง ไม่เข้า shell history และ psql เป็นคนประกอบ
คำสั่ง `ALTER USER` ให้เอง เราจึงไม่มีทางเผลอต่อสตริงจากตัวแปรที่ว่าง

```bash
docker exec -it gacp-postgres psql -U <ผู้ใช้ฐานข้อมูล> -d postgres
```

แล้วที่ prompt ของ psql พิมพ์

```
\password <ผู้ใช้ฐานข้อมูล>
```

psql จะถามรหัสใหม่สองครั้งแบบไม่แสดงบนจอ ให้วางค่าเดียวกับที่ผ่านการตรวจในข้อ 3.3
**ถ้าเผลอกด Enter ผ่านโดยไม่พิมพ์อะไร psql จะตั้งรหัสเป็นค่าว่างให้จริง**
จึงต้องยืนยันด้วยข้อ 7.3 ทุกครั้ง ห้ามเชื่อว่าคำสั่งไม่ error แปลว่าถูก

**วิธีที่สอง สำหรับกรณีที่ต้องรันแบบไม่โต้ตอบ**
ส่งรหัสผ่านทางไฟล์ env ของ `docker exec` ไม่ใช่ทาง argument เพราะ `ps`
บนเครื่องเดียวกันมองเห็น argument ได้

```bash
: "${NEW_DB_PASSWORD:?หยุด รหัสใหม่ว่าง}"
: "${DB_USER_VAL:?หยุด ไม่รู้ชื่อ role}"

PWFILE="$(mktemp /dev/shm/gacp-rot.XXXXXX)"
chmod 0600 "$PWFILE"
printf 'NEWPW=%s\n' "$NEW_DB_PASSWORD" > "$PWFILE"

# psql ดึงค่าจาก NEWPW ในคอนเทนเนอร์มาใส่ตัวแปรของ psql แล้วอ้างด้วย :'newpw'
# ซึ่ง psql จะ escape ให้เอง เราจึงไม่ต้องต่อสตริง SQL ด้วยมือ
docker exec -i --env-file "$PWFILE" gacp-postgres \
    psql -U "$DB_USER_VAL" -d postgres -v ON_ERROR_STOP=1 \
    -c "\\set newpw \`printf '%s' \"\$NEWPW\"\`" \
    -c "ALTER USER \"${DB_USER_VAL}\" PASSWORD :'newpw';"

shred -u "$PWFILE" 2>/dev/null || rm -f "$PWFILE"
```

บรรทัด `: "${NEW_DB_PASSWORD:?...}"` สองบรรทัดแรกคือส่วนที่ทำให้คำสั่งนี้ fail-closed
ถ้าตัวแปรว่างหรือไม่ถูกตั้ง bash จะหยุดก่อนที่ `docker exec` จะได้รัน
ห้ามลบสองบรรทัดนี้ออกไม่ว่ากรณีใด

**ห้ามปิดหน้าจอนี้จนกว่าจะจบขั้นที่ 6**

### ขั้นที่ 4 recreate คอนเทนเนอร์ทั้งสองสแตก ช่อง 6 ถึง 8

ต้องทำติดกันทันที และต้องทำ **ทั้งสองสแตกในรอบเดียว** เพราะใช้ role ร่วมกัน

```bash
cd /opt/gacp-platform

# prod
docker compose --env-file .env.production \
    -f docker-compose.production.yml \
    up -d --no-deps backend

# staging ต้องใช้ทั้งสองไฟล์ เพราะ backend-staging ต่อ network ที่ประกาศในไฟล์ prod
# รูปแบบเดียวกับที่ scripts/deploy/deploy-staging.sh:134-137 ใช้
docker compose --env-file .env.staging \
    -f docker-compose.production.yml -f docker-compose.staging.yml \
    up -d --no-deps backend-staging
```

ถ้ามีคอนเทนเนอร์ blue หรือ green รันอยู่ (ตรวจจากขั้นที่ 1) ต้อง recreate ด้วย
โดยใช้ profile ตามที่ `docker-compose.bluegreen.yml` กำหนด

### ขั้นที่ 5 ตรวจตาม checklist ข้อ 7 ทั้งหมด

ห้ามข้ามไปขั้นที่ 6 จนกว่า checklist จะผ่านครบทุกข้อ

### ขั้นที่ 6 บันทึกและเก็บกวาด

```bash
# บันทึกลง audit log เดียวกับที่ rotate-secret.sh ใช้ (secret-rotation.md:61)
printf '%s  DB_PASSWORD  actor=%s  backup=/var/backups/gacp/env-rotations/*-%s.bak\n' \
    "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "${SUDO_USER:-$USER}" "$TS" \
    | sudo tee -a /var/log/gacp-secret-rotations.log > /dev/null

# ล้างค่าออกจาก session
unset NEW_DB_PASSWORD OLD_DB_PASSWORD
history -c 2>/dev/null || true
```

อัปเดตที่เก็บรหัสของทีม (ช่อง 13) แล้วปิดงาน

---

## 6. เฉพาะกรณี staging เรื่องที่ต้องรู้เพิ่ม

- staging **ไม่มีฐานข้อมูลของตัวเอง** ในความหมายของ instance มันใช้คอนเทนเนอร์
  `gacp-postgres` ตัวเดียวกับ prod แยกเฉพาะชื่อฐานข้อมูล
  (`docker-compose.staging.yml:8-9` และ `:67`)
- ชื่อฐานข้อมูลของ staging มาจาก `STAGING_DB_NAME` ไม่ใช่ `DB_NAME`
  (`docker-compose.staging.yml:67`) ต่อให้ `.env.staging` มีบรรทัด `DB_NAME=` อยู่
  บรรทัดนั้นถูกเมินทั้งบรรทัด รายละเอียดอยู่ที่ `docs/operations/env-layering.md` ข้อ 3
- ถ้าจะรัน deploy staging หลังหมุนรหัส ด่านตรวจที่
  `scripts/deploy/deploy-staging.sh:66-72` จะปฏิเสธถ้า `DB_PASSWORD` ใน `.env.staging`
  ว่าง และคอนเทนเนอร์ migrate ที่ `:122` จะหยิบค่าจากไฟล์เดียวกัน
  จึงต้องแก้ไฟล์ให้เสร็จก่อนสั่ง deploy เสมอ

---

## 7. checklist ยืนยันว่าครบ รันได้จริงทุกข้อ

ติ๊กครบทั้งเจ็ดข้อจึงจะถือว่าจบ

### 7.1 ทุกไฟล์ถือค่าเดียวกัน

```bash
hash_of() { sudo grep -E "^$2=" "$1" | head -1 | cut -d= -f2- | tr -d '\r\n' | sha256sum | cut -c1-12; }

echo "prod    DB_PASSWORD  $(hash_of /opt/gacp-platform/.env.production DB_PASSWORD)"
echo "staging DB_PASSWORD  $(hash_of /opt/gacp-platform/.env.staging    DB_PASSWORD)"
```

สองบรรทัดต้องได้ hash เท่ากัน ถ้าไม่เท่า แปลว่าแก้ไม่ครบ กลับไปขั้นที่ 2

### 7.2 ค่าในคอนเทนเนอร์ตรงกับไฟล์

```bash
docker exec gacp-backend         printenv DATABASE_URL | sed -E 's#(://[^:]+:)[^@]+@#\1REDACTED@#'
docker exec gacp-backend-staging printenv DATABASE_URL | sed -E 's#(://[^:]+:)[^@]+@#\1REDACTED@#'

# เทียบเฉพาะส่วนรหัสผ่านด้วย hash ไม่ต้องเปิดค่า
docker exec gacp-backend printenv DATABASE_URL \
  | sed -E 's#^.*://[^:]+:([^@]+)@.*$#\1#' | tr -d '\n' | sha256sum | cut -c1-12
```

ค่า hash ต้องตรงกับข้อ 7.1 และชื่อฐานข้อมูลท้าย URL ต้องถูกต้อง
prod ต้องเป็นฐานของ prod ส่วน staging ต้องเป็นฐานของ staging ไม่ใช่ฐานเดียวกัน

### 7.3 role ในฐานข้อมูลรับรหัสใหม่จริง ไม่ใช่แค่ ALTER สำเร็จ

`ALTER ROLE` ตอบว่าสำเร็จแม้จะตั้งรหัสเป็นค่าว่าง จึงต้องทดสอบ login จริง

> ⚠️ **แก้ 2026-08-05 (secret-rotation-full.md §12.7)**: เดิมข้อนี้ต่อ `-h 127.0.0.1`
> ซึ่ง **พิสูจน์รหัสไม่ได้จริง** — pg_hba ที่อิมเมจ `postgres:15` สร้างตอน initdb ทำให้
> loopback TCP (127.0.0.1) และ unix socket เป็น `trust` (ไม่ถามรหัส) บรรทัด
> `host all all all scram-sha-256` ที่ entrypoint เติมทีหลังบังคับรหัสเฉพาะ **ที่อยู่
> ที่ไม่ใช่ loopback** เท่านั้น · จึงต้องต่อจาก **eth0 ของ container (ไม่ใช่ 127.0.0.1)**
> ถึงจะชน scram · **ถ้าคำสั่งไม่ถาม/ไม่ต้องใช้รหัสแล้วผ่าน = การตรวจไม่ได้พิสูจน์อะไร หยุด**

```bash
PWFILE="$(mktemp /dev/shm/gacp-chk.XXXXXX)"; chmod 0600 "$PWFILE"
printf 'PGPASSWORD=%s\n' "$NEW_DB_PASSWORD" > "$PWFILE"

# ต่อจาก eth0 ของ container (ไม่ใช่ 127.0.0.1) เพื่อบังคับให้ชนบรรทัด scram-sha-256
# ที่ต้องยืนยันตัวตนด้วยรหัสจริง — 127.0.0.1 จะตกบรรทัด trust ของ initdb (no-op)
docker exec -i --env-file "$PWFILE" gacp-postgres \
    sh -c 'psql -h "$(hostname -i)" -U <ผู้ใช้ฐานข้อมูล> -d <ชื่อฐานข้อมูล> \
        -tAc "SELECT current_user, current_database();"'

shred -u "$PWFILE" 2>/dev/null || rm -f "$PWFILE"
```

ต้องได้ชื่อ role กับชื่อฐานข้อมูลออกมา ถ้าได้ `password authentication failed` แปลว่ายังไม่ผ่าน ·
ถ้า **ไม่ถามรหัสเลยแล้วผ่าน** แปลว่ายังต่อโดน trust — ตรวจ pg_hba (`docker exec gacp-postgres
cat /var/lib/postgresql/data/pg_hba.conf`) แล้วต่อจากที่อยู่ที่ชน scram · ทางเลือก: ต่อจาก
client container บน `gacp-network` (`docker run --rm --network gacp-network postgres:15-alpine
psql -h postgres ...`)

### 7.4 แอปเชื่อมต่อได้จริง ไม่ใช่แค่คอนเทนเนอร์ขึ้น

`/api/health` คืน 503 เมื่อ Prisma ต่อฐานข้อมูลไม่ได้
(`apps/backend/routes/api/index.js:379-394` โดยเฉพาะบรรทัด `:384`)
และ `/api/health/ready` ตรวจทั้งฐานข้อมูลและ secrets
(`apps/backend/routes/api/health.js:62-108`)

```bash
curl -s -o /dev/null -w 'prod    /api/health -> %{http_code}\n' http://127.0.0.1:8000/api/health
curl -s -o /dev/null -w 'staging /api/health -> %{http_code}\n' http://127.0.0.1:8001/api/health

curl -s http://127.0.0.1:8000/api/health/ready | head -c 400; echo
curl -s http://127.0.0.1:8001/api/health/ready | head -c 400; echo
```

ต้องได้ 200 ทั้งคู่ และ `/ready` ต้องมี `"status":"READY"`
**คอนเทนเนอร์ที่ขึ้นอยู่ไม่ใช่หลักฐาน** `restart: unless-stopped`
(`docker-compose.staging.yml:55`) ไม่รีสตาร์ตจากสถานะ unhealthy
และไม่มี autoheal ในรีโป (`git grep -i autoheal` ได้ศูนย์ผลลัพธ์)

### 7.5 login ผ่านจริง ข้อที่พลาดรอบที่แล้ว

รอบที่แล้วอาการโผล่ตอน login เท่านั้น เพราะการเชื่อมต่อที่เปิดค้างอยู่ยังทำงานได้
เส้นทาง login คือ `POST /api/auth/health/login`
(`apps/backend/server.js:341` ผูก `/api` · `apps/backend/routes/api/index.js:101` ผูก `/auth/health`
· `apps/backend/routes/api/auth/auth-health.js:60` ผูก `/login`)

```bash
# ใช้บัญชีทดสอบเท่านั้น ห้ามใช้บัญชีของผู้ใช้จริง
# สนใจแค่ status code ไม่ต้องแสดง body ที่อาจมี token
curl -s -o /dev/null -w 'staging login -> %{http_code}\n' \
  -X POST http://127.0.0.1:8001/api/auth/health/login \
  -H 'Content-Type: application/json' \
  -d '{"healthId":"<บัญชีทดสอบ>","password":"<รหัสบัญชีทดสอบ>"}'

curl -s -o /dev/null -w 'prod    login -> %{http_code}\n' \
  -X POST http://127.0.0.1:8000/api/auth/health/login \
  -H 'Content-Type: application/json' \
  -d '{"healthId":"<บัญชีทดสอบ>","password":"<รหัสบัญชีทดสอบ>"}'
```

- ได้ 200 แปลว่าผ่าน
- ได้ 401 แปลว่าแอปคุยกับฐานข้อมูลได้แล้ว แค่รหัสบัญชีทดสอบไม่ตรง ถือว่าผ่านเช่นกัน
- ได้ 500 หรือ 503 แปลว่า **ยังไม่ผ่าน** ให้ดู log ทันที
  `docker logs gacp-backend-staging --tail 100`

### 7.6 บริการรอบข้างยังทำงาน

```bash
# สำรองข้อมูลยังทำได้ ไฟล์ต้องมีขนาดมากกว่าศูนย์
sudo bash /opt/gacp-platform/scripts/backup/pg-backup.sh
ls -lh /var/backups/gacp/scheduled/daily/ | tail -3

# ตัวที่ต่อผ่าน TCP ต้องตรวจแยก (scripts/backup/backup-system.sh:55)
# ถ้ารันอยู่ใน cron ให้รอรอบถัดไปแล้วดู log อย่าเพิ่งปิดงาน

# postgres-exporter ถ้ารันอยู่
docker ps --filter name=gacp-postgres-exporter --format '{{.Names}} {{.Status}}'

# role gacp_app ของงาน RLS มีอยู่จริงไหม (ช่อง 11)
docker exec -i gacp-postgres psql -U <ผู้ใช้ฐานข้อมูล> -d postgres \
    -tAc "SELECT rolname FROM pg_roles WHERE rolname = 'gacp_app';"
```

### 7.7 pgAdmin

เข้าเว็บ pgAdmin แล้วกดเชื่อมต่อ server ที่บันทึกไว้ ถ้าเชื่อมต่อไม่ได้ให้อัปเดต
รหัสที่บันทึกไว้ในรายการ server นั้น
**ตรวจจากบรรทัดคำสั่งไม่ได้** เพราะข้อมูลอยู่ใน volume `pgadmin_data`
(`docker-compose.production.yml:336-357`)

---

## 8. rollback

### 8.1 อาการพังแบบที่หนึ่ง แอปต่อไม่ได้หลัง recreate

```bash
# 1. คืนรหัสเดิมให้ฐานข้อมูลก่อน เพื่อให้ระบบกลับมาเร็วที่สุด
#    ต้องมี OLD_DB_PASSWORD จากข้อ 2.3
: "${OLD_DB_PASSWORD:?หยุด ไม่มีรหัสเดิม ข้ามไปข้อ 8.3}"
PWFILE="$(mktemp /dev/shm/gacp-rb.XXXXXX)"; chmod 0600 "$PWFILE"
printf 'NEWPW=%s\n' "$OLD_DB_PASSWORD" > "$PWFILE"
docker exec -i --env-file "$PWFILE" gacp-postgres \
    psql -U <ผู้ใช้ฐานข้อมูล> -d postgres -v ON_ERROR_STOP=1 \
    -c "\\set newpw \`printf '%s' \"\$NEWPW\"\`" \
    -c "ALTER USER \"<ผู้ใช้ฐานข้อมูล>\" PASSWORD :'newpw';"
shred -u "$PWFILE" 2>/dev/null || rm -f "$PWFILE"

# 2. คืนไฟล์ env จากที่สำรองไว้ในข้อ 2.2
ls -lt /var/backups/gacp/env-rotations/ | head -5
sudo cp /var/backups/gacp/env-rotations/.env.production-<TIMESTAMP>.bak /opt/gacp-platform/.env.production
sudo cp /var/backups/gacp/env-rotations/.env.staging-<TIMESTAMP>.bak    /opt/gacp-platform/.env.staging
sudo chmod 0600 /opt/gacp-platform/.env.production /opt/gacp-platform/.env.staging

# 3. recreate ทั้งสองสแตกอีกครั้ง (คำสั่งเดียวกับขั้นที่ 4)
# 4. รัน checklist ข้อ 7 ซ้ำทั้งหมด
```

### 8.2 อาการพังแบบที่สอง เผลอตั้งรหัสเป็นค่าว่าง

อาการ `/api/health` คืน 503 ทั้งสองสแตก และ log ของ backend ขึ้นข้อความยืนยันตัวตนล้มเหลว
วิธีแก้คือ `ALTER USER` ตั้งรหัสใหม่ทันทีตามข้อ 5 ขั้นที่ 3

ถ้าเข้า psql ไม่ได้เพราะรหัสว่าง ให้ลองต่อผ่าน unix socket ภายในคอนเทนเนอร์
ซึ่งมักตั้งเป็น trust ในอิมเมจ postgres

```bash
docker exec -it gacp-postgres psql -U <ผู้ใช้ฐานข้อมูล> -d postgres
```

ถ้ายังเข้าไม่ได้ ให้ดูว่า pg_hba อนุญาตอะไรบ้าง แล้วค่อยตัดสินใจ

```bash
docker exec gacp-postgres cat /var/lib/postgresql/data/pg_hba.conf
```

**เรื่องนี้ตรวจจากรีโปไม่ได้** ค่า pg_hba ถูกสร้างโดยอิมเมจตอน initdb ไม่มีในรีโป

### 8.3 อาการพังแบบที่สาม ไม่มีรหัสเดิมแล้ว

ยังกู้ได้ เพราะการเข้าถึงผ่าน unix socket ในคอนเทนเนอร์ไม่ต้องใช้รหัส (ยืนยันตามข้อ 8.2)
ให้ตั้งรหัสใหม่ที่รู้ค่า แล้วเดินขั้นที่ 2 ถึงขั้นที่ 5 ใหม่ทั้งชุด
ไม่ต้อง restore ฐานข้อมูล เพราะไม่มีข้อมูลเสียหาย เสียแค่การเข้าถึง

### 8.4 ถ้าข้อมูลเสียหายจริง

```bash
ls -lt /var/backups/gacp/scheduled/daily/ | head -5
sudo env DB_NAME=gacp_db bash /opt/gacp-platform/scripts/backup/pg-backup.sh --restore /var/backups/gacp/scheduled/daily/<ไฟล์>
```

> **แก้ 2026-08-13 — ต้องใส่ `DB_NAME` เอง** เดิมเขียนว่า `sudo bash … --restore …` เฉย ๆ
> ซึ่งพึ่งค่า default ของสคริปต์ · `sudo` ตัด environment ทิ้งอยู่แล้ว จึงต้องใช้ `sudo env VAR=…`
> ตอนนี้สคริปต์**ปฏิเสธการรันถ้าไม่ระบุชื่อฐาน** เพราะมีคู่มือสองเล่มส่งคนมาที่คำสั่งเดียวกัน
> เพื่อกู้คนละฐาน (เล่มนี้ = `gacp_db` · `deploy-staging-manual.md` = `gacp_staging`)
> การพึ่ง default จึงเป็นการโยนหัวก้อยตอนเกิดเหตุ — `reports/risk-assessment/2026-08-13.md` §4 R2

คำสั่ง restore อยู่ที่ `scripts/backup/pg-backup.sh` ในบล็อก `--restore` (ราวบรรทัด 58-104)
และจะเขียนทับข้อมูลทั้งฐาน อ่านคำเตือนก่อนกด · ไฟล์ที่ใช้ได้กับเส้นทางนี้คือ `*.sql.gz` เท่านั้น
ไฟล์ `*.dump` ใน `/opt/gacp-platform/backups/` เป็น `pg_dump -Fc` ต้องใช้ `pg_restore`

---

## 9. หมายเหตุเรื่อง monitoring ห้ามพึ่ง alert

**ตอนนี้ไม่มีกฎ alert ข้อไหนทำงานอยู่เลย** ต่อให้ระบบล่มทั้งระบบก็ไม่มีอะไรแจ้ง
นี่คือเหตุผลตรง ๆ ที่รอบที่แล้วไม่มีใครรู้จนกระทั่งมีคนลอง login

หลักฐาน

- `docker-compose.production.yml:407` mount เข้าไปให้ prometheus **เฉพาะ**
  `./monitoring/prometheus.yml` ไฟล์เดียว
- `monitoring/prometheus.yml` **ไม่มี** ทั้ง `rule_files:` และ `alerting:` block
  (`grep -n 'rule_files\|alerting' monitoring/prometheus.yml` ได้ศูนย์ผลลัพธ์)
- **ไม่มี service ชื่อ `alertmanager` ในไฟล์ compose ใดที่ใช้ deploy จริง**
  มีเฉพาะในสแตกแยกที่ไม่ได้ deploy ตามที่บันทึกไว้แล้วที่
  `docs/architecture/2026-04-28-server-hygiene-review.md:144` และ
  the third-party services review:332`
- ผลคือกฎ alert **19 ข้อ** ใน `monitoring/alerts.yml` **ไม่เคยถูกโหลด**
  รวมถึงสองข้อที่ตรงกับเหตุการณ์นี้พอดีคือ
  `BackendDown` ที่ `monitoring/alerts.yml:32` และ
  `DatabaseDown` ที่ `monitoring/alerts.yml:43`
- ไม่มีตัวจัดการสถานะ unhealthy ของคอนเทนเนอร์ (`git grep -i autoheal` ได้ศูนย์ผลลัพธ์)
  คอนเทนเนอร์ที่ healthcheck ตกจะอยู่เฉย ๆ ต่อไป

**สิ่งที่ต้องทำแทน** จนกว่าจะแก้เรื่อง monitoring เสร็จ

1. ทำ checklist ข้อ 7 ให้ครบทุกข้อ ห้ามข้ามข้อไหน
2. หลังจบงาน ให้เฝ้าดูอย่างน้อย 30 นาที และรันข้อ 7.4 กับ 7.5 ซ้ำอีกครั้ง
   เพราะการเชื่อมต่อที่เปิดค้างอยู่จะทยอยหมดอายุในช่วงนี้
3. แจ้งทีมว่าเพิ่งหมุนรหัส เพื่อให้มีคนเจอปัญหาแทนที่จะเป็นผู้ใช้จริง

---

## 10. เอกสารที่เกี่ยวข้อง

- `docs/operations/env-layering.md` ค่า env มาจากชั้นไหน ชั้นไหนทับชั้นไหน
- `docs/operations/runbooks/secret-rotation.md` การหมุนความลับตัวอื่นที่ทำอัตโนมัติได้
- `docs/operations/staging-activation.md` ที่มาของ `.env.staging` และของ `STAGING_DB_NAME`
- `scripts/deploy/deploy-staging.sh` เส้นทาง deploy ของ staging ที่กินค่าจาก `.env.staging`
- `scripts/backup/pg-backup.sh` สำรองและกู้คืนฐานข้อมูล
