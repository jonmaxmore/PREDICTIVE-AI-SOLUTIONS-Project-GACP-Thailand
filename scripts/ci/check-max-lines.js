#!/usr/bin/env node

/**
 * Enforce source file size guardrails.
 *
 * Modes:
 * - delta (default): checks changed files in working tree only.
 *   Fails if a changed file is > max lines and has grown vs HEAD
 *   (or is a new file that exceeds max).
 * - all: checks every source file and fails any file > max lines.
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.ts', '.tsx', '.cjs', '.mjs']);
const IGNORED_DIRS = new Set(['node_modules', '.next', 'dist', 'build', 'coverage', '.git', '.turbo']);

// max <= 0 disables the hard cap entirely (warn-only mode). The default is
// 0 (no cap) so the policy is "feedback, not gate" — humans choose file
// size based on cohesion, not on an arbitrary line count. The `warn`
// threshold still surfaces oversized files in the build log so reviewers
// can flag them when the size hurts readability.
const DEFAULTS = {
  mode: 'delta',
  max: 0,
  warn: 400,
};

function parseArgs(argv) {
  const config = { ...DEFAULTS };

  for (const arg of argv) {
    if (arg.startsWith('--mode=')) {
      config.mode = arg.split('=')[1] || config.mode;
      continue;
    }
    if (arg.startsWith('--max=')) {
      const parsed = Number(arg.split('=')[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        config.max = parsed;
      }
      continue;
    }
    if (arg.startsWith('--warn=')) {
      const parsed = Number(arg.split('=')[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        config.warn = parsed;
      }
      continue;
    }
  }

  // Only clamp warn against max when max is enabled. When max is disabled
  // (max <= 0), the warn threshold stands on its own as a soft signal.
  if (config.max > 0 && config.warn > config.max) {
    config.warn = config.max;
  }

  return config;
}

function run(command, args, cwd = process.cwd()) {
  let result;

  if (process.platform === 'win32') {
    const commandLine = [command, ...args].join(' ');
    result = spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandLine], {
      cwd,
      env: process.env,
      shell: false,
      stdio: 'pipe',
      encoding: 'utf8',
    });
  } else {
    result = spawnSync(command, args, {
      cwd,
      env: process.env,
      shell: false,
      stdio: 'pipe',
      encoding: 'utf8',
    });
  }

  if (result.error) {
    throw result.error;
  }

  return result;
}

function normalizePath(filePath) {
  return filePath.replace(/\\/g, '/').replace(/^\.?\//, '');
}

function isSourceFile(filePath) {
  const normalized = normalizePath(filePath);
  if (!normalized) {
    return false;
  }

  const ext = path.extname(normalized);
  if (!SOURCE_EXTENSIONS.has(ext)) {
    return false;
  }

  const segments = normalized.split('/');
  return !segments.some((segment) => IGNORED_DIRS.has(segment));
}

function countLines(content) {
  if (!content) {
    return 0;
  }

  const normalized = content.replace(/\r\n/g, '\n');
  const withoutFinalEol = normalized.endsWith('\n')
    ? normalized.slice(0, -1)
    : normalized;

  if (!withoutFinalEol) {
    return 0;
  }

  return withoutFinalEol.split('\n').length;
}

function countLinesFromDisk(filePath) {
  const content = fs.readFileSync(filePath, 'utf8');
  return countLines(content);
}

function countLinesFromHead(filePath) {
  const result = run('git', ['show', `HEAD:${filePath}`]);
  if (result.status !== 0) {
    return null;
  }

  return countLines(String(result.stdout || ''));
}

function parsePorcelainPath(rawLine) {
  if (!rawLine || rawLine.length < 4) {
    return null;
  }

  const status = rawLine.slice(0, 2);
  const payload = rawLine.slice(3).trim();

  if (!payload) {
    return null;
  }

  if (status.includes('D')) {
    return null;
  }

  if (payload.includes(' -> ')) {
    return payload.split(' -> ').pop();
  }

  return payload;
}

function getChangedFiles() {
  const result = run('git', ['status', '--porcelain']);
  if (result.status !== 0) {
    throw new Error(`Unable to get changed files: ${(result.stderr || '').trim()}`);
  }

  const lines = String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean);

  const unique = new Set();

  for (const line of lines) {
    const parsed = parsePorcelainPath(line);
    if (!parsed) {
      continue;
    }
    unique.add(normalizePath(parsed));
  }

  return [...unique];
}

function getHeadChangedFiles() {
  const result = run('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']);
  if (result.status !== 0) {
    throw new Error(`Unable to get HEAD changed files: ${(result.stderr || '').trim()}`);
  }

  return String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => normalizePath(line.trim()))
    .filter(Boolean);
}

function getDeltaCandidates() {
  const workingTree = getChangedFiles();
  const headChanges = getHeadChangedFiles();
  const unique = new Set([...headChanges, ...workingTree]);
  return [...unique];
}

function walkFiles(dir, output = []) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (IGNORED_DIRS.has(entry.name)) {
      continue;
    }

    const absolute = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(absolute, output);
      continue;
    }

    const relative = normalizePath(path.relative(process.cwd(), absolute));
    if (!isSourceFile(relative)) {
      continue;
    }

    output.push(relative);
  }

  return output;
}

function log(message) {
  console.log(`[max-lines] ${message}`);
}

function main() {
  const config = parseArgs(process.argv.slice(2));

  if (!['delta', 'all'].includes(config.mode)) {
    throw new Error(`Invalid --mode value "${config.mode}". Use "delta" or "all".`);
  }

  const candidates = config.mode === 'all'
    ? walkFiles(process.cwd())
    : getDeltaCandidates().filter(isSourceFile);

  if (candidates.length === 0) {
    log(`No source files to check (mode=${config.mode})`);
    return;
  }

  const warnings = [];
  const violations = [];

  const maxEnabled = config.max > 0;

  for (const relativePath of candidates) {
    const absolutePath = path.join(process.cwd(), relativePath);
    if (!fs.existsSync(absolutePath)) {
      continue;
    }

    const currentLines = countLinesFromDisk(absolutePath);
    const overWarn = currentLines > config.warn;
    const overMax = maxEnabled && currentLines > config.max;

    if (config.mode === 'all') {
      if (overMax) {
        violations.push(`${relativePath} (${currentLines} lines > ${config.max})`);
      } else if (overWarn) {
        warnings.push(`${relativePath} (${currentLines} lines > ${config.warn})`);
      }
      continue;
    }

    const previousLines = countLinesFromHead(relativePath);
    const isNewFile = previousLines === null;
    const hasGrown = isNewFile ? true : currentLines > previousLines;

    if (overMax && hasGrown) {
      const reason = isNewFile
        ? 'new file exceeds limit'
        : `grew from ${previousLines} to ${currentLines}`;
      violations.push(`${relativePath} (${reason}, max ${config.max})`);
      continue;
    }

    if (overMax) {
      warnings.push(`${relativePath} (${currentLines} lines, still over ${config.max} but did not grow)`);
      continue;
    }

    if (overWarn) {
      warnings.push(`${relativePath} (${currentLines} lines > warn ${config.warn})`);
    }
  }

  for (const warning of warnings) {
    log(`WARN: ${warning}`);
  }

  if (violations.length > 0) {
    for (const violation of violations) {
      log(`FAIL: ${violation}`);
    }
    throw new Error(`Found ${violations.length} file(s) violating max-line policy`);
  }

  log(`OK: checked ${candidates.length} file(s) in mode=${config.mode}, no violations`);
}

try {
  main();
} catch (error) {
  log(`ERROR: ${error.message}`);
  process.exit(1);
}
