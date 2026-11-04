// 中文 PDF 轉錄回歸測試：先在專案根目錄 python3 -m http.server 8765，再 node tests/pdf-cjk.e2e.js
// 上傳 tests/fixtures/pdf-cjk/ 的 4 份虛構 PDF 到 AI 閱卷與 AI 自動填，比對網站抓到的字與原文；說明見 docs/PDF轉錄修正.md
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const FX = path.join(__dirname, 'fixtures', 'pdf-cjk');
// 沙箱擋外部 CDN 時：設 CDN_DIR 指向本機 pdfjs-dist@3.11.174 / xlsx@0.18.5（npm pack 解開），只在測試瀏覽器內替換（含中文字型對照表 cmaps）
async function route(ctx) {
  const dir = process.env.CDN_DIR; if (!dir) return;
  await ctx.route('https://cdnjs.cloudflare.com/**', (r) => {
    const u = r.request().url(); const H = { 'Access-Control-Allow-Origin': '*' };
    let m = u.match(/pdf\.js\/3\.11\.174\/(pdf\.min\.js|pdf\.worker\.min\.js)$/);
    if (m) return r.fulfill({ path: path.join(dir, 'pdfjs-dist-3.11.174/package/build', m[1]), contentType: 'application/javascript', headers: H });
    m = u.match(/pdf\.js\/3\.11\.174\/(cmaps|standard_fonts)\/(.+)$/);
    if (m) return r.fulfill({ path: path.join(dir, 'pdfjs-dist-3.11.174/package', m[1], decodeURIComponent(m[2])), contentType: 'application/octet-stream', headers: H });
    if (/xlsx\/0\.18\.5\/xlsx\.full\.min\.js$/.test(u)) return r.fulfill({ path: path.join(dir, 'xlsx-0.18.5/package/dist/xlsx.full.min.js'), contentType: 'application/javascript', headers: H });
    return r.abort();
  });
}
const truth = JSON.parse(fs.readFileSync(path.join(FX, 'truth.json'), 'utf8'));
const sq = (s) => String(s || '').replace(/[\s　]+/g, '');
function lcs(a, b) { // 依序比對：回傳 b 中有多少字依序對得上 a、以及漏掉的字
  const A = [...a], B = [...b]; const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Uint16Array(m + 1));
  for (let i = 1; i <= n; i++) for (let j = 1; j <= m; j++) dp[i][j] = A[i-1] === B[j-1] ? dp[i-1][j-1] + 1 : Math.max(dp[i-1][j], dp[i][j-1]);
  const miss = []; let i = n, j = m; while (i > 0 && j > 0) { if (A[i-1] === B[j-1]) { i--; j--; } else if (dp[i-1][j] >= dp[i][j-1]) { miss.push(A[i-1]); i--; } else j--; } while (i > 0) { miss.push(A[--i]); }
  return { hit: dp[n][m], miss: miss.reverse().join('') };
}
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 1000 } });
  await route(ctx);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(String(e))); p.on('console', (m) => { if (/cmap|CMap|Warning/i.test(m.text())) errs.push('console: ' + m.text().slice(0, 160)); });
  await p.goto('http://localhost:8765/index.html?demo=ding#page-ai-brief', { waitUntil: 'load' });
  await p.waitForTimeout(800);
  // 包一層 getDocument，記下網站每頁實際拿到的文字（不改網站邏輯）
  await p.evaluate(async () => {
    const pdf = await pdfjsLib.getDocument({ data: await (await fetch('01_%E6%B0%91%E4%BA%8B%E8%B5%B7%E8%A8%B4%E7%8B%80.pdf')).arrayBuffer() }).promise;
    const proto = Object.getPrototypeOf(await pdf.getPage(1)); const gt = proto.getTextContent;
    proto.getTextContent = async function (...a) { const tc = await gt.apply(this, a); const cap = window.__cap = window.__cap || {}; cap[this._pageIndex + 1] = tc.items.map((x) => x.str).join(''); return tc; };
  });
  const rows = [];
  const files = Object.keys(truth);
  for (const f of files) {
    const fp = path.join(FX, f); const t = truth[f];
    const want = sq(t.map((x) => x.text).join('')); const wantText = sq(t.filter((x) => !x.image).map((x) => x.text).join(''));
    // AI 閱卷
    await p.evaluate(() => { location.hash = '#page-ai-brief'; window.__cap = {}; });
    await p.evaluate(() => { document.getElementById('aib-pdf-status').textContent = '__wait'; }); await p.setInputFiles('#aib-pdf', { name: f, mimeType: 'application/pdf', buffer: fs.readFileSync(fp) });
    await p.waitForFunction(() => !/讀取中|__wait/.test(document.getElementById('aib-pdf-status').textContent), null, { timeout: 60000 });
    const aib = await p.evaluate(() => ({ st: document.getElementById('aib-pdf-status').innerHTML.replace(/<br>/g,' / ').replace(/<[^>]+>/g,''), pages: window.__cap }));
    const aibGot = sq(Object.values(aib.pages).join(''));
    // AI 自動填
    await p.evaluate(() => { location.hash = '#page-autofill'; window.__cap = {}; });
    await p.waitForSelector('#af-file', { state: 'attached' });
    await p.evaluate(() => { document.getElementById('af-status').textContent = '__wait'; }); await p.setInputFiles('#af-file', { name: f, mimeType: 'application/pdf', buffer: fs.readFileSync(fp) });
    await p.waitForFunction(() => !/讀取中|__wait/.test(document.getElementById('af-status').textContent), null, { timeout: 60000 });
    const af = await p.evaluate(() => ({ st: document.getElementById('af-status').innerHTML.replace(/<br>/g,' / ').replace(/<[^>]+>/g,''), pages: window.__cap }));
    const afGot = sq(Object.values(af.pages).join(''));
    const L1 = lcs(want, aibGot), L2 = lcs(want, afGot);
    rows.push({ file: f, pages: t.length, imagePages: t.map((x, i) => x.image ? i + 1 : 0).filter(Boolean), truthChars: [...want].length, textLayerChars: [...wantText].length,
      aib: { got: [...aibGot].length, matched: L1.hit, missSample: L1.miss.slice(0, 40), status: aib.st },
      af: { got: [...afGot].length, matched: L2.hit, missSample: L2.miss.slice(0, 40), status: af.st } });
  }
  for (const r of rows) console.log(`${r.file}｜原文 ${r.truthChars}（文字層 ${r.textLayerChars}）｜閱卷 抓到 ${r.aib.got} 對上 ${r.aib.matched}｜自動填 抓到 ${r.af.got} 對上 ${r.af.matched}\n   閱卷狀態：${r.aib.status}\n   自動填狀態：${r.af.status}`);
  console.log('錯誤/警告：', [...new Set(errs)].slice(0, 8));
  const fails = [];
  for (const r of rows) {
    if (r.aib.matched !== r.textLayerChars) fails.push(`${r.file} 閱卷只對上 ${r.aib.matched}/${r.textLayerChars}`);
    if (r.af.matched !== r.textLayerChars) fails.push(`${r.file} 自動填只對上 ${r.af.matched}/${r.textLayerChars}`);
    for (const n of r.imagePages) { const t = `第 ${n} 頁是圖片、讀不到文字`; if (!r.aib.status.includes(t)) fails.push(`${r.file} 閱卷沒提示「${t}」`); if (!r.af.status.includes(t)) fails.push(`${r.file} 自動填沒提示「${t}」`); }
  }
  console.log(fails.length ? '失敗：\n' + fails.join('\n') : `全部通過（${rows.length} 份 PDF × 2 個功能）`);
  await b.close(); process.exit(fails.length ? 1 : 0);
})();
