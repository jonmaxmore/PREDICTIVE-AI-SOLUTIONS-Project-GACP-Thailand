'use strict';

/**
 * Give every existing plot a permanent code.
 *
 * The expand migration (20260824100000_plot_permanent_code_expand) added plots.plotCode as
 * nullable. This fills it for rows that predate it, so a later contract migration can make
 * the column required.
 *
 * Safe to run repeatedly: it only touches rows where plotCode IS NULL, so a second run is a
 * no-op rather than a re-issue. That matters more than it sounds — re-issuing a code would
 * orphan any sign already printed with the old one, and orphaning a sign is the failure this
 * whole column exists to prevent.
 *
 * qrIssuedAt is deliberately left NULL. The code exists; no sign has been printed yet. The
 * two are different facts and the day a farmer asks "was a sign ever made for this plot?"
 * the answer has to be honest.
 *
 * Usage:
 *   node prisma/backfill-plot-codes.js            # dry run, prints what it would do
 *   node prisma/backfill-plot-codes.js --apply    # writes
 */

const { PrismaClient } = require('@prisma/client');
const { generatePlotCode } = require('../shared/plot-code');

const prisma = new PrismaClient();
const APPLY = process.argv.includes('--apply');

async function main() {
    const pending = await prisma.plot.findMany({
        where: { plotCode: null },
        select: { id: true, name: true, farmId: true },
        orderBy: { createdAt: 'asc' },
    });

    const total = await prisma.plot.count();
    console.log(`แปลงทั้งหมด ${total} | ยังไม่มีรหัส ${pending.length}`);

    if (pending.length === 0) {
        console.log('ไม่มีอะไรต้องทำ');
        return;
    }

    if (!APPLY) {
        for (const plot of pending) {
            console.log(`  จะออกรหัสให้ ${plot.name} (${plot.id.slice(0, 8)})`);
        }
        console.log('\nDRY RUN — ยังไม่เขียน');
        return;
    }

    let written = 0;
    for (const plot of pending) {
        // The unique index is the arbiter, not this loop. A collision is astronomically
        // unlikely at 9.3e14 codes, but "unlikely" is not "handled": retry on the unique
        // violation rather than pre-checking, because a pre-check has a race window and a
        // retry does not.
        for (let attempt = 1; ; attempt++) {
            const plotCode = generatePlotCode();
            try {
                await prisma.plot.update({ where: { id: plot.id }, data: { plotCode } });
                console.log(`  ${plot.name} -> ${plotCode}`);
                written++;
                break;
            } catch (error) {
                const isUniqueViolation = error && error.code === 'P2002';
                if (!isUniqueViolation || attempt >= 5) throw error;
                console.warn(`  ชนกัน ลองใหม่ (${attempt})`);
            }
        }
    }

    const remaining = await prisma.plot.count({ where: { plotCode: null } });
    console.log(`\nออกรหัสแล้ว ${written} | เหลือที่ยังไม่มีรหัส ${remaining}`);
}

main()
    .catch((error) => {
        console.error('ERR', error.message);
        process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
