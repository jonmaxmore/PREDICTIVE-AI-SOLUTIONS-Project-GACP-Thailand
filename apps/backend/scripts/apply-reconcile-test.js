// Apply the reconcile.sql to the local DB (idempotent test).
// Pass the SQL file path as arg.
//
// Splits on top-level ';' but keeps DO $$ ... $$; blocks intact.
const { PrismaClient } = require('@prisma/client');
const { readFileSync } = require('fs');

const sqlPath = process.argv[2] || '/tmp/reconcile.sql';
const sql = readFileSync(sqlPath, 'utf8');

function splitStatements(text) {
    const statements = [];
    let buf = '';
    let inDollar = false;
    const lines = text.split('\n');
    for (const line of lines) {
        if (line.trim().startsWith('--')) {continue;} // strip comments
        // Toggle dollar-quote state for DO $$ ... $$
        const dollarMatches = (line.match(/\$\$/g) || []).length;
        if (dollarMatches % 2 === 1) {inDollar = !inDollar;}
        buf += line + '\n';
        if (!inDollar && /;\s*$/.test(line)) {
            const stmt = buf.trim();
            if (stmt) {statements.push(stmt);}
            buf = '';
        }
    }
    if (buf.trim()) {statements.push(buf.trim());}
    return statements;
}

const c = new PrismaClient();

(async () => {
    const stmts = splitStatements(sql);
    console.log(`split into ${stmts.length} statements`);
    let ok = 0; let failed = 0;
    for (const s of stmts) {
        try {
            await c.$executeRawUnsafe(s);
            ok += 1;
        } catch (e) {
            failed += 1;
            console.error(`FAIL: ${s.split('\n')[0].slice(0, 80)} -> ${e.message.split('\n')[0]}`);
        }
    }
    console.log(`done: ok=${ok} failed=${failed}`);
    process.exitCode = failed > 0 ? 1 : 0;
    await c.$disconnect();
})();
