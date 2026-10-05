-- ============================================================
-- GACP PostgreSQL Performance Tuning
-- Optimized for 2GB RAM container on DigitalOcean
-- ============================================================

-- Memory: allocate 25% of container RAM to shared_buffers
ALTER SYSTEM SET shared_buffers = '512MB';

-- Tell planner about total available cache (OS cache + shared_buffers)
ALTER SYSTEM SET effective_cache_size = '1536MB';

-- Per-operation memory (sorts, hashes) — 8MB is good for moderate queries
ALTER SYSTEM SET work_mem = '8MB';

-- Memory for VACUUM, CREATE INDEX, etc.
ALTER SYSTEM SET maintenance_work_mem = '128MB';

-- SSD storage: lower random page cost (default 4.0 is for spinning disks)
ALTER SYSTEM SET random_page_cost = 1.1;

-- Max connections: match Prisma pool + overhead
ALTER SYSTEM SET max_connections = 50;

-- Log queries slower than 500ms for debugging
ALTER SYSTEM SET log_min_duration_statement = 500;

-- WAL tuning for write performance
ALTER SYSTEM SET wal_buffers = '16MB';
ALTER SYSTEM SET checkpoint_completion_target = 0.9;
