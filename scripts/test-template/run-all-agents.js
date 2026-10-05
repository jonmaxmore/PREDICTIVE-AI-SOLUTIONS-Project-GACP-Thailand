#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════
 * Multi-Agent Carpet-Bomb Test Orchestrator (Template)
 * ═══════════════════════════════════════════════════════════════
 *
 * Zero-dependency test orchestrator. Runs all agents sequentially,
 * collects results, and produces a unified report.
 *
 * Usage:
 *   node scripts/test-template/run-all-agents.js [BASE_URL]
 *   node scripts/test-template/run-all-agents.js https://your-server.com
 *
 * Customize:
 *   1. Edit the `agents` array below to add/remove agents
 *   2. Each agent must write results to a .txt file with format:
 *      "Pass: X | Fail: Y | Skip: Z | Rate: R%"
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// ─── CONFIGURATION ──────────────────────────────────────────
const BASE_URL = process.argv[2] || process.env.TEST_TARGET || 'http://localhost:3000';
const SCRIPT_DIR = __dirname;
const TIMEOUT_MS = 120_000; // 2 min per agent

const agents = [
    { name: 'Agent B — Backend API',     script: 'agent-backend.js',      icon: '🔌' },
    { name: 'Agent S — Security',        script: 'agent-security.js',     icon: '🛡️' },
    { name: 'Agent P — Performance',     script: 'agent-performance.js',  icon: '⏱️' },
    { name: 'Agent E — Config Audit',    script: 'agent-environment.js',  icon: '🔍' },
    // Add more agents here:
    // { name:'Agent F — Frontend', script:'agent-frontend.js', icon:''},
    // { name:'Agent D — Database', script:'agent-database.js', icon:''},
];

// ─── RESULT PARSER ──────────────────────────────────────────
function parseResultsFile(filename) {
    const filePath = path.join(SCRIPT_DIR, filename);
    if (!fs.existsSync(filePath)) return null;
    const content = fs.readFileSync(filePath, 'utf-8');

    // Standard format: "Pass: X | Fail: Y | Skip: Z | Rate: R%"
    const match = content.match(/Pass:\s*(\d+)\s*\|\s*Fail:\s*(\d+)\s*\|\s*Skip:\s*(\d+)\s*\|\s*Rate:\s*([\d.]+)/);
    if (match) {
        return {
            passed: parseInt(match[1]),
            failed: parseInt(match[2]),
            skipped: parseInt(match[3]),
            rate: parseFloat(match[4]),
            total: parseInt(match[1]) + parseInt(match[2]) + parseInt(match[3]),
        };
    }
    return null;
}

// ─── MAIN ───────────────────────────────────────────────────
async function main() {
    const startTime = Date.now();

    console.log('');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║ Multi-Agent Carpet-Bomb Test Suite ║');
    console.log(`║  ${String(agents.length).padStart(2)} Agents × Full Platform Coverage                         ║`);
    console.log('╚══════════════════════════════════════════════════════════════╝');
    console.log(`\n  Target: ${BASE_URL}`);
    console.log(`  Date:   ${new Date().toISOString()}\n`);

    const summaries = [];

    for (const agent of agents) {
        const scriptPath = path.join(SCRIPT_DIR, agent.script);

        if (!fs.existsSync(scriptPath)) {
            console.log(`\n Skipping ${agent.name} — script not found: ${agent.script}`);
            summaries.push({ ...agent, passed: 0, failed: 0, skipped: 0, total: 0, rate: 0 });
            continue;
        }

        console.log(`\n${'═'.repeat(60)}`);
        console.log(`${agent.icon}  Running ${agent.name}...`);
        console.log(`${'═'.repeat(60)}\n`);

        try {
            execSync(
                `node "${scriptPath}" "${BASE_URL}"`,
                { stdio: 'inherit', timeout: TIMEOUT_MS }
            );
        } catch {
            // Agent may exit(1) on failures — that's OK, we still collect results
        }

        const resultsFile = agent.script.replace('.js', '-results.txt');
        const stats = parseResultsFile(resultsFile);
        summaries.push(stats ? { ...agent, ...stats } : { ...agent, passed: 0, failed: 0, skipped: 0, total: 0, rate: 0 });
    }

    // ─── UNIFIED REPORT ──────────────────────────────────────
    const totalPassed  = summaries.reduce((s, a) => s + a.passed, 0);
    const totalFailed  = summaries.reduce((s, a) => s + a.failed, 0);
    const totalSkipped = summaries.reduce((s, a) => s + a.skipped, 0);
    const grandTotal   = totalPassed + totalFailed + totalSkipped;
    const overallRate  = grandTotal > 0 ? ((totalPassed / grandTotal) * 100).toFixed(1) : '0.0';
    const elapsed      = ((Date.now() - startTime) / 1000).toFixed(1);

    console.log('\n');
    console.log('╔══════════════════════════════════════════════════════════════╗');
    console.log('║ UNIFIED CARPET-BOMB TEST REPORT ║');
    console.log('╠══════════════════════════════════════════════════════════════╣');

    for (const s of summaries) {
        const bar = s.total > 0
            ? `${'█'.repeat(Math.round(s.rate / 5))}${'░'.repeat(20 - Math.round(s.rate / 5))}`
            : '░'.repeat(20);
        const statusIcon = s.failed === 0 ? '🟢' : s.rate >= 80 ? '🟡' : '🔴';
        console.log(`║  ${s.icon} ${s.name.padEnd(28)} ${statusIcon} ${String(s.passed).padStart(3)}/${String(s.total).padStart(3)} ${bar} ${String(s.rate).padStart(5)}% ║`);
    }

    console.log('╠══════════════════════════════════════════════════════════════╣');
    const overallIcon = totalFailed === 0 ? '🟢' : parseFloat(overallRate) >= 80 ? '🟡' : '🔴';
    console.log(`║ ${overallIcon} OVERALL: ${totalPassed}/${grandTotal} passed (${overallRate}%) ${elapsed}s ║`);
    console.log('╚══════════════════════════════════════════════════════════════╝');

    if (totalFailed === 0) {
        console.log('\n ALL AGENTS PASSED — Platform is healthy!\n');
    } else {
        console.log(`\n ${totalFailed} total failure(s) across ${summaries.filter(s => s.failed > 0).length} agent(s)\n`);
    }

    // Save unified report
    const reportFile = path.join(SCRIPT_DIR, 'carpet-bomb-report.txt');
    const lines = [
        '═══════════════════════════════════════════════════════════',
        '  Multi-Agent Carpet-Bomb Test Report',
        '═══════════════════════════════════════════════════════════',
        `  Target:   ${BASE_URL}`,
        `  Date:     ${new Date().toISOString()}`,
        `  Duration: ${elapsed}s`,
        '',
        ...summaries.map(s => `  ${s.name}: ${s.passed}/${s.total} (${s.rate}%) ${s.failed === 0 ? '✓' : `✗ ${s.failed} failed`}`),
        '',
        `  OVERALL: ${totalPassed}/${grandTotal} (${overallRate}%)`,
        '',
        totalFailed === 0 ? '  ✅ ALL PASSED' : `  ❌ ${totalFailed} FAILURE(S)`,
    ];
    fs.writeFileSync(reportFile, lines.join('\n'), 'utf-8');
    console.log(`Unified report → ${reportFile}\n`);

    process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch(err => { console.error('Fatal:', err); process.exit(2); });
