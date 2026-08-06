# Metro News — Phase 1

全新版本的第一階段：**純前端 App shell、設計系統、假資料與互動原型**。

## 本階段已包含

- Vite + TypeScript + 原生 DOM，沒有 React、Vue 或 Tailwind CDN
- 手機、平板及桌面響應式 Metro 介面
- 最新、香港、國際、財經、科技、娛樂及體育分類
- 獨立文章閱讀路由
- 本地搜尋、收藏及已讀示範
- 字體大小、列表密度及減少動畫設定
- Loading、Empty、Error、Offline 狀態預覽
- 新 PWA manifest 與完整圖示尺寸
- 本地抽象新聞封面；沒有圖片搜尋功能
- 基礎安全 headers 範本

## 明確未包含

- Cloudflare Worker API
- D1 資料庫
- RSS / Atom 同步
- AI 摘要
- 圖片搜尋
- 正式 Service Worker / 離線資料庫
- 收藏持久化

以上項目會在後續 Phase 加入。

## 執行

Vite 8 需要 Node.js 20.19+ 或 22.12+。

```bash
npm install
npm run dev
```

建立 production bundle：

```bash
npm run build
npm run preview
```

## 狀態測試

開啟「設定」→「Phase 1 測試工具」，選擇 Loading、Empty、Error 或 Offline，再返回「最新」。

## 主要目錄

```text
src/client/
├─ components/   可重用 UI 元件
├─ data/         Phase 1 假資料
├─ lib/          DOM 與格式工具
├─ state/        記憶體狀態
├─ styles/       Design tokens 與元件樣式
├─ views/        各頁面
├─ app.ts        App shell 與路由整合
├─ router.ts     Hash router
└─ types.ts      資料型別
```
