#!/usr/bin/env node
/**
 * Backfill the relational `application_documents` table from existing
 * `Application.formData.draftDocuments` (and `Application.attachments`) JSON.
 *
 * Idempotent: skips (applicationId, documentId) rows that already exist.
 * fileHash/photoHash are computed from the on-disk file when reachable; if a
 * file is missing (older uploads), the row is still created with null hashes
 * (the fraud scan recomputes/handles nulls).
 *
 * Run inside the backend container/image (needs the generated Prisma client):
 *   node scripts/backfill-application-documents.js
 */
const path = require('path');
const { prisma } = require('../services/prisma-database');
const sync = require('../services/application-document-sync');
const logger = require('../shared/logger');

const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(process.cwd(), 'uploads'));

function toAbsolute(fileUrl) {
  const f = String(fileUrl || '').trim();
  if (!f) { return null; }
  const rel = f.replace(/^\/?uploads\//, '').replace(/^\//, '');
  return path.join(UPLOAD_DIR, rel);
}

async function main() {
  if (!prisma.applicationDocument) {
    logger.error('[backfill] prisma.applicationDocument is undefined — regenerate the Prisma client first.');
    process.exit(1);
  }
  const apps = await prisma.application.findMany({ select: { id: true, formData: true, attachments: true } });
  let created = 0; let skipped = 0; let scanned = 0;
  for (const app of apps) {
    const fd = (app.formData && typeof app.formData === 'object') ? app.formData : {};
    const fromDraft = Array.isArray(fd.draftDocuments) ? fd.draftDocuments : [];
    const fromAttach = Array.isArray(app.attachments) ? app.attachments : [];
    const docs = [...fromDraft, ...fromAttach].filter((d) => d && (d.fileUrl || d.url));
    for (const d of docs) {
      scanned++;
      const documentId = d.documentId || d.id || null;
      if (documentId) {
        const exists = await prisma.applicationDocument.findFirst({ where: { applicationId: app.id, documentId } });
        if (exists) { skipped++; continue; }
      }
      const row = await sync.syncApplicationDocument(prisma, {
        applicationId: app.id,
        documentId,
        slotId: d.slotId || null,
        stepKey: d.stepKey || null,
        fileName: d.fileName || d.name || null,
        fileUrl: d.fileUrl || d.url,
        fileSize: Number.isInteger(d.size) ? d.size : (Number.isInteger(d.fileSize) ? d.fileSize : null),
        mimeType: d.mimeType || d.type || null,
        uploadedBy: d.uploadedBy || null,
        absolutePath: toAbsolute(d.fileUrl || d.url),
      });
      if (row) { created++; }
    }
  }
  logger.info(`[backfill] applications=${apps.length} scanned=${scanned} created=${created} skipped=${skipped}`);
  await prisma.$disconnect();
}

main().catch((e) => { logger.error('[backfill] failed:', e); process.exit(1); });
