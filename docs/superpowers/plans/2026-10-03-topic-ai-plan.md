# Topic AI implementation plan

基準 8a35f5f；需求為 ../specs/2026-10-03-topic-ai-design.md。用戶已要求設計後直接實作，採本 session 原生執行。

1. Policy + migration：先寫 classification/duplicate/window/update/output validation 行為測試，確認 RED，再實作 topic-ai-policy.js、0003_topic_ai.sql。輸出 deterministic groups/mode、fingerprints、bounded evidence/prompt。
2. Service + routes：SQLite D1 adapter 及 route tests 先 RED；實作 topic-ai-store.js/topic-ai.js、entry router。驗證 NONE/CURATION/cache 零 AI、incremental/correction、lease fencing、budget、failure backoff。
3. UI：先測 rendering/late response/offline 行為；實作 topic-ai-ui.js/css、tracking preference/settings/app hooks。SW precache/bump，保留 existing article feed/reader flow。
4. Integration：完整 npm test、static contracts、baseline、migration實際 SQLite、wrangler compile/CSS build。獨立 review pass 檢查費用上限、來源、race、快取過期、局部更新。建立分支 PR，不自動 merge/deploy。

Review focus: source filter isolation、removed/revised evidence、concurrent quotas/leases、output coverage overclaim、UI switch to search/settings、offline dependencies、JSON injection/unknown source.

## Ledger
- Baseline: Worker 83/83 pass；獨立新 clone、feature branch。
- Task 1: policy tests RED (8 absent behaviors) → GREEN 8/8；full Worker suite 91/91。singleton 自身相似度不計入 cohesion，避免誤觸發。
- Task 2: real SQLite route/cache/lease/budget tests RED → GREEN 6/6；Worker suite 97/97。
- Task 3: client cache-only/explicit-POST/abandoned response/offline/source safety tests RED → GREEN 5/5；Worker suite 102/102、all static contracts/baseline pass、CSS build pass。
- Budget representation: one UTC day row with calls + hours_json permits a single atomic conditional UPSERT for both daily/hourly limits; no half-reservation or check-then-write race.
- Final review: independent read-only reviewer found stale pre-claim reads, displaced EVENT sources, and EVENT readability counted outside selected group. Each was reproduced RED and fixed GREEN. CURATION hidden items were also corrected; all retained entries are displayed in useful Chinese categories.
- Final regression: title-only rows are excluded from paid evidence batches; selected readable rows need not be among the newest 12.
- Final verification: Worker 108/108, baseline and all existing static contracts, CSS build, Wrangler dry-run (103.11 KiB) and 390px mobile Chromium interaction QA pass.
- Review boundaries: structural reference validation does not prove semantic entailment; cohesion remains heuristic. Production model quality and live D1 behavior await deployment observation. No production AI call or deployment performed.
