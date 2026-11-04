// 一鍵示範結果內容檢查（2026-11-06，體檢第 2 項）：node tests/demo-content.e2e.js
// 檢查：當事人只有「原告：王小明」「被告：李大華」；時間軸每筆的日期都出現在自己那句話裡。
// 沙箱擋外部 CDN 時：設 CDN_DIR（同 demo-regression.e2e.js）
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const url = process.argv[2] || 'http://localhost:8765/index.html?demo=ding&autorun=pdf-view';
(async () => {
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const dir = process.env.CDN_DIR;
  if (dir) {
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
  await p.waitForFunction(() => { const v = document.getElementById('aib-viewer'); return v && !v.classList.contains('hidden'); }, null, { timeout: 30000 });
  const text = await p.evaluate(() => document.getElementById('aib-trace').innerText);
  const section = (name, next) => { const a = text.indexOf('\n' + name + '\n'); const z = text.indexOf('\n' + next + '\n', a + 1); return a < 0 ? '' : text.slice(a, z < 0 ? undefined : z); };
  const parties = (section('當事人', '時間軸').match(/(原告|被告|上訴人|被上訴人)：.+/g) || []);
  const tl = (section('時間軸', '證據').match(/\d{3}年\d{2}月\d{2}日｜.+$/gm) || []);
  const fails = [];
  const want = ['原告：王小明', '被告：李大華'];
  if (parties.length !== 2 || !want.every((w) => parties.includes(w))) fails.push('當事人不對：' + parties.join('、'));
  tl.forEach((line) => {
    const [d, ctxText] = line.split('｜');
    const [, y, m, dd] = d.match(/(\d{3})年(\d{2})月(\d{2})日/);
    if (!ctxText.includes(`${Number(y)}年${Number(m)}月${Number(dd)}日`)) fails.push('時間軸日期不在內容裡：' + line);
    if (/^[^，。]*。/.test(ctxText)) fails.push('時間軸內容夾到上一句：' + line);
  });
  if (tl.length < 5) fails.push('時間軸筆數太少：' + tl.length);
  console.log(JSON.stringify({ parties, timeline: tl.length, fails, pageErrors: errs }, null, 1));
  await b.close();
  process.exit(fails.length || errs.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
