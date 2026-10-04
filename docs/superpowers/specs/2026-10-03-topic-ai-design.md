# 追蹤主題 AI 整理

## 目的與現有架構
PR #115 已部署於 8a35f5f。PWA 以 tracking.js/LocalDB 保存關鍵詞；custom category 經 api.js 的 archive cursor 搜尋 live DB、ARCHIVE_01/02。逐篇 AI 是 Reader 主動呼叫 Qwen，快取只在本機。主題整理使用獨立 Worker 模組及 D1 表，不改逐篇撮要。

## 選擇
採按需、metadata 分類 + 節錄增量整理。全文章每次重送較昂貴；embedding/逐篇 AI facts 需要額外 AI calls、向量儲存及遷移，此階段不採用。用戶進入追蹤頁只讀快取；按「整理／更新」才提交 POST，沒有背景或 cron AI calls。Auto 指自動判斷整理模式，不代表定時生成。

## 分群與 cohesion
最多搜尋最近 60 個去重結果（沿用 archive 搜尋）；標題用 Unicode 中文雙字 token/英文詞，去掉搜尋詞 token、停用詞及泛化字。相似度用標題 token overlap（共同 token / 較大 token set）；其他 metadata 用於來源、日期窗口、分類標籤及 description 可讀性 gate。採 greedy 固定中心群集避免 chaining。cohesion = 主群佔比 60% + 主群平均 medoid similarity 40%。這是啟發式 0–100 分，並非信心百分比。
最少 3 篇獨立文章、2 篇具 80 字以上內文；否則 NONE。好去處/美食/優惠等 CURATION；天氣/熱話等 DIGEST。其餘 cohesion >=70 且主群>=3 才 EVENT；45–69 DIGEST；<45 只有至少兩個可讀子群才 DIGEST，否則 NONE。EVENT 只綜合主群，旁支文章仍留在 feed。用戶強制事件模式仍受最少資料及主群 gate，不能將不相干文章硬合成事件。
DIGEST 近期 14 日、CURATION 30 日、EVENT 最近 60 篇；窗口改變會重判 mode。跨 mode 重新建有限 snapshot，不沿用錯誤格式。

## D1 schema
0003_topic_ai.sql 只加 live DB 表：topic_ai_cache（key、query、preference、sources filter、analysis_json、output_json、sources_json、members_json、checked_at、generated_at、lease_token/until、retry_at、updated_at），topic_ai_budget（UTC day bucket、calls、hours_json）。sources_json 保存 id/title/link/date/source，不依赖記事保留期；members_json 保存已處理 fingerprint。shared cache key = normalized query + user mode + source selection + policy version 的 SHA256。兩個 archive DB 不增加 AI 表。

## 資料流與成本
GET /api/topic-ai?q=&mode=&sources= 只回 cache/status，無 AI。
POST 相同參數，body 不接受文章或 prompt。Origin、rate limit、參數 gate 後，D1 primary session claim 120 秒 lease，cache metadata 5 分鐘內不重搜。相同 fingerprint、NONE、CURATION 不調 AI。CURATION 用分類/去重結果直接顯示。EVENT 最少間隔 1 小時；DIGEST 3 小時。單篇變動也在間隔後可更新；讀取 cache 永不觸發生成。
初次最多 12 篇，每篇節錄 900 字；AI 只選有至少 80 字已存內文的文章，避免標題當完整證據。增量每次最多 6 篇（未處理 fingerprint），加舊 sections（<=8000 字）和有限來源 registry，總 user payload <=22000 字。大量 backlog 需分次更新，UI 顯示待整理篇數，不將未處理文章標記已處理。保留引用來源最多 60 篇；超過限額/既有文章更正/mode 改變或已處理文章離開当前選定群集觸發有限重建，避免無限增長與已更正舊說法。只用已存 description，無自動全文抓取或額外逐篇 AI calls；UI 明示節錄、涵蓋篇數及窗口上限。
全站初始額度每小時 8、每日 40 次（UTC）；D1 single conditional UPSERT budget claim，失敗嘗試也計數。AI 同一 snapshot 只跑一次、無自動修復重試；失敗保留舊結果、15 分鐘 backoff；超時/lease fencing 禁止較舊工作覆蓋新結果。30 日未使用 cache 清理，schema 保持 rollback additive。

## Output 與來源可靠性
AI 回 JSON sections[{heading,items:[{text,sourceIds}]}]。EVENT 指導事件概況、最新進展、人物關係、時間線、證供/說法、現況與未解事項；DIGEST 近期重點、多子議題。無資料省略；指控、證供、裁判區分；新聞文字視為資料不可執行內文指令。每點需已知 sourceIds，拒絕未知 ID、空引用、過大/不合法輸出，無 AI 自造 URL。這驗證來源存在，不聲稱能自動證明語义；使用者可回原文。

## UI
追蹤頁文章列表前獨立整理卡；設定 Auto/Event/Digest/Off 保存在該本機 category，舊 category 預設 Auto。顯示判斷 mode、時間、篇數、待整理數及節錄限制；展開 sections、每點來源超連結。資料不足/關閉/限額/忙碌/失敗均不阻塞 feed。使用 AbortController + sequence 避免切頁/改 mode 舊 response 污染新 topic。localStorage 只保留最多 20 個最後成功 snapshot 供離線讀取；server shared cache 為權威。新模組加入 SW manifest、cache v85。

## 驗證
純 policy fixtures：案件/天氣/生活/太少/弱 cohesion/去重/時間窗口；增量與更正 fingerprint；JSON references/payload cap。真 SQLite D1 adapter 執行 migration/lease/budget/cache lifecycle/concurrency。Worker routes Origin/OPTIONS/rate/body/cache/no-AI paths。前端 DOM 情境：關閉、來源链接安全、換頁競態、offline。全 Worker tests、現有 static contracts、baseline、Wrangler dry-run、CSS build。
