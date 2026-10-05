#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════
 * GACP Journey Orchestrator — 16-Agent Full Stack Test Suite
 * ═══════════════════════════════════════════════════════════════
 * Runs all 16 agents (Journey + Frontend + Backend + Database)
 *
 * Usage:
 *   node scripts/test/journey/run-all-journeys.js [TARGET_URL]
 */

const { execSync } = require('child_process');
const path = require('path');

const agents = [
    // ── Journey Agents (J1-J10) ──
    { key: 'J1',  name: 'Registration & Login',    script: 'agent-j1-registration.js',       icon: '👤', cat: 'Journey' },
    { key: 'J2',  name: 'Farm Management',          script: 'agent-j2-farm-management.js',    icon: '🌾', cat: 'Journey' },
    { key: 'J4',  name: 'Document Review',           script: 'agent-j4-document-review.js',    icon: '📋', cat: 'Journey' },
    { key: 'J5',  name: 'Audit Workflow',            script: 'agent-j5-audit-workflow.js',     icon: '🔍', cat: 'Journey' },
    { key: 'J6',  name: 'Payment & Invoicing',      script: 'agent-j6-payment-invoicing.js',  icon: '💰', cat: 'Journey' },
    { key: 'J7',  name: 'Certificate & Verify',     script: 'agent-j7-certificate-verify.js', icon: '🏆', cat: 'Journey' },
    { key: 'J8',  name: 'Rejection & Revision',     script: 'agent-j8-rejection-revision.js', icon: '🔄', cat: 'Journey' },
    { key: 'J9',  name: 'Notifications & Tickets',  script: 'agent-j9-notification-lifecycle.js', icon: '🔔', cat: 'Journey' },
    { key: 'J10', name: 'Golden Scenario E2E',      script: 'agent-j10-golden-scenario.js',   icon: '🌟', cat: 'Journey' },
    // ── Frontend Agents (F1-F2) ──
    { key: 'F1',  name: 'Frontend Health Pages',    script: 'agent-f1-frontend-health.js',    icon: '🖥️', cat: 'Frontend' },
    { key: 'F2',  name: 'Frontend Provider Pages',  script: 'agent-f2-frontend-provider.js',  icon: '🖥️', cat: 'Frontend' },
    // ── Backend Agents (B1-B2) ──
    { key: 'B1',  name: 'Backend Stress & Error',   script: 'agent-b1-backend-stress.js',     icon: '⚡', cat: 'Backend' },
    { key: 'B2',  name: 'Security & Auth',          script: 'agent-b2-backend-security.js',   icon: '🔒', cat: 'Backend' },
    // ── Database Agents (D1-D2) ──
    { key: 'D1',  name: 'Database Integrity',       script: 'agent-d1-database-integrity.js', icon: '🗄️', cat: 'Database' },
    { key: 'D2',  name: 'Database Performance',     script: 'agent-d2-database-performance.js', icon: '📈', cat: 'Database' },
    // ── Specialty Agents (S1-S4) ──
    { key: 'S1',  name: 'SEO & Accessibility',      script: 'agent-s1-seo-accessibility.js',  icon: '🔍', cat: 'Specialty' },
    { key: 'S2',  name: 'API Contract',             script: 'agent-s2-api-contract.js',       icon: '📜', cat: 'Specialty' },
    { key: 'S3',  name: 'Workflow State Machine',   script: 'agent-s3-workflow-state.js',     icon: '⚙️', cat: 'Specialty' },
    { key: 'S4',  name: 'Cross-Layer Integration',  script: 'agent-s4-cross-layer.js',        icon: '🔗', cat: 'Specialty' },
];

const targetUrl = process.argv[2] || 'https://gacpth.com';

const sleep = ms => new Promise(r => setTimeout(r, ms));

console.log(`
╔══════════════════════════════════════════════════════════════╗
║  🛤️ GACP 20-Agent Full Stack Test Suite                     ║
║  Journey + Frontend + Backend + Database + Specialty        ║
╚══════════════════════════════════════════════════════════════╝

  Target: ${targetUrl}
  Date:   ${new Date().toISOString()}
`);

const results = [];
const startTime = Date.now();

(async () => {
for (const [i, agent] of agents.entries()) {
    if (i > 0) await sleep(3000); // Cooldown between agents to prevent rate-limiting
    console.log(`\n════════════════════════════════════════════════════════════`);
    console.log(`${agent.icon}  Running ${agent.key} — ${agent.name}...`);
    console.log(`════════════════════════════════════════════════════════════\n`);

    const scriptPath = path.join(__dirname, agent.script);
    const agentStart = Date.now();

    try {
        const output = execSync(`node "${scriptPath}" "${targetUrl}"`, {
            encoding: 'utf-8',
            timeout: 90000,
            env: { ...process.env, NODE_TLS_REJECT_UNAUTHORIZED: '0' },
        });
        process.stdout.write(output);

        // Parse results from output
        const passMatch = output.match(/Passed:\s*(\d+)/);
        const failMatch = output.match(/Failed:\s*(\d+)/);
        const pas = passMatch ? parseInt(passMatch[1]) : 0;
        const fai = failMatch ? parseInt(failMatch[1]) : 0;

        results.push({
            ...agent,
            pass: pas,
            fail: fai,
            total: pas + fai,
            ms: Date.now() - agentStart,
            status: fai === 0 ? '🟢' : '🟡',
        });
    } catch (err) {
        const output = err.stdout || '';
        process.stdout.write(output);
        const passMatch = output.match(/Passed:\s*(\d+)/);
        const failMatch = output.match(/Failed:\s*(\d+)/);
        const pas = passMatch ? parseInt(passMatch[1]) : 0;
        const fai = failMatch ? parseInt(failMatch[1]) : 0;

        results.push({
            ...agent,
            pass: pas,
            fail: Math.max(fai, 1),
            total: pas + Math.max(fai, 1),
            ms: Date.now() - agentStart,
            status: '🔴',
        });
    }
}

const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
const totalPass = results.reduce((s, r) => s + r.pass, 0);
const totalFail = results.reduce((s, r) => s + r.fail, 0);
const totalTests = results.reduce((s, r) => s + r.total, 0);
const overallRate = totalTests > 0 ? ((totalPass / totalTests) * 100).toFixed(1) : '0.0';

// Print unified report
console.log(`\n
╔══════════════════════════════════════════════════════════════╗
║  📊 FULL STACK TEST REPORT — 20 Agents                     ║
╠══════════════════════════════════════════════════════════════╣`);
for (const r of results) {
    const pct = r.total > 0 ? ((r.pass / r.total) * 100).toFixed(0) : '0';
    const bar = '█'.repeat(Math.round(r.pass / r.total * 20)).padEnd(20, '░');
    const nameStr = `${r.icon} ${r.key} ${r.name}`.padEnd(35);
    console.log(`║  ${r.status} ${nameStr} ${String(r.pass).padStart(2)}/${String(r.total).padStart(2)} ${bar} ${pct.padStart(3)}% ║`);
}
console.log(`╠══════════════════════════════════════════════════════════════╣`);
if (totalFail === 0) {
    console.log(`║ OVERALL: ${totalPass}/${totalTests} passed (${overallRate}%) ${elapsed}s ║`);
} else {
    console.log(`║ OVERALL: ${totalPass}/${totalTests} passed (${overallRate}%) ${elapsed}s ║`);
}
console.log(`╚══════════════════════════════════════════════════════════════╝`);

if (totalFail === 0) {
    console.log('\n ALL JOURNEY AGENTS PASSED — Full loop verified!\n');
} else {
    console.log(`\n ${totalFail} total failure(s) across ${results.filter(r => r.fail > 0).length} agent(s)\n`);
}

// Save report
const fs = require('fs');
const reportFile = path.join(__dirname, 'journey-report.txt');
const reportLines = [
    'GACP Journey Test Report',
    `Date: ${new Date().toISOString()}`,
    `Target: ${targetUrl}`,
    `Runtime: ${elapsed}s`,
    '',
    ...results.map(r => `${r.status} ${r.key} ${r.name}: ${r.pass}/${r.total} (${r.total > 0 ? ((r.pass/r.total)*100).toFixed(1) : 0}%)`),
    '',
    `TOTAL: ${totalPass}/${totalTests} (${overallRate}%)`,
];
fs.writeFileSync(reportFile, reportLines.join('\n'), 'utf-8');
console.log(`Unified report → ${reportFile}\n`);

process.exit(totalFail > 0 ? 1 : 0);
})();
