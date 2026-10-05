# Runbook — สำรองและกู้คืนฐานข้อมูล (เครื่อง staging)

**เพราะอะไร:** ก่อน 2026-08-08 ระบบนี้ **ไม่มีการสำรองข้อมูลอัตโนมัติเลย** — มีแค่ dump
ที่คนสั่งมือก่อน deploy สามครั้ง ไฟล์ใหม่สุดลงวันที่ 8 มิถุนายน (เก่ากว่าสองเดือน) และ
`crontab -l` ของทั้ง `ubuntu` และ `root` ไม่มีรายการ backup แม้แต่บรรทัดเดียว
`GOALS.md:18` บันทึกไว้ว่า *"backup ไม่เคยพิสูจน์ restore"* — ความจริงหนักกว่านั้นคือมันไม่ได้ทำงานด้วยซ้ำ

**หลักการของหน้านี้:** ไฟล์ที่กู้ไม่ได้ไม่ใช่ backup · การมีไฟล์ไม่ใช่หลักฐาน
**หลักฐานคือการกู้กลับมาแล้วนับแถวได้ตรง**

**จังหวะที่ควรซ้อม:** ตอนนี้ระบบเป็น beta ยังไม่มีผู้ใช้จริง ⇒ การซ้อมกู้ที่ล้มเหลว
มีราคาเท่ากับ "ทำข้อมูลตัวอย่างใหม่" **นี่คือช่วงเวลาเดียวที่ซ้อมได้ฟรี** เมื่อมีเกษตรกรจริง
ราคาจะเปลี่ยนเป็น "ข้อมูลผู้ใช้หาย" อย่างถาวร

---

## สิ่งที่ตั้งไว้แล้วบนเครื่อง (2026-08-08)

| | |
|---|---|
| สคริปต์ | `/usr/local/bin/gacp-backup.sh` — ต้นฉบับอยู่ในรีโปที่ `scripts/ops/gacp-backup.sh` |
| ตารางเวลา | crontab ของ `ubuntu`: `17 3 * * * /usr/local/bin/gacp-backup.sh >> /tmp/gacp-backup.log 2>&1` |
| ปลายทาง | `/opt/gacp-platform/backups/<db>_<YYYYMMDD_HHMMSS>.dump` |
| ครอบคลุม | **ฐานข้อมูล**: `gacp_db` (ฝั่ง `gacpth.com`) และ `gacp_staging` (ฝั่ง `staging.gacpth.com`) · **volume** (เพิ่ม 2026-08-13 — **7 ตัว** ตาม `scripts/ops/gacp-backup.sh:47`): `gacp-uploads-data`, `gacp-storage-data`, `gacp-signing-keys`, `gacp-minio-data`, `gacp-platform_gacp_staging_uploads`, `gacp-platform_gacp_staging_storage`, `gacp-platform_gacp_staging_signing_keys` · สามตัวหลังมาจาก `docker-compose.staging.yml:39-45` ที่ไม่ประกาศ `name:` ⇒ ชื่อจริงมี prefix ของ compose project ซึ่งอ่านจากรีโปไม่ได้ ต้องดูจาก `docker volume ls` บนเครื่อง |
| รูปแบบ | ฐานข้อมูล: `pg_dump -Fc` (custom) — `pg_restore` อ่านเลือกได้และรายงานรายการอ็อบเจ็กต์ในตัว · volume: `tar czf` เป็น `<volume>_<TS>.tgz` |
| เก็บย้อนหลัง | 30 วันทั้ง `.dump` และ `.tgz` · **เดิมเขียนว่า "ไฟล์ละ ~1 MB ⇒ ข้อจำกัดคือความรก ไม่ใช่พื้นที่" — ไม่จริงอีกต่อไปเมื่อรวม volume** ตรวจ `docker system df -v` ก่อนไว้ใจตัวเลขนี้ |

> **กับดักที่เจอจริงตอนติดตั้ง:** ถ้าตั้ง cron ก่อนสร้างสคริปต์ จะได้ **backup ที่ดูเหมือนมี
> แต่ไม่มี** ซึ่งแย่กว่าไม่มีเลย เพราะจะไปเชื่อมันตอนที่ต้องใช้จริง ⇒ ตรวจว่าไฟล์มีอยู่จริง
> ก่อนเสมอ: `ls -l /usr/local/bin/gacp-backup.sh`

## แก้สคริปต์แล้วต้องซิงก์ขึ้นเครื่อง

สคริปต์บนเครื่องเป็น **สำเนา** ของไฟล์ในรีโป แก้ในรีโปแล้วต้องคัดลอกขึ้นไป ไม่งั้นสองฝั่งจะห่างกัน:

```
cd /opt/gacp-platform && git pull
sudo install -m 0755 scripts/ops/gacp-backup.sh /usr/local/bin/gacp-backup.sh
/usr/local/bin/gacp-backup.sh
echo exit=$?
```

## ① ตรวจว่าการสำรองยังทำงานอยู่ (ทำเดือนละครั้ง)

```
ls -lh /opt/gacp-platform/backups/*.dump | tail -4
```
ต้องเห็นไฟล์ของ **ทั้งสองฐาน** ลงวันที่ไม่เกินเมื่อวาน และขนาดไม่ใช่ 0
ถ้าไม่มีของเมื่อคืน ให้ดู `/tmp/gacp-backup.log` แล้วรันสคริปต์ด้วยมือหนึ่งครั้งเพื่อดู error จริง

## ② ตรวจว่าไฟล์ไม่เน่า — ไม่ต้องกู้

```
LAST=$(ls -t /opt/gacp-platform/backups/gacp_db_*.dump | head -1)
docker exec -i gacp-postgres pg_restore --list < "$LAST" | wc -l
```
ได้ตัวเลขหลักร้อยขึ้นไป = ไฟล์สมบูรณ์ อ่านออก (ค่าอ้างอิงจากการวัดจริง 2026-08-08: **1064**)
ได้ `0` หรือขึ้น error = ไฟล์เสีย **หยุดแล้วแก้ก่อนทำอย่างอื่น**

ขั้นนี้ยังไม่ใช่การพิสูจน์ว่ากู้ได้ — แค่พิสูจน์ว่าไฟล์ไม่พัง

## ③ ซ้อมกู้จริง (ทำไตรมาสละครั้ง และก่อนย้ายเครื่องทุกครั้ง)

กู้เข้าฐานข้อมูลชั่วคราว → นับแถวเทียบกับของจริง → ลบทิ้ง
**เครื่องเป็นคนเทียบ ไม่ใช่คนอ่านด้วยตา** — เทียบด้วยตาเคยพลาดมาแล้ว

เปลี่ยน `gacp_db` เป็น `gacp_staging` เพื่อซ้อมอีกฝั่ง (ควรซ้อมทั้งสอง):

```
docker exec -i gacp-postgres psql -U gacp -d gacp_db -c 'CREATE DATABASE gacp_restore_drill'
L=$(ls -t /opt/gacp-platform/backups/gacp_db_*.dump | head -1)
docker exec -i gacp-postgres pg_restore -U gacp -d gacp_restore_drill --no-owner --no-privileges < "$L" 2>&1 | tail -3
docker exec -i gacp-postgres psql -U gacp -d gacp_db -c 'ANALYZE' > /dev/null
docker exec -i gacp-postgres psql -U gacp -d gacp_restore_drill -c 'ANALYZE' > /dev/null
docker exec -i gacp-postgres psql -U gacp -d gacp_db            -tAc "SELECT relname||'|'||n_live_tup FROM pg_stat_user_tables WHERE n_live_tup>0 ORDER BY 1" > /tmp/src.txt
docker exec -i gacp-postgres psql -U gacp -d gacp_restore_drill -tAc "SELECT relname||'|'||n_live_tup FROM pg_stat_user_tables WHERE n_live_tup>0 ORDER BY 1" > /tmp/dst.txt
diff /tmp/src.txt /tmp/dst.txt && echo "RESTORE DRILL: PASS" || echo "RESTORE DRILL: FAIL"
docker exec -i gacp-postgres psql -U gacp -d gacp_db -c 'DROP DATABASE gacp_restore_drill'
```

> **`ANALYZE` ทั้งสองฝั่งเป็นข้อบังคับ ไม่ใช่ของแถม** — `n_live_tup` เป็นค่าประมาณจาก
> ตัวเก็บสถิติและค้างได้นาน การซ้อมครั้งแรก 2026-08-08 ขึ้น FAIL เพราะ `ANALYZE` แค่ฝั่งที่กู้
> ทำให้ต้นฉบับรายงาน 16 ตาราง ส่วนฝั่งที่กู้รายงาน 25 ตาราง — **เทียบของสองอย่างด้วยไม้บรรทัด
> คนละอัน** ไม่ใช่ backup ผิด พอ `ANALYZE` ทั้งคู่แล้วได้ PASS ทันที
>
> ผลข้างเคียงที่สำคัญ: ตัวเลข "ระบบมีข้อมูลเท่าไร" ที่เคยอ่านจากสถิติเก่า **ต่ำกว่าความจริง**
> ก่อนอ้างตัวเลขจาก `pg_stat_user_tables` ที่ไหนก็ตาม ต้อง `ANALYZE` ก่อนเสมอ

**ผลที่บันทึกไว้ 2026-08-08 (ครั้งแรกที่โปรเจกต์นี้พิสูจน์ได้):**

| ฐานข้อมูล | ผล |
|---|---|
| `gacp_db` | `RESTORE DRILL: PASS` — 25 ตาราง ตรงกันทุกบรรทัด |
| `gacp_staging` | `STAGING RESTORE: PASS` — ตรงกันทุกบรรทัด |

## ④ กู้จริงตอนฉุกเฉิน

**หยุดอ่านแล้วคิดก่อนพิมพ์** — การเขียนทับฐานข้อมูลที่ใช้งานอยู่ย้อนกลับไม่ได้
ตาม the project rules L5 การกู้ของจริงเป็นของ operator เท่านั้น agent ห้ามรัน

ลำดับที่ปลอดภัย:

1. **สำรองสภาพปัจจุบันก่อน** แม้จะคิดว่าเสียแล้ว — `/usr/local/bin/gacp-backup.sh`
   สภาพที่พังคือหลักฐานของเหตุการณ์ และบางทีเสียแค่บางส่วน
2. หยุดแอปที่เขียนลงฐานนั้น (`docker stop gacp-backend` หรือ `gacp-backend-staging`
   ตามฝั่งที่กู้ — ดู `docs/operations/staging-box-topology.md` ว่าฐานไหนคู่กับคอนเทนเนอร์ไหน)
3. กู้เข้า **ฐานใหม่ชื่ออื่นก่อนเสมอ** แล้วตรวจด้วยขั้นตอน ③ — **ห้ามกู้ทับฐานเดิมโดยตรง**
4. ตรวจแล้วพอใจจึงค่อยสลับชื่อฐาน แล้วสตาร์ตแอปกลับ
5. บันทึกเหตุการณ์ลง the change log — เวลา สาเหตุ ไฟล์ที่ใช้ ผลการนับแถว

## สิ่งที่ยังไม่ได้ทำ (บันทึกไว้ให้ตรงความจริง)

- **ไม่มีสำเนานอกเครื่อง** — dump อยู่บนดิสก์ก้อนเดียวกับฐานข้อมูล ⇒ ดิสก์เสียหรือเครื่องหาย
  = หายทั้งคู่ · แก้ได้ด้วยการส่งขึ้น `gacp-minio` หรือที่เก็บนอกเครื่อง แต่ยัง **ไม่ได้ทำ**
- **ไม่มีการแจ้งเตือนเมื่อ backup ล้ม** — cron เขียนลง `/tmp/gacp-backup.log` เท่านั้น
  ถ้าล้มติดกันหลายคืนจะไม่มีใครรู้จนกว่าจะมาเปิดดู
- ~~ไฟล์ที่ผู้ใช้อัปโหลดไม่ถูกสำรอง~~ — **แก้แล้ว 2026-08-13** ครอบ 7 volume:
  production `gacp-uploads-data`, `gacp-storage-data`, `gacp-signing-keys`, `gacp-minio-data`
  และ staging `gacp-platform_gacp_staging_{uploads,storage,signing_keys}`
  (ชื่อฝั่ง staging ยืนยันจาก `docker volume ls` บนเครื่องจริง — `docker-compose.staging.yml:39-45`
  ไม่ประกาศ `name:` จึงเดาจากรีโปไม่ได้) · **ยังไม่เคยซ้อมกู้ tarball** ดูข้อถัดไป
- **ยังไม่มีขั้นตอนกู้ volume** — §③ และ §④ ครอบเฉพาะฐานข้อมูล · การกู้ tarball คือ
  `docker run --rm -v <volume>:/dst -v /opt/gacp-platform/backups:/src alpine:3.20 sh -c 'cd /dst && tar xzf /src/<file>.tgz'`
  **ยังไม่เคยซ้อม** — อย่าเพิ่งนับว่าใช้ได้จนกว่าจะซ้อมจริงเหมือนที่ทำกับฐานข้อมูล 2026-08-08
- **ยังไม่ได้จับเวลา** — `GOALS.md:50` ขอ restore drill แบบจับเวลา ครั้งนี้พิสูจน์ความถูกต้อง
  แล้วแต่ยังไม่ได้วัดว่าใช้เวลาเท่าไร ซึ่งเป็นตัวเลขที่ต้องรู้ก่อนสัญญา RTO กับใคร

สามข้อแรกสำคัญขึ้นมากเมื่อมีผู้ใช้จริง — ตอนนี้ยังรับได้เพราะเป็น beta
