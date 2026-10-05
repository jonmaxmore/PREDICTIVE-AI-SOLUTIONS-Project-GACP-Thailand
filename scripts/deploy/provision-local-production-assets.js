#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

// __dirname is `<repo>/scripts/deploy`, so go up two levels to reach the
// repo root where apps/, nginx/, and the canonical .env.production.example
// actually live. The original `path.resolve(__dirname, '..')` resolved to
// `<repo>/scripts/` and made backendDir, sslDir, and envSources all dangle
// — Runtime Readiness CI failed on every run because of it.
const rootDir = path.resolve(__dirname, '..', '..');
const backendDir = path.join(rootDir, 'apps', 'backend');
const sslDir = path.join(rootDir, 'nginx', 'ssl');
const localSslDir = path.join(sslDir, 'local');

const envTarget = path.join(backendDir, '.env.production');
const envSources = [
  path.join(backendDir, '.env.production.template'),
  path.join(backendDir, '.env.production.example'),
  // Root-level fallback: the docker-compose production stack reads from
  // /opt/gacp-platform/.env.production seeded from the root template.
  path.join(rootDir, '.env.production.example'),
];

const prodCert = path.join(sslDir, 'gacp.crt');
const prodKey = path.join(sslDir, 'gacp.key');
const localCert = path.join(localSslDir, 'localhost.crt');
const localKey = path.join(localSslDir, 'localhost.key');

function copyIfMissing(source, target) {
  if (fs.existsSync(target)) {
    console.log(`[skip] already exists: ${path.relative(rootDir, target)}`);
    return true;
  }
  if (!fs.existsSync(source)) {
    return false;
  }
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  console.log(`[ok] copied ${path.relative(rootDir, source)} -> ${path.relative(rootDir, target)}`);
  return true;
}

function createEnvFromTemplate() {
  if (fs.existsSync(envTarget)) {
    console.log('[skip] apps/backend/.env.production already exists');
    return true;
  }

  const source = envSources.find((file) => fs.existsSync(file));
  if (!source) {
    console.log('[warn] no env template/example found for .env.production');
    return false;
  }

  fs.copyFileSync(source, envTarget);
  console.log(`[ok] created apps/backend/.env.production from ${path.basename(source)}`);
  return true;
}

function hasOpenSsl() {
  const probe = spawnSync('openssl', ['version'], {
    cwd: rootDir,
    stdio: 'ignore',
    shell: process.platform === 'win32',
  });
  return probe.status === 0;
}

function generateLocalCertificate() {
  if (fs.existsSync(localCert) && fs.existsSync(localKey)) {
    return true;
  }

  if (!hasOpenSsl()) {
    console.log('[warn] openssl not found; cannot generate local certificate automatically');
    return false;
  }

  fs.mkdirSync(localSslDir, { recursive: true });
  const cmd = [
    'openssl req -x509 -nodes -days 365',
    '-newkey rsa:2048',
    `-keyout "${localKey}"`,
    `-out "${localCert}"`,
    '-subj "/C=TH/ST=Bangkok/L=Bangkok/O=GACP/OU=Local/CN=localhost"',
  ].join(' ');

  const result = spawnSync(cmd, {
    cwd: rootDir,
    shell: true,
    stdio: 'inherit',
  });

  return result.status === 0;
}

function provisionSsl() {
  const copiedCert = copyIfMissing(localCert, prodCert);
  const copiedKey = copyIfMissing(localKey, prodKey);
  if (copiedCert && copiedKey) {
    return true;
  }

  const generated = generateLocalCertificate();
  if (!generated) {
    return false;
  }

  const certOk = copyIfMissing(localCert, prodCert);
  const keyOk = copyIfMissing(localKey, prodKey);
  return certOk && keyOk;
}

function main() {
  console.log('Provisioning local production assets...');
  const envOk = createEnvFromTemplate();
  const sslOk = provisionSsl();

  if (!envOk || !sslOk) {
    console.log('[result] partial provisioning completed; review warnings above');
    process.exit(1);
  }

  console.log('[result] local production assets are ready');
}

main();
