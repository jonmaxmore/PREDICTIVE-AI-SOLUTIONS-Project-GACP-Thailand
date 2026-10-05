#!/usr/bin/env node

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const WINDOWS_RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const UNSAFE_WINDOWS_CHARS = /[<>:"\\|?*]/;
const CAMEL_CASE_DYNAMIC_ROUTE = /\/\[[^\]/]*[A-Z][^\]/]*\](?:\/|$)/;
const NEXT_ROUTE_GROUP = /^apps\/web-app\/src\/app(?:\/[^/]+)*\/\([^)]+\)(?:\/|$)/;
const TOOLING_UPPERCASE_BASENAMES = new Set([
  'README.md',
  'CHANGELOG.md',
  'Dockerfile',
  'CMakeLists.txt',
  'AndroidManifest.xml',
  'Info.plist',
  'AppDelegate.swift',
  'MainActivity.kt',
  'Runner.rc',
  'FILES',
  'VERSION',
]);

function gitLsFiles() {
  const output = execFileSync('git', ['ls-files', '-co', '--exclude-standard'], {
    encoding: 'utf8',
  });

  return output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .sort();
}

function basenameWithoutExtension(segment) {
  return path.posix.basename(segment).replace(/\..*$/, '');
}

function isGeneratedOrPlatformPath(filePath) {
  const basename = path.posix.basename(filePath);

  return (
    TOOLING_UPPERCASE_BASENAMES.has(basename)
    || filePath.startsWith('.github/')
    || filePath.startsWith('apps/mobile-app/')
    || filePath.startsWith('apps/backend/prisma/migrations/')
    || filePath.startsWith('apps/backend/prisma/schema/')
    || filePath.startsWith('apps/backend/prisma/sql/')
    || filePath.startsWith('apps/web-app/__tests__/')
    || filePath.includes('/__tests__/')
    || filePath.includes('/__mocks__/')
    || /^docs\/adr\/ADR-\d+-.+\.md$/.test(filePath)
  );
}

function hasCaseInsensitiveCollision(paths) {
  const seen = new Map();
  const collisions = [];

  for (const filePath of paths) {
    const key = filePath.toLowerCase();
    const existing = seen.get(key);
    if (existing && existing !== filePath) {
      collisions.push(`${existing} <-> ${filePath}`);
    } else {
      seen.set(key, filePath);
    }
  }

  return collisions;
}

function classifyPath(filePath) {
  const segments = filePath.split('/');
  const basename = path.posix.basename(filePath);
  const issues = [];
  const warnings = [];

  if (filePath.startsWith('.playwright-cli/')) {
    issues.push('tracked Playwright CLI artifact should live under output/playwright/ and stay ignored');
  }

  if (/\s/.test(filePath)) {
    issues.push('contains whitespace');
  }

  if (UNSAFE_WINDOWS_CHARS.test(filePath)) {
    issues.push('contains Windows-unsafe character');
  }

  if (segments.some((segment) => /[. ]$/.test(segment))) {
    issues.push('contains a segment ending with a dot or space');
  }

  if (segments.some((segment) => WINDOWS_RESERVED_NAMES.test(basenameWithoutExtension(segment)))) {
    issues.push('contains a Windows reserved device name');
  }

  if (CAMEL_CASE_DYNAMIC_ROUTE.test(filePath)) {
    issues.push('Next.js dynamic route params must use kebab-case, for example [cert-number]');
  }

  if (filePath.includes('(') || filePath.includes(')')) {
    const isNextRouteGroup = NEXT_ROUTE_GROUP.test(filePath);
    if (!isNextRouteGroup) {
      issues.push('parentheses are only allowed for Next.js route groups under apps/web-app/src/app');
    }
  }

  if (/[^\x00-\x7F]/.test(filePath)) {
    warnings.push('contains non-ASCII characters');
  }

  const isAllowedException = isGeneratedOrPlatformPath(filePath);

  if (!isAllowedException && /[A-Z]/.test(filePath)) {
    warnings.push('contains uppercase characters; keep only framework/tooling-required exceptions');
  }

  if (!isAllowedException && basename.includes('_')) {
    warnings.push('contains underscores; prefer kebab-case unless generated or platform-required');
  }

  return { filePath, issues, warnings };
}

function printGroup(title, items, limit = 80) {
  if (items.length === 0) {
    return;
  }

  console.error(`\n[repo-naming] ${title}:`);
  for (const item of items.slice(0, limit)) {
    console.error(` - ${item}`);
  }
  if (items.length > limit) {
    console.error(` - ...and ${items.length - limit} more`);
  }
}

function main() {
  const paths = gitLsFiles();
  const collisions = hasCaseInsensitiveCollision(paths);
  const classified = paths.map(classifyPath);
  const blocking = [];
  const warnings = [];

  for (const result of classified) {
    for (const issue of result.issues) {
      blocking.push(`${result.filePath} (${issue})`);
    }
    for (const warning of result.warnings) {
      warnings.push(`${result.filePath} (${warning})`);
    }
  }

  for (const collision of collisions) {
    blocking.push(`${collision} (case-insensitive path collision)`);
  }

  if (warnings.length > 0) {
    console.log(`[repo-naming] warnings: ${warnings.length}`);
    for (const warning of warnings.slice(0, 40)) {
      console.log(` - ${warning}`);
    }
    if (warnings.length > 40) {
      console.log(` - ...and ${warnings.length - 40} more`);
    }
  }

  if (blocking.length > 0) {
    printGroup('blocking violations', blocking);
    process.exit(1);
  }

  console.log(`[repo-naming] OK: ${paths.length} paths checked, no blocking naming violations`);
}

main();
