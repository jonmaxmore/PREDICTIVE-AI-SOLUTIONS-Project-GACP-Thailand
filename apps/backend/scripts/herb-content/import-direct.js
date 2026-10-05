'use strict';
/**
 * ต้นแบบ 5 (ก) — direct herb-content import, run INSIDE the backend container
 * against the target DB (used for the PROD import where the seeded API-admin
 * account does not exist). Idempotent: clears prior AI_DRAFT rows (never the
 * SEED_STARTER rows), then bulk-imports via the validated service.
 *
 * AI_DRAFT content — pending SSRU verification (advisory banner shown on all
 * herb pages). When SSRU verifies/replaces the content, drop the new files into
 * ./data and re-run this (idempotent) to refresh prod.
 *
 * Run (prod):
 *   docker cp scripts/herb-content/import-direct.js gacp-backend:/app/apps/backend/_import.js
 *   docker exec -w /app/apps/backend gacp-backend node _import.js
 *   docker exec gacp-backend rm -f /app/apps/backend/_import.js
 */
const path = require('path');
const svc = require('../../services/herb-knowledge-service');
const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

const DATA = path.join(__dirname, 'data');
const CODES = ['CANNABIS', 'TURMERIC', 'GINGER', 'BLACK_GALINGALE', 'PLAI', 'KRATOM'];

(async () => {
    for (const code of CODES) {
        const del = await prisma.herbKnowledgeEntry.deleteMany({
            where: { herbCode: code, source: { startsWith: 'AI_DRAFT' } },
        });
        const rows = require(path.join(DATA, `${code}.json`));
        const res = await svc.bulkImportEntries(code, rows, { actor: { id: 'content-import' } });
        console.log(`${code.padEnd(16)} cleared=${del.count} imported=${res.imported} skipped=${res.skipped}`);
    }
    const cov = await svc.getCoverageStats();
    console.log(`\nCOVERAGE meeting=${cov.herbsMeetingTarget}/${cov.totalHerbs} total=${cov.totalEntries}`);
    for (const h of cov.herbs) { console.log(`  ${h.code.padEnd(16)} ${h.count} ${h.meets300 ? 'OK' : 'LOW'}`); }
    await prisma.$disconnect();
    if (cov.herbsMeetingTarget !== cov.totalHerbs) { process.exit(2); }
})().catch((e) => { console.error('FATAL', e.message); process.exit(1); });
