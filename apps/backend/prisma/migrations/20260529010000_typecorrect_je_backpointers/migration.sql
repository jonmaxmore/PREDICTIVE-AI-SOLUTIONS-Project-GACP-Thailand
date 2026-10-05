-- DB-01/02: type-correct the journal-entry back-pointers (text -> uuid) so they
-- match journal_entries.id (uuid). The written values are real JournalEntry ids
-- (purchase-invoice-service.js:614 `journalEntryId: persisted.id`,
--  manual-journal-entry-service.js:441 `postedJournalEntryId: entry.id`), so the
-- ::uuid cast is non-lossy.
--
-- NOTE: this is hand-written as ALTER COLUMN ... TYPE ... USING (NOT Prisma's
-- default DROP COLUMN + ADD COLUMN, which would DISCARD existing values when run
-- on a populated database). The end-state column type is identical, so
-- `prisma migrate diff` reports zero drift.
--
-- A real FOREIGN KEY constraint to journal_entries(id) is intentionally NOT added
-- here: it would reject writes if the posting flow ever referenced an uncommitted
-- / missing entry, and that path cannot be exercised in this environment. The
-- columns are now uuid-typed and therefore FK-ready for a separately-tested change.

ALTER TABLE "purchase_invoices"
  ALTER COLUMN "journalEntryId" TYPE UUID USING "journalEntryId"::uuid;

ALTER TABLE "manual_journal_entry_drafts"
  ALTER COLUMN "postedJournalEntryId" TYPE UUID USING "postedJournalEntryId"::uuid;
