'use strict';

/**
 * Generate the Data Dictionary file
 * ("คู่มือการใช้ชุดข้อมูล: ความหมายของ data field, หน่วยนับ — 1 เล่ม/ไฟล์").
 *
 * Run: node apps/backend/scripts/generate-data-dictionary.js
 * Output: docs/data/data-dictionary.md (repo root)
 *
 * Reads the SAME dataset-domains.js config the export endpoints use, so the
 * manual can never drift from the actual export shape (guarded further by the
 * DMMF static test in __tests__/unit/dataset-export-service.test.js).
 */

// services/prisma-database process.exit(1)s without DATABASE_URL; the
// dictionary builder never touches the DB, so a placeholder is safe here.
process.env.DATABASE_URL = process.env.DATABASE_URL
    || 'postgresql://placeholder:placeholder@localhost:5432/placeholder';

const fs = require('fs');
const path = require('path');
const { generateDataDictionaryMarkdown } = require('../services/dataset-export-service');

const outPath = path.resolve(__dirname, '../../../docs/data/data-dictionary.md');
fs.mkdirSync(path.dirname(outPath), { recursive: true });
fs.writeFileSync(outPath, generateDataDictionaryMarkdown(), 'utf8');
console.log(`[data-dictionary] written: ${outPath}`);
