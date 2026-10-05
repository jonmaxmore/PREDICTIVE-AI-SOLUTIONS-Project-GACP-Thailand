-- A plot gets a permanent identifier of its own.
--
-- มกษ. 3502-2561 ข้อ 8(1) requires recording "รหัสแปลงปลูกและข้อมูลประจำแปลงปลูก" — a plot
-- code and per-plot data. The platform had none. The trace QR hangs off
-- planting_cycle_plots, which is unique per (cycleId, plotId), so the identifier was reborn
-- every season: a field sign could not outlive one cycle, and the same land registered under
-- two accounts could not be detected across seasons.
--
-- This is the EXPAND half. The column is nullable and nothing reads it yet, so the running
-- application is unaffected. A later contract migration makes it required, once every row
-- carries one and the code that mints it is live.
--
-- qrIssuedAt / qrRevokedAt exist so a sign has a life story: printed once, reprinted with the
-- SAME code when it fades, and revoked when it is stolen or photographed by someone who
-- should not have it. Minting a fresh code on reprint would fragment the plot's history and
-- defeat the overlap check, which is the whole point of the column.
--
-- Every statement is idempotent so a re-run cannot fail a deploy.

ALTER TABLE "plots" ADD COLUMN IF NOT EXISTS "plotCode" TEXT;
ALTER TABLE "plots" ADD COLUMN IF NOT EXISTS "qrIssuedAt" TIMESTAMP(3);
ALTER TABLE "plots" ADD COLUMN IF NOT EXISTS "qrRevokedAt" TIMESTAMP(3);

-- Unique, but only over rows that have a code: the index has to tolerate the backfill
-- window, when most rows are still NULL. Postgres treats NULLs as distinct in a unique
-- index, so a plain unique index would already allow many NULLs — this is spelled as a
-- partial index anyway, so the intent is readable rather than inferred from Postgres
-- trivia by whoever reads it next.
CREATE UNIQUE INDEX IF NOT EXISTS "plots_plotCode_key"
    ON "plots" ("plotCode")
    WHERE "plotCode" IS NOT NULL;
