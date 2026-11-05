# vendor/：網站用到的外部元件（2026-11-05 起放在網站裡，不靠 CDN）

斷網也能開網站、跑一鍵示範、讀 PDF、做本機 OCR。只有「呼叫 Gemini」需要網路。

| 資料夾／檔案 | 版本 | 來源（npm） | 用途 |
|---|---|---|---|
| `tailwind.css` | Tailwind 3.4.17 編好的靜態 CSS（只含用到的 class） | `tailwindcss@3.4.17`，設定在 `tools/tailwind.config.js` | 版面樣式 |
| `pdfjs/`（含 `cmaps/`、`standard_fonts/`） | 3.11.174 | `pdfjs-dist@3.11.174` | 讀 PDF、中文字型對照表 |
| `xlsx/` | 0.18.5 | `xlsx@0.18.5` | 讀寫 Excel |
| `tesseract/` | tesseract.js 5.1.1、core 5.1.1 | `tesseract.js@5.1.1`、`tesseract.js-core@5.1.1`（只放 LSTM 兩種：有／無 SIMD） | 本機 OCR |
| `tesseract/lang/chi_tra.traineddata.gz` | 4.0.0_best_int | `@tesseract.js-data/chi_tra@1.0.0` | 繁體中文語言檔 |

改了 `index.html` 或 `modules/*.js` 裡的 Tailwind class 之後，要重新產生 CSS：

```
npx tailwindcss@3.4.17 -c tools/tailwind.config.js -i tools/tailwind.input.css -o vendor/tailwind.css --minify
```
