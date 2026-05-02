-- Sigvault — Postgres ChainStore schema
-- =====================================
--
-- One table holds the cryptographic chain log for every key. The
-- PRIMARY KEY (key_id, counter) is the load-bearing constraint that
-- prevents two writers from advancing the same chain to the same
-- counter; the loser of any race fails with `23505 unique_violation`,
-- which qv-server surfaces as `CHAIN_LOG_CONFLICT` to the request.
--
-- Apply once, on the database referenced by QV_CHAIN_STORE_URL:
--
--     psql "$QV_CHAIN_STORE_URL" -f qv-ops/sql/sigvault_chain.sql
--
-- The ChainStore also auto-creates this schema on first use. Running
-- the script in advance is harmless (`IF NOT EXISTS`) and lets ops set
-- up the database before the first qv-server boot.
--
-- Recommended hosting:
--   * Dedicated database for Sigvault (or schema). No other workloads.
--   * Postgres 14+ (12+ minimum). SCRAM-SHA-256 must be enabled.
--   * Daily basebackup + WAL archiving for point-in-time recovery.
--   * Connection pooler optional — Sigvault writers hold one connection
--     per process. Verify replicas can use pgBouncer transaction-mode.

CREATE TABLE IF NOT EXISTS sigvault_chain (
    key_id     text   NOT NULL,
    counter    bigint NOT NULL,
    state_hash bytea  NOT NULL,
    PRIMARY KEY (key_id, counter)
);

-- Optional: index supports SELECT … ORDER BY counter ASC (load path).
-- The PRIMARY KEY already covers (key_id, counter) so the planner uses
-- it for ordered range scans; this is a comment, not an index, kept
-- here for operators who want to be reminded.

-- Hex format is required by qv-server's bytea parser.
SET bytea_output = 'hex';
