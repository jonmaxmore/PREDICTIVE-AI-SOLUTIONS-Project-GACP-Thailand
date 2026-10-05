#!/usr/bin/env bash
# Pilot — fetch CC BY 4.0 plant-disease image datasets (ต้นแบบ 6).
# แพลตฟอร์ม GACP ประเทศไทย · สัญญา C05F680149
#
# ⚠️ ดาวน์โหลดเฉพาะชุด "ลิขสิทธิ์เปิด CC BY 4.0" เท่านั้น (ดู pilot-image-datasets-manifest.md).
#    ต้องได้รับอนุมัติจาก owner ก่อนรัน. ไฟล์ภาพ (หลาย GB) เก็บนอก repo — ห้าม commit.
#
# usage: bash scripts/pilot/fetch-clean-datasets.sh <OUT_DIR>
set -u
OUT="${1:-./pilot-datasets}"
mkdir -p "$OUT"
echo "→ output: $OUT"

# each: id | version | dir | title | mendeley-id (blank = git)
write_source () { # dir | title | url | license
  printf 'title: %s\nurl: %s\nlicense: %s\nfetched_by: fetch-clean-datasets.sh\n' "$2" "$3" "$4" > "$1/SOURCE.txt"
}

# ---- D3 PlantDoc (git clone — reliable) ----
D3="$OUT/D3-PlantDoc"
if [ ! -d "$D3/.git" ]; then
  echo "→ D3 PlantDoc (git clone)…"
  git clone --depth 1 https://github.com/pratikkayal/PlantDoc-Dataset "$D3" \
    && write_source "$D3" "PlantDoc-Dataset" "https://github.com/pratikkayal/PlantDoc-Dataset" "CC BY 4.0"
else echo "→ D3 exists, skip"; fi

# ---- D1/D2/D4/D5 Mendeley (public-api attempt → manual fallback) ----
# Mendeley Data programmatic download is unreliable without file UUIDs/auth.
# The script prepares the dir + SOURCE.txt and TRIES the public file API;
# if it fails, download manually via the DOI "Download All" button.
mendeley () { # dir | id | version | title
  local dir="$OUT/$1" id="$2" ver="$3" title="$4"
  mkdir -p "$dir"
  write_source "$dir" "$title" "https://data.mendeley.com/datasets/$id/$ver" "CC BY 4.0"
  echo "→ ${1} (Mendeley $id v$ver): trying public file API…"
  # best-effort: list files, download each download_url if present
  local api="https://data.mendeley.com/public-api/datasets/$id/files?version=$ver&folder_id="
  if curl -fsSL "$api" -o "$dir/_files.json" 2>/dev/null && grep -q download "$dir/_files.json" 2>/dev/null; then
    # extract download_url + filename (best-effort; adjust if API shape changes)
    node -e '
      const fs=require("fs");const d=process.argv[1];
      let a; try{a=JSON.parse(fs.readFileSync(d+"/_files.json","utf8"))}catch(e){process.exit(3)}
      const files=Array.isArray(a)?a:(a.results||a.files||[]);
      let n=0; for(const f of files){const u=(f.content_details&&f.content_details.download_url)||f.download_url;const nm=(f.filename||f.name||("file"+(n++)));if(u)console.log(u+"\t"+nm);}
    ' "$dir" 2>/dev/null | while IFS=$'\t' read -r url name; do
      [ -n "$url" ] && echo "   ↓ $name" && curl -fsSL "$url" -o "$dir/$name"
    done
    echo "   ✓ ${1} done (verify contents)"
  else
    echo "   ⚠ API unavailable → ดาวน์โหลดด้วยมือ: เปิด https://data.mendeley.com/datasets/$id/$ver แล้วกด 'Download All' วางไฟล์ใน $dir/"
  fi
}

mendeley "D1-Turmeric-LeafDisease"       jtttfbx342  1 "Turmeric Leaf Disease Detection"
mendeley "D2-Turmeric-PlantDisease-Rhizome" g46dvrcvwn 2 "Turmeric Plant Disease (incl. rhizome)"
mendeley "D4-CropPest-Disease"           bwh3zbpkpv  1 "Dataset for Crop Pest and Disease Detection"
mendeley "D5-ThaiMedicinalPlants"        7ygxpxk7tx  1 "Thai Medicinal Plants Leaf (13 species incl. kratom)"

echo ""
echo "✔ done. ต่อไป: verify ชื่อโฟลเดอร์คลาสจริง → map เข้า enum ตาม pilot-image-datasets-manifest.md §2"
echo "  ห้าม commit ไฟล์ภาพลง git; เก็บ SOURCE.txt (attribution CC BY 4.0) ไว้คู่ข้อมูลเสมอ"
