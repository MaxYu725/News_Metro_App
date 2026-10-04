# Metro News Worker

This directory is the version-controlled baseline for the production Cloudflare Worker `news-proxy`.

## CF-W1 baseline

The current `src/index.js` was recovered directly from the deployed Cloudflare Worker through the Workers Scripts API. `recovery-manifest.json` records the source hash, deployment identity, compatibility date, observability settings, and sanitized binding metadata. Secret values are not stored in this repository.

Production bindings represented by `wrangler.jsonc`:

- `AI` — Workers AI
- `DB` — D1 database `metro_news_db`
- `API_KEY` — required Worker secret; value remains in Cloudflare only
- Cron — every 3 minutes for the HK01 first-party latest feed, plus every 15 minutes for the full category/Bastille sync

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

## Tracked topic organization

`GET /api/topic-ai?q=...&mode=auto|event|digest|off&sources=hk01,bastille`
reads the shared snapshot; it never searches or invokes AI. `POST` to the same
URL (no body) checks and updates on explicit user demand. Origin and existing
rate limit bindings apply. Apply live migration `0003_topic_ai.sql` before
publishing this Worker; archive migrations do not change.

The policy chooses EVENT/DIGEST/CURATION/NONE without embeddings or AI
classification. It inspects at most the newest 60 matches across live/archive
search. EVENT uses one coherent group, DIGEST a 14-day window, CURATION a
30-day window. CURATION groups and de-duplicates publisher links/titles without
AI. Cohesion is a title-based heuristic, not semantic certainty.

AI generation uses stored article excerpts with at least 80 characters; no
background full-article fetch. Initial batches cap at 12 articles, incremental
batches at 6, each excerpt at 900 characters, user input at 22,000 characters
and output at 2,600 tokens. Corrected, expired or displaced evidence and mode
changes rebuild a bounded snapshot. Each displayed AI point must reference
known source IDs; the service keeps source titles, URLs and dates. Reference
validation cannot prove factual entailment; readers can check originals.

A primary D1 session claims a 120-second fenced lease, re-reads authoritative
state, and checks a five-minute metadata cache. EVENT updates are separated by
one hour and DIGEST by three hours. Atomic quota reservations allow 8 AI
attempts/hour and 40/day globally (UTC), including failed attempts. Failed or
invalid output preserves the previous snapshot with a 15-minute backoff.
Cache rows idle for 30 days and old quota buckets are pruned; at most 500
unleased topic rows remain after pruning. No new cron or deployment secret.

The tracking UI keeps Auto/Event/Digest/Off per local category. Entering a
category only reads cache; the Organize/Check updates button permits a POST.
It shows excerpt coverage, backlog and source links. The local fallback retains
20 snapshots; new dependencies are precached in shell v85.

Tests: `npm test` includes a real Python SQLite adapter for migration, lease,
quota, incremental and correction scenarios. Browser QA can run from the repo
root with Playwright installed:

```sh
node .github/scripts/qa-topic-ai-browser.mjs
```

Set `PLAYWRIGHT_BROWSER_EXECUTABLE` to reuse an installed Chromium and optionally
`TOPIC_QA_SCREENSHOT` to save a test screenshot. Fixtures cover mobile width,
explicit POST, safe output rendering, source links, pending coverage, mode
changes and section navigation. No production AI is used by tests or the new
cache-only production smoke probe.
