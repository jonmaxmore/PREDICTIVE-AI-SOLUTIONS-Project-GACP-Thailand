#!/usr/bin/env node

/**
 * Guard to avoid introducing new ESLint warnings.
 *
 * Scope:
 * - Lints only source files changed in HEAD commit.
 * - Fails on any warning/error in those changed files.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const LINTABLE_EXTENSIONS = new Set(['.js', '.jsx', '.cjs', '.mjs', '.ts', '.tsx']);
const MAX_FILES_PER_BATCH = 40;

function info(message) {
  console.log(`[no-new-warnings] ${message}`);
}

function fail(message) {
  console.error(`[no-new-warnings] FAIL: ${message}`);
  process.exit(1);
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

function getHeadChangedFiles(repoRoot) {
  const result = run('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD'], repoRoot);

  if (result.status !== 0) {
    throw new Error(`Unable to read HEAD changed files: ${(result.stderr || '').trim()}`);
  }

  return String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function stripBom(text) {
  if (!text) {
    return '';
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

function normalizeForTrivialDiff(text) {
  return stripBom(text)
    .replace(/\r\n/g, '\n')
    .replace(/\n+$/g, '');
}

function isTrivialFormattingChange(repoRoot, appPrefix, relativePath) {
  const headPath = `${appPrefix}${relativePath}`;
  const absolutePath = path.join(repoRoot, appPrefix, relativePath);

  if (!fs.existsSync(absolutePath) || !fs.statSync(absolutePath).isFile()) {
    return false;
  }

  const headResult = run('git', ['show', `HEAD:${headPath}`], repoRoot);
  if (headResult.status !== 0) {
    return false;
  }

  const currentContent = fs.readFileSync(absolutePath, 'utf8');
  const headContent = String(headResult.stdout || '');

  if (currentContent === headContent) {
    return true;
  }

  return normalizeForTrivialDiff(currentContent) === normalizeForTrivialDiff(headContent);
}

function toLintableFiles(repoRoot, changedFiles, appPrefix) {
  const seen = new Set();

  return changedFiles
    .filter((file) => file.startsWith(appPrefix))
    .map((file) => file.slice(appPrefix.length))
    .filter(Boolean)
    .filter((relativePath) => LINTABLE_EXTENSIONS.has(path.extname(relativePath)))
    .filter((relativePath) => {
      const absolutePath = path.join(repoRoot, appPrefix, relativePath);
      return fs.existsSync(absolutePath) && fs.statSync(absolutePath).isFile();
    })
    .filter((relativePath) => !isTrivialFormattingChange(repoRoot, appPrefix, relativePath))
    .filter((relativePath) => {
      if (seen.has(relativePath)) {
        return false;
      }
      seen.add(relativePath);
      return true;
    });
}

function chunk(items, size) {
  const groups = [];
  for (let i = 0; i < items.length; i += size) {
    groups.push(items.slice(i, i + size));
  }
  return groups;
}

function runEslintForApp(appName, appDir, files) {
  if (files.length === 0) {
    info(`${appName}: no changed lintable files, skipped`);
    return;
  }

  info(`${appName}: linting ${files.length} changed file(s) with --max-warnings=0`);

  const batches = chunk(files, MAX_FILES_PER_BATCH);
  const eslintBinary = process.platform === 'win32'
    ? path.join(appDir, 'node_modules', '.bin', 'eslint.cmd')
    : path.join(appDir, 'node_modules', '.bin', 'eslint');

  if (!fs.existsSync(eslintBinary)) {
    fail(`${appName}: eslint binary not found at ${eslintBinary}`);
  }

  for (const fileBatch of batches) {
    const result = run(eslintBinary, ['--max-warnings=0', '--no-warn-ignored', ...fileBatch], appDir);

    if (result.status !== 0) {
      const output = `${result.stdout || ''}${result.stderr || ''}`.trim();
      fail(`${appName}: eslint failed${output ? `\n${output}` : ''}`);
    }
  }
}

function main() {
  const repoRoot = process.cwd();
  const changedFiles = getHeadChangedFiles(repoRoot);

  const backendFiles = toLintableFiles(repoRoot, changedFiles, 'apps/backend/');
  const webFiles = toLintableFiles(repoRoot, changedFiles, 'apps/web-app/');

  if (backendFiles.length === 0 && webFiles.length === 0) {
    info('No changed lintable files in HEAD; check skipped');
    return;
  }

  runEslintForApp('backend', path.join(repoRoot, 'apps', 'backend'), backendFiles);
  runEslintForApp('web-app', path.join(repoRoot, 'apps', 'web-app'), webFiles);

  info('No new ESLint warnings/errors detected in changed files');
}

try {
  main();
} catch (error) {
  fail(error.message);
}
