// 掃描檔交給 Gemini：12 頁、假回應每頁延遲 1.2 秒，檢查進度條一路前進、不會卡在一半（2026-11-05）
//   先在專案根目錄 python3 -m http.server 8765，再 node tests/gemini-speed.e2e.js
//   12 頁掃描檔由三份虛構掃描判決拼成（執行時用 python pypdf 產生在暫存資料夾，不放進 git）
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path'); const os = require('os'); const { execFileSync } = require('child_process');
const { offline } = require('./offline');
const FX = path.join(__dirname, 'fixtures', 'pdf-cjk');
const SHOTS = path.join(__dirname, '..', 'docs', 'screenshots', '1105-speed-cases');
const PDF = path.join(os.tmpdir(), 'lf_scan_12p.pdf');
const DELAY = 1200;

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  execFileSync('python3', ['-c', `
from pypdf import PdfReader, PdfWriter
import sys
w=PdfWriter(); d=sys.argv[1]
for f,n in [('S1_掃描判決_乾淨_5頁.pdf',5),('S2_掃描判決_模擬掃描_5頁.pdf',5),('S3_掃描判決_寬字距含圖片_3頁.pdf',2)]:
  r=PdfReader(d+'/'+f); [w.add_page(r.pages[i]) for i in range(n)]
w.write(sys.argv[2])`, FX, PDF]);
  const fails = []; const check = (c, m) => { if (!c) fails.push(m); console.log(`  ${c ? '✓' : '✗'} ${m}`); };
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1280, height: 900 }, deviceScaleFactor: 2 }); await offline(ctx);
  let inFlight = 0; let peak = 0; const models = new Set(); let maxBytes = 0;
  await ctx.route(/^https:\/\/generativelanguage\.googleapis\.com\//, async (r) => {
    inFlight++; peak = Math.max(peak, inFlight); models.add((r.request().url().match(/models\/([^:]+):/) || [])[1]);
    const body = r.request().postData() || ''; maxBytes = Math.max(maxBytes, body.length);
    const n = +(body.match(/第 (\d+) 頁/) || [])[1];
    await new Promise((x) => setTimeout(x, DELAY)); inFlight--;
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: `臺灣臺北地方法院民事判決（虛構）第${n}頁　原告甲○○　被告乙○○` }] }, finishReason: 'STOP' }] }) });
  });
  await ctx.addInitScript(() => { try { localStorage.setItem('lf_admin_gemini_key', 'fake-key-for-test-only'); localStorage.setItem('lf_admin_gemini_model', 'gemini-2.5-flash'); } catch (e) { /* ignore */ } });
  const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto('http://localhost:8765/index.html?demo=ding#page-ai-brief', { waitUntil: 'load' }); await p.waitForTimeout(800);
  const t0 = Date.now();
  await p.setInputFiles('#aib-pdf', { name: '掃描判決_12頁（虛構）.pdf', mimeType: 'application/pdf', buffer: fs.readFileSync(PDF) });
  const seen = []; let shot = false;
  for (let i = 0; i < 200; i++) {
    const s = await p.evaluate(() => { const bar = document.querySelector('.lf-ocr-progress'); return bar ? { pct: +bar.getAttribute('aria-valuenow'), label: bar.querySelector('.l').textContent } : null; });
    if (s && (!seen.length || seen[seen.length - 1].pct !== s.pct)) seen.push(s);
    if (s && !shot && s.pct >= 40) { await p.locator('.lf-ocr-progress').scrollIntoViewIfNeeded(); await p.screenshot({ path: path.join(SHOTS, '04_掃描檔12頁_進度條.png') }); shot = true; }
    if (!s && seen.length && seen[seen.length - 1].pct > 80) break;
    await p.waitForTimeout(150);
  }
  const ms = Date.now() - t0;
  console.log('進度：' + seen.map((x) => x.pct + '%').join(' → '));
  console.log(`花了 ${(ms / 1000).toFixed(1)} 秒（一頁一頁送約需 ${(12 * DELAY / 1000).toFixed(1)} 秒以上）；同時最多 ${peak} 頁；模型 ${[...models].join(',')}；最大一次送出 ${(maxBytes / 1024).toFixed(0)} KB`);
  check(seen.length >= 8, '進度條一路前進（至少 8 個不同的進度）');
  check(seen.every((x, i) => !i || x.pct >= seen[i - 1].pct), '進度只往前、不倒退');
  check(seen.some((x) => x.pct >= 75), '有走到 75% 以上，不會卡在一半');
  check(peak >= 2 && peak <= 3, '同時送 2–3 頁');
  check(models.size === 1 && models.has('gemini-2.5-flash-lite'), '辨識用 flash-lite');
  check(ms < 12 * DELAY, '比一頁一頁送快');
  check(maxBytes < 1.5 * 1024 * 1024, '每頁圖片不會過大（< 1.5 MB）');
  check(!errs.length, '頁面沒有錯誤 ' + errs.join(' | '));
  await b.close();
  console.log(fails.length ? '失敗：\n' + fails.join('\n') : '全部通過');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
