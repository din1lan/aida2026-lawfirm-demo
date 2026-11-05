// 一鍵示範網址回歸檢查：node tests/demo-regression.e2e.js [網址]
// 預設 http://localhost:8765/index.html?demo=ding&autorun=pdf-view
'use strict';
const { chromium } = require('playwright');
const { offline, unexpected } = require('./offline');
const url = process.argv[2] || 'http://localhost:8765/index.html?demo=ding&autorun=pdf-view';
const shot = process.argv[3];
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 } });
  // 斷網：外部網址全擋（元件都在 vendor/），順便證明一鍵示範不需要網路
  const blocked = await offline(ctx);
  const p = await ctx.newPage();
  const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
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
  const ext = unexpected(blocked);
  console.log(JSON.stringify({ url, viewerOpen, ...info, offline: true, externalTried: ext, pageErrors: errs }));
  await b.close();
  process.exit(viewerOpen && !errs.length && !ext.length ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
