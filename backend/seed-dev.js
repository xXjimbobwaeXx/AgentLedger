/**
 * Local-dev seed: creates one account and prints a usable API key so you can run
 * the example agent against localhost without going through the Telegram flow.
 *
 *   node seed-dev.js
 *
 * Dev only. Don't run against production.
 */
import { pool } from "./src/db.js";
import { newApiKey } from "./src/auth.js";

const DEV_TG_ID = 999999999;

const { rows } = await pool.query(
  `INSERT INTO accounts (telegram_user_id) VALUES ($1)
   ON CONFLICT (telegram_user_id) DO UPDATE SET telegram_user_id = EXCLUDED.telegram_user_id
   RETURNING id`,
  [DEV_TG_ID]
);
const accountId = rows[0].id;

const k = newApiKey();
await pool.query(
  "INSERT INTO api_keys (account_id, key_hash, key_prefix) VALUES ($1,$2,$3)",
  [accountId, k.hash, k.prefix]
);

console.log("\n  Dev account: " + accountId);
console.log("  Telegram id: " + DEV_TG_ID + "  (use this for the dashboard dev-bypass)");
console.log("\n  AGENTLEDGER_KEY=" + k.raw + "\n");

await pool.end();