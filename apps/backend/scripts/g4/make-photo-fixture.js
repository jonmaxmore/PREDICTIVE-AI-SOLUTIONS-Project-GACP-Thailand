#!/usr/bin/env node
'use strict';
/**
 * Build one labelled JPEG for the on-site audit walk.
 *
 * The evidence gate demands ≥5 FarmAuditPhoto rows (audit-onsite-service.js
 * DEFAULT_MIN_PHOTOS = 5), and the field app sends the device's GPS alongside each
 * upload — coordinates come from the auditor's (granted) geolocation, not from the
 * image, so the image's job is to be a real photograph-shaped file a human can open
 * and recognise, not a pixel. Each frame states in Thai WHAT it depicts and that it
 * is walk fixture material, for the same reason the PDF fixtures do: a file standing
 * in an official audit trail must say on its face what it is.
 *
 * Usage: node scripts/g4/make-photo-fixture.js <out.jpg> <label> <sublabel>
 */
const path = require('path');
const sharp = require('sharp');

async function main() {
    const [outPath, label, sublabel] = process.argv.slice(2);
    if (!outPath || !label) {
        console.error('usage: make-photo-fixture.js <out.jpg> <label> [sublabel]');
        process.exit(2);
    }
    // Different hue per label so the five photos are visually distinct in the report.
    let hash = 0;
    for (const ch of label) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
    const hue = hash % 360;

    const svg = `<svg width="1200" height="900" xmlns="http://www.w3.org/2000/svg">
      <defs>
        <linearGradient id="g" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stop-color="hsl(${hue},45%,72%)"/>
          <stop offset="1" stop-color="hsl(${hue},50%,38%)"/>
        </linearGradient>
      </defs>
      <rect width="1200" height="900" fill="url(#g)"/>
      <rect x="60" y="330" width="1080" height="240" rx="24" fill="rgba(255,255,255,0.88)"/>
      <text x="600" y="430" text-anchor="middle" font-family="Leelawadee UI, Tahoma, sans-serif"
            font-size="64" font-weight="bold" fill="#1a3a2a">${label}</text>
      <text x="600" y="510" text-anchor="middle" font-family="Leelawadee UI, Tahoma, sans-serif"
            font-size="34" fill="#41594c">${sublabel || ''}</text>
      <text x="600" y="860" text-anchor="middle" font-family="Leelawadee UI, Tahoma, sans-serif"
            font-size="26" fill="rgba(255,255,255,0.92)">ภาพชุดทดสอบระบบ (G4) — ใช้สำหรับการเดินระบบจริงเท่านั้น</text>
    </svg>`;

    await sharp(Buffer.from(svg)).jpeg({ quality: 88 }).toFile(outPath);
    console.log(`${path.basename(outPath)} written`);
}

main().catch((e) => { console.error('FATAL:', e.message); process.exit(1); });
