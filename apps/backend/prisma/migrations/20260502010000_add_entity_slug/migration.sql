-- Wave C PR C-3 — add slug column to entities + backfill from displayName.
--
-- The slug powers URL routing (/health/workspaces/{slug}/...) so workspace
-- links are shareable / deep-linkable / breadcrumb-friendly. The header
-- `x-active-entity-id` is still authoritative for backend scope; the slug
-- is purely a UX affordance.
--
-- Idempotent: re-applying is a no-op.

-- 1. Column
ALTER TABLE "entities" ADD COLUMN IF NOT EXISTS "slug" TEXT;

-- 2. Backfill — slugify(displayName) with collision-suffix.
--   * lowercased, ASCII-folded, non-[a-z0-9] collapsed to '-'
--   * Thai characters dropped (slug is for URL paths, not display)
--   * empty fallback uses entity id prefix
--   * collisions get -2 / -3 / … via row_number() over the partition
DO $$
DECLARE
    rec RECORD;
    base TEXT;
    candidate TEXT;
    suffix INT;
BEGIN
    FOR rec IN SELECT id, "displayName" FROM "entities" WHERE slug IS NULL ORDER BY "createdAt" LOOP
        -- Strip non-ASCII (Thai, etc.) by replacing anything outside a-zA-Z0-9
        -- with '-'. Then collapse runs of '-' and trim. lower() at the end.
        base := lower(regexp_replace(
            regexp_replace(coalesce(rec."displayName", ''), '[^a-zA-Z0-9]+', '-', 'g'),
            '(^-+)|(-+$)', '', 'g'
        ));
        IF base = '' OR base IS NULL THEN
            base := 'entity-' || substring(rec.id, 1, 8);
        END IF;

        -- Collision-resolve.
        candidate := base;
        suffix := 1;
        WHILE EXISTS (SELECT 1 FROM "entities" WHERE slug = candidate AND id <> rec.id) LOOP
            suffix := suffix + 1;
            candidate := base || '-' || suffix::text;
        END LOOP;

        UPDATE "entities" SET slug = candidate WHERE id = rec.id;
    END LOOP;
END $$;

-- 3. Unique index (after backfill, otherwise NULL collisions block rollout).
CREATE UNIQUE INDEX IF NOT EXISTS "entities_slug_key" ON "entities"("slug");
