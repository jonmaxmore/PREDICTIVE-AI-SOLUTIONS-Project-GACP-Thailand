#!/usr/bin/env bash
# bootstrap-staging-runner.sh — one-shot สำหรับ operator รันบนเครื่อง staging
# ทำ 2 อย่าง: (1) เคลียร์ stack production ที่ไม่ใช้ (operator ยืนยัน 2026-08-06: ยังไม่มี production จริง)
#            (2) ติดตั้ง GitHub self-hosted runner เป็น service
#
# วิธีใช้ (ต้อง sudo):
#   sudo bash bootstrap-staging-runner.sh <RUNNER_TOKEN>
# เอา <RUNNER_TOKEN> จาก: repo → Settings → Actions → Runners → New self-hosted runner (Linux x64)
# (token อายุ ~1 ชม. ใช้ลงทะเบียนครั้งเดียว — ไม่ใช่ secret ระยะยาว)
#
# ปลอดภัย: ไม่แตะ stack/volume ของ staging · ลบ volume production เฉพาะเมื่อใส่ WIPE_PROD_VOLUMES=1
set -euo pipefail

REPO_URL="https://github.com/jonmaxmore/GACP-Certification-Application"
RUNNER_DIR="/opt/actions-runner"
RUNNER_USER="runner"
COMPOSE_DIR="${COMPOSE_DIR:-/opt/gacp-platform}"
TOKEN="${1:-}"

[ -z "$TOKEN" ] && { echo "usage: sudo bash $0 <RUNNER_TOKEN>  (ดูวิธีเอา token ในหัวไฟล์)"; exit 2; }
[ "$(id -u)" -ne 0 ] && { echo "ต้องรันด้วย sudo"; exit 2; }
command -v docker >/dev/null || { echo "ไม่พบ docker บนเครื่องนี้ — ติดตั้งก่อน"; exit 2; }

echo "== [1/5] สถานะ container ปัจจุบัน =="
docker ps -a --format 'table {{.Names}}\t{{.Status}}\t{{.Image}}' || true
df -h / | tail -1

echo "== [2/5] เคลียร์ stack production (ไม่แตะ staging) =="
if [ -f "$COMPOSE_DIR/docker-compose.production.yml" ]; then
  ( cd "$COMPOSE_DIR"
    docker compose -f docker-compose.production.yml down --remove-orphans || true
    if [ "${WIPE_PROD_VOLUMES:-0}" = "1" ]; then
      echo "  -> WIPE_PROD_VOLUMES=1: ลบ volume ฝั่ง production ด้วย (ย้อนไม่ได้)"
      docker compose -f docker-compose.production.yml down -v || true
    else
      echo "  -> คง volume ไว้ (ลบภายหลังด้วย WIPE_PROD_VOLUMES=1 ถ้าแน่ใจ)"
    fi )
else
  echo "  -> ไม่พบ $COMPOSE_DIR/docker-compose.production.yml — ข้าม (ตั้ง COMPOSE_DIR=<path> ถ้าอยู่ที่อื่น)"
fi
docker image prune -af --filter "until=168h" || true

echo "== [3/5] เตรียม user + ดาวน์โหลด runner =="
id "$RUNNER_USER" >/dev/null 2>&1 || useradd -m -s /bin/bash "$RUNNER_USER"
usermod -aG docker "$RUNNER_USER"
mkdir -p "$RUNNER_DIR" && chown "$RUNNER_USER:$RUNNER_USER" "$RUNNER_DIR"
LATEST=$(curl -fsSL https://api.github.com/repos/actions/runner/releases/latest | grep -oP '"tag_name":\s*"v\K[0-9.]+' | head -1)
[ -z "$LATEST" ] && { echo "ดึงเวอร์ชัน runner ล่าสุดไม่ได้ — ตรวจเน็ตของเครื่อง"; exit 1; }
sudo -u "$RUNNER_USER" bash -c "
  cd '$RUNNER_DIR'
  [ -f config.sh ] || { curl -fsSL -o r.tar.gz https://github.com/actions/runner/releases/download/v${LATEST}/actions-runner-linux-x64-${LATEST}.tar.gz && tar xzf r.tar.gz && rm r.tar.gz; }
"

echo "== [4/5] ลงทะเบียนกับ repo =="
sudo -u "$RUNNER_USER" bash -c "
  cd '$RUNNER_DIR'
  ./config.sh --url '$REPO_URL' --token '$TOKEN' --name gacp-staging-runner --labels self-hosted,linux,x64 --unattended
"

echo "== [5/5] ติดตั้งเป็น service + start =="
( cd "$RUNNER_DIR" && ./svc.sh install "$RUNNER_USER" && ./svc.sh start && ./svc.sh status || true )

echo ""
echo "เสร็จ — ตรวจที่ $REPO_URL/settings/actions/runners ต้องเห็น gacp-staging-runner สถานะ Idle (เขียว)"
echo "ขั้นถัดไป: merge PR #819 (ci.yml ชี้ self-hosted แล้ว) แล้ว re-run workflow บน main ให้เขียว 1 ครั้ง"
