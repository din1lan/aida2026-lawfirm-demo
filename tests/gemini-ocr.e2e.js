// 掃描頁用 Gemini 辨識：瀏覽器實測（假回應，不連 Google、不用真的金鑰）
//   先在專案根目錄 python3 -m http.server 8765，再 node tests/gemini-ocr.e2e.js
//   沙箱擋外部 CDN 時：CDN_DIR＝本機 npm 同版本套件（同 tests/pdf-cjk.e2e.js）；TW_CSS＝先編好的 Tailwind 樣式（只為了截圖好看）
// 跑 4 種情況，截圖到 docs/screenshots/gemini-ocr/：
//   AI 智慧閱卷 × {不勾選→本機 OCR、勾選→Gemini}、AI 自動填 × {不勾選、勾選}，另加「勾選但金鑰錯→退回本機」
// 用的檔案：tests/fixtures/pdf-cjk/T2_含圖片頁_3頁.pdf（虛構判決，第 2 頁是掃描圖片，第 1、3 頁有文字層）
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const FX = path.join(__dirname, 'fixtures', 'pdf-cjk');
const FILE = 'T2_含圖片頁_3頁.pdf';
const SHOTS = path.join(__dirname, '..', 'docs', 'screenshots', 'gemini-ocr');
const FAKE_KEY = 'fake-key-for-test-only';

async function route(ctx, gem) {
  const dir = process.env.CDN_DIR; const tw = process.env.TW_CSS;
  await ctx.route(/^https:\/\/cdn\.tailwindcss\.com/, (r) => (tw
    ? r.fulfill({ contentType: 'application/javascript', body: `(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(fs.readFileSync(tw, 'utf8'))};document.head.appendChild(s);window.tailwind={};})();` })
    : r.abort()));
  await ctx.route(/^https:\/\/generativelanguage\.googleapis\.com\//, gem);
  await ctx.route(/^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)\//, (r) => {
    const u = r.request().url(); const H = { 'Access-Control-Allow-Origin': '*' };
    if (/cdn\.jsdelivr\.net/.test(u)) ctx.__tessHits = (ctx.__tessHits || 0) + 1;
    if (!dir) return r.continue();
    const file = (p, type) => r.fulfill({ path: path.join(dir, p), contentType: type || 'application/octet-stream', headers: H });
    let m = u.match(/pdf\.js\/3\.11\.174\/(pdf\.min\.js|pdf\.worker\.min\.js)$/);
    if (m) return file('pdfjs-dist-3.11.174/package/build/' + m[1], 'application/javascript');
    m = u.match(/pdf\.js\/3\.11\.174\/(cmaps|standard_fonts)\/(.+)$/);
    if (m) return file(`pdfjs-dist-3.11.174/package/${m[1]}/${decodeURIComponent(m[2])}`);
    if (/xlsx\/0\.18\.5\/xlsx\.full\.min\.js$/.test(u)) return file('xlsx-0.18.5/package/dist/xlsx.full.min.js', 'application/javascript');
    m = u.match(/npm\/tesseract\.js@5\.1\.1\/dist\/(.+)$/);
    if (m) return file('tesseract.js-5.1.1/package/dist/' + m[1], 'application/javascript');
    m = u.match(/npm\/tesseract\.js-core@5\.1\.1\/(.+)$/);
    if (m) return file('tesseract.js-core-5.1.1/package/' + m[1], m[1].endsWith('.wasm') ? 'application/wasm' : 'application/javascript');
    m = u.match(/npm\/@tesseract\.js-data\/(chi_tra)@1\.0\.0\/(.+)$/);
    if (m) return file(`tesseract.js-data-${m[1]}-1.0.0/package/${m[2]}`);
    return r.abort();
  });
}

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const truth = JSON.parse(fs.readFileSync(path.join(FX, 'truth.json'), 'utf8'))[FILE];
  const buf = fs.readFileSync(path.join(FX, FILE));
  const fails = []; const log = (s) => console.log(s);
  const check = (cond, msg) => { if (!cond) fails.push(msg); log(`  ${cond ? '✓' : '✗'} ${msg}`); };
  const b = await chromium.launch();

  // mode：'ok'＝假 Gemini 回傳該頁原文（把「乙○○」換成虛構姓名「李大華」，示範分析時會被遮）；'badkey'＝回 400 金鑰錯
  async function scenario(name, feature, checked, mode) {
    log(`\n■ ${name}`);
    const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
    const calls = [];
    await route(ctx, async (r) => {
      const body = JSON.parse(r.request().postData() || '{}');
      const ask = (((body.contents || [])[0] || {}).parts || [])[0] || {};
      const n = +(String(ask.text || '').match(/第 (\d+) 頁/) || [])[1];
      const hasImg = !!(((body.contents || [])[0] || {}).parts || []).find((p) => p.inline_data && p.inline_data.data.length > 1000);
      calls.push({ page: n, hasImg, url: r.request().url() });
      if (mode === 'badkey') return r.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { code: 400, status: 'INVALID_ARGUMENT', message: 'API key not valid. Please pass a valid API key.' } }) });
      const text = String((truth[n - 1] || {}).text || '').replace(/乙○○/g, '李大華');
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }] }) });
    });
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', (e) => { if (!/tailwind/.test(String(e))) errs.push(String(e)); });
    await p.goto('http://localhost:8765/index.html?demo=ding#page-ai-brief', { waitUntil: 'load' });
    await p.waitForTimeout(800);
    // 金鑰：照網站作法貼在「AI 智慧閱卷」頁（假的）
    await p.fill('#aib-gemini-key', FAKE_KEY); await p.dispatchEvent('#aib-gemini-key', 'change');
    const isAib = feature === 'aib';
    const box = isAib ? '#aib-gemini-ocr' : '#af-gemini-ocr'; const input = isAib ? '#aib-pdf' : '#af-file'; const status = isAib ? 'aib-pdf-status' : 'af-status';
    if (!isAib) await p.evaluate(() => window.LF_AutofillHost.showPage('page-autofill'));
    await p.waitForSelector(box, { state: 'attached' });
    check(!(await p.isChecked(box)), '勾選框預設沒打勾');
    if (checked) await p.check(box);
    await p.evaluate((id) => { document.getElementById(id).textContent = '__wait'; }, status);
    await p.setInputFiles(input, { name: FILE, mimeType: 'application/pdf', buffer: buf });
    await p.waitForFunction((id) => !/讀取中|__wait|辨識中|辨識完成/.test(document.getElementById(id).textContent), status, { timeout: 300000 });
    const st = await p.evaluate((id) => document.getElementById(id).textContent, status);
    log('  狀態：' + st.replace(/\s+/g, ' ').slice(0, 260));
    const aibText = isAib ? await p.inputValue('#aib-text') : '';
    const tess = ctx.__tessHits || 0;

    if (!checked) {
      check(calls.length === 0, '沒勾選：完全沒有呼叫 Gemini');
      check(/OCR 辨識，可能有錯字|圖片、讀不到文字/.test(st), '沒勾選：照舊用本機 OCR');
    } else if (mode === 'ok') {
      check(calls.length === 1 && calls[0].page === 2 && calls[0].hasImg, '只送第 2 頁（掃描頁）的圖片，第 1、3 頁有文字層不送');
      check(calls.every((c) => c.url.includes('key=' + FAKE_KEY)), '用「AI 智慧閱卷」頁貼的金鑰');
      check(st.includes('第 2 頁由 Gemini 辨識') && st.includes('沒有遮姓名') && st.includes('會先遮姓名'), '畫面標示「由 Gemini 辨識」與圖片沒遮、分析有遮');
      // AI 智慧閱卷：文字用 Gemini 的，但背景會用本機 OCR 取得座標（只為了「原文」螢光，圖片不上傳）；AI 自動填不需要
      if (!isAib) check(tess === 0, '全部成功時不下載本機 OCR 元件（AI 自動填）');
      if (isAib) check(aibText.includes('此頁由 Gemini 辨識') && aibText.includes('李大華'), '文字框裡該頁標示「此頁由 Gemini 辨識」');
    } else {
      check(calls.length === 1, '金鑰錯：試過一次就停');
      check(st.includes('金鑰無效') && st.includes('已改用本機辨識'), '畫面說明失敗原因與「已改用本機辨識」');
      check(/OCR 辨識，可能有錯字|圖片、讀不到文字/.test(st), '退回本機 OCR');
    }
    const tag = `${isAib ? '閱卷' : '自動填'}_${checked ? (mode === 'ok' ? '勾選Gemini' : '勾選但金鑰錯') : '不勾選本機'}`;
    await p.screenshot({ path: path.join(SHOTS, `${tag}_1讀入.png`), fullPage: false });

    // 接著照原流程分析：送出前去識別化（閱卷用「去識別化測試」假回應引擎；自動填用示意版）
    if (isAib && checked && mode === 'ok') {
      await p.selectOption('#aib-engine', 'gemini-mock');
      await p.click('#aib-analyze');
      await p.waitForSelector('#deid-preview', { timeout: 30000 });
      const prev = await p.evaluate(() => document.getElementById('deid-preview').innerText);
      check(/【(對造|人名|關係人|當事人)[A-Z0-9]+】/.test(prev) && !/被告\s*李大華/.test(prev.split('將送出')[1] || prev), '分析前的預覽：Gemini 轉回來的姓名（李大華）已換成代號');
      await p.screenshot({ path: path.join(SHOTS, `${tag}_2分析前已遮姓名.png`) });
    } else if (!isAib) {
      await p.click('#af-run');
      await p.waitForFunction(() => /讀完了|⚠/.test(document.getElementById('af-status').textContent), null, { timeout: 30000 });
      const st2 = await p.evaluate(() => document.getElementById('af-status').textContent);
      log('  讀完：' + st2.replace(/\s+/g, ' ').slice(0, 200));
      check(/已遮蔽 \d+ 項個資/.test(st2), 'AI 讀取時文字已先遮個資');
      if (checked) check(st2.includes('第 2 頁由 Gemini 辨識'), '讀完後仍保留「由 Gemini 辨識」說明');
      await p.screenshot({ path: path.join(SHOTS, `${tag}_2讀完.png`), fullPage: true });
    }
    check(!errs.length, '沒有頁面錯誤' + (errs.length ? '：' + errs[0] : ''));
    await ctx.close();
  }

  await scenario('AI 智慧閱卷｜不勾選（本機 OCR）', 'aib', false, 'ok');
  await scenario('AI 智慧閱卷｜勾選（Gemini 假回應）', 'aib', true, 'ok');
  await scenario('AI 智慧閱卷｜勾選但金鑰錯（退回本機）', 'aib', true, 'badkey');
  await scenario('AI 自動填｜不勾選（本機 OCR）', 'af', false, 'ok');
  await scenario('AI 自動填｜勾選（Gemini 假回應）', 'af', true, 'ok');
  await b.close();
  console.log(fails.length ? `\n失敗 ${fails.length} 項：\n` + fails.join('\n') : '\n全部通過');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
