// 一鍵示範在網路很慢／示範 PDF 下載失敗時也要跑得完（2026-11-05 體檢）：node tests/demo-slow.e2e.js
// 先在專案根目錄 python3 -m http.server 8765。斷網模式（外部網址全擋）。
//   ① 慢：每份示範 PDF 延遲 6 秒（4 份共 24 秒，超過舊版 15 秒上限）→ 照樣分析完、打開原文
//   ② 壞：示範 PDF 全部 404 → 不卡在「請先貼入至少 30 字」，自動改用示範文字分析
'use strict';
const { chromium } = require('playwright');
const { offline, unexpected } = require('./offline');
const url = 'http://localhost:8765/index.html?demo=ding&autorun=pdf-view';
(async () => {
  const b = await chromium.launch(); const fails = [];
  for (const mode of ['slow', 'broken']) {
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
    const blocked = await offline(ctx);
    await ctx.route(/\/0[1-4]_[^/]+\.pdf$/, async (r) => {
      if (mode === 'broken') return r.fulfill({ status: 404, body: 'not found' });
      await new Promise((res) => setTimeout(res, 6000)); return r.continue();
    });
    const p = await ctx.newPage(); const errs = [], dialogs = [];
    p.on('pageerror', (e) => errs.push(String(e)));
    p.on('dialog', (d) => { dialogs.push(d.message()); d.dismiss(); });
    const t0 = Date.now();
    await p.goto(url, { waitUntil: 'load' });
    await p.waitForFunction(() => document.querySelectorAll('#aib-trace .aib-badge').length > 0, null, { timeout: 90000 }).catch(() => {});
    await p.waitForTimeout(1500);
    const info = await p.evaluate(() => ({ badges: document.querySelectorAll('#aib-trace .aib-badge').length, viewer: !document.getElementById('aib-viewer').classList.contains('hidden') }));
    const sec = ((Date.now() - t0) / 1000).toFixed(1);
    const stuck = dialogs.some((m) => /至少 30 字/.test(m));
    console.log(`${mode === 'slow' ? '① 慢（每份 PDF 延遲 6 秒）' : '② 示範 PDF 全部下載失敗'}：${sec} 秒，結果 ${info.badges} 筆，原文視窗 ${info.viewer ? '有開' : '沒開'}，跳出訊息：${dialogs.join('／') || '無'}`);
    if (!info.badges) fails.push(mode + '：沒有分析結果');
    if (stuck) fails.push(mode + '：卡在「請先貼入至少 30 字」');
    if (mode === 'slow' && !info.viewer) fails.push('slow：沒有打開原文視窗');
    if (errs.length) fails.push(mode + ' 頁面錯誤：' + errs.join(' | '));
    if (unexpected(blocked).length) fails.push(mode + ' 連了外部網址：' + unexpected(blocked).join('、'));
    await ctx.close();
  }
  await b.close();
  console.log(fails.length ? '失敗：\n' + fails.join('\n') : '全部通過');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
