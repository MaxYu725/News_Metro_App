# Metro News Worker

This directory is the version-controlled baseline for the production Cloudflare Worker `news-proxy`.

## CF-W1 baseline

The current `src/index.js` was recovered directly from the deployed Cloudflare Worker through the Workers Scripts API. `recovery-manifest.json` records the source hash, deployment identity, compatibility date, observability settings, and sanitized binding metadata. Secret values are not stored in this repository.

Production bindings represented by `wrangler.jsonc`:

- `AI` — Workers AI
- `DB` — D1 database `metro_news_db`
- `API_KEY` — required Worker secret; value remains in Cloudflare only
- Cron — every 15 minutes

The compatibility date remains pinned to the recovered production value (`2026-08-07`) for baseline parity. It should only be advanced as a separate reviewed change.

## D1 migrations

`migrations/0000_production_baseline.sql` is an idempotent representation of the schema and indexes that already exist in production. It uses `IF NOT EXISTS` intentionally so the first Wrangler migration adoption does not rebuild the existing `articles` table or indexes.

Do not add the Cloudflare-managed `_cf_KV` table to migrations.

## Validation

From `worker/`:

```sh
npm install
npm run check
```

The repository CI additionally verifies:

- recovered source SHA-256 against `recovery-manifest.json`
- Wrangler binding/date parity with the recovered production settings
- D1 baseline columns and indexes in an in-memory SQLite database
- Worker JavaScript syntax
- Wrangler dry-run compilation

## Deployment safety

CF-W1 does not deploy this source. Production remains on the recovered Quick Editor deployment until a separate hardening PR is reviewed and explicitly deployed.

Do not commit `.dev.vars`, `.env`, API tokens, or secret values. The Wrangler config declares only the required secret name `API_KEY`.

## Known production issues reserved for the next checkpoint

- `/api/article-full` currently accepts arbitrary external URLs and must be converted to a strict parsed-URL allowlist.
- CORS is currently wildcard and cost-bearing endpoints do not have application-level abuse controls.
- `video` ingestion is stale and should be checked against the current HK01/RSSHub upstream mapping.

These are intentionally not changed in CF-W1 so the repository first gains an exact, testable production baseline.
