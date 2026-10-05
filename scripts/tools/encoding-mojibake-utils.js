const fs = require('fs');
const path = require('path');
const { TextDecoder } = require('util');

const SOURCE_EXTENSIONS = new Set([
  '.js',
  '.jsx',
  '.ts',
  '.tsx',
  '.mjs',
  '.cjs',
  '.json',
  '.md',
  '.html',
  '.css',
  '.yml',
  '.yaml',
]);

const IGNORED_DIRS = new Set([
  'node_modules',
  '.next',
  'dist',
  'build',
  'coverage',
  '.git',
  'playwright-report',
  '.turbo',
]);

const CP1252_REVERSE = new Map([
  [0x20AC, 0x80],
  [0x201A, 0x82],
  [0x0192, 0x83],
  [0x201E, 0x84],
  [0x2026, 0x85],
  [0x2020, 0x86],
  [0x2021, 0x87],
  [0x02C6, 0x88],
  [0x2030, 0x89],
  [0x0160, 0x8A],
  [0x2039, 0x8B],
  [0x0152, 0x8C],
  [0x017D, 0x8E],
  [0x2018, 0x91],
  [0x2019, 0x92],
  [0x201C, 0x93],
  [0x201D, 0x94],
  [0x2022, 0x95],
  [0x2013, 0x96],
  [0x2014, 0x97],
  [0x02DC, 0x98],
  [0x2122, 0x99],
  [0x0161, 0x9A],
  [0x203A, 0x9B],
  [0x0153, 0x9C],
  [0x017E, 0x9E],
  [0x0178, 0x9F],
]);

const MOJIBAKE_HINT_RE = /[\u00C2\u00C3\u00E0\u00E2\u00EF\u00F0]/;
const THAI_RE = /[\u0E00-\u0E7F]/g;
const REPLACEMENT_RE = /\uFFFD/g;

const MOJIBAKE_RUN_RE =
  /[\u00C2\u00C3\u00E0\u00E2\u00EF\u00F0][\u0080-\u00FF\u0152\u0153\u0160\u0161\u0178\u017D\u017E\u0192\u02C6\u02DC\u2013-\u201A\u201C-\u201E\u2020-\u2022\u2026\u2030\u2039\u203A\u20AC\u2122]*/g;

const utf8StrictDecoder = new TextDecoder('utf-8', { fatal: true });

function countMatches(text, regex) {
  return (text.match(regex) || []).length;
}

function countMojibakeScore(text) {
  const scoreRegex = new RegExp(MOJIBAKE_RUN_RE.source, 'g');
  return countMatches(text, scoreRegex);
}

function toByteFromCp1252Char(char) {
  const codePoint = char.codePointAt(0);
  if (codePoint >= 0x80 && codePoint <= 0xFF) {
    return codePoint;
  }
  return CP1252_REVERSE.get(codePoint);
}

function decodeMojibakeRun(run) {
  const bytes = [];
  for (const char of run) {
    const byte = toByteFromCp1252Char(char);
    if (byte === undefined) {
      return run;
    }
    bytes.push(byte);
  }

  try {
    return utf8StrictDecoder.decode(Uint8Array.from(bytes));
  } catch (_error) {
    return run;
  }
}

function repairMojibakeText(content) {
  let repaired = content;
  for (let pass = 0; pass < 3; pass += 1) {
    repaired = repaired.replace(MOJIBAKE_RUN_RE, decodeMojibakeRun);
  }
  return repaired;
}

function shouldRepair(beforeText, afterText) {
  const beforeScore = countMojibakeScore(beforeText);
  const afterScore = countMojibakeScore(afterText);

  if (afterScore >= beforeScore) {
    return false;
  }

  const beforeThai = countMatches(beforeText, THAI_RE);
  const afterThai = countMatches(afterText, THAI_RE);
  if (afterThai < beforeThai) {
    return false;
  }

  const beforeReplacement = countMatches(beforeText, REPLACEMENT_RE);
  const afterReplacement = countMatches(afterText, REPLACEMENT_RE);
  if (afterReplacement > beforeReplacement) {
    return false;
  }

  return true;
}

function isIgnoredPath(filePath) {
  const parts = filePath.split(path.sep);
  return parts.some((part) => IGNORED_DIRS.has(part));
}

function isTextSourceFile(filePath) {
  if (isIgnoredPath(filePath)) {
    return false;
  }
  return SOURCE_EXTENSIONS.has(path.extname(filePath).toLowerCase());
}

function walkFiles(rootDir, output = []) {
  if (!fs.existsSync(rootDir)) {
    return output;
  }

  const entries = fs.readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) {
      continue;
    }

    const absolutePath = path.join(rootDir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(absolutePath, output);
      continue;
    }

    if (!entry.isFile()) {
      continue;
    }

    if (!isTextSourceFile(absolutePath)) {
      continue;
    }

    output.push(absolutePath);
  }

  return output;
}

function relativePath(filePath) {
  return path.relative(process.cwd(), filePath).replace(/\\/g, '/');
}

function scanAndRepairFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  if (!MOJIBAKE_HINT_RE.test(content)) {
    return null;
  }

  const repaired = repairMojibakeText(content);
  if (repaired === content) {
    return null;
  }

  if (!shouldRepair(content, repaired)) {
    return null;
  }

  return {
    filePath,
    beforeScore: countMojibakeScore(content),
    afterScore: countMojibakeScore(repaired),
    beforeThai: countMatches(content, THAI_RE),
    afterThai: countMatches(repaired, THAI_RE),
    content: repaired,
  };
}

module.exports = {
  MOJIBAKE_HINT_RE,
  THAI_RE,
  walkFiles,
  relativePath,
  scanAndRepairFile,
  countMojibakeScore,
};
