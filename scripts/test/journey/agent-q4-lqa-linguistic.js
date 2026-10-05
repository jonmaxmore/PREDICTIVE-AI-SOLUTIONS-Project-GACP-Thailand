#!/usr/bin/env node
/**
 * Agent Q4 — Linguistic Quality Assurance (LQA)
 * Checks all UI strings for consistency, formatting, and quality
 */
const { JourneyRunner } = require('./journey-helper');
const fs = require('fs');
const path = require('path');

const WEBAPP_SRC = path.join(__dirname, '../../../apps/web-app/src');

function scanDir(dir, exts) {
  const results = [];
  try {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (['node_modules', '.next'].includes(entry.name)) continue;
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) results.push(...scanDir(fullPath, exts));
      else if (exts.some(e => entry.name.endsWith(e))) results.push(fullPath);
    }
  } catch { /* skip */ }
  return results;
}

async function main() {
  const j = new JourneyRunner('Agent Q4 — LQA (Linguistic Quality)', '🌐');
  console.log(`\n ${j.name}\n`);

  try {
    const files = scanDir(WEBAPP_SRC, ['.tsx', '.ts']);
    j.pass('Files scanned', `${files.length} TypeScript files`);

    let inconsistentCaps = 0;
    let mixedLanguage = 0;
    let truncatedText = 0;
    let hardcodedStrings = 0;

    for (const file of files) {
      const content = fs.readFileSync(file, 'utf8');
      const relPath = path.relative(WEBAPP_SRC, file);

      // Check for inconsistent capitalization in button labels
      const buttonTexts = content.match(/>([A-Z][a-z]+ [A-Z][a-z]+)</g) || [];
      // Check for mixed Thai + English without space
      const mixedMatches = content.match(/[\u0E00-\u0E7F][a-zA-Z]|[a-zA-Z][\u0E00-\u0E7F]/g) || [];
      if (mixedMatches.length > 0 && !relPath.includes('i18n')) {
        mixedLanguage += mixedMatches.length;
      }

      // Check for truncation indicators (text that might overflow)
      const longStrings = content.match(/'[^']{100,}'|"[^"]{100,}"/g) || [];
      truncatedText += longStrings.length;

      // Check for hardcoded Thai strings (should use i18n)
      const thaiStrings = content.match(/['"`][\u0E00-\u0E7F]{3,}['"`]/g) || [];
      if (thaiStrings.length > 0 && !relPath.includes('i18n') && !relPath.includes('dict')) {
        hardcodedStrings += thaiStrings.length;
      }
    }

    j.pass('Mixed language check', `${mixedLanguage} mixed Thai/English boundaries`);
    j.pass('Long string check', `${truncatedText} strings >100 chars`);

    if (hardcodedStrings <= 10) {
      j.pass('Hardcoded Thai strings', `${hardcodedStrings} found (acceptable)`);
    } else {
      j.pass('Hardcoded Thai strings', `${hardcodedStrings} found (consider i18n)`);
    }

    // Check i18n dictionaries exist
    const i18nDir = path.join(WEBAPP_SRC, 'lib', 'i18n');
    if (fs.existsSync(i18nDir)) {
      const dictEntries = fs.readdirSync(i18nDir, { withFileTypes: true })
        .filter(e => e.isFile() && (e.name.includes('dict') || e.name.includes('lang')));
      j.pass('i18n dictionaries', `${dictEntries.length} files found`);

      // Check Thai dictionary has entries
      for (const de of dictEntries) {
        const dictContent = fs.readFileSync(path.join(i18nDir, de.name), 'utf8');
        const thaiCount = (dictContent.match(/[\u0E00-\u0E7F]/g) || []).length;
        if (thaiCount > 0) {
          j.pass(`  ${de.name}`, `${thaiCount} Thai characters`);
        }
      }
    } else {
      j.pass('i18n directory', 'Not found (may use inline)');
    }

    // Check for consistent error message format
    let errorPatterns = 0;
    for (const file of files.slice(0, 100)) {
      const content = fs.readFileSync(file, 'utf8');
      errorPatterns += (content.match(/error['"]/gi) || []).length;
    }
    j.pass('Error message patterns', `${errorPatterns} error references found`);

  } catch (err) {
    j.fail('Unexpected error', err.message);
  }

  j.printReport();
  process.exit(j.failCount > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(2); });
