const express = require('express');
const router = express.Router();
// L-001: a holiday loader used to be destructured here and its result threaded
// into both branches below. It merged an environment variable with a system-
// configuration row (both named in the audit ledger L-001) — neither of which
// this repository ever seeds — so the Set it returned was empty on every request
// in any environment built from this tree, and this endpoint answered weekend-
// only. Not yet verified: the state of the staging DB and env (L-001 F1, operator
// check pending). If that row or that var was set by hand on a deployed system,
// this endpoint WAS holiday-aware there and the change below alters its numbers.
// Otherwise dropping the call keeps the answer bit-for-bit identical while
// removing the second Thai holiday calendar; the canonical one is
// utils/working-days.js. See the backlog:
// making this endpoint genuinely holiday-aware means moving it onto
// utils/working-days, which CHANGES the numbers it returns and is therefore a
// separate work item, not this dedup.
const {
    addWorkingDays,
    countWorkingDays,
} = require('../../../services/working-days-service');
const logger = require('../../../shared/logger');
const { buildStatusMachine } = require('../../../shared/status-machine-contract');

function toValidDate(value, fallback = null) {
    if (!value) {
        return fallback;
    }
    const parsed = new Date(String(value));
    return Number.isFinite(parsed.getTime()) ? parsed : null;
}

/**
 * GET /api/system/status-machine
 * Application workflow status machine definitions
 */
router.get('/status-machine', async (req, res) => {
    try {
        return res.json({ success: true, data: buildStatusMachine() });
    } catch (error) {
        logger.error('[system] load status machine failed:', error?.message); // C4-05
        return res.status(500).json({ success: false, error: 'Failed to load status machine' });
    }
});

router.get('/working-days', async (req, res) => {
    try {
        const now = new Date();
        const fromDate = toValidDate(req.query.from, now);
        if (!fromDate) {
            return res.status(400).json({
                success: false,
                error: 'INVALID_FROM_DATE',
            });
        }

        // Empty by construction — the removed loader never produced anything
        // else here (see the note on the import). Kept as a named binding so the
        // response shape (`holidayCount`, `holidays`) and the arithmetic calls
        // below are byte-for-byte the behaviour that shipped before L-001.
        const holidays = new Set();
        const days = Number.parseInt(String(req.query.days || ''), 10);
        const toDate = toValidDate(req.query.to, null);
        const includeHolidayList = String(req.query.includeHolidays || 'false').trim().toLowerCase() === 'true';

        if (Number.isFinite(days) && days >= 0) {
            const dueDate = addWorkingDays(fromDate, days, holidays);
            return res.json({
                success: true,
                data: {
                    from: fromDate.toISOString(),
                    workingDays: days,
                    dueDate: dueDate.toISOString(),
                    holidayCount: holidays.size,
                    ...(includeHolidayList ? { holidays: [...holidays].sort() } : {}),
                },
            });
        }

        if (toDate) {
            const total = countWorkingDays(fromDate, toDate, holidays);
            return res.json({
                success: true,
                data: {
                    from: fromDate.toISOString(),
                    to: toDate.toISOString(),
                    workingDays: total,
                    holidayCount: holidays.size,
                    ...(includeHolidayList ? { holidays: [...holidays].sort() } : {}),
                },
            });
        }

        return res.status(400).json({
            success: false,
            error: 'INVALID_QUERY',
            message: 'Provide ?days=<number> or ?to=<date>',
        });
    } catch (error) {
        logger.error('[System Working Days] Error:', error);
        // Do not echo raw error.message — the real cause is logged above.
        return res.status(500).json({
            success: false,
            error: 'Failed to calculate working days',
        });
    }
});

module.exports = router;
