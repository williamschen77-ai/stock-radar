# Stock Radar Mobile

這是 Stock Radar 的 Capacitor 行動版專案。網站前端會被打包進 iOS／Android App；市場資料仍由公開的 Stock Radar API 網域提供。

## 先決條件

- Node.js 20+
- iOS：macOS、最新版 Xcode、Apple Developer Program 帳號
- Android：Android Studio 與 Android SDK
- 一個公開 HTTPS 網域作為 API 來源；**Vercel Deployment Protection 必須對該網域關閉**，否則 App 無法讀取 `/api/*`。

## 第一次建立原生專案

```bash
cd mobile
copy .env.example .env
# 將 .env 的 STOCK_RADAR_API_ORIGIN 改成正式公開網址
npm install
npm run ios:add
npm run android:add
npm run assets
npm run ios:prepare
npm run sync
```

之後用 `npm run ios:open` 在 Xcode 開啟 iOS 專案；修改網站程式後執行 `npm run sync` 再回到 Xcode Archive。

## App Store 上架前清單

1. 在 Apple Developer 建立 `com.williamschen.stockradar` App ID；若已有識別碼，先同步修改 `capacitor.config.json`。
2. 已選定的 1024px 圖示在 `resources/icon.png`；執行 `npm run assets` 會產生各 iOS／Android 尺寸。
3. 在 Xcode 設定版本、Build Number、最低 iOS 版本與簽署 Team。
4. TestFlight 實機測試：主動 ETF 清單、個股搜尋、收藏、分享、離線狀態與所有外部連結。
5. App Store Connect 填寫名稱、描述、關鍵字、1024px 圖示、iPhone/iPad 截圖、[隱私權政策](https://YOUR-PUBLIC-DOMAIN.example/privacy.html)、[支援頁面](https://YOUR-PUBLIC-DOMAIN.example/)、風險聲明與金融類別資訊。
6. 上傳 Archive，先發 TestFlight，再送 App Review。

## 為何不能只開網站

Apple Guideline 4.2 不接受單純包裝網站。送審版本必須保有原生價值：本機收藏、系統分享、可選擇的本機價格提醒與離線狀態。這個專案已安裝 Share／Local Notifications 插件並預留 bridge；下一個開發階段會把這些能力接到 App UI。
