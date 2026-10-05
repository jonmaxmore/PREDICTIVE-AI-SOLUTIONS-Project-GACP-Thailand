/**
 * Job Scheduler
 * Manages background jobs and scheduled tasks
 */

const cron = require('node-cron');
const logger = require('../../shared/logger');
const { prisma } = require('../prisma-database');
const { CANONICAL_ROLES } = require('../../shared/canonical-rbac');
const { NOTIFICATION_KIND } = require('../../shared/notification-kind');
const { getZonedParts, localMonthRange, nextLocalDayStart, DEFAULT_TIME_ZONE } = require('../../utils/working-days');

const DAY_MS = 24 * 60 * 60 * 1000;

// Every users.role spelling for an applicant, in BOTH the legacy casing and the
// canonical one, so this query is correct on either side of migration
// 20260801000000_canonicalize_user_role. An uppercase-only filter would
// match nothing post-migration and fail silently, as an empty result.
const APPLICANT_ROLES = Object.freeze([CANONICAL_ROLES.HEALTH]);

class JobScheduler {
  constructor() {
    this.jobs = [];
  }

  /**
   * Start all scheduled jobs
   */
  start() {
    logger.info('Starting job scheduler');

    // AI QC Queue Processing - Removed
    /*
    if (process.env.ENABLE_AI_QC === 'true') {
      // ...
    }
    */

    // Certificate Expiry Check - Daily at 8 AM
    const certExpiryJob = cron.schedule('0 8 * * *', async () => {
      try {
        logger.info('Running certificate expiry check');
        const thirtyDaysFromNow = new Date(Date.now() + 30 * DAY_MS);
        
        const expiringCerts = await prisma.certificate.findMany({
          where: {
            expiryDate: { lte: thirtyDaysFromNow },
            status: 'active',
          },
          include: { user: true },
        });
        
        logger.info(`Found ${expiringCerts.length} certificates expiring within 30 days`);
        // Notifications would be sent here in production
      } catch (error) {
        logger.error('Certificate expiry check failed:', error);
      }
    }, { timezone: DEFAULT_TIME_ZONE }); // the hour above is a Bangkok hour

    this.jobs.push({ name: 'Certificate Expiry', job: certExpiryJob });
    logger.info('Scheduled: Certificate Expiry Check (daily at 8 AM)');

    // Inspection Reminder - Daily at 7 AM
    const inspectionReminderJob = cron.schedule('0 7 * * *', async () => {
      try {
        logger.info('Running inspection reminder job');
        // Tomorrow as a Bangkok day: 00:00 tomorrow to 00:00 the day after.
        const tomorrow = nextLocalDayStart(new Date());
        const dayAfter = nextLocalDayStart(tomorrow);
        
        const upcomingAudits = await prisma.audit.findMany({
          where: {
            scheduledDate: { gte: tomorrow, lt: dayAfter },
            status: 'SCHEDULED',
          },
        });
        
        logger.info(`Found ${upcomingAudits.length} audits scheduled for tomorrow`);
        // Reminders would be sent here in production
      } catch (error) {
        logger.error('Inspection reminder failed:', error);
      }
    }, { timezone: DEFAULT_TIME_ZONE }); // the hour above is a Bangkok hour

    this.jobs.push({ name: 'Inspection Reminder', job: inspectionReminderJob });
    logger.info('Scheduled: Inspection Reminder (daily at 7 AM)');

    // Database Cleanup - Weekly on Sunday at 2 AM
    const cleanupJob = cron.schedule('0 2 * * 0', async () => {
      try {
        logger.info('Running database cleanup');
        const thirtyDaysAgo = new Date(Date.now() - 30 * DAY_MS);
        
        // Clean up old notifications. Official letters (R2 M1, operator
        // decision D-9 2026-08-03) are a permanent archive — the weekly
        // sweep must never take them, however old or read they are.
        const deletedNotifications = await prisma.notification.deleteMany({
          where: {
            createdAt: { lt: thirtyDaysAgo },
            isRead: true,
            kind: { not: NOTIFICATION_KIND.OFFICIAL_LETTER },
          },
        });
        
        logger.info(`Cleanup complete: ${deletedNotifications.count} old notifications removed`);
      } catch (error) {
        logger.error('Database cleanup failed:', error);
      }
    }, { timezone: DEFAULT_TIME_ZONE }); // the hour above is a Bangkok hour

    this.jobs.push({ name: 'Database Cleanup', job: cleanupJob });
    logger.info('Scheduled: Database Cleanup (weekly on Sunday at 2 AM)');

    // Report Generation - Monthly on 1st at 1 AM
    const monthlyReportJob = cron.schedule('0 1 1 * *', async () => {
      try {
        logger.info('Generating monthly reports');
        // Last Bangkok calendar month, as [start, end].
        const nowBkk = getZonedParts(new Date());
        const lastMonthRange = localMonthRange(nowBkk.year, nowBkk.month - 1);
        const startOfMonth = lastMonthRange.start;
        const endOfMonth = new Date(lastMonthRange.end.getTime() - 1);
        
        const stats = {
          applications: await prisma.application.count({ where: { createdAt: { gte: startOfMonth, lte: endOfMonth } } }),
          certificates: await prisma.certificate.count({ where: { issuedDate: { gte: startOfMonth, lte: endOfMonth } } }),
          Applicants: await prisma.user.count({ where: { createdAt: { gte: startOfMonth, lte: endOfMonth }, role: { in: [...APPLICANT_ROLES] } } }),
        };
        
        logger.info(`Monthly report: ${stats.applications} apps, ${stats.certificates} certs, ${stats.Applicants} new Applicants`);
      } catch (error) {
        logger.error('Monthly report generation failed:', error);
      }
    }, { timezone: DEFAULT_TIME_ZONE }); // the hour above is a Bangkok hour

    this.jobs.push({ name: 'Monthly Reports', job: monthlyReportJob });
    logger.info('Scheduled: Monthly Reports (1st of each month at 1 AM)');

    logger.info(`Job scheduler started with ${this.jobs.length} jobs`);
  }

  /**
   * Stop all scheduled jobs
   */
  stop() {
    logger.info('Stopping job scheduler');

    this.jobs.forEach(({ name, job }) => {
      job.stop();
      logger.info(`Stopped job: ${name}`);
    });

    this.jobs = [];
    logger.info('Job scheduler stopped');
  }

  /**
   * Get list of active jobs
   */
  getJobs() {
    return this.jobs.map(({ name }) => name);
  }

  /**
   * Run a job manually
   */
  async runJob(jobName) {
    const job = this.jobs.find(({ name }) => name === jobName);

    if (!job) {
      throw new Error(`Job not found: ${jobName}`);
    }

    logger.info(`Manually running job: ${jobName}`);

    // Jobs are functions, so we need to extract and call them
    // This is a workaround since cron jobs don't expose their callback directly
    switch (jobName) {
      // case 'AI QC Queue':
      //   await aiQcTrigger.processAIQCQueue();
      //   break;
      default:
        throw new Error(`Manual execution not implemented for: ${jobName}`);
    }


  }
}

module.exports = new JobScheduler();

