// 一鍵示範網址回歸檢查：node tests/demo-regression.e2e.js [網址]
// 預設 http://localhost:8765/index.html?demo=ding&autorun=pdf-view
'use strict';
const { chromium } = require('playwright');
const url = process.argv[2] || 'http://localhost:8765/index.html?demo=ding&autorun=pdf-view';
const shot = process.argv[3];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  // 沙箱擋外部 CDN 時：設 CDN_DIR 指向本機的 pdfjs-dist@3.11.174 / xlsx@0.18.5（npm pack 解開），只在測試瀏覽器內替換
  const dir = process.env.CDN_DIR;
  if (dir) {
    const path = require('path');
    const map = {
      'pdf.js/3.11.174/pdf.min.js': 'pdfjs-dist-3.11.174/package/build/pdf.min.js',
      'pdf.js/3.11.174/pdf.worker.min.js': 'pdfjs-dist-3.11.174/package/build/pdf.worker.min.js',
      'xlsx/0.18.5/xlsx.full.min.js': 'xlsx-0.18.5/package/dist/xlsx.full.min.js',
    };
    await ctx.route('https://cdnjs.cloudflare.com/**', (r) => {
      const k = Object.keys(map).find((x) => r.request().url().endsWith(x));
      return k ? r.fulfill({ path: path.join(dir, map[k]), contentType: 'application/javascript', headers: { 'Access-Control-Allow-Origin': '*' } }) : r.abort();
    });
  }
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => { if (!/tailwind/.test(String(e))) errs.push(String(e)); });
  await p.goto(url, { waitUntil: 'load' });
  let viewerOpen = false;
  for (let i = 0; i < 60 && !viewerOpen; i++) { await p.waitForTimeout(500); viewerOpen = await p.evaluate(() => { const v = document.getElementById('aib-viewer'); return !!v && !v.classList.contains('hidden'); }); }
  const info = await p.evaluate(() => ({
    page: (location.hash || ''),
    findings: document.querySelectorAll('#aib-trace .aib-badge').length,
    viewerTitle: (document.getElementById('aib-viewer-title') || {}).textContent,
    progressModuleLoaded: !!window.ProgressReport,
  }));
  if (shot) await p.screenshot({ path: shot });
  console.log(JSON.stringify({ url, viewerOpen, ...info, pageErrors: errs }));
  await b.close();
  process.exit(viewerOpen && !errs.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
