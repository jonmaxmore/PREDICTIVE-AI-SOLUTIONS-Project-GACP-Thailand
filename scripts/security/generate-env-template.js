#!/usr/bin/env node
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function generateSecret(length = 64) {
  return crypto.randomBytes(length).toString('hex');
}

const ENV_TEMPLATES = {
  backend: `# Backend Environment Configuration
# Generated: ${new Date().toISOString()}

# Server Configuration
NODE_ENV=development
PORT=3000
HOST=localhost

# Database Configuration
DATABASE_URL=postgresql://postgres:password@localhost:5432/gacp_db

# Redis Configuration
REDIS_URL=redis://localhost:6379
REDIS_PASSWORD=

# JWT Secrets (CHANGE THESE IN PRODUCTION)
Applicant_JWT_SECRET=${generateSecret()}
DTAM_JWT_SECRET=${generateSecret()}
JWT_EXPIRES_IN=7d

# AWS Configuration (for production)
AWS_REGION=ap-southeast-1
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_S3_BUCKET=

# Email / SMS: none (operator 2026-09-16 — no email, no forgot-password by email or SMS)

# LINE Notify
LINE_NOTIFY_TOKEN=

# Payment Gateway
PAYMENT_API_KEY=
PAYMENT_SECRET_KEY=

# Security
RATE_LIMIT_WINDOW_MS=900000
RATE_LIMIT_MAX_REQUESTS=100
BCRYPT_ROUNDS=12

# Logging
LOG_LEVEL=info
LOG_FILE_PATH=./logs
`,

  frontend: `# Frontend Environment Configuration
# Generated: ${new Date().toISOString()}

# API Configuration
NEXT_PUBLIC_API_URL=http://localhost:3000
NEXT_PUBLIC_WS_URL=ws://localhost:3000

# Application
NEXT_PUBLIC_APP_NAME=GACP Platform
NEXT_PUBLIC_APP_VERSION=1.0.0

# Feature Flags
NEXT_PUBLIC_ENABLE_ANALYTICS=false
NEXT_PUBLIC_ENABLE_CHAT=false
`
};

function createEnvFile(appPath, template) {
  const envPath = path.join(appPath, '.env.example');
  const envLocalPath = path.join(appPath, '.env.local.example');

  fs.writeFileSync(envPath, template, 'utf8');
  console.log(`Created ${envPath}`);

  if (!fs.existsSync(path.join(appPath, '.env'))) {
    fs.writeFileSync(path.join(appPath, '.env'), template, 'utf8');
    console.log(`Created ${path.join(appPath,'.env')}`);
  }
}

const rootDir = process.cwd();
console.log('Generating environment templates...\n');

createEnvFile(path.join(rootDir, 'apps', 'backend'), ENV_TEMPLATES.backend);
createEnvFile(path.join(rootDir, 'apps', 'Applicant-portal'), ENV_TEMPLATES.frontend);
createEnvFile(path.join(rootDir, 'apps', 'admin-portal'), ENV_TEMPLATES.frontend);
createEnvFile(path.join(rootDir, 'apps', 'certificate-portal'), ENV_TEMPLATES.frontend);

console.log('\n Environment templates generated');
console.log('Update .env files with actual values');
console.log('Never commit .env files to version control');
