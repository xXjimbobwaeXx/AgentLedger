-- AgentLedger backend schema (free tier)
-- Apply with:  psql "$DATABASE_URL" -f schema.sql

CREATE EXTENSION IF NOT EXISTS pgcrypto;  -- gen_random_uuid()

-- An account is one developer, identified by their Telegram user (via the Mini App).
CREATE TABLE IF NOT EXISTS accounts (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  telegram_user_id bigint UNIQUE NOT NULL,
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- API keys belong to an account. We store only the hash of the key, never the key.
CREATE TABLE IF NOT EXISTS api_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  key_hash    text UNIQUE NOT NULL,   -- sha256(raw key)
  key_prefix  text NOT NULL,          -- display only, e.g. "al_live_ab1…"
  created_at  timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz
);
CREATE INDEX IF NOT EXISTS api_keys_account ON api_keys(account_id);

CREATE TABLE IF NOT EXISTS runs (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id  uuid NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  agent       text NOT NULL,
  status      text NOT NULL DEFAULT 'running',  -- running | completed | failed
  metadata    jsonb NOT NULL DEFAULT '{}',
  head_hash   text,                              -- hash of the latest step (chain head)
  anchor      jsonb,                             -- v2 (paid): { chain, txHash, ts }. NULL in free tier.
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz
);
CREATE INDEX IF NOT EXISTS runs_account ON runs(account_id, started_at DESC);

-- Steps are append-only. No route ever UPDATEs or DELETEs a step — that
-- immutability plus the hash chain is the product.
-- NOTE: `ts` is TEXT, not timestamptz, on purpose. The hash is computed over the
-- exact ISO string the SDK recorded; storing it as text keeps it byte-stable so
-- the dashboard's recompute matches. timestamptz would re-normalize and could
-- silently break verification.
CREATE TABLE IF NOT EXISTS steps (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  run_id      uuid NOT NULL REFERENCES runs(id) ON DELETE CASCADE,
  seq         integer NOT NULL,
  ts          text NOT NULL,
  type        text NOT NULL,        -- message|llm_call|tool_call|tool_result|decision|error
  name        text,
  input       jsonb,
  output      jsonb,
  metadata    jsonb NOT NULL DEFAULT '{}',
  prev_hash   text,
  hash        text NOT NULL,
  UNIQUE (run_id, seq)
);
CREATE INDEX IF NOT EXISTS steps_run ON steps(run_id, seq);

-- Optional hardening: make append-only a database guarantee, not just convention.
-- Uncomment in production once your write path is stable.
-- CREATE OR REPLACE FUNCTION steps_no_mutate() RETURNS trigger AS $$
-- BEGIN RAISE EXCEPTION 'steps are append-only'; END;
-- $$ LANGUAGE plpgsql;
-- CREATE TRIGGER steps_immutable BEFORE UPDATE OR DELETE ON steps
--   FOR EACH ROW EXECUTE FUNCTION steps_no_mutate();