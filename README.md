# Metro News Live (即時新聞快訊)

> 是一款融合經典 **Windows Phone (Metro UI)** 美學與現代化高流暢度互動的 Android 全螢幕無廣告新聞閱讀程式。

---

## 專案核心特色
1. **沉浸式 Typography**：全黑背景搭配高對比字體，頂部標題採用 Metro 標誌性「視野超出裁剪（Edge-bleeding）」設計。
2. **無縫無限循環 Pivot（Infinite Looping Pivot）**：英文頁籤支持 `latest` ➔ `local` ➔ `entertainment` ➔ `tech` ➔ `pinned` ➔ `settings` 無限滑動循環。
3. **固定錨點幾何 Tile 畫布**：文章卡片由演算法基於文章 ID 產生幾何背景磚；向下展開內文時，座標原點鎖定於頂部，平滑解鎖下方的幾何圖案而不變形。
4. **自動吸頂滾動（Auto-Snap to Top）**：點擊卡片展開閱讀時，列表會自動以阻尼物理手勢捲動並將文章對齊頂部。

---

## 雲端架構與佈署參數
* **後端 API**：`https://metro-news-api.maxyu0725.workers.dev/`
* **Cloudflare KV Namespace**：`NEWS_CACHE_KV` (`0faa3dc0b32a435fb91672dd0f2cfe25`)
* **GitHub Actions APK 簽署 Alias**：`gemini-news-release`
* **GitHub Repository**：`maxyu725/metro-news-live`

---

## 本地開發與運行
```bash
# Clone the repository
git clone [https://github.com/maxyu725/metro-news-live.git](https://github.com/maxyu725/metro-news-live.git)
cd metro-news-live

# Open index.html directly in browser for UI preview
# OR build Android app via Capacitor
npm install
npx cap sync android
npx cap open android
