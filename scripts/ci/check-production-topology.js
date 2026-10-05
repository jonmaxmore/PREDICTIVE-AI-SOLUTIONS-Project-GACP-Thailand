#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..', '..');

function read(relPath) {
  return fs.readFileSync(path.join(root, relPath), 'utf8');
}

function serviceBlock(composeText, serviceName) {
  const pattern = new RegExp(
    `^  ${serviceName}:\\r?\\n([\\s\\S]*?)(?=^  [A-Za-z0-9_-]+:\\r?$|^networks:\\r?$|^volumes:\\r?$)`,
    'm',
  );
  const match = composeText.match(pattern);
  if (!match) {
    throw new Error(`Missing service block: ${serviceName}`);
  }
  return match[1];
}

const checks = [];

function pass(message) {
  checks.push({ ok: true, message });
}

function fail(message) {
  checks.push({ ok: false, message });
}

function expectMatch(content, regex, message) {
  if (regex.test(content)) {
    pass(message);
  } else {
    fail(message);
  }
}

function expectNoMatch(content, regex, message) {
  if (regex.test(content)) {
    fail(message);
  } else {
    pass(message);
  }
}

try {
  const compose = read('docker-compose.production.yml');
  const hostNginx = read(path.join('deploy', 'nginx', 'gacp-platform.conf'));
  const dockerNginx = read(path.join('nginx', 'gacp.production.conf'));
  const networkDiagram = read(path.join('docs', 'architecture', 'network-diagram.md'));

  const nginxBlock = serviceBlock(compose, 'nginx');
  const backendBlock = serviceBlock(compose, 'backend');
  const frontendBlock = serviceBlock(compose, 'frontend');
  const minioBlock = serviceBlock(compose, 'minio');

  expectMatch(
    nginxBlock,
    /127\.0\.0\.1:8080:80/,
    'production compose keeps Docker nginx on loopback only (127.0.0.1:8080:80)',
  );
  expectNoMatch(
    nginxBlock,
    /^\s*-\s*["']?(?:0\.0\.0\.0:)?(?:80:80|443:443)["']?\s*$/m,
    'production compose does not expose Docker nginx directly on public 80/443',
  );
  expectNoMatch(
    backendBlock,
    /^\s+ports:\s*$/m,
    'backend service does not publish host ports in production compose',
  );
  expectNoMatch(
    frontendBlock,
    /^\s+ports:\s*$/m,
    'frontend service does not publish host ports in production compose',
  );
  expectMatch(
    minioBlock,
    /127\.0\.0\.1:9000:9000[\s\S]*127\.0\.0\.1:9001:9001|127\.0\.0\.1:9001:9001[\s\S]*127\.0\.0\.1:9000:9000/,
    'MinIO remains loopback-only in production compose',
  );

  expectMatch(
    hostNginx,
    /server 127\.0\.0\.1:8080;/,
    'host nginx proxies to Docker nginx via 127.0.0.1:8080',
  );
  expectNoMatch(
    hostNginx,
    /127\.0\.0\.1:8443/,
    'host nginx no longer references an unused Docker 8443 listener',
  );
  expectMatch(
    hostNginx,
    /proxy_pass http:\/\/docker_nginx_http;/,
    'host nginx forwards public traffic to the Docker nginx upstream',
  );

  expectMatch(
    dockerNginx,
    /location \/api\/ \{[\s\S]*proxy_pass http:\/\/(?:backend:8000|\$backend_up);/,
    'Docker nginx sends /api traffic to backend:8000 (direct or via the $backend_up resolver variable)',
  );
  expectMatch(
    dockerNginx,
    /location \/ \{[\s\S]*proxy_pass http:\/\/(?:frontend:3000|\$frontend_up);/,
    'Docker nginx sends web traffic to frontend:3000 (direct or via the $frontend_up resolver variable)',
  );
  expectMatch(
    dockerNginx,
    /location = \/health \{[\s\S]*return 200 "OK";/,
    'Docker nginx serves the loopback health endpoint directly',
  );

  expectMatch(
    networkDiagram,
    /Host nginx[\s\S]*docker nginx[\s\S]*127\.0\.0\.1:8080/,
    'network diagram documents the two-layer nginx topology',
  );

  const failures = checks.filter((check) => !check.ok);
  const reporter = failures.length > 0 ? console.error : console.log;

  reporter('Production topology validation');
  for (const check of checks) {
    reporter(`${check.ok ? 'PASS' : 'FAIL'} ${check.message}`);
  }

  if (failures.length > 0) {
    process.exit(1);
  }
} catch (error) {
  console.error(`FAIL ${error.message}`);
  process.exit(1);
}
