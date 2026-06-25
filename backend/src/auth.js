import { createHash, randomBytes } from "node:crypto";
import { pool } from "./db.js";
import { validateInitData } from "./telegram.js";

export function hashKey(raw) {
  return createHash("sha256").update(raw).digest("hex");
}

export function newApiKey() {
  const raw = "al_live_" + randomBytes(24).toString("base64url");
  return { raw, prefix: raw.slice(0, 11) + "…", hash: hashKey(raw) };
}

/** Capture path: `Authorization: Bearer <api key>` → req.accountId */
export async function apiKeyAuth(req, res, next) {
  try {
    const m = (req.get("authorization") || "").match(/^Bearer\s+(.+)$/i);
    if (!m) return res.status(401).json({ error: "missing api key" });
    const kh = hashKey(m[1]);
    const { rows } = await pool.query("SELECT account_id FROM api_keys WHERE key_hash=$1", [kh]);
    if (!rows.length) return res.status(401).json({ error: "invalid api key" });
    req.accountId = rows[0].account_id;
    pool.query("UPDATE api_keys SET last_used_at=now() WHERE key_hash=$1", [kh]).catch(() => {});
    next();
  } catch (e) { res.status(500).json({ error: "auth error" }); }
}

/**
 * Dashboard path: Telegram Mini App initData, sent as either
 *   `Authorization: tma <initData>`  or  `X-Telegram-Init-Data: <initData>`.
 * Validates the signature, then upserts the account keyed by Telegram user id.
 */
export async function telegramAuth(req, res, next) {
  try {
    // DEV ONLY bypass: view seeded runs locally without real Telegram initData.
    // Enable with DEV_TG_BYPASS=1; ignored whenever NODE_ENV=production.
    const bypass = process.env.DEV_TG_BYPASS === "1" && process.env.NODE_ENV !== "production";
    let user;
    if (bypass) {
      user = { id: 999999999, first_name: "Dev" }; // matches seed-dev.js DEV_TG_ID
    } else {
      const m = (req.get("authorization") || "").match(/^tma\s+(.+)$/i);
      const initData = m ? m[1] : req.get("x-telegram-init-data");
      const v = validateInitData(initData, process.env.BOT_TOKEN);
      if (!v.ok) return res.status(401).json({ error: "telegram auth failed: " + v.error });
      user = v.user;
    }

    const { rows } = await pool.query(
      `INSERT INTO accounts (telegram_user_id) VALUES ($1)
       ON CONFLICT (telegram_user_id) DO UPDATE SET telegram_user_id = EXCLUDED.telegram_user_id
       RETURNING id`,
      [user.id]
    );
    req.accountId = rows[0].id;
    req.tgUser = user;
    next();
  } catch (e) { res.status(500).json({ error: "auth error" }); }
}