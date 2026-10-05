/**
 * Job Scheduler
 * Manages all cron jobs for the GACP platform
 */

const cron = require('node-cron');
const logger = require('../shared/logger');
const { checkExpiredDeadlines } = require('./revision-deadline-checker');
const workActivitySlaMonitor = require('./work-activity-sla-monitor');
const renewalReminderCron = require('../cron/renewal-reminder-cron');
const { DEFAULT_TIME_ZONE } = require('../utils/working-days');

class JobScheduler {
  constructor() {
    this.jobs = [];
  }

  start() {
    logger.info('[Job Scheduler] Starting all scheduled jobs...');

    // Application SLA-breach detection runs via the BullMQ queue
    // (services/queue-service.js → jobs/sla-processor.js, daily 08:00,
    // canonical statuses). The old node-cron jobs/sla-monitor.js used
    // non-canonical SLA_RULES keys (matched 0 rows) + an always-zero daily
    // report; both were dead and removed (audit 2.2).

    // Revision Deadline Auto-Cancel — hourly (:15)
    this.jobs.push(
      cron.schedule('15 * * * *', async () => {
        logger.info('[Cron] Running Revision Deadline Checker (hourly)');
        try {
          const stats = await checkExpiredDeadlines();
          logger.info('[Cron] Revision Deadline Checker result:', stats);
        } catch (error) {
          logger.error('[Cron] Revision Deadline Checker failed:', error);
        }
      }),
    );

    // Certificate Expiry Check — every day at 00:00
    this.jobs.push(
      cron.schedule('0 0 * * *', async () => {
        logger.info('[Cron] Running certificate expiry check (daily)');
        try {
          const { prisma } = require('../services/prisma-database');
          const { sendNotification, NotifyType } = require('../services/notification-service');
          const { runWithTenantContext, withoutTenantScope } = require('../services/tenant-context');

          const thirtyDaysFromNow = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

          // Cross-tenant scan: cron has no tenant scope. Per-cert
          // notification writes re-enter the cert's tenant via
          // runWithTenantContext below.
          const expiringCerts = await withoutTenantScope(() => prisma.certificate.findMany({
            where: {
              status: 'active',
              expiryDate: {
                lte: thirtyDaysFromNow,
                gte: new Date(),
              },
              isDeleted: false,
            },
            include: {
              user: {
                select: { id: true, firstName: true, lastName: true },
              },
            },
          }));

          let sent = 0;
          for (const cert of expiringCerts) {
            if (!cert.organizationId) {
              logger.error(`[Cron] Certificate ${cert.id} missing organizationId; skipping per-tenant scope`);
              continue;
            }

            const daysUntilExpiry = Math.ceil((new Date(cert.expiryDate) - new Date()) / (1000 * 60 * 60 * 24));

            await runWithTenantContext({ organizationId: cert.organizationId }, () =>
              sendNotification(cert.userId, NotifyType.CERTIFICATE_EXPIRING, {
                certificateNumber: cert.certificateNumber,
                expiryDate: cert.expiryDate.toLocaleDateString('th-TH', { timeZone: DEFAULT_TIME_ZONE }),
                daysUntilExpiry,
              }),
            );
            sent++;
          }

          logger.info(`[Cron] Sent ${sent}/${expiringCerts.length} certificate expiry notifications`);
        } catch (error) {
          logger.error('[Cron] Certificate expiry check failed:', error);
        }
      }, { timezone: 'Asia/Bangkok' }),
    );

    // 6. (removed) Subscription Expiry. 2026-09-11 — operator: แพลตฟอร์มไม่มีบริการ
    // แพ็กเกจสมาชิก งานที่ปล่อยให้แถวหมดอายุจึงไม่มีแถวให้ทำงานด้วย และตาราง
    // subscriptions ถูกลบใน 20260911140000_retire_subscriptions_and_slips

    // 6b. Work Activity SLA Monitor (ADR-016 Phase 1B) — hourly at :30.
    // Checks open WorkActivity rows past warningAt/dueAt and dispatches
    // WORK_ACTIVITY_WARNING / WORK_ACTIVITY_BREACH notifications.
    // Dedup is per-row (warnedAt + breachedAt columns) so an overdue
    // row only triggers one alert, never repeated.
    this.jobs.push(
      cron.schedule('30 * * * *', async () => {
        logger.info('[Cron] Running Work Activity SLA Monitor');
        try {
          const stats = await workActivitySlaMonitor.checkOverdueActivities();
          logger.info('[Cron] Work Activity SLA Monitor result:', stats);
        } catch (error) {
          logger.error('[Cron] Work Activity SLA Monitor failed:', error);
        }
      }),
    );

    // 7. (removed) Subscription auto-renewal. M3 / มติ operator 2026-08-23
    // "ไม่มีค่าสมาชิก" — ไม่มีค่าสมาชิก งานที่เคยเรียกเก็บซ้ำตอนแพ็กเกจใกล้หมดอายุ
    // (สร้างแถว PENDING_PAYMENT ใหม่ + ใบแจ้งหนี้ที่มีราคา) จึงถูกลบพร้อมฟังก์ชันที่มันเรียก
    // 2026-09-11 งานที่ 6 ถูกลบตามไปด้วย พร้อมทั้งพื้นผิวแพ็กเกจสมาชิกทั้งชุด

    // 8. Renewal Reminder — daily 09:00 Asia/Bangkok. Walks the 60/30/15-day
    // cadence tiers and dispatches CERTIFICATE_EXPIRING_SOON via the
    // notification fanout for each ACTIVE certificate expiring on exactly
    // that day.
    // Idempotent — re-runs same day skip already-sent reminders via
    // formData.renewalReminders marker (see renewal-service.markRenewalReminderSent).
    this.jobs.push(
      cron.schedule('0 9 * * *', async () => {
        logger.info('[Cron] Running Renewal Reminder');
        try {
          const summary = await renewalReminderCron.run();
          logger.info('[Cron] Renewal Reminder result:', summary);
        } catch (error) {
          logger.error('[Cron] Renewal Reminder failed:', error);
        }
      }, { timezone: 'Asia/Bangkok' }),
    );

    // 10. PDPA retention sweep — daily 02:30 BKK (B-JOB-10 fix, 2026-06-04).
    // Anonymises PII whose retainUntil has elapsed (PDPA ม.37). Previously the
    // job existed (jobs/pdpa-retention-job.js) but was NEVER registered here, so
    // the legal retention sweep never ran in production. Idempotent + tenant-safe
    // (runs withoutTenantScope, skips already-anonymised rows).
    this.jobs.push(
      cron.schedule('30 2 * * *', async () => {
        logger.info('[Cron] Running PDPA retention sweep');
        try {
          // Lazy-require so scheduler module-load does not pull in
          // prisma-database (keeps the scheduler unit-tests' light mocks valid).
          const { runPdpaRetentionSweep } = require('./pdpa-retention-job');
          const result = await runPdpaRetentionSweep();
          logger.info('[Cron] PDPA retention sweep result:', result);
        } catch (error) {
          logger.error('[Cron] PDPA retention sweep failed:', error);
        }
      }, { timezone: 'Asia/Bangkok' }),
    );

    // 11. Audit hash-chain integrity verify — daily 03:15 Asia/Bangkok
    // (audit gap #14, carpet-bomb-inversion-audit-2026-07-06 #27). verifyChain
    // was a dead control (zero non-test callers): tamper-evidence that was
    // never checked. This sweeps each tenant's recent chain window and logs
    // [AUDIT_CHAIN_ALERT] on any LINK/HASH mismatch, so a post-write edit to an
    // immutable audit row (e.g. flipping an AUDITOR REJECT→APPROVE, or changing
    // a paid amount in metadata) is surfaced instead of silently trusted at the
    // 5-year DTAM inspection.
    //
    // BASELINE (v2-cutover): resolved INSIDE runScheduledChainVerification.
    // Precedence (FU-2 MUST-3): explicit fromSequence (deliberate forensic
    // caller intent, e.g. {windowSize:0, fromSequence:0} full scan) > the
    // per-tenant SystemConfig `audit_chain_baselines` map when seeded (a NEW
    // tenant's fresh chain must not be skipped by the legacy tenant's global
    // floor) > env AUDIT_CHAIN_VERIFY_FROM_SEQ (set ONCE at deploy to the
    // then-current max(sequenceNumber) so the sweep does NOT cry wolf on
    // PRE-EXISTING benign legacy breaks: PDPA re-key/detokenize mutated audit
    // columns → standing HASH_MISMATCH; dropped sequences → LINK_MISMATCH).
    // This nightly cron passes NOTHING so the map (or env) applies. See
    // services/audit-trail.js (also: wire [AUDIT_CHAIN_ALERT] to in-country
    // alerting; weekly full scan TODO).
    this.jobs.push(
      cron.schedule('15 3 * * *', async () => {
        logger.info('[Cron] Running Audit Chain Integrity Verify');
        try {
          // Lazy-require keeps the scheduler unit-test light mocks valid
          // (mirrors the PDPA retention sweep block above).
          const { runScheduledChainVerification } = require('../services/audit-trail');
          const summary = await runScheduledChainVerification();
          logger.info('[Cron] Audit Chain Integrity Verify result:', summary);
        } catch (error) {
          logger.error('[Cron] Audit Chain Integrity Verify failed:', error);
        }
      }, { timezone: 'Asia/Bangkok' }),
    );

    // 12. Waiver decision-SLA escalation — daily 09:30 Asia/Bangkok (owner
    // stress-test mandate 2026-07-08: "leniency needs a decision SLA or the
    // safety valve is theoretical"). PENDING waiver-reopen requests older
    // than 5 WORKING days re-ping the waiver approvers (both finance roles) + the requesting
    // inspector daily until decided. Idempotence = daily cadence by design.
    this.jobs.push(
      cron.schedule('30 9 * * *', async () => {
        logger.info('[Cron] Running Waiver SLA Escalation');
        try {
          // Lazy-require keeps the scheduler unit-test light mocks valid
          // (mirrors the PDPA retention sweep block above).
          const { runWaiverSlaEscalation } = require('./waiver-sla-escalation-job');
          const summary = await runWaiverSlaEscalation();
          logger.info('[Cron] Waiver SLA Escalation result:', summary);
        } catch (error) {
          logger.error('[Cron] Waiver SLA Escalation failed:', error);
        }
      }, { timezone: 'Asia/Bangkok' }),
    );

    // 13. Payment Reminder Sweep (W3-41 Q2-D2) — daily 09:00 Asia/Bangkok.
    // For every pending CERTIFICATION_CHECKOUT invoice, dispatches whichever
    // of the three shifted reminder days (PRE_DUE / DUE_DATE / OVERDUE_NOTICE,
    // checkout-schedule-service) falls on today (ICT). Idempotent via the
    // durable PaymentReminderLog unique key (insert-first, P2002 = skip).
    // NEVER writes invoice state — OVERDUE stays derived-only.
    this.jobs.push(
      cron.schedule('0 9 * * *', async () => {
        logger.info('[Cron] Running Payment Reminder Sweep');
        try {
          // Lazy-require keeps the scheduler unit-test light mocks valid
          // (mirrors the PDPA retention sweep block above).
          const { runPaymentReminderSweep } = require('./payment-reminder-job');
          const summary = await runPaymentReminderSweep();
          logger.info('[Cron] Payment Reminder Sweep result:', summary);
        } catch (error) {
          logger.error('[Cron] Payment Reminder Sweep failed:', error);
        }
      }, { timezone: 'Asia/Bangkok' }),
    );

    // 14. Payment Closure Sweep (R2 M5) — daily 03:00 Asia/Bangkok. Closes a
    // checkout case whose payment was ABANDONED: a PENDING invoice past its
    // dueDate by more than the configured calendar-day threshold AND fully
    // reminded (all 3 PaymentReminderLog types). Marks the application terminal
    // (closedReason=PAYMENT_ABANDONED) + one canonical audit row + a
    // notification. Idempotent (an already-EXPIRED case is skipped); moves NO
    // money — invoice/payment state is never touched.
    this.jobs.push(
      cron.schedule('0 3 * * *', async () => {
        logger.info('[Cron] Running Payment Closure Sweep');
        try {
          // Lazy-require keeps the scheduler unit-test light mocks valid
          // (mirrors the PDPA retention sweep block above).
          const { runPaymentClosureSweep } = require('./payment-closure-job');
          const summary = await runPaymentClosureSweep();
          logger.info('[Cron] Payment Closure Sweep result:', summary);
        } catch (error) {
          logger.error('[Cron] Payment Closure Sweep failed:', error);
        }
      }, { timezone: 'Asia/Bangkok' }),
    );

    // 15. Settlement Reconcile (Task 5, settlement-resilience) — every 10
    // min. The Stripe-truth backstop: re-drives webhook events stuck
    // RECEIVED/FAILED past their retry window, and orders Stripe reports
    // captured but never advanced past PENDING_PAYMENT locally (webhook
    // lost/late/erroring). Both queries delegate the actual settle to
    // checkout-settlement-service (settleEvent / settleFromPaymentIntent) —
    // this job never writes SETTLED itself. Bounded (SETTLEMENT.
    // RECONCILE_BATCH) + fault-isolated per row, same idiom as the sweeps
    // above.
    this.jobs.push(
      cron.schedule('*/10 * * * *', async () => {
        logger.info('[Cron] Running Settlement Reconcile');
        try {
          // Lazy-require keeps the scheduler unit-test light mocks valid
          // (mirrors the PDPA retention sweep block above).
          const { runSettlementReconcile } = require('./settlement-reconcile-job');
          const summary = await runSettlementReconcile();
          logger.info('[Cron] Settlement Reconcile result:', summary);
        } catch (error) {
          logger.error('[Cron] Settlement Reconcile failed:', error);
        }
      }, { timezone: 'Asia/Bangkok' }),
    );

    // 16. Stale PENDING document pre-check sweep — every 5 min (final review M4,
    // 2026-09-29). A pre-check whose job was lost with Redis, or whose FAILED
    // write died with the database, stays PENDING for ever; the queue's own
    // `failed` handler never hears of it. Rows PENDING past 10 minutes become
    // FAILED with the one failure flag (jobs/document-precheck-stale-sweep.js).
    // Idempotent + tenant-safe (cross-tenant scan, per-row tenant write).
    this.jobs.push(
      cron.schedule('*/5 * * * *', async () => {
        try {
          // Lazy-require, same reason as the blocks above.
          const { runStalePrecheckSweep } = require('./document-precheck-stale-sweep');
          await runStalePrecheckSweep();
        } catch (error) {
          logger.error('[Cron] Stale pre-check sweep failed:', error);
        }
      }, { timezone: 'Asia/Bangkok' }),
    );

    logger.info(`[Job Scheduler] Started ${this.jobs.length} scheduled jobs`);
  }

  stop() {
    logger.info('[Job Scheduler] Stopping all scheduled jobs...');
    this.jobs.forEach(job => job.stop());
    this.jobs = [];
  }
}

const scheduler = new JobScheduler();

if (process.env.NODE_ENV !== 'test') {
  scheduler.start();
}

module.exports = scheduler;
