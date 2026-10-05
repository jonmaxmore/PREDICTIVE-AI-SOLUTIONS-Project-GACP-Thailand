/**
 * Mega Agent Runner — Universal executor for config-driven agents
 */
const { JourneyRunner, api, loginHealth, loginProvider, generateThaiId, waitMs } = require('../journey-helper');
const https = require('https');
const BASE = process.argv[2] || 'https://gacpth.com';

async function fetchPage(path) {
    const agent = new https.Agent({ rejectUnauthorized: false });
    try {
        const res = await fetch(`${BASE}${path}`, { agent, redirect: 'follow' });
        const body = await res.text();
        return { status: res.status, ok: res.status >= 200 && res.status < 400, body };
    } catch (err) { return { status: 0, ok: false, body: '', error: err.message }; }
}

async function runAgent(agentDef) {
    const j = new JourneyRunner(`Agent ${agentDef.key} — ${agentDef.name}`, agentDef.icon);
    console.log(`\n${agentDef.icon} ${j.name}\n`);
    let tokens = {};
    try {
        for (const step of agentDef.steps) {
            if (step.login) {
                const id = generateThaiId(step.login === 'health' ? '110000000000' : '390000000000');
                const t = step.login === 'health' ? await loginHealth(id) : await loginProvider(id);
                if (t) { tokens[step.login] = t; j.pass(step.name, 'Token acquired'); }
                else j.fail(step.name, 'No token');
                await waitMs(300);
                continue;
            }
            if (step.type === 'page') {
                const r = await fetchPage(step.path);
                if (r.ok || r.status === 302 || r.status === 307) j.pass(step.name, `HTTP ${r.status}`);
                else j.fail(step.name, `HTTP ${r.status}`);
                if (step.check) {
                    const body = r.body || '';
                    if (step.check === 'title' && /<title>/i.test(body)) j.pass(step.name + ' title', 'Present');
                    else if (step.check === 'viewport' && /viewport/i.test(body)) j.pass(step.name + ' viewport', 'Present');
                }
            } else {
                const method = step.method || 'GET';
                const opts = {};
                if (step.token && tokens[step.token]) opts.token = tokens[step.token];
                if (step.body) opts.body = step.body;
                const r = await api(method, step.path, opts);
                const expect = step.expect || [200];
                if (r.ok || expect.includes(r.status)) {
                    let detail = `status: ${r.status}`;
                    if (step.field && r.data) {
                        const v = step.field.split('.').reduce((o, k) => o?.[k], r.data);
                        if (v !== undefined) detail += ` | ${step.field}: ${JSON.stringify(v).slice(0, 40)}`;
                    }
                    j.pass(step.name, detail);
                } else {
                    j.fail(step.name, `status: ${r.status}`);
                }
            }
            await waitMs(step.delay || 100);
        }
    } catch (err) { j.fail('Unexpected error', err.message); }
    return j.printReport();
}

module.exports = { runAgent, fetchPage };
