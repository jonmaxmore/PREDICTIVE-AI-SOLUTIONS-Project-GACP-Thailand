#!/usr/bin/env node
const crypto = require('crypto');

function generateSecret(length = 64) {
  return crypto.randomBytes(length).toString('hex');
}

console.log('Generating secure secrets for GACP Platform\n');

const secrets = {
  HEALTH_JWT_SECRET: generateSecret(64),
  DTAM_JWT_SECRET: generateSecret(64),
  SESSION_SECRET: generateSecret(32),
  ENCRYPTION_KEY: generateSecret(32)
};

console.log('Copy these to your terraform.tfvars or .env file:\n');
console.log('# JWT Secrets');
console.log(`HEALTH_JWT_SECRET="${secrets.HEALTH_JWT_SECRET}"`);
console.log(`DTAM_JWT_SECRET="${secrets.DTAM_JWT_SECRET}"`);
console.log(`\n# Session & Encryption`);
console.log(`SESSION_SECRET="${secrets.SESSION_SECRET}"`);
console.log(`ENCRYPTION_KEY="${secrets.ENCRYPTION_KEY}"`);

console.log('\n Store these securely and never commit to version control!');
