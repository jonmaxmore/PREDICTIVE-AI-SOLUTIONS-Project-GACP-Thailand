SELECT column_name FROM information_schema.columns WHERE table_name='applications' AND column_name LIKE '%id%' ORDER BY column_name;
\echo ===SEP===
SELECT column_name FROM information_schema.columns WHERE table_name='farms' AND column_name LIKE '%id%' ORDER BY column_name;
