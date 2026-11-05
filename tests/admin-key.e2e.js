// 管理員設定與「主畫面沒有金鑰框」（2026-11-05）：node tests/admin-key.e2e.js
// 先在專案根目錄 python3 -m http.server 8765。斷網模式；用假金鑰，不連 Google。
'use strict';
const { chromium } = require('playwright');
const { offline } = require('./offline');
const FAKE = 'TEST-FAKE-KEY-0000';
(async () => {
  const b = await chromium.launch(); const fails = [];
  const ok = (c, m) => { console.log(`  ${c ? '✓' : '✗'} ${m}`); if (!c) fails.push(m); };
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); await offline(ctx);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(String(e))); p.on('dialog', (d) => d.accept());
  await p.goto('http://localhost:8765/index.html?demo=ding#page-ai-brief'); await p.waitForTimeout(800);
  const aib = () => p.evaluate(() => ({ st: document.getElementById('aib-engine-status').textContent, eng: document.getElementById('aib-engine').value }));
  const html = await p.content();
  ok(!/id="aib-gemini-key"|id="aib-gemini-model"|aib-gemini-load|貼上你自己的金鑰/.test(html), '主畫面沒有貼金鑰的框、模型選單、載入模型按鈕');
  ok(!/navitem[^>]*page-admin/.test(html), '管理員設定不在主選單');
  let a = await aib(); ok(a.eng === 'local' && /尚未設定 AI，目前為示意版/.test(a.st), '沒有金鑰：AI 智慧閱卷顯示「尚未設定 AI，目前為示意版」');
  await p.click('button.navitem[data-page="page-autofill"]'); await p.waitForTimeout(300);
  ok(/尚未設定 AI，目前為示意版/.test(await p.textContent('#af-engine-status')), '沒有金鑰：AI 自動填顯示「尚未設定 AI，目前為示意版」');
  ok(await p.evaluate(() => document.querySelector('.lf-gemini-ocr-wrap').classList.contains('hidden')), '沒有金鑰：不顯示「掃描頁用 Gemini 辨識」');
  await p.goto('http://localhost:8765/index.html?demo=ding#admin'); await p.waitForTimeout(800);
  ok(await p.evaluate(() => !document.getElementById('page-admin').classList.contains('hidden')), '網址加 #admin 進到管理員設定');
  await p.fill('#adm-key', FAKE); await p.click('#adm-save'); await p.waitForTimeout(300);
  ok(await p.evaluate((k) => localStorage.getItem('lf_admin_gemini_key') === k, FAKE), '儲存：金鑰存在這台電腦的 localStorage');
  ok(/••••••0000/.test(await p.textContent('#adm-ai-status')) && !(await p.textContent('#adm-ai-status')).includes(FAKE), '畫面只顯示末 4 碼');
  await p.click('button.navitem[data-page="page-ai-brief"]'); await p.waitForTimeout(300);
  a = await aib(); ok(a.eng === 'gemini' && /Google Gemini/.test(a.st), '有金鑰：AI 智慧閱卷預設用 Gemini');
  await p.click('button.navitem[data-page="page-autofill"]'); await p.waitForTimeout(300);
  ok(/Google Gemini/.test(await p.textContent('#af-engine-status')), '有金鑰：AI 自動填預設用 Gemini');
  // 一鍵備份檔不含金鑰
  const [dl] = await Promise.all([p.waitForEvent('download', { timeout: 5000 }).catch(() => null), p.evaluate(() => { const b = document.getElementById('btn-backup-export'); if (b) b.click(); })]);
  if (dl) { const txt = require('fs').readFileSync(await dl.path(), 'utf8'); ok(!txt.includes(FAKE) && !/lf_admin_gemini/.test(txt), '一鍵備份檔裡沒有金鑰'); }
  else console.log('  （這個身分看不到備份按鈕，略過備份檢查）');
  // 有金鑰時，一鍵示範仍用示意版跑
  await p.goto('http://localhost:8765/index.html?demo=ding&autorun=pdf-view');
  const shown = await p.waitForFunction(() => { const v = document.getElementById('aib-viewer'); return v && !v.classList.contains('hidden'); }, null, { timeout: 30000 }).then(() => true).catch(() => false);
  ok(shown, '有金鑰時一鍵示範照樣用示意版跑完');
  await p.goto('http://localhost:8765/index.html?demo=ding#admin'); await p.waitForTimeout(800);
  await p.click('#adm-clear'); await p.waitForTimeout(200); await p.click('[data-act=ok]'); await p.waitForTimeout(300);
  ok(await p.evaluate(() => localStorage.getItem('lf_admin_gemini_key') === null), '清除：localStorage 裡的金鑰刪掉了');
  await p.click('button.navitem[data-page="page-ai-brief"]'); await p.waitForTimeout(300);
  a = await aib(); ok(a.eng === 'local' && /尚未設定 AI/.test(a.st), '清除後自動回到示意版');
  // 非主持律師不能改
  await p.goto('http://localhost:8765/index.html?demo=assistant#admin'); await p.waitForTimeout(800);
  ok(await p.evaluate(() => document.getElementById('adm-save').disabled && !document.getElementById('adm-role-note').classList.contains('hidden')), '非主持律師：只能看，不能改');
  // 沒有金鑰：一鍵示範
  const p2 = await ctx.newPage(); await p2.goto('http://localhost:8765/index.html?demo=ding&autorun=pdf-view');
  ok(await p2.waitForFunction(() => { const v = document.getElementById('aib-viewer'); return v && !v.classList.contains('hidden'); }, null, { timeout: 30000 }).then(() => true).catch(() => false), '沒有金鑰時一鍵示範用示意版跑完');
  ok(!errs.length, '沒有頁面錯誤' + (errs.length ? '：' + errs[0] : ''));
  await b.close();
  console.log(fails.length ? '失敗：\n' + fails.join('\n') : '全部通過');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
