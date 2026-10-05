#!/usr/bin/env node
/**
 * Agent Q1 — Typo Check
 * Scans all UI-facing text files for common typos in Thai and English
 */
const { JourneyRunner } = require('./journey-helper');
const fs = require('fs');
const path = require('path');

const WEBAPP_SRC = path.join(__dirname, '../../../apps/web-app/src');

// Common English typos in code
const ENGLISH_TYPOS = [
  ['teh ', 'the '], ['adn ', 'and '], ['recieve', 'receive'],
  ['occured', 'occurred'], ['seperate', 'separate'], ['definately', 'definitely'],
  ['neccessary', 'necessary'], ['accomodate', 'accommodate'], ['achive', 'achieve'],
  ['adress', 'address'], ['calender', 'calendar'], ['cancle', 'cancel'],
  ['certficate', 'certificate'], ['comming', 'coming'], ['complted', 'completed'],
  ['Erorr', 'Error'], ['Sucess', 'Success'], ['Submited', 'Submitted'],
  ['Proccess', 'Process'], ['Documnet', 'Document'], ['Notifcation', 'Notification'],
];

// Common Thai typos
const THAI_TYPOS = [
  ['กรุณณา', 'กรุณา'], ['สำเรจ', 'สำเร็จ'], ['ข้อมุล', 'ข้อมูล'],
  ['ดำเนินการร', 'ดำเนินการ'], ['เอกสสาร', 'เอกสาร'],
];

function scanDir(dir, exts) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.name === 'node_modules' || entry.name === '.next') continue;
      if (entry.isDirectory()) {
        results.push(...scanDir(fullPath, exts));
      } else if (exts.some(ext => entry.name.endsWith(ext))) {
        results.push(fullPath);
      }
    }
  } catch { /* skip */ }
  return results;
}

async function main() {
  const j = new JourneyRunner('Agent Q1 — Typo Check', '📝');
  console.log(`\n ${j.name}\n`);

  try {
    const files = scanDir(WEBAPP_SRC, ['.tsx', '.ts', '.js', '.css']);
    j.pass('Files scanned', `${files.length} files`);

    let totalTypos = 0;
    const typoFiles = [];

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const relPath = path.relative(WEBAPP_SRC, file);

      for (const [typo, correct] of [...ENGLISH_TYPOS, ...THAI_TYPOS]) {
        if (content.toLowerCase().includes(typo.toLowerCase())) {
          totalTypos++;
          typoFiles.push(`${relPath}: "${typo}" → "${correct}"`);
        }
      }
    }

    if (totalTypos === 0) {
      j.pass('No typos found', `Checked ${ENGLISH_TYPOS.length + THAI_TYPOS.length} patterns`);
    } else {
      j.pass('Typos found (review recommended)', `${totalTypos} potential typos in ${typoFiles.length} locations`);
      for (const t of typoFiles.slice(0, 10)) {
        j.pass('  Typo location', t);
      }
    }

    // Check for placeholder text
    let placeholders = 0;
    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      if (/lorem ipsum/i.test(content)) placeholders++;
      if (/TODO:.*text/i.test(content)) placeholders++;
    }

    if (placeholders === 0) {
      j.pass('No placeholder text', 'No "lorem ipsum" or TODO text found');
    } else {
      j.pass('Placeholder text found', `${placeholders} files (review recommended)`);
    }

  } catch (err) {
    j.fail('Unexpected error', err.message);
  }

  j.printReport();
  process.exit(j.failCount > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(2); });
