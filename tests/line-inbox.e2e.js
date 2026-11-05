// LINE 預約收件匣瀏覽器實測：先在專案根目錄 python3 -m http.server 8765，再 node tests/line-inbox.e2e.js
// 用假的 Make 回應（不連網、不用任何網址或金鑰）：新格式（有全名）＋舊格式（只有暱稱），
// 檢查卡片顯示全名、LINE 暱稱小字、自動利衝比對三種結果、沒有對造輸入框。截圖到 docs/screenshots/
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const { offline, unexpected } = require('./offline');
const BASE = process.env.BASE || 'http://localhost:8765/index.html';
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');
const FAKE = 'https://hook.us1.make.com/fake-line-inbox-test';
const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const row = (n, cols) => [n, ...cols.map(b64)].join('\t');
const BODY = ['LINEINBOX1',
  row(101, ['2026-11-05 09:12', '大華哥', '【債務糾紛】朋友告我還錢，我覺得是合夥', '0900000301', '2026-11-07 10:00', '待審核', '李大華']),
  row(102, ['2026-11-05 09:30', 'Lin', '【車禍】想再委任處理另一件車禍', '0900000302', '2026-11-07 14:00', '待審核', '林小華']),
  row(103, ['2026-11-05 10:05', '雯雯', '【租賃糾紛】押金沒退', '0900000303', '', '待審核', '王曉雯']),
  row(104, ['2026-11-05 10:40', '阿傑🐳', '【勞資爭議】加班費', '0900000304', '', '待審核']), // 舊格式 6 欄
].join('\n');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
  const blocked = await offline(ctx);
  let fetched = 0;
  await ctx.route(FAKE, (r) => { fetched++; r.fulfill({ status: 200, contentType: 'text/plain; charset=utf-8', body: BODY, headers: { 'access-control-allow-origin': '*' } }); });
  await ctx.addInitScript((u) => { try { localStorage.setItem('lf_lineInboxUrl', u); } catch (e) { /* ignore */ } }, FAKE);
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?demo=ding', { waitUntil: 'load' });
  await page.waitForTimeout(800);
  await page.locator('[data-page="page-line-inbox"]').first().click();
  await page.waitForFunction(() => /收到 \d+ 筆新預約/.test((document.getElementById('line-inbox-fetch-msg') || {}).textContent || ''), null, { timeout: 10000 });

  const cards = await page.$$eval('#line-inbox-list .line-card', (els) => els.map((el) => ({
    name: (el.querySelector('.line-name') || {}).textContent,
    nick: (el.querySelector('.line-nick') || {}).textContent || '',
    noFull: el.textContent.includes('未提供全名'),
    level: (el.querySelector('.line-conflict') || { dataset: {} }).dataset.level,
    text: (el.querySelector('.line-conflict') || {}).textContent || '',
    sameNameNote: el.textContent.includes('同名僅供參考，請律師確認'),
  })));
  const by = (n) => cards.find((c) => c.name === n) || {};
  const checks = {
    '李大華：全名當標題、LINE 暱稱小字、🔴 曾為本所案件對造': by('李大華').nick === 'LINE：大華哥' && by('李大華').level === 'opponent' && by('李大華').text.includes('曾為本所案件對造') && by('李大華').sameNameNote,
    '林小華：🟡 曾為本所客戶／當事人': by('林小華').level === 'client' && by('林小華').text.includes('曾為本所客戶／當事人'),
    '王曉雯：✅ 利衝表無紀錄': by('王曉雯').level === 'clear' && by('王曉雯').text.includes('利衝表無紀錄'),
    '舊格式只有暱稱：顯示暱稱＋未提供全名＋無法比對': by('阿傑🐳').noFull && by('阿傑🐳').level === 'noname' && by('阿傑🐳').text.includes('無全名，無法比對'),
    '示範資料也自動比對（李大華 seed 🔴、黃志豪 🟡、鄭家瑜 ✅）': cards.filter((c) => c.name === '李大華').length === 2 && by('黃志豪').level === 'client' && by('鄭家瑜').level === 'clear',
    '對造輸入框與「利益衝突比對」按鈕已拿掉': await page.evaluate(() => !document.querySelector('[data-lb-opp]') && ![...document.querySelectorAll('#line-inbox-list button')].some((b) => b.textContent.includes('利益衝突比對'))),
  };
  // 展開命中明細
  const daHua = page.locator('#line-inbox-list .line-card').filter({ hasText: 'LINE：大華哥' });
  await daHua.locator('details summary').click();
  checks['可展開命中明細（現有案件對造）'] = await daHua.locator('details').textContent().then((t) => t.includes('現有案件對造'));
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({ path: path.join(OUT, 'line-inbox-auto-conflict.png'), fullPage: true });

  // 審核通過 → 轉為接案，姓名帶入開案表單
  await page.locator('#line-inbox-list .line-card').filter({ hasText: '王曉雯' }).locator('[data-act="clear"]').click();
  await page.locator('#line-inbox-list .line-card').filter({ hasText: '王曉雯' }).locator('[data-act="convert"]').click();
  checks['審核通過後轉接案，全名帶入開案表單'] = await page.evaluate(() => (document.getElementById('form-case').elements.person || {}).value === '王曉雯');

  // 重新接收：不重複新增
  await page.locator('[data-page="page-line-inbox"]').first().click();
  await page.waitForTimeout(800);
  checks['重新接收不會重複新增'] = (await page.$$eval('#line-inbox-list .line-card', (els) => els.length)) === cards.length;

  const ext = unexpected(blocked);
  const ok = Object.values(checks).every(Boolean) && !errors.length && !ext.length && fetched > 0;
  Object.entries(checks).forEach(([k, v]) => console.log(`  ${v ? '✓' : '✗'} ${k}`));
  console.log(JSON.stringify({ fetched, cards: cards.length, pageErrors: errors, externalTried: ext }));
  console.log(ok ? '結果：全部通過' : '結果：有失敗');
  await browser.close();
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
