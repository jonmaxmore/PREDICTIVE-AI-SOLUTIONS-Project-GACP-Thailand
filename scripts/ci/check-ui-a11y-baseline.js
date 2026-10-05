#!/usr/bin/env node
/* eslint-disable no-console */

const fs = require('fs');
const path = require('path');

const rootDir = path.resolve(__dirname, '..', '..');
const webSrcDir = path.join(rootDir, 'apps', 'web-app', 'src');

const errors = [];
let actionIconCount = 0;

function walkDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkDir(fullPath));
      continue;
    }
    if (entry.isFile() && /\.(tsx|jsx)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }
  return files;
}

function getLineNumber(text, index) {
  return text.slice(0, index).split(/\r?\n/).length;
}

function readTag(text, startIndex) {
  let i = startIndex;
  let inSingle = false;
  let inDouble = false;
  let inTemplate = false;
  let escaped = false;
  let braceDepth = 0;
  let parenDepth = 0;

  while (i < text.length) {
    const ch = text[i];

    if (escaped) {
      escaped = false;
      i += 1;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      i += 1;
      continue;
    }

    if (inSingle) {
      if (ch === '\'') {
        inSingle = false;
      }
      i += 1;
      continue;
    }

    if (inDouble) {
      if (ch === '"') {
        inDouble = false;
      }
      i += 1;
      continue;
    }

    if (inTemplate) {
      if (ch === '`') {
        inTemplate = false;
      }
      i += 1;
      continue;
    }

    if (ch === '\'') {
      inSingle = true;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inDouble = true;
      i += 1;
      continue;
    }
    if (ch === '`') {
      inTemplate = true;
      i += 1;
      continue;
    }

    if (ch === '{') {
      braceDepth += 1;
      i += 1;
      continue;
    }

    if (ch === '}') {
      braceDepth = Math.max(0, braceDepth - 1);
      i += 1;
      continue;
    }

    if (ch === '(') {
      parenDepth += 1;
      i += 1;
      continue;
    }

    if (ch === ')') {
      parenDepth = Math.max(0, parenDepth - 1);
      i += 1;
      continue;
    }

    if (ch === '>' && braceDepth === 0 && parenDepth === 0) {
      return text.slice(startIndex, i + 1);
    }

    i += 1;
  }

  return text.slice(startIndex);
}

function validateActionIconLabels() {
  const files = walkDir(webSrcDir);

  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    let start = text.indexOf('<ActionIcon');
    while (start !== -1) {
      actionIconCount += 1;
      const tag = readTag(text, start);
      const hasLabel = /aria-label\s*=/.test(tag) || /title\s*=/.test(tag);
      if (!hasLabel) {
        const relPath = path.relative(rootDir, file);
        errors.push(`${relPath}:${getLineNumber(text, start)} missing aria-label/title on <ActionIcon>`);
      }
      start = text.indexOf('<ActionIcon', start + 1);
    }
  }
}

function validateSkipLinkAndKeyboardDropzone() {
  const layoutPath = path.join(webSrcDir, 'app', 'layout.tsx');
  const layout = fs.readFileSync(layoutPath, 'utf8');
  // Phase A5 v3.5.1 (2026-04-28) replaced the English-first skip link with a
  // Thai-first variant and switched the target to #main-content (the canonical
  // id used by GovLayout and pages that render their own <main>).
  //
  // The link then became bilingual, which moved it out of this file: its text
  // comes from useLanguage(), so it had to become a client component rendered
  // inside <Providers>. The load-bearing property is unchanged — an in-page
  // anchor to #main-content, reachable as the first focusable element — so the
  // check follows it into the component rather than insisting on the literal.
  // Accepting `<SkipToContent />` on its own would not be a check at all, so
  // the component is opened and the anchor verified there.
  const rendersSkipComponent = /<SkipToContent\s*\/>/.test(layout);
  let hasSkipAnchor = /href=["']#main-content["']/.test(layout)
    && (layout.includes('Skip to main content') || layout.includes('ข้ามไปยังเนื้อหาหลัก'));

  if (!hasSkipAnchor && rendersSkipComponent) {
    const componentPath = path.join(webSrcDir, 'components', 'layout', 'SkipToContent.tsx');
    if (!fs.existsSync(componentPath)) {
      errors.push('apps/web-app/src/app/layout.tsx renders <SkipToContent /> but the component is missing');
    } else {
      const component = fs.readFileSync(componentPath, 'utf8');
      // The copy now lives in the dictionary, so require the anchor plus a
      // dictionary read — a hardcoded string here would be the old bug back.
      hasSkipAnchor = /href=["']#main-content["']/.test(component)
        && /dict\.common\.skipToContent/.test(component);
      if (!hasSkipAnchor) {
        errors.push('SkipToContent.tsx must render an anchor to #main-content with dict.common.skipToContent');
      }
    }
  } else if (!hasSkipAnchor) {
    errors.push('apps/web-app/src/app/layout.tsx missing skip-to-main-content anchor (Thai or English)');
  }

  // (The components/ui/file-upload.tsx dropzone a11y check was removed with the
  //  component itself — it had 0 importers and was deleted as dead code, audit §3.
  //  Re-add a keyboard-accessible-dropzone assertion here when an upload dropzone
  //  is reintroduced and actually wired into a page.)
}

validateActionIconLabels();
validateSkipLinkAndKeyboardDropzone();

if (errors.length > 0) {
  console.error('[ux-ui-baseline] FAIL');
  for (const error of errors) {
    console.error(`- ${error}`);
  }
  process.exit(1);
}

console.log(`[ux-ui-baseline] PASS (${actionIconCount} ActionIcon tags verified)`);
