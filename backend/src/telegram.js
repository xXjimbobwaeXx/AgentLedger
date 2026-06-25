import { createHmac } from "node:crypto";

/**
 * Validate Telegram Mini App initData.
 * Algorithm (Telegram WebApp):
 *   secret_key = HMAC_SHA256(key="WebAppData", msg=bot_token)
 *   expected   = hex(HMAC_SHA256(key=secret_key, msg=data_check_string))
 *   data_check_string = all fields except `hash` (and `signature`), as
 *                       `key=value`, sorted alphabetically, joined by "\n".
 *
 * Also rejects stale initData (replay protection) via auth_date.
 */
export function validateInitData(initData, botToken, maxAgeSec = 86400) {
  if (!initData || !botToken) return { ok: false, error: "missing input" };

  const params = new URLSearchParams(initData);
  const hash = params.get("hash");
  if (!hash) return { ok: false, error: "no hash" };
  params.delete("hash");
  params.delete("signature"); // third-party Ed25519 field, not part of HMAC check

  const dataCheckString = [...params.entries()]
    .map(([k, v]) => `${k}=${v}`)
    .sort()
    .join("\n");

  const secretKey = createHmac("sha256", "WebAppData").update(botToken).digest();
  const expected = createHmac("sha256", secretKey).update(dataCheckString).digest("hex");
  if (expected !== hash) return { ok: false, error: "bad signature" };

  const authDate = Number(params.get("auth_date") || 0);
  if (maxAgeSec && Date.now() / 1000 - authDate > maxAgeSec)
    return { ok: false, error: "expired" };

  let user = null;
  try { user = JSON.parse(params.get("user") || "null"); } catch { /* noop */ }
  if (!user?.id) return { ok: false, error: "no user" };

  return { ok: true, user };
}