# Runbook — full gate on the gate/staging machine (no GitHub Actions)

**เพราะอะไร:** สิ่งที่ CI มีแล้วเราไม่มี คือ *เครื่องที่มี Postgres จริง + Prisma engine + egress เปิด*
เครื่อง staging มีครบทั้งสามอย่าง ⇒ ย้าย gate ไปรันที่นั่น แทนที่จะรอ Actions

**ข้อจำกัดที่ต้องรู้ก่อนใช้:** gate นี้ **ไม่ได้ห้าม** ใครก็ตาม merge โดยไม่รันมัน — branch protection
ตั้งไม่ได้บนแพลนปัจจุบัน สิ่งที่ได้คือ *ตรวจจับได้ 100% และซ่อนไม่ได้*
(`scripts/probes/gate-attestation.sh` ผูกกับ SHA · `scripts/probes/main-attestation-audit.sh` ไล่ย้อน main)

---

## ต้องมีบนเครื่องก่อน (ครั้งเดียว)

| ของ | ใช้ทำอะไร | ไม่มีแล้วเป็นยังไง |
|---|---|---|
| `node`, `pnpm` | install + jest + prisma | preflight 1 หยุดตั้งแต่ยังไม่แตะอะไร: **exit 3** พร้อมชื่อเครื่องมือที่ขาด |
| `evidence/` ที่ user นี้เขียนได้ | log ของทุกเช็ก + attestation | preflight 2 เขียนไฟล์จริงแล้วลบเพื่อพิสูจน์ (ไม่ใช่แค่ `[ -w ]`) — เขียนไม่ได้ = **exit 3** ไม่ใช่ FAIL |
| Postgres + `psql`/สิทธิ์ `CREATE DATABASE` | สร้าง scratch DB ต่อรอบ | preflight 3 ยิง `SELECT 1` ก่อนสร้าง worktree — ต่อไม่ได้ = **exit 3** พร้อมบอกให้ตั้ง `GATE_PG_ADMIN_URL` · **ข้อยกเว้นที่รู้ตัว**: ต่อได้แต่ `CREATE DATABASE` ไม่ผ่าน หรือ `git worktree add` ล้ม = ยัง **exit 2** (เป็นปัญหาเครื่องเหมือนกัน แต่ขับด้วย `--selftest` ไม่ได้เพราะต้องมี Postgres จริง จึงยังไม่แปลง — เขียนไว้ดีกว่าปล่อยให้เอกสารผิด) |
| `gitleaks` บน PATH | deep secret scan (ชั้น 2) | `secret-scan-deep` = **NOT-RUN** ⇒ verdict FAIL (fail-closed) จนกว่าจะติดตั้ง หรือ operator ยอมรับด้วย `--allow-blocked` ซึ่งถูกบันทึกลง attestation · หนี้ก้อนนี้ค้างอยู่แล้วที่ the backlog` |

`GATE_PG_ADMIN_URL` = connection string ที่ต่อ DB `postgres` ได้ (ใช้ `CREATE DATABASE`/`DROP DATABASE`)
ถ้าไม่ตั้ง สคริปต์จะใช้ตัวแปร libpq ปกติ (`PGHOST`/`PGUSER`/`PGPORT`) แทน

**Law L3 — สคริปต์บังคับเอง ไม่ใช่ความจำคน:** ชื่อ DB ต้องตรง `^gacp_gate_[0-9a-z_]+$` (allowlist)
`gacp_db` / `gacp_staging` = abort ทันที · scratch DB ถูก `DROP` ใน trap EXIT ทุกทางออก

---

## 3 คำสั่ง (รันจากในโฟลเดอร์ repo บนเครื่อง staging — โฟลเดอร์ไหนก็ได้ที่ `git status` ทำงาน)

```bash
# 1. เอาโค้ดที่จะ gate มา (เปลี่ยนชื่อ branch ได้ตามใบงาน)
git fetch origin && git checkout feat/full-gate-offline && git pull --ff-only

# 2+3 เป็นคำสั่งเดียวโดยตั้งใจ — gate ไม่ผ่าน = ไม่ commit อะไรเลย
#     (เดิมสองบรรทัดนี้แยกกัน ไม่มี `&&` ⇒ gate ABORT ด้วย exit 3 แล้ว commit ยังเดินต่อ
#      และ gate-attestation.sh ไม่นับไฟล์ใต้ evidence/gate/ ⇒ attestation ของ commit ก่อนหน้า
#      จะดู "ครอบ" HEAD ใหม่ได้ทั้งที่ไม่มีการ gate เกิดขึ้นจริง)
bash scripts/ci/full-gate.sh \
  && SHA="$(git rev-parse HEAD)" \
  && test -f "evidence/gate/$SHA.json" \
  && git add evidence/gate \
  && git commit -m "chore(gate): full-gate attestation" -m "Gate-Attestation: $SHA" \
  && git push
```

คำสั่งที่ 2 พิมพ์สามกองเสมอ: `PASS` / `FAIL` / `NOT-RUN` (พร้อมเหตุผลรายตัว)
และ exit 0 **เฉพาะ**เมื่อเช็กที่ `required` ทุกตัว PASS

ผลลัพธ์ที่ commit: `evidence/gate/<sha>.json` + log ดิบ `evidence/gate/logs/<sha>/<check>.log`
+ ผลละเอียดของ probe/jest ที่ `evidence/gate/logs/<sha>/artifacts/` (อยู่นอก worktree ชั่วคราว จึงไม่ถูกลบตอนจบรอบ)

exit 3 (ABORT) = ไม่มีเช็กไหนได้รัน ⇒ **ไม่มี attestation และ log ของรอบนั้นถูกลบทิ้ง** เหลือ `ABORTED.txt` แทน — ไม่มีอะไรให้ commit

> ทำไมต้อง commit จากเครื่อง staging: attestation ผูกกับ SHA เป๊ะ การ scp ไปเครื่องอื่นแล้วค่อย commit
> เพิ่มขั้นตอนที่ทำให้ไฟล์กับ commit หลุดกันได้ · การ commit ไฟล์นี้จะเลื่อน HEAD ไปอีกหนึ่ง commit
> ซึ่ง `gate-attestation` รองรับไว้แล้ว: attestation ของ commit ก่อนหน้ายังนับ ถ้าสิ่งที่เปลี่ยนหลังจากนั้น
> มีแต่ไฟล์ใน `evidence/gate/` เท่านั้น (แตะโค้ดแม้ไบต์เดียว = ต้องรันใหม่)

---

## อ่านผล

```bash
bash scripts/probes/gate-attestation.sh        # HEAD นี้มี attestation ที่ใช้ได้ไหม
bash scripts/probes/main-attestation-audit.sh  # commit บน main ตัวไหนที่ไม่มี
```

| อาการ | แปลว่า | ทำอะไร |
|---|---|---|
| `full-gate: ABORT — infra failure ... (exit 3)` | **ไม่มีเช็กไหนได้รัน** — เครื่องเขียน evidence ไม่ได้ / เครื่องมือขาด / Postgres ไม่ตอบ · ไม่ใช่ผลตรวจ commit จึงไม่มี attestation ถูกเขียน | ทำตามบรรทัด `fix:` ที่สคริปต์พิมพ์ (ก๊อปวางได้) แล้วรันใหม่ · เคสที่เจอจริงรอบแรก: `evidence/` เป็นของ root ⇒ `sudo chown -R "$(id -un)":"$(id -gn)" <repo>/evidence` |
| `verdict: FAIL` + มีชื่อเช็กในกอง FAIL | เช็กนั้นรันแล้วแดงจริง | เปิด `evidence/gate/logs/<sha>/<check>.log` แล้วแก้ — **ยอมรับไม่ได้ทุกกรณี** `--allow-blocked` ไม่ครอบ FAIL |
| `verdict: FAIL` + เช็ก required อยู่ในกอง NOT-RUN | เครื่องมือไม่มี/รันไม่ได้ | ติดตั้งเครื่องมือแล้วรันใหม่ · หรือ `bash scripts/ci/full-gate.sh --allow-blocked "<ชื่อคุณ>: <เหตุผล>"` — ชื่อ+เหตุผลถูกเขียนลง attestation และ `gate-attestation` จะประกาศออกมาทุกครั้ง |
| `money-equation-real` / `drain-complete-real` อยู่ในกอง NOT-RUN เสมอ | ตั้งใจ — scratch DB มี 0 แถวเงิน; `PASS` ที่นั่นแปลว่า "ตรวจ 0 แถว" ไม่ใช่ "ไม่มีปัญหา" และการชี้ไป prod ผิด Law L3 | ไม่ต้องทำอะไร · ถ้าจะรันจริงต้องมีแถวจริง (`FULL_GATE_RUN_MONEY_PROBES=1`) และสคริปต์ยังบังคับ `rows_examined > 0` อยู่ดี |
| `integration-no-skip` ขึ้น FAIL แต่ verdict ยัง PASS | เป็น `advisory` — ยังไม่มี baseline ที่ operator เซ็น | ดูตัวเลข pending ใน log; จะบังคับเมื่อไหร่ให้แก้ `advisory`→`required` ที่ `scripts/ci/full-gate-checks.txt` |

---

## แก้ชุดเช็ก

`scripts/ci/full-gate-checks.txt` คือรายการเดียว ทั้งตัวรัน (`full-gate.sh`) และตัวตรวจ
(`gate-attestation.sh`) อ่านไฟล์นี้ไฟล์เดียว — เพิ่ม/ลด/เลื่อนชั้นเช็กที่นั่นที่เดียว

ตรวจว่ากลไกยังทำงาน (ไม่ต้องมี DB):

```bash
bash scripts/ci/full-gate.sh --selftest
bash scripts/probes/gate-attestation.sh --selftest
bash scripts/probes/main-attestation-audit.sh --selftest
```
