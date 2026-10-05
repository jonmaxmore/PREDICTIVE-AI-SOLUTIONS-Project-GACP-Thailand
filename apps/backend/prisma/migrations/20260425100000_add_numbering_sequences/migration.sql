-- ============================================================================
-- Race-safe document numbering
--
-- Replaces the count(*)+1 pattern used by buildBatchNumber and similar helpers
-- with PostgreSQL sequences. Sequences are concurrency-safe by construction —
-- two transactions calling nextval() will always receive distinct values, even
-- under heavy parallelism, so we never produce duplicate batch numbers.
--
-- Sequences are NOT transactional (a rollback does not return the consumed
-- value), which is fine for human-facing numbering — gaps are acceptable.
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS harvest_batch_number_seq
    AS BIGINT
    INCREMENT BY 1
    MINVALUE 1
    START WITH 1
    NO CYCLE;

CREATE SEQUENCE IF NOT EXISTS lot_number_seq
    AS BIGINT
    INCREMENT BY 1
    MINVALUE 1
    START WITH 1
    NO CYCLE;

CREATE SEQUENCE IF NOT EXISTS application_number_seq
    AS BIGINT
    INCREMENT BY 1
    MINVALUE 1
    START WITH 1
    NO CYCLE;
