'use strict';

/**
 * The one place that words and sends "your inspection is booked / moved".
 *
 * Both scheduling doors (the queue, audit-scheduling-service.assignAuditor, and the
 * calendar, scheduler-audit-schedules-post-handler) call this. Before it existed they
 * disagreed: the queue told only the farmer, the calendar told both in English with a raw
 * ISO instant ("scheduled for 2026-10-12T02:30:00.000Z").
 *
 * Dates are printed the way a Thai reader reads them (business-dates rule): the Bangkok
 * day and Bangkok wall clock, in the Buddhist year. The process clock is UTC, so reading
 * the instant's own fields would print the day before for anything booked before 07:00.
 *
 * Delivery is in-app (createNotification), the only business channel left (external-services
 * cleanup). It never throws: the schedule has already been written when this runs.
 */

const logger = require('../../shared/logger');
const { THAI_MONTHS_FULL } = require('../../utils/thai-format');
const { getZonedParts, DEFAULT_TIME_ZONE } = require('../../utils/working-days');
const { createNotification } = require('../notification-service');

function toDate(value) {
    if (!value) { return null; }
    const d = value instanceof Date ? value : new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
}

/** "12 ตุลาคม 2569" — Bangkok day, Buddhist year. */
function formatBangkokThaiDate(value) {
    const d = toDate(value);
    if (!d) { return ''; }
    const { year, month, day } = getZonedParts(d);
    return `${day} ${THAI_MONTHS_FULL[month - 1]} ${year + 543}`;
}

/** "09:30" — Bangkok wall clock, 24 hours. */
function formatBangkokTime(value) {
    const d = toDate(value);
    if (!d) { return ''; }
    return new Intl.DateTimeFormat('en-GB', {
        hour: '2-digit', minute: '2-digit', hour12: false, timeZone: DEFAULT_TIME_ZONE,
    }).format(d);
}

function whenText(value) {
    return `วันที่ ${formatBangkokThaiDate(value)} เวลา ${formatBangkokTime(value)} น.`;
}

/**
 * @param {object} p
 * @param {string} p.applicationId
 * @param {string} p.applicationNumber
 * @param {Date|string} p.scheduledAt
 * @param {string} [p.auditorName]
 * @param {'ONSITE'|'ONLINE_MEET'} [p.inspectionMode]
 * @param {string|null} [p.location]
 * @param {string|null} [p.mapLink]
 * @param {string|null} [p.meetingLink]
 * @param {boolean} [p.rescheduled]
 * @param {Date|string|null} [p.previousScheduledAt]
 * @returns {{ farmer: {type, title, message, data}, inspector: {type, title, message, data} }}
 */
function buildAuditScheduleNotices(p = {}) {
    const number = p.applicationNumber || '-';
    const online = p.inspectionMode === 'ONLINE_MEET';
    const rescheduled = Boolean(p.rescheduled);
    const previous = toDate(p.previousScheduledAt);
    const when = whenText(p.scheduledAt);
    const movedFrom = rescheduled && previous ? ` (เดิม ${whenText(previous)})` : '';

    const where = online
        ? (p.meetingLink ? `ตรวจออนไลน์ ลิงก์ประชุม ${p.meetingLink}` : 'ตรวจออนไลน์')
        : (p.location || p.mapLink
            ? `ตรวจที่ฟาร์ม ${[p.location, p.mapLink].filter(Boolean).join(' ')}`
            : 'ตรวจที่ฟาร์ม');

    const data = {
        applicationId: p.applicationId,
        applicationNumber: p.applicationNumber,
        scheduledDate: toDate(p.scheduledAt) ? toDate(p.scheduledAt).toISOString() : null,
        inspectionMode: p.inspectionMode || null,
        action: rescheduled ? 'AUDIT_RESCHEDULED' : 'AUDIT_SCHEDULED',
    };

    const farmerMessage = `คำขอเลขที่ ${number} ${rescheduled ? 'เลื่อนนัดตรวจประเมินเป็น' : 'มีนัดตรวจประเมิน'} ${when}${movedFrom} `
        + `ผู้ตรวจประเมินคือ ${p.auditorName || 'ผู้ที่ได้รับมอบหมาย'} ${where}`;
    const inspectorMessage = `คุณ${rescheduled ? 'มีการเลื่อนนัดตรวจ' : 'ได้รับมอบหมายให้ตรวจ'}คำขอเลขที่ ${number} ${when}${movedFrom} ${where}`;

    return {
        farmer: {
            type: 'INFO',
            title: rescheduled ? 'เลื่อนนัดตรวจประเมิน' : 'นัดหมายตรวจประเมิน',
            message: farmerMessage,
            data: { ...data, auditorName: p.auditorName || null },
        },
        inspector: {
            type: 'INFO',
            title: rescheduled ? 'เลื่อนนัดตรวจประเมิน' : 'ได้รับมอบหมายงานตรวจประเมิน',
            message: inspectorMessage,
            data: {
                ...data,
                meetingLink: online ? (p.meetingLink || null) : null,
                mapLink: online ? null : (p.mapLink || null),
                location: online ? null : (p.location || null),
            },
        },
    };
}

/**
 * Tell the farmer and the inspector. Best effort: a failure is logged, never thrown.
 * @param {object} p  everything buildAuditScheduleNotices takes, plus
 * @param {string|null} p.farmerUserId
 * @param {string|null} p.auditorId
 * @returns {Promise<{ farmer: object|null, inspector: object|null }>}
 */
async function notifyAuditScheduled(p = {}) {
    const notices = buildAuditScheduleNotices(p);
    const send = async (userId, notice, who) => {
        if (!userId) { return null; }
        try {
            return await createNotification({ userId, ...notice });
        } catch (err) {
            logger.warn(`[audit-schedule-notices] ${who} notification failed: ${err && err.message}`);
            return null;
        }
    };
    const [farmer, inspector] = await Promise.all([
        send(p.farmerUserId, notices.farmer, 'farmer'),
        send(p.auditorId, notices.inspector, 'inspector'),
    ]);
    return { farmer, inspector };
}

module.exports = {
    buildAuditScheduleNotices,
    notifyAuditScheduled,
    formatBangkokThaiDate,
    formatBangkokTime,
};
