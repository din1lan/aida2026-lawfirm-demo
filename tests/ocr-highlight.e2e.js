// 掃描頁「原文」螢光標示：先在專案根目錄 python3 -m http.server 8765，再 node tests/ocr-highlight.e2e.js
// 做法：上傳虛構掃描判決，從「產生測試檔時真的畫上去的句子」挑原句（不是 OCR 結果，所以含 OCR 錯字的情況），
//   打開原文視窗，檢查黃框是否落在該句實際所在的行與位置。
//   ① 本機 OCR：S1 乾淨掃描、S2 模擬掃描　② Gemini 辨識（假回應＝原文）：座標由背景本機 OCR 補上
// 截圖：docs/screenshots/ocr-highlight/
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const { offline, unexpected } = require('./offline');
const FX = path.join(__dirname, 'fixtures', 'pdf-cjk');
const SHOTS = path.join(__dirname, '..', 'docs', 'screenshots', 'ocr-highlight');
const truth = JSON.parse(fs.readFileSync(path.join(FX, 'truth.json'), 'utf8'));
const MIN_HITS = 8;

async function route(ctx, gem) {
  // 斷網：外部網址全擋（元件都在 vendor/）；只有 Gemini 走假回應
  ctx.__blocked = await offline(ctx);
  if (gem) await ctx.route(/^https:\/\/generativelanguage\.googleapis\.com\//, gem);
}

// 產生器（tests/fixtures/pdf-cjk/gen_scan.py）的版面：每行 30 字、字高 fs、行距 int(fs*1.6)、左上邊界 0.9 吋
function layout(dpi) { const fs = Math.floor(14 / 72 * dpi); return { dpi, fs, lh: Math.floor(fs * 1.6), x0: Math.floor(0.9 * dpi), y0: Math.floor(0.9 * dpi) }; }
// 從原文挑句子：每頁挑 4 句，各取一個畫面行裡第 2～16 字（14 字），算出它在頁面上的位置（頁面單位＝點）
function pickQuotes(file, dpi, pagesWanted) {
  const L = layout(dpi); const k = 72 / dpi; const out = [];
  pagesWanted.forEach((pn) => {
    const rows = []; truth[file][pn - 1].text.split('\n').forEach((line) => { for (let i = 0; i < line.length; i += 30) rows.push(line.slice(i, i + 30)); });
    const cand = rows.map((r, i) => ({ r, i })).filter((x) => [...x.r].length >= 20 && !/虛構掃描判決測試/.test(x.r));
    [0, 2, 4, 6].map((j) => cand[j]).filter(Boolean).forEach(({ r, i }) => {
      out.push({ page: pn, quote: r.slice(2, 16), y0: (L.y0 + i * L.lh) * k, y1: (L.y0 + i * L.lh + L.fs) * k, x0: (L.x0 + 2 * L.fs) * k, x1: (L.x0 + 16 * L.fs) * k });
    });
  });
  return out;
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const b = await chromium.launch(); const fails = []; const summary = [];
  async function run(label, file, dpi, pagesWanted, gemini) {
    const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
    await route(ctx, gemini ? async (r) => {
      const body = JSON.parse(r.request().postData() || '{}'); const ask = (((body.contents || [])[0] || {}).parts || [])[0] || {};
      const n = +(String(ask.text || '').match(/第 (\d+) 頁/) || [])[1];
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: truth[file][n - 1].text }] }, finishReason: 'STOP' }] }) });
    } : null);
    // 金鑰：管理員設定頁存在 localStorage（假的）
    if (gemini) await ctx.addInitScript(() => { try { localStorage.setItem('lf_admin_gemini_key', 'FAKE-KEY-FOR-TEST'); } catch (e) { /* ignore */ } });
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto('http://localhost:8765/index.html?demo=ding#page-ai-brief', { waitUntil: 'load' }); await p.waitForTimeout(800);
    if (gemini) await p.check('#aib-gemini-ocr');
    await p.evaluate(() => { document.getElementById('aib-pdf-status').textContent = '__wait'; });
    await p.setInputFiles('#aib-pdf', { name: file, mimeType: 'application/pdf', buffer: fs.readFileSync(path.join(FX, file)) });
    await p.waitForFunction(() => !/讀取中|__wait|辨識中|辨識完成/.test(document.getElementById('aib-pdf-status').textContent), null, { timeout: 300000 });
    if (gemini) {
      // 2026-11-05：讀完馬上點最後一頁（第 5 頁）的原文：要插隊先辨識、有進度，不用等整份 5 頁跑完（之前約 19 秒）
      const q5 = pickQuotes(file, dpi, [5])[0]; const t0 = Date.now(); let sawProgress = false;
      await p.evaluate((f) => window.LF_AibViewer(f), { page: q5.page, quote: q5.quote });
      for (let i = 0; i < 600; i++) {
        const st = await p.evaluate(() => { const c = document.querySelector('#aib-viewer-body canvas + canvas'); const n = document.querySelector('.aib-scan-note'); return { done: !!(c && c.dataset.rects), note: n ? n.textContent : '' }; });
        if (/\d+%|前面還有/.test(st.note)) sawProgress = true;
        if (st.done) break; await p.waitForTimeout(100);
      }
      const sec = (Date.now() - t0) / 1000;
      console.log(`  第 5 頁黃框出現：${sec.toFixed(1)} 秒；等待時有顯示進度：${sawProgress ? '有' : '沒有'}`);
      summary.push(`Gemini 第5頁黃框 ${sec.toFixed(1)} 秒`);
      if (sec > 12) fails.push(`Gemini 第 5 頁黃框要等 ${sec.toFixed(1)} 秒（應該插隊先做，12 秒內）`);
      if (!sawProgress) fails.push('等黃框時沒有顯示進度');
    }
    const quotes = pickQuotes(file, dpi, pagesWanted); let hits = 0; let shot = 0;
    for (const q of quotes) {
      await p.evaluate((f) => window.LF_AibViewer(f), { page: q.page, quote: q.quote });
      // Gemini 頁：座標要等背景本機 OCR 跑完（最多 3 分鐘）
      await p.waitForFunction(() => { const c = document.querySelector('#aib-viewer-body canvas + canvas'); const n = document.querySelector('.aib-scan-note'); return (c && c.dataset.rects) || (n && /找不到夠接近/.test(n.textContent)); }, null, { timeout: 180000 }).catch(() => {});
      const r = await p.evaluate(() => { const c = document.querySelector('#aib-viewer-body canvas + canvas'); const vpw = c ? c.width : 0; return { rects: c && c.dataset.rects ? JSON.parse(c.dataset.rects) : [], score: c ? c.dataset.score : '', note: (document.querySelector('.aib-scan-note') || {}).textContent || '', w: vpw }; });
      // 換回頁面單位：畫面寬 / 頁寬（A4＝8.27 吋＝595.4 點）
      const k = r.w / (8.27 * 72);
      const hit = r.rects.length > 0 && r.rects.some((x) => { const cy = (x.y + x.h / 2) / k; const ox = Math.min(x.x + x.w, q.x1 * k) - Math.max(x.x, q.x0 * k); return cy >= q.y0 - 6 && cy <= q.y1 + 6 && ox > 0.5 * (q.x1 - q.x0) * k; });
      if (hit) hits++;
      if (hit && shot < 2) { shot++; await p.locator('#aib-viewer > div').first().screenshot({ path: path.join(SHOTS, `${label}_${shot}.png`) }).catch(() => p.screenshot({ path: path.join(SHOTS, `${label}_${shot}.png`) })); }
      console.log(`  ${hit ? '✓' : '✗'} 第${q.page}頁「${q.quote}」${r.rects.length ? `相似度 ${r.score}` : r.note.slice(0, 40)}`);
    }
    summary.push(`${label}：${hits}/${quotes.length}`);
    if (hits < MIN_HITS) fails.push(`${label} 只標對 ${hits}/${quotes.length}（至少 ${MIN_HITS}）`);
    if (errs.length) fails.push(`${label} 頁面錯誤：${errs.slice(0, 2).join(' | ')}`);
    await ctx.close();
  }
  console.log('■ 本機 OCR：S1 乾淨掃描'); await run('本機OCR_乾淨掃描', 'S1_掃描判決_乾淨_5頁.pdf', 200, [1, 2, 3], false);
  console.log('■ 本機 OCR：S2 模擬掃描'); await run('本機OCR_模擬掃描', 'S2_掃描判決_模擬掃描_5頁.pdf', 150, [1, 2, 3], false);
  console.log('■ Gemini 辨識（假回應）＋背景本機座標：S1'); await run('Gemini_背景座標', 'S1_掃描判決_乾淨_5頁.pdf', 200, [1, 2, 3], true);
  console.log('\n命中：' + summary.join('｜'));
  console.log(fails.length ? '失敗：\n' + fails.join('\n') : '全部通過');
  await b.close(); process.exit(fails.length ? 1 : 0);
})();
