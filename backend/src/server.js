import express from "express";
import { pool } from "./db.js";
import { computeStepHash } from "./chain.js";
import { apiKeyAuth, telegramAuth, newApiKey } from "./auth.js";

const app = express();
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => res.json({ ok: true }));

/* ============================ account / signup ============================ */
/* The Mini App calls /me on open. First call issues an API key (shown once) for
   the dev to paste into the SDK. Telegram identity = the account. */
app.get("/me", telegramAuth, async (req, res) => {
  const { rows } = await pool.query(
    "SELECT key_prefix FROM api_keys WHERE account_id=$1 ORDER BY created_at LIMIT 1",
    [req.accountId]
  );
  if (rows.length) {
    return res.json({ account_id: req.accountId, telegram_user: req.tgUser, api_key_prefix: rows[0].key_prefix, api_key: null });
  }
  const k = newApiKey();
  await pool.query("INSERT INTO api_keys (account_id, key_hash, key_prefix) VALUES ($1,$2,$3)", [req.accountId, k.hash, k.prefix]);
  res.json({ account_id: req.accountId, telegram_user: req.tgUser, api_key_prefix: k.prefix, api_key: k.raw }); // raw returned ONCE
});

app.post("/keys/rotate", telegramAuth, async (req, res) => {
  const k = newApiKey();
  await pool.query("INSERT INTO api_keys (account_id, key_hash, key_prefix) VALUES ($1,$2,$3)", [req.accountId, k.hash, k.prefix]);
  res.json({ api_key: k.raw, api_key_prefix: k.prefix });
});

/* ============================ capture (SDK) ============================ */
app.post("/runs", apiKeyAuth, async (req, res) => {
  const { agent, metadata } = req.body || {};
  if (!agent) return res.status(400).json({ error: "agent required" });
  const { rows } = await pool.query(
    "INSERT INTO runs (account_id, agent, metadata) VALUES ($1,$2,$3) RETURNING id, head_hash",
    [req.accountId, agent, metadata || {}]
  );
  res.json({ id: rows[0].id, head_hash: rows[0].head_hash });
});

/* Append one step. Server assigns seq + prev_hash, computes the authoritative
   hash, and rejects out-of-order writes. The transaction + FOR UPDATE keeps the
   chain strictly linear under concurrent writers. */
app.post("/runs/:id/steps", apiKeyAuth, async (req, res) => {
  const runId = req.params.id;
  const { type, name, input, output, metadata, ts, prev_hash } = req.body || {};
  if (!type || !ts) return res.status(400).json({ error: "type and ts required" });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const { rows } = await client.query("SELECT account_id, head_hash FROM runs WHERE id=$1 FOR UPDATE", [runId]);
    if (!rows.length) { await client.query("ROLLBACK"); return res.status(404).json({ error: "run not found" }); }
    if (rows[0].account_id !== req.accountId) { await client.query("ROLLBACK"); return res.status(403).json({ error: "forbidden" }); }

    const head = rows[0].head_hash ?? null;
    // Continuity guard: the client's idea of the head must match the server's.
    if ((prev_hash ?? null) !== head) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: "prev_hash mismatch (out-of-order write)", expected: head });
    }

    const seqRes = await client.query("SELECT COALESCE(MAX(seq)+1, 0) AS seq FROM steps WHERE run_id=$1", [runId]);
    const seq = seqRes.rows[0].seq;

    const step = { run_id: runId, seq, ts, type, name: name ?? null, input: input ?? null, output: output ?? null, metadata: metadata || {}, prev_hash: head };
    const hash = computeStepHash(step);

    await client.query(
      `INSERT INTO steps (run_id, seq, ts, type, name, input, output, metadata, prev_hash, hash)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
      [runId, seq, ts, type, step.name, step.input, step.output, step.metadata, head, hash]
    );
    await client.query("UPDATE runs SET head_hash=$1 WHERE id=$2", [hash, runId]);
    await client.query("COMMIT");

    res.json({ ...step, hash }); // SDK sets its local head = hash
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    res.status(500).json({ error: "append failed" });
  } finally {
    client.release();
  }
});

app.post("/runs/:id/finish", apiKeyAuth, async (req, res) => {
  const status = req.body?.status === "failed" ? "failed" : "completed";
  const { rowCount } = await pool.query(
    "UPDATE runs SET status=$1, ended_at=now() WHERE id=$2 AND account_id=$3",
    [status, req.params.id, req.accountId]
  );
  if (!rowCount) return res.status(404).json({ error: "run not found" });
  res.json({ ok: true, status });
});

/* ============================ dashboard reads ============================ */
app.get("/runs", telegramAuth, async (req, res) => {
  const { rows } = await pool.query(
    `SELECT r.id, r.agent, r.status, r.metadata, r.head_hash, r.anchor, r.started_at, r.ended_at,
            (SELECT COUNT(*)::int FROM steps s WHERE s.run_id = r.id) AS step_count
       FROM runs r WHERE r.account_id=$1 ORDER BY r.started_at DESC LIMIT 100`,
    [req.accountId]
  );
  res.json({ runs: rows });
});

app.get("/runs/:id", telegramAuth, async (req, res) => {
  const r = await pool.query("SELECT * FROM runs WHERE id=$1 AND account_id=$2", [req.params.id, req.accountId]);
  if (!r.rows.length) return res.status(404).json({ error: "run not found" });
  const s = await pool.query(
    "SELECT id, run_id, seq, ts, type, name, input, output, metadata, prev_hash, hash FROM steps WHERE run_id=$1 ORDER BY seq",
    [req.params.id]
  );
  res.json({ run: r.rows[0], steps: s.rows });
});

const port = process.env.PORT || 8080;
app.listen(port, () => console.log(`AgentLedger backend listening on :${port}`));