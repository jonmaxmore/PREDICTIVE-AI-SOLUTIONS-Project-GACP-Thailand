/**
 * E2E QC Golden Scenario Test
 * 
 * Tests the complete GACP cultivation -> harvest -> lot -> QR code flow.
 * This script runs INSIDE the backend container and produces:
 * - QR code PNG file
 * - JSON report with all metadata
 * 
 * Usage: docker exec gacp-backend node scripts/e2e_qc_golden.js
 */

// Note: `fetch` is a Node 18+ built-in (also declared in eslint.config.js
// globals); the previous `/* global fetch */` directive is now redundant
// and tripped no-redeclare.

const fs = require('fs');
const path = require('path');

const BASE_URL =
    process.env.API_URL ||
    process.env.BASE_URL ||
    'http://localhost:8000';
const OUTPUT_DIR = path.join(__dirname, '..', 'e2e-output');

function buildApiUrl(endpoint) {
    const base = BASE_URL.replace(/\/+$/, '');
    let normalized = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;

    // Avoid duplicate /api prefix when BASE_URL already includes /api.
    if (base.endsWith('/api') && normalized.startsWith('/api/')) {
        normalized = normalized.slice(4);
    }

    return `${base}${normalized}`;
}

// Colors for console output
const colors = {
    reset: '\x1b[0m',
    bright: '\x1b[1m',
    red: '\x1b[31m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    blue: '\x1b[34m',
    cyan: '\x1b[36m',
};

function log(message, type = 'info') {
    const timestamp = new Date().toISOString();
    let color = colors.cyan;
    let prefix = 'ℹ️ ';
    
    switch (type) {
        case 'success':
            color = colors.green;
            prefix = '✅';
            break;
        case 'error':
            color = colors.red;
            prefix = '❌';
            break;
        case 'warning':
            color = colors.yellow;
            prefix = '⚠️ ';
            break;
        case 'header':
            color = colors.bright;
            prefix = '';
            break;
    }
    
    console.log(`${color}[${timestamp}] ${prefix} ${message}${colors.reset}`);
}

async function fetchAPI(endpoint, options = {}) {
    const url = buildApiUrl(endpoint);
    log(`Calling: ${options.method || 'GET'} ${url}`);
    
    const response = await fetch(url, {
        ...options,
        headers: {
            'Content-Type': 'application/json',
            // P1-e2e: /e2e/* routes require a shared secret (set E2E_SECRET in env).
            ...(process.env.E2E_SECRET ? { 'x-e2e-secret': process.env.E2E_SECRET } : {}),
            ...options.headers,
        },
    });
    
    const text = await response.text();
    
    try {
        return JSON.parse(text);
    } catch {
        throw new Error(`Invalid JSON response from ${endpoint}: ${text.substring(0, 200)}`);
    }
}

function ensureOutputDir() {
    if (!fs.existsSync(OUTPUT_DIR)) {
        fs.mkdirSync(OUTPUT_DIR, { recursive: true });
        log(`Created output directory: ${OUTPUT_DIR}`);
    }
}

async function downloadQRCode(lotId, lotNumber) {
    const url = buildApiUrl(`/api/e2e/lot/${lotId}/qr`);
    log(`Downloading QR code from: ${url}`);
    
    const response = await fetch(url);
    
    if (!response.ok) {
        throw new Error(`Failed to download QR code: ${response.status}`);
    }
    
    const buffer = Buffer.from(await response.arrayBuffer());
    const filename = `qr-code-${lotNumber.replace(/[^a-zA-Z0-9-]/g, '_')}.png`;
    const filepath = path.join(OUTPUT_DIR, filename);
    
    fs.writeFileSync(filepath, buffer);
    log(`QR code saved to: ${filepath}`, 'success');
    
    return filepath;
}

function saveReport(data, timestamp) {
    const filename = `golden-report-${timestamp}.json`;
    const filepath = path.join(OUTPUT_DIR, filename);
    
    fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
    log(`Report saved to: ${filepath}`, 'success');
    
    return filepath;
}

function saveDataUrl(dataUrl, lotNumber) {
    const filename = `qr-dataurl-${lotNumber.replace(/[^a-zA-Z0-9-]/g, '_')}.txt`;
    const filepath = path.join(OUTPUT_DIR, filename);
    
    fs.writeFileSync(filepath, dataUrl);
    log(`Data URL saved to: ${filepath}`, 'success');
    
    return filepath;
}

async function main() {
    const timestamp = Date.now();
    
    log('═══════════════════════════════════════════════════════════════════', 'header');
    log('         E2E QC GOLDEN SCENARIO - GACP Platform                    ', 'header');
    log('═══════════════════════════════════════════════════════════════════', 'header');
    console.log();
    
    try {
        ensureOutputDir();
        
        // Step 0: Health check
        log('Step 0: Backend Health Check');
        const health = await fetchAPI('/api/health');
        if (!health.success) {
            throw new Error('Backend is not healthy');
        }
        log('Backend is healthy', 'success');
        
        // Step 1: Run Golden Scenario (creates all data in one call)
        log('Step 1: Running Golden Scenario (User → Farm → Batch → Lot → QR)');
        const goldenResult = await fetchAPI('/api/e2e/golden-scenario', {
            method: 'POST',
            body: JSON.stringify({}),
        });
        
        if (!goldenResult.success) {
            throw new Error(`Golden Scenario failed: ${goldenResult.error || 'Unknown error'}`);
        }
        
        const { data } = goldenResult;
        log(`Created User: ${data.user.email}`, 'success');
        log(`Created Farm: ${data.farm.name}`, 'success');
        log(`Created Batch: ${data.batch.batchNumber}`, 'success');
        log(`Created Lot: ${data.lot.lotNumber}`, 'success');
        log(`QR Code ID: ${data.lot.qrCode}`, 'success');
        log(`Tracking URL: ${data.lot.trackingUrl}`, 'success');
        
        // Step 2: Download QR code image
        log('Step 2: Downloading QR Code Image');
        const qrFilePath = await downloadQRCode(data.lot.id, data.lot.lotNumber);
        
        // Step 3: Save QR data URL (for embedding)
        log('Step 3: Saving QR Code Data URL');
        const dataUrlPath = saveDataUrl(data.qrCodeDataUrl, data.lot.lotNumber);
        
        // Step 4: Save full report
        log('Step 4: Saving Complete Report');
        const report = {
            timestamp: new Date().toISOString(),
            status: 'SUCCESS',
            scenario: 'Golden QC Flow',
            data: {
                user: data.user,
                farm: data.farm,
                species: data.species,
                cycle: data.cycle,
                batch: data.batch,
                lot: data.lot,
                label: data.label,
            },
            outputs: {
                qrCodeImage: qrFilePath,
                qrDataUrl: dataUrlPath,
            },
        };
        const reportPath = saveReport(report, timestamp);
        
        // Summary
        console.log();
        log('═══════════════════════════════════════════════════════════════════', 'header');
        log('                    GOLDEN SCENARIO COMPLETED!                      ', 'header');
        log('═══════════════════════════════════════════════════════════════════', 'header');
        console.log();
        log('Summary:', 'success');
        console.log(`Lot Number: ${data.lot.lotNumber}`);
        console.log(`Tracking URL: ${data.lot.trackingUrl}`);
        console.log(`QR Code Image: ${qrFilePath}`);
        console.log(`Full Report: ${reportPath}`);
        console.log();
        log('Label Data:', 'success');
        console.log(`Plant: ${data.label.plant}`);
        console.log(`Farm: ${data.label.farmName}`);
        console.log(`Province: ${data.label.province}`);
        console.log(`Weight: ${data.label.weight}`);
        console.log(`THC: ${data.label.thcContent}, CBD: ${data.label.cbdContent}`);
        console.log();
        
        process.exit(0);
        
    } catch (error) {
        log(`Golden Scenario FAILED: ${error.message}`, 'error');
        console.error(error);
        
        // Save error report
        const errorReport = {
            timestamp: new Date().toISOString(),
            status: 'FAILED',
            error: error.message,
            stack: error.stack,
        };
        
        ensureOutputDir();
        const errorPath = path.join(OUTPUT_DIR, `error-report-${timestamp}.json`);
        fs.writeFileSync(errorPath, JSON.stringify(errorReport, null, 2));
        log(`Error report saved to: ${errorPath}`, 'warning');
        
        process.exit(1);
    }
}

main();
