#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════
 * 100-Agent Mega Full Stack Test Suite — Orchestrator
 * Categories: Frontend, Backend, Database, Health, Provider,
 *             DTAM, WHO, FDA, Agriculture, GACP Expert
 * ═══════════════════════════════════════════════════════════════
 */
const { runAgent } = require('./mega-runner');
const fs = require('fs');
const path = require('path');

// Load all agent definitions
const agents = [
    ...require('./agents-frontend'),
    ...require('./agents-backend'),
    ...require('./agents-database-health'),
    ...require('./agents-provider-dtam'),
    ...require('./agents-expert'),
];

const sleep = ms => new Promise(r => setTimeout(r, ms));
const startTime = Date.now();
const results = [];

console.log(`
╔══════════════════════════════════════════════════════════════╗
║  🚀 GACP 100-Agent Mega Full Stack Test Suite               ║
║  Frontend│Backend│DB│Health│Provider│DTAM│WHO│FDA│Agri│GACP  ║
╚══════════════════════════════════════════════════════════════╝

  Agents:  ${agents.length}
  Target:  ${process.argv[2] || 'https://gacpth.com'}
  Date:    ${new Date().toISOString()}
`);

(async () => {
    for (const [i, agent] of agents.entries()) {
        if (i > 0) await sleep(1500); // 1.5s cooldown between agents
        console.log(`\n${'═'.repeat(60)}`);
        console.log(`${agent.icon}  [${i + 1}/${agents.length}] ${agent.key} — ${agent.name} (${agent.cat})`);
        console.log(`${'═'.repeat(60)}\n`);

        try {
            const r = await Promise.race([
                runAgent(agent),
                new Promise((_, rej) => setTimeout(() => rej(new Error('TIMEOUT')), 60000)),
            ]);
            results.push({ key: agent.key, name: agent.name, cat: agent.cat, icon: agent.icon, ...r });
        } catch (err) {
            console.log(`${agent.key} FAILED: ${err.message}`);
            results.push({ key: agent.key, name: agent.name, cat: agent.cat, icon: agent.icon, pass: 0, fail: 1, skip: 0, total: 1, rate: '0.0' });
        }
    }

    // ─── Category Summary ───
    const cats = {};
    for (const r of results) {
        if (!cats[r.cat]) cats[r.cat] = { pass: 0, fail: 0, total: 0, agents: 0 };
        cats[r.cat].pass += r.pass;
        cats[r.cat].fail += r.fail;
        cats[r.cat].total += r.total;
        cats[r.cat].agents++;
    }

    const totalPass = results.reduce((s, r) => s + r.pass, 0);
    const totalFail = results.reduce((s, r) => s + r.fail, 0);
    const totalSteps = results.reduce((s, r) => s + r.total, 0);
    const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);

    // ─── Print Report ───
    console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
    console.log(`║ MEGA TEST REPORT — ${agents.length} Agents ║`);
    console.log(`╠══════════════════════════════════════════════════════════════╣`);

    for (const r of results) {
        const pct = r.total > 0 ? ((r.pass / r.total) * 100).toFixed(0) : '0';
        const bar = '█'.repeat(Math.round(pct / 5)).padEnd(20, '░');
        const status = r.fail === 0 ? '🟢' : '🔴';
        const line = `${status} ${r.icon} ${r.key} ${r.name}`;
        console.log(`║  ${line.padEnd(38)} ${String(r.pass).padStart(2)}/${String(r.total).padStart(2)} ${bar} ${pct.padStart(3)}% ║`);
    }

    console.log(`╠══════════════════════════════════════════════════════════════╣`);
    console.log(`║ CATEGORY SUMMARY ║`);
    for (const [cat, c] of Object.entries(cats)) {
        const pct = c.total > 0 ? ((c.pass / c.total) * 100).toFixed(0) : '0';
        console.log(`║  ${cat.padEnd(20)} ${c.agents} agents  ${c.pass}/${c.total} (${pct}%)`.padEnd(63) + '║');
    }
    console.log(`╠══════════════════════════════════════════════════════════════╣`);
    const overallPct = totalSteps > 0 ? ((totalPass / totalSteps) * 100).toFixed(1) : '0.0';
    const overallStatus = totalFail === 0 ? '🟢' : '🟡';
    console.log(`║ ${overallStatus} OVERALL: ${totalPass}/${totalSteps} passed (${overallPct}%) ${elapsed}s`.padEnd(63) +'║');
    console.log(`╚══════════════════════════════════════════════════════════════╝`);

    if (totalFail === 0) console.log('\n ALL 100 AGENTS PASSED!');
    else console.log(`\n ${totalFail} failure(s) across ${results.filter(r => r.fail > 0).length} agent(s)`);

    // ─── Save Report ───
    const reportFile = path.join(__dirname, 'mega-report.txt');
    const lines = [
        `GACP 100-Agent Mega Report`,
        `Date: ${new Date().toISOString()}`,
        `Overall: ${totalPass}/${totalSteps} (${overallPct}%) in ${elapsed}s`,
        '',
        ...results.map(r => `${r.fail === 0 ? 'PASS' : 'FAIL'} | ${r.key} | ${r.name} | ${r.pass}/${r.total}`),
    ];
    fs.writeFileSync(reportFile, lines.join('\n'), 'utf-8');
    console.log(`\nReport → ${reportFile}\n`);

    process.exit(totalFail > 0 ? 1 : 0);
})().catch(err => { console.error('Fatal:', err); process.exit(2); });
