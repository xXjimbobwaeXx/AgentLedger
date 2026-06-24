# AgentLedger

**Verifiable, tamper-evident audit trails for AI agents.** Built for the TON / $GRAM ecosystem and Telegram.

Every step your agent takes — LLM calls, tool calls, decisions — is recorded as a hash-chained trail you can inspect and *prove* wasn't altered after the fact. Open a run, hit **Verify**, and the chain goes green. Tamper with a single step and it goes red at the exact point it broke.

<!-- TODO: drop the tamper→verify clip here -->
<!-- ![Verify demo](docs/verify-demo.gif) -->

## Why

Most agent-observability tools give you a log you have to *trust* the vendor didn't change. AgentLedger gives you a trail whose integrity is checkable with math — a SHA-256 hash chain where each step embeds the hash of the one before it. Locally today; provable to a third party on-chain ([roadmap](#roadmap)).

## Quickstart

1. Open the AgentLedger Mini App in Telegram to get your API key.
2. Instrument your agent:

```ts
import { Ledger } from "@agentledger/sdk";

const ledger = new Ledger({ apiKey: "al_live_…" });
const run = await ledger.startRun({ agent: "my-agent" });
await run.log({ type: "llm_call", name: "claude", input, output });
await run.finish();
```

3. Your run shows up in the dashboard. Hit **Verify integrity**.

## Repo structure

| Path | What it is | Deploys as |
|---|---|---|
| `sdk/` | `@agentledger/sdk` — the capture SDK | npm package |
| `backend/` | Express + Postgres API | Render web service |
| `dashboard/` | Telegram Mini App (capture view + local verify) | Render static site |
| `examples/` | Example agent + round-trip gate test | — |
| `test/` | `chain-parity` — guards SDK ↔ backend hash drift | CI |
| `docs/` | Wiring & deploy guide | — |

## Local development

- **Backend:** `cd backend && cp .env.example .env`, fill in `DATABASE_URL` + `BOT_TOKEN`, `npm install`, `psql "$DATABASE_URL" -f schema.sql`, then `DEV_TG_BYPASS=1 npm start` to view seeded runs without Telegram.
- **Seed a dev key:** `node backend/seed-dev.js` prints an API key.
- **Gate test:** `npx tsx examples/example-agent.ts` — a PASS means the SDK and backend hash identically end to end.
- **Dashboard:** `cd dashboard && npm install && npm run dev`.

## How verification works

The integrity guarantee comes purely from the local hash chain — no blockchain required for the free tier. Each step's hash is computed over a canonical (sorted-key) serialization of its fields **plus the previous step's hash**. Change anything in any step and its hash breaks; because every later step embeds the prior hash, you can't quietly edit one event without re-deriving the whole tail. Verification recomputes the chain client-side.

## Roadmap

- ✅ **Free tier:** capture, view, local verification, Telegram Mini App.
- ⏳ **Pay-per-anchor:** notarize a run's chain head on TON (paying in $GRAM) so its integrity is provable to anyone, not just self-attested. The `anchor` column and seams already exist.
- ⏳ Solana / Base anchoring backends.

## License

MIT — see [LICENSE](LICENSE). The hashing logic is open by design: for a trust tool, you should be able to verify it yourself.
