/**
 * Environment Bootstrapper (GACP Zero-Config Dev Engine)
 * Automatically provisions .env from .env.example if missing.
 * Generates secure dynamic JWT and Encryption keys so the Local environment never crashes.
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execSync } = require('child_process');

const ENV_PATH = path.join(__dirname, '..', '.env');
const ENV_EXAMPLE_PATH = path.join(__dirname, '..', '.env.example');

console.log('GACP Zero-Config Bootstrapper Started...\n');

// 1. Create .env if missing
if (!fs.existsSync(ENV_PATH)) {
    console.log('No .env file found. Auto-generating from .env.example...');
    if (fs.existsSync(ENV_EXAMPLE_PATH)) {
        let envContent = fs.readFileSync(ENV_EXAMPLE_PATH, 'utf8');

        // Auto-generate strong secrets for local dev to prevent JWT/Encryption crashes
        const randomJwt = crypto.randomBytes(32).toString('hex');
        const randomEncryptionKey = crypto.randomBytes(16).toString('hex'); // 32 chars exactly

        envContent = envContent.replace(
            /JWT_SECRET=".+"/g,
            `JWT_SECRET="${randomJwt}"`,
        );
        envContent = envContent.replace(
            /ENCRYPTION_KEY=".+"/g,
            `ENCRYPTION_KEY="${randomEncryptionKey}"`,
        );

        fs.writeFileSync(ENV_PATH, envContent, 'utf8');
        console.log('Generated .env with secure local dynamic keys.');
    } else {
        console.error('.env.example is missing! Cannot bootstrap.');
        process.exit(1);
    }
} else {
    console.log('.env already exists.');
}

// 2. Execute Prisma Database Migration (Auto-heal DB schema)
try {
    console.log('Verifying Database Schema (Prisma DB Push)...');
    execSync('npx prisma db push --schema prisma/schema', { stdio: 'inherit', cwd: path.join(__dirname, '..') });
    console.log('Database Schema Synced.');
} catch (_error) {
    console.warn('Database push failed. Is your local PostgreSQL server running?');
    console.warn('You may need to start Docker or PgAdmin first to allow schema syncing.');
}

// 3. Auto-Seed Development Users
try {
    console.log('Seeding Development Roles and Users (if absent)...');
    execSync('npm run prisma:seed', { stdio: 'ignore', cwd: path.join(__dirname, '..') });
    console.log('Local Database Seeded.');
} catch (_error) {
    console.warn('Seeding failed or skipped (usually safe if db is inactive).');
}

console.log('\n GACP Environment is ready! Run`npm run dev`to start the backend.');
