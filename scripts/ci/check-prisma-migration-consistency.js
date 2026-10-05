#!/usr/bin/env node

/**
 * Prisma migration consistency guard.
 *
 * Fast guard (always):
 * - If backend schema file changes in HEAD commit, at least one migration file
 *   under apps/backend/prisma/migrations must also change in the same commit.
 *
 * Strict guard (optional):
 * - When SHADOW_DATABASE_URL is provided, run Prisma migrate diff to detect
 *   migration/schema drift at SQL level.
 */

const { spawnSync } = require('child_process');

function run(command, args, cwd = process.cwd()) {
  if (process.platform === 'win32') {
    const commandLine = [command, ...args].join(' ');
    return spawnSync(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', commandLine], {
      cwd,
      encoding: 'utf8',
      stdio: 'pipe',
      shell: false,
      env: process.env,
    });
  }

  return spawnSync(command, args, {
    cwd,
    encoding: 'utf8',
    stdio: 'pipe',
    shell: false,
    env: process.env,
  });
}

function getHeadChangedFiles() {
  const result = run('git', ['diff-tree', '--no-commit-id', '--name-only', '-r', 'HEAD']);
  if (result.status !== 0) {
    throw new Error(`Unable to read HEAD diff: ${(result.stderr || '').trim()}`);
  }

  return String(result.stdout || '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function fail(message) {
  console.error(`[prisma-consistency] FAIL: ${message}`);
  process.exit(1);
}

function info(message) {
  console.log(`[prisma-consistency] ${message}`);
}

function main() {
  const changedFiles = getHeadChangedFiles();
  // The schema is a prismaSchemaFolder — a directory of domain .prisma files.
  // There is no single-file layout left to fall back to, and none can come back:
  // guardrail G-04 (scripts/ci/lib/prisma-schema-sources.js) fails the build if a
  // .prisma file exists anywhere outside this folder. A branch for schema.prisma
  // here only made the folder look like one option among two.
  const backendSchemaFolder = 'apps/backend/prisma/schema/';
  const backendMigrationsPrefix = 'apps/backend/prisma/migrations/';

  const schemaChanged = changedFiles.some((file) => file.startsWith(backendSchemaFolder));
  const migrationsChanged = changedFiles.some((file) => file.startsWith(backendMigrationsPrefix));

  if (schemaChanged && !migrationsChanged) {
    fail(
      `Detected schema change (${backendSchemaFolder}*.prisma) `
      + `without any migration file change under ${backendMigrationsPrefix}.`,
    );
  }

  info('Commit-level schema/migration pairing check passed');

  const shadowDbUrl = String(process.env.SHADOW_DATABASE_URL || '').trim();
  if (!shadowDbUrl) {
    info('Strict drift check skipped (SHADOW_DATABASE_URL not set)');
    return;
  }

  const fs = require('fs');
  const path = require('path');
  // The folder is the schema (prismaSchemaFolder); its absence is a hard failure,
  // not a cue to look elsewhere.
  const schemaArg = 'apps/backend/prisma/schema';

  if (!fs.existsSync(path.join(process.cwd(), schemaArg))) {
    fail(`No Prisma schema folder at ${schemaArg}`);
  }

  const strict = run('npx', [
    '--prefix',
    'apps/backend',
    'prisma',
    'migrate',
    'diff',
    '--from-migrations',
    'apps/backend/prisma/migrations',
    '--to-schema-datamodel',
    schemaArg,
    '--shadow-database-url',
    shadowDbUrl,
    '--exit-code',
  ]);

  if (strict.status === 0) {
    info('Strict migration drift check passed');
    return;
  }

  if (strict.status === 2) {
    fail('Strict migration drift detected between migrations and schema');
  }

  const output = `${strict.stdout || ''}${strict.stderr || ''}`.trim();
  fail(`Strict drift check errored${output ? `: ${output}` : ''}`);
}

try {
  main();
} catch (error) {
  fail(error.message);
}
