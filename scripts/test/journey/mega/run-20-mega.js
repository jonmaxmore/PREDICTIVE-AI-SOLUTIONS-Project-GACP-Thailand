#!/usr/bin/env node
/**
 * ═══════════════════════════════════════════════════════════════
 * 20-Agent Mega Suite — 2 agents × 10 expert categories
 * Frontend│Backend│DB│Health│Provider│DTAM│WHO│FDA│Agri│GACP
 * ═══════════════════════════════════════════════════════════════
 */
const { runAgent } = require('./mega-runner');
const fs = require('fs');
const path = require('path');

// Pick 2 best agents per category from full 100-agent config
const all = [
    ...require('./agents-frontend'),
    ...require('./agents-backend'),
    ...require('./agents-database-health'),
    ...require('./agents-provider-dtam'),
    ...require('./agents-expert'),
];

// Selected 20 agents: 2 per category
const selectedKeys = [
    'F01','F02',   // Frontend: Health Pages + Provider Pages
    'B01','B02',   // Backend: API Health + Auth/Token
    'D01','D02',   // Database: Connection + Master Data
    'H01','H02',   // Health User: Registration + Application
    'P01','P02',   // Provider: Reviewer + Auditor
    'T01','T05',   // DTAM: กทล.1 Form + Inspection Criteria
    'W01','W02',   // WHO: GACP Guidelines + Quality
    'A01','A03',   // FDA: Registration + Quality Control
    'G01','G02',   // Agriculture: Soil + Cultivation
    'E01','E03',   // GACP Expert: GAP + QA System
];

const agents = selectedKeys.map(k => all.find(a => a.key === k)).filter(Boolean);
const sleep = ms => new Promise(r => setTimeout(r, ms));
const startTime = Date.now();
const results = [];

console.log(`
╔══════════════════════════════════════════════════════════════╗
║  🚀 GACP 20-Agent Mega Suite — 10 Expert Categories        ║
║  Frontend│Backend│DB│Health│Provider│DTAM│WHO│FDA│Agri│GACP  ║
╚══════════════════════════════════════════════════════════════╝

  Agents:  ${agents.length} (2 per category × 10 categories)
  Target:  ${process.argv[2] || 'https://gacpth.com'}
  Date:    ${new Date().toISOString()}
`);

(async () => {
    for (const [i, agent] of agents.entries()) {
        if (i > 0) await sleep(2000);
        console.log(`\n${'═'.repeat(60)}`);
        console.log(`${agent.icon}  [${i+1}/${agents.length}] ${agent.key} — ${agent.name} (${agent.cat})`);
        console.log(`${'═'.repeat(60)}\n`);
        try {
            const r = await Promise.race([
                runAgent(agent),
                new Promise((_,rej) => setTimeout(() => rej(new Error('TIMEOUT')), 60000)),
            ]);
            results.push({key:agent.key,name:agent.name,cat:agent.cat,icon:agent.icon,...r});
        } catch (err) {
            console.log(`${agent.key} FAILED: ${err.message}`);
            results.push({key:agent.key,name:agent.name,cat:agent.cat,icon:agent.icon,pass:0,fail:1,skip:0,total:1,rate:'0.0'});
        }
    }

    // Category summary
    const cats = {};
    for (const r of results) {
        if (!cats[r.cat]) cats[r.cat] = {pass:0,fail:0,total:0,agents:0};
        cats[r.cat].pass+=r.pass; cats[r.cat].fail+=r.fail; cats[r.cat].total+=r.total; cats[r.cat].agents++;
    }
    const totalPass = results.reduce((s,r)=>s+r.pass,0);
    const totalFail = results.reduce((s,r)=>s+r.fail,0);
    const totalSteps = results.reduce((s,r)=>s+r.total,0);
    const elapsed = ((Date.now()-startTime)/1000).toFixed(1);

    console.log(`\n╔══════════════════════════════════════════════════════════════╗`);
    console.log(`║ MEGA REPORT — ${agents.length} Agents × 10 Categories ║`);
    console.log(`╠══════════════════════════════════════════════════════════════╣`);
    for (const r of results) {
        const pct = r.total>0?((r.pass/r.total)*100).toFixed(0):'0';
        const bar = '█'.repeat(Math.round(pct/5)).padEnd(20,'░');
        const st = r.fail===0?'🟢':'🔴';
        console.log(`║  ${st} ${r.icon} ${r.key} ${r.name.padEnd(28)} ${String(r.pass).padStart(2)}/${String(r.total).padStart(2)} ${bar} ${pct.padStart(3)}% ║`);
    }
    console.log(`╠══════════════════════════════════════════════════════════════╣`);
    console.log(`║ CATEGORY BREAKDOWN ║`);
    for (const [cat,c] of Object.entries(cats)) {
        const pct = c.total>0?((c.pass/c.total)*100).toFixed(0):'0';
        console.log(`║  ${cat.padEnd(20)} ${c.agents} agents  ${c.pass}/${c.total} (${pct}%)`.padEnd(63)+'║');
    }
    console.log(`╠══════════════════════════════════════════════════════════════╣`);
    const pct = totalSteps>0?((totalPass/totalSteps)*100).toFixed(1):'0.0';
    const st = totalFail===0?'🟢':'🟡';
    console.log(`║ ${st} OVERALL: ${totalPass}/${totalSteps} passed (${pct}%) ${elapsed}s`.padEnd(63)+'║');
    console.log(`╚══════════════════════════════════════════════════════════════╝`);
    if (totalFail===0) console.log('\n ALL 20 MEGA AGENTS PASSED!');
    else console.log(`\n ${totalFail} failure(s) across ${results.filter(r=>r.fail>0).length} agent(s)`);

    // Save
    const rpt = path.join(__dirname,'mega-20-report.txt');
    const lines = [`GACP 20-Agent Mega Report`,`Date: ${new Date().toISOString()}`,
        `Overall: ${totalPass}/${totalSteps} (${pct}%) in ${elapsed}s`,'',
        ...results.map(r=>`${r.fail===0?'PASS':'FAIL'} | ${r.key} | ${r.name} (${r.cat}) | ${r.pass}/${r.total}`)];
    fs.writeFileSync(rpt,lines.join('\n'),'utf-8');
    console.log(`\nReport → ${rpt}\n`);
    process.exit(totalFail>0?1:0);
})().catch(err=>{console.error('Fatal:',err);process.exit(2);});
