-- Fix duplicate canonicalId values by appending UUID suffix
-- First show duplicates
DO $$
DECLARE
    r RECORD;
    counter INT;
BEGIN
    counter := 0;
    FOR r IN 
        SELECT id, "canonicalId" FROM users 
        WHERE "canonicalId" IN (
            SELECT "canonicalId" FROM users 
            GROUP BY "canonicalId" HAVING count(*) > 1
        )
        ORDER BY "canonicalId", "createdAt" DESC
    LOOP
        counter := counter + 1;
        -- Skip the first occurrence (keep original), fix subsequent
        IF counter > 1 THEN
            UPDATE users SET "canonicalId" = "canonicalId" || '-dup-' || substring(id, 1, 8) WHERE id = r.id;
            RAISE NOTICE 'Fixed duplicate: id=% canonicalId=%', r.id, r."canonicalId";
        END IF;
        -- Reset counter when canonicalId changes
    END LOOP;
END $$;

-- Now create unique index
CREATE UNIQUE INDEX IF NOT EXISTS "users_canonicalId_key" ON users("canonicalId");
