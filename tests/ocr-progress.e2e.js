// 本機 OCR 進度條（2026-11-05）：node tests/ocr-progress.e2e.js
// 先在專案根目錄 python3 -m http.server 8765。斷網模式、假金鑰（不連 Google）。
// AI 智慧閱卷、收文登記各上傳 5 頁虛構掃描判決：
//   進度條要出現「第 N／5 頁」＋百分比；同一頁辨識中百分比要會動；辨識完自動收起
//   「掃描頁用 Gemini 辨識」勾選框（有設定 AI 時才顯示）預設不勾
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const { offline } = require('./offline');
const FILE = 'S1_掃描判決_乾淨_5頁.pdf';
const buf = fs.readFileSync(path.join(__dirname, 'fixtures', 'pdf-cjk', FILE));
(async () => {
  const b = await chromium.launch(); const fails = [];
  const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fails.push(m); };
  const cases = [
    { name: 'AI 智慧閱卷', hash: '#page-ai-brief', input: '#aib-pdf', status: 'aib-pdf-status', box: 'aib-gemini-ocr', done: /✓ 文件1/ },
    { name: '收文登記', hash: '#page-autofill', input: '#in-file', status: 'in-status', box: 'in-gemini-ocr', done: /已讀入|讀取失敗/ },
  ];
  for (const c of cases) {
    console.log('■ ' + c.name);
    const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); await offline(ctx);
    // 沒設定金鑰：掃描頁用本機 OCR（有金鑰時改由 Gemini 讀）
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
    await p.goto('http://localhost:8765/index.html?demo=ding' + c.hash, { waitUntil: 'load' }); await p.waitForTimeout(900);
    if (c.hash === '#page-autofill') await p.evaluate(() => window.LF_AutofillHost.showPage('page-autofill'));
    ok(!(await p.$('#' + c.box)), '沒有「掃描頁用 Gemini 辨識」勾選框（2026-11-05 拿掉）');
    await p.setInputFiles(c.input, { name: FILE, mimeType: 'application/pdf', buffer: buf });
    const seen = []; const t0 = Date.now();
    while (Date.now() - t0 < 180000) {
      const s = await p.evaluate((id) => {
        const st = document.getElementById(id); const bar = document.querySelector('.lf-ocr-progress');
        return { st: st ? st.textContent : '', bar: bar ? bar.querySelector('.l').textContent : null, w: bar ? bar.querySelector('.f').style.width : null };
      }, c.status);
      if (s.bar) seen.push(s);
      if (c.done.test(s.st) && !s.bar) break;
      await p.waitForTimeout(150);
    }
    const labels = seen.map((x) => x.bar);
    const pages = new Set(labels.map((l) => (l.match(/第 (\d+)／5 頁/) || [])[1]).filter(Boolean));
    const perPage = {}; seen.forEach((x) => { const n = (x.bar.match(/第 (\d+)／5 頁/) || [])[1]; (perPage[n] = perPage[n] || new Set()).add(x.w); });
    const moving = Object.values(perPage).some((ws) => ws.size >= 3);
    console.log(`    看到 ${seen.length} 次進度條；頁：${[...pages].join('、')}；例：「${labels[Math.floor(labels.length / 2)] || ''}」`);
    ok(seen.length > 0, '辨識時出現進度條');
    ok(pages.size >= 4 && labels.some((l) => /\d+%/.test(l)), '進度條顯示「第 N／5 頁」與百分比，逐頁前進');
    ok(moving, '同一頁辨識中，進度條也在動（同一頁看到 3 個以上不同寬度）');
    ok(await p.evaluate(() => !document.querySelector('.lf-ocr-progress')), '辨識完自動收起');
    ok(!errs.length, '沒有頁面錯誤' + (errs.length ? '：' + errs[0] : ''));
    await ctx.close();
  }
  await b.close();
  console.log(fails.length ? '失敗：\n' + fails.join('\n') : '全部通過');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
