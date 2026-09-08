import { config as loadDotenv } from 'dotenv';
import { PgBoss } from 'pg-boss';
import { pino } from 'pino';

loadDotenv({ path: '../../.env.local', quiet: true });
loadDotenv({ path: '../../.env', quiet: true });

// อ่าน env หลังโหลด .env.local เท่านั้น (import แบบ dynamic เพื่อให้ลำดับถูกต้อง)
const { readEnv } = await import('@gacp/contracts');
const env = readEnv();

const logger = pino({
  level: env.GACP_ENV === 'production' ? 'info' : 'debug',
  redact: ['*.nationalId', '*.password', '*.secret'],
});

// Automation ใช้ connection แบบ direct (ไม่ผ่าน pooler) เพราะ pg-boss ถือ connection ยาว
const automation = new PgBoss({
  connectionString: env.GACP_DATABASE_DIRECT_URL,
  schema: 'automation',
  // biome-ignore lint/style/useNamingConvention: ชื่อ option ของ pg-boss (ส่งต่อให้ PostgreSQL)
  application_name: 'gacp-automation',
});

automation.on('error', (error) => logger.error({ err: error }, 'pg-boss error'));

const HEARTBEAT_JOB = 'heartbeat';
const HEARTBEAT_SCHEDULE_EXPRESSION = '* * * * *';

await automation.start();
await automation.createQueue(HEARTBEAT_JOB);
await automation.schedule(HEARTBEAT_JOB, HEARTBEAT_SCHEDULE_EXPRESSION);
await automation.work(HEARTBEAT_JOB, async (jobs) => {
  for (const job of jobs) {
    logger.debug({ jobId: job.id }, 'automation heartbeat');
  }
});

logger.info({ environment: env.GACP_ENV }, 'automation started');

async function shutdown(signal: string): Promise<void> {
  logger.info({ signal }, 'automation stopping');
  await automation.stop({ graceful: true, timeout: 30_000 });
  process.exit(0);
}

process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
