# Metro News Live (`metro-news-live`)
Android app & Cloudflare Worker project adopting Windows Phone Metro UI style for live Hong Kong news.

## 🚀 Features
- **Immersive Fullscreen**: No top status bar, clock, or app logo area.
- **Infinite Looping Pivot**: English headers (`latest`, `local`, `entertainment`, `tech`, `pinned`, `settings`).
- **Anchored Geometry Tiles**: TileBackgroundView generates random geometry anchored at `(0,0)`. Expanding un-clips background without shifting geometry.
- **Auto-Snap Scroll**: Expanding a Tile smoothly scrolls its top edge to the viewport top (`SNAP_TO_START`).
- **Settings Page**: Accent Color Picker, Font Size Slider, Auto-refresh Interval, Data Saver, Worker Health Check (`https://metro-news-api.maxyu0725.workers.dev/`).

## 📦 Deployment Instructions

### Push to GitHub
Run the following commands in your terminal to push this project to GitHub:

```bash
git init
git add .
git commit -m "Initial commit of metro-news-live"
git remote add origin https://github.com/maxyu725/metro-news-live.git
git branch -M main
git push -u origin main
```

Upon `git push`, **GitHub Actions** will automatically:
1. Deploy the Cloudflare Worker to `https://metro-news-api.maxyu0725.workers.dev/`.
2. Compile and sign the Android Release APK (`gemini-news-release`).
