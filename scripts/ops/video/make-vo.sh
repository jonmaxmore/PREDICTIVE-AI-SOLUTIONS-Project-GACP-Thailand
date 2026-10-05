#!/usr/bin/env bash
# make-vo.sh — สังเคราะห์เสียงพากย์ไทย (Microsoft neural TTS ผ่าน edge-tts)
# รันบนเครื่อง staging (ต้องมี internet + python3) — ผลลัพธ์: ~/gacp-vo.tar.gz (ไฟล์เสียง 14 ท่อน ~3MB)
# Usage: bash scripts/ops/video/make-vo.sh   [VOICE=th-TH-NiwatNeural สำหรับเสียงผู้ชาย]
set -euo pipefail
VOICE="${VOICE:-th-TH-PremwadeeNeural}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT=/tmp/gacp-vo
rm -rf "$OUT" && mkdir -p "$OUT"

python3 -m pip install --user -q edge-tts 2>/dev/null || pip3 install -q edge-tts
EDGE="python3 -m edge_tts"

echo "[make-vo] voice=$VOICE"
while IFS='|' read -r NUM TEXT; do
  [ -z "${NUM// }" ] && continue
  echo "[make-vo] scene $NUM ..."
  $EDGE --voice "$VOICE" --rate=-8% --text "$TEXT" --write-media "$OUT/vo-$NUM.mp3"
done < "$SCRIPT_DIR/vo-script.txt"

COUNT=$(ls "$OUT"/vo-*.mp3 | wc -l)
tar czf "$HOME/gacp-vo.tar.gz" -C "$OUT" .
echo "[make-vo] done: $COUNT clips -> $HOME/gacp-vo.tar.gz ($(du -h "$HOME/gacp-vo.tar.gz" | cut -f1))"
