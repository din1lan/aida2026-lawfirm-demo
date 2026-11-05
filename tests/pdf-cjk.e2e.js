// 中文 PDF 轉錄回歸測試：先在專案根目錄 python3 -m http.server 8765，再 node tests/pdf-cjk.e2e.js
// 上傳 tests/fixtures/pdf-cjk/ 的虛構 PDF 到「AI 智慧閱卷」與「AI 自動填」，比對網站抓到的字與原文。
//   有文字層的頁：要一字不差；掃描（圖片）頁：OCR 依序對上原文要 ≥ 85%，畫面要有「OCR 辨識，可能有錯字」提醒，
//   中文字之間不能有空白；含圖片區塊的那份要提示「有 N 行無法辨識，已略過」
//   OFFLINE_OCR=1：模擬連不到 OCR 元件 → 圖片頁要明確寫「第 N 頁是圖片、讀不到文字」或「可能是掃描檔」
// 說明見 docs/PDF轉錄修正.md
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const { offline, unexpected } = require('./offline');
const FX = path.join(__dirname, 'fixtures', 'pdf-cjk');
const OFFLINE = process.env.OFFLINE_OCR === '1';
const OCR_MIN = 0.85;

async function route(ctx) {
  // 斷網：外部網址全擋（元件都在 vendor/）。OFFLINE_OCR=1 時連本機的 OCR 元件也擋，模擬元件壞掉
  ctx.__blocked = await offline(ctx, OFFLINE ? { blockLocal: /\/vendor\/tesseract\// } : {});
}
const sq = (s) => String(s || '').replace(/[\s　]+/g, '');
function lcs(a, b) { // 依序比對：b 裡有幾個字依序對得上 a
  const A = [...a], B = [...b]; const n = A.length, m = B.length;
  let prev = new Uint16Array(m + 1), cur = new Uint16Array(m + 1);
  for (let i = 1; i <= n; i++) { for (let j = 1; j <= m; j++) cur[j] = A[i - 1] === B[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]); [prev, cur] = [cur, prev]; cur.fill(0); }
  return prev[m];
}
const strip = (html) => html.replace(/<br>/g, ' / ').replace(/<[^>]+>/g, '');

(async () => {
  const truth = JSON.parse(fs.readFileSync(path.join(FX, 'truth.json'), 'utf8'));
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
  await route(ctx);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  p.on('console', (m) => { if (/CMap/i.test(m.text())) errs.push('console: ' + m.text().slice(0, 160)); });
  await p.goto('http://localhost:8765/index.html?demo=ding#page-ai-brief', { waitUntil: 'load' });
  await p.waitForTimeout(800);
  // 記下網站每頁實際拿到的文字：AI 閱卷看 AIB_DOC 組出的文字框；AI 自動填看 pdf.js 每頁文字＋OCR 結果（包住共用函式，不改網站邏輯）
  await p.evaluate(() => {
    const P = window.LF_PdfText; const orig = P.read;
    P.read = async (...a) => { const t0 = performance.now(); const r = await orig(...a); window.__last = { pages: r.pages.map((x) => ({ text: x.text, ocr: x.ocr })), ms: performance.now() - t0, ocrMs: r.ocrMs, ocrError: r.ocrError }; return r; };
  });
  const rows = []; const fails = [];
  for (const f of Object.keys(truth)) {
    const t = truth[f]; const buf = fs.readFileSync(path.join(FX, f));
    const res = {};
    for (const [key, hash, input, status] of [['閱卷', '#page-ai-brief', '#aib-pdf', 'aib-pdf-status'], ['自動填', '#page-autofill', '#af-file', 'af-status']]) {
      await p.evaluate((h) => { if (h === '#page-autofill') window.LF_AutofillHost.showPage('page-autofill'); else location.hash = h; window.__last = null; }, hash);
      await p.waitForSelector(input, { state: 'attached' });
      await p.evaluate((id) => { document.getElementById(id).textContent = '__wait'; }, status);
      await p.setInputFiles(input, { name: f, mimeType: 'application/pdf', buffer: buf });
      await p.waitForFunction((id) => !/讀取中|__wait|辨識中|辨識完成/.test(document.getElementById(id).textContent), status, { timeout: 300000 });
      const got = await p.evaluate((id) => ({ st: document.getElementById(id).innerHTML, last: window.__last }), status);
      const st = strip(got.st); const pages = (got.last && got.last.pages) || [];
      let textHit = 0, textAll = 0, ocrHit = 0, ocrAll = 0;
      t.forEach((pg, i) => { const w = sq(pg.text), g = sq((pages[i] || {}).text); const h = lcs(w, g); if (pg.image) { ocrHit += h; ocrAll += [...w].length; } else { textHit += h; textAll += [...w].length; } });
      res[key] = { st, textHit, textAll, ocrHit, ocrAll, sec: got.last ? +(got.last.ms / 1000).toFixed(1) : null, ocrSec: got.last ? +(got.last.ocrMs / 1000).toFixed(1) : null };
      if (textHit !== textAll) fails.push(`${f}｜${key}：文字層只對上 ${textHit}/${textAll}`);
      const imgNums = t.map((x, i) => (x.image ? i + 1 : 0)).filter(Boolean);
      if (imgNums.length) {
        if (!OFFLINE) {
          if (ocrHit / ocrAll < OCR_MIN) fails.push(`${f}｜${key}：OCR 正確率 ${(ocrHit / ocrAll * 100).toFixed(1)}% 低於 ${OCR_MIN * 100}%`);
          if (!/OCR 辨識，可能有錯字/.test(st)) fails.push(`${f}｜${key}：沒有「OCR 辨識，可能有錯字」提醒`);
          const ocrText = pages.filter((x) => x.ocr).map((x) => x.text).join('\n');
          const gaps = (ocrText.match(/[\u4e00-\u9fff○][ \u3000]+(?=[\u4e00-\u9fff○])/g) || []).length;
          if (gaps) fails.push(`${f}｜${key}：OCR 文字的中文字之間還有 ${gaps} 處空白`);
          if (/寬字距含圖片/.test(f) && !/無法辨識，已略過/.test(st)) fails.push(`${f}｜${key}：圖片區塊的亂碼行沒有被略過並提示`);
        } else if (!(textAll ? st.includes(`第 ${imgNums.join('、')} 頁是圖片、讀不到文字`) : /掃描檔/.test(st))) fails.push(`${f}｜${key}：離線時沒有明確說哪幾頁讀不到`);
      }
    }
    rows.push({ f, res });
    const a = res['閱卷'], c = res['自動填'];
    console.log(`${f}｜文字層 ${a.textHit}/${a.textAll}${a.ocrAll ? `｜掃描頁 OCR 閱卷 ${a.ocrHit}/${a.ocrAll}（${(a.ocrHit / a.ocrAll * 100).toFixed(1)}%，${a.ocrSec} 秒）自動填 ${c.ocrHit}/${c.ocrAll}（${(c.ocrHit / c.ocrAll * 100).toFixed(1)}%，${c.ocrSec} 秒）` : ''}\n   閱卷：${a.st}\n   自動填：${c.st}`);
  }
  if (errs.length) fails.push('頁面錯誤：' + errs.slice(0, 3).join(' | '));
  console.log(fails.length ? '失敗：\n' + fails.join('\n') : `全部通過（${rows.length} 份 PDF × 2 個功能${OFFLINE ? '，離線模式' : ''}）`);
  await b.close(); process.exit(fails.length ? 1 : 0);
})();
