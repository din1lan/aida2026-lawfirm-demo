// 收文登記確認畫面（原圖為主）瀏覽器實測：先在專案根目錄 python3 -m http.server 8765，再 node tests/intake-viewer.e2e.js
// 用虛構掃描檔（兩頁：開庭通知＋郵局繳款單）與有文字層的 PDF 各跑一次，斷網、示意版（本機辨識）、不用金鑰。
// 截圖到 docs/screenshots/intake/：一般確認畫面、放大檢視各一張
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const { offline, unexpected } = require('./offline');
const FX = path.join(__dirname, 'fixtures', 'intake');
const SHOTS = path.join(__dirname, '..', 'docs', 'screenshots', 'intake');
const BASE = process.env.BASE || 'http://localhost:8765/index.html';
const asFile = (f) => ({ name: path.basename(f), mimeType: 'application/pdf', buffer: fs.readFileSync(f) });

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const fails = []; const check = (c, m) => { if (!c) fails.push(m); console.log(`  ${c ? '✓' : '✗'} ${m}`); };
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 1700 }, timezoneId: 'Asia/Taipei', deviceScaleFactor: 2 });
  const blocked = await offline(ctx);
  const p = await ctx.newPage(); const errs = [];
  p.on('pageerror', (e) => errs.push(String(e)));
  await p.goto(BASE + '?demo=ding#page-autofill', { waitUntil: 'load' });
  await p.waitForFunction(() => !!document.getElementById('in-panel'), null, { timeout: 15000 });
  await p.evaluate(() => window.LF_AutofillHost.showPage('page-autofill'));

  async function load(file) {
    await p.setInputFiles('#in-file', asFile(path.join(FX, file)));
    await p.waitForFunction(() => /已讀入|讀取失敗/.test(document.getElementById('in-status').textContent), null, { timeout: 180000 });
    await p.click('#in-run');
    await p.waitForFunction(() => /請逐欄確認|⚠/.test(document.getElementById('in-status').textContent), null, { timeout: 180000 });
    await p.locator('#in-viewer img').first().waitFor();
  }
  const geo = () => p.evaluate(() => {
    const r = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return { w: b.width, h: b.height }; };
    const q = document.querySelector('#in-rows .dv-quote');
    return { card: r('#in-review-card'), left: r('#in-split .dv-left'), right: r('#in-viewer'), pages: document.querySelectorAll('#in-viewer [data-dv-page]').length,
      quoteH: q ? q.getBoundingClientRect().height : 0, quoteLine: q ? parseFloat(getComputedStyle(q).lineHeight) || 16 : 0, oldTable: !!document.getElementById('in-table') };
  });
  // 點某一欄 → 原圖跳到第幾頁、有沒有黃框
  async function clickField(k) {
    await p.click(`#in-rows [data-in-row="${k}"] .dv-l`);
    await p.waitForTimeout(150);
    return p.evaluate(() => {
      const m = document.querySelector('#in-viewer .dv-mark'); const sc = document.querySelector('#in-viewer [data-dv-scroll]');
      let page = 0; let visible = false;
      if (m) { page = Number(m.closest('[data-dv-page]').dataset.dvPage); const a = m.getBoundingClientRect(), s = sc.getBoundingClientRect(); visible = a.top >= s.top - 1 && a.bottom <= s.bottom + 1; }
      return { marks: document.querySelectorAll('#in-viewer .dv-mark').length, page, visible, pos: document.querySelector('#in-viewer [data-dv-pos]').textContent, hint: document.querySelector('#in-viewer [data-dv-hint]').textContent };
    });
  }

  // ---------------------------------------------------------------- 1) 兩頁掃描檔
  console.log('\n■ 兩頁虛構掃描檔（本機辨識）');
  await load('S37_兩頁掃描_開庭通知加繳款單.pdf');
  let g = await geo();
  check(g.pages === 2, `右邊原圖兩頁都有（${g.pages}）`);
  check(!g.oldTable, '舊的三欄表格（含「原文出處那一句」大欄）已拿掉');
  check(g.right && g.left && g.right.w > g.left.w * 1.5 && g.right.w > g.card.w * 0.55, `左窄右寬：欄位 ${Math.round(g.left.w)}px、原圖 ${Math.round(g.right.w)}px（卡片 ${Math.round(g.card.w)}px）`);
  check(g.quoteH > 0 && g.quoteH <= g.quoteLine * 1.6, `原文出處縮成一行小字（高 ${Math.round(g.quoteH)}px）`);
  const rows = await p.$$eval('#in-rows [data-in-row]', (rs) => rs.map((r) => ({ k: r.dataset.inRow, quote: !!r.querySelector('.dv-quote') })));
  const withQuote = rows.filter((r) => r.quote).map((r) => r.k);
  console.log('    有出處的欄位：' + withQuote.join('、'));
  const hits = {};
  for (const k of withQuote) hits[k] = await clickField(k);
  Object.entries(hits).forEach(([k, h]) => console.log(`    ${k}：第 ${h.page || '—'} 頁、黃框 ${h.marks}、${h.visible ? '在可視範圍' : '—'} ${h.hint}`));
  const boxed = Object.values(hits).filter((h) => h.marks > 0);
  check(boxed.length >= 2, `點欄位會在原圖畫黃框（${boxed.length}／${withQuote.length} 欄）`);
  check(boxed.every((h) => h.visible), '黃框都自動捲到看得見的地方');
  const pagesHit = new Set(boxed.map((h) => h.page));
  check(pagesHit.has(1) && pagesHit.has(2), `點不同欄位會跳到不同頁（第 ${[...pagesHit].join('、')} 頁）`);
  check(await p.$eval('#in-rows .dv-active', (e) => !!e), '目前點選的欄位有標示');
  // 一般確認畫面截圖：選一個第 1 頁有黃框的欄位
  const first = Object.entries(hits).find(([, h]) => h.page === 1 && h.marks);
  if (first) await clickField(first[0]);
  await p.locator('#in-review-card').screenshot({ path: path.join(SHOTS, '19_確認畫面_原圖為主_掃描兩頁.png') });

  // 放大檢視
  await p.click('#in-viewer [data-dv-page="1"] img');
  await p.locator('#dv-lightbox').waitFor();
  const lb = () => p.evaluate(() => { const t = document.querySelector('#dv-lightbox [data-lb="inner"]').style.transform; const m = t.match(/translate\(([-\d.]+)px, ?([-\d.]+)px\) scale\(([\d.]+)\)/); return { pos: document.querySelector('#dv-lightbox [data-lb="pos"]').textContent, x: +m[1], y: +m[2], z: +m[3], marks: document.querySelectorAll('#dv-lightbox .dv-mark').length }; });
  let s0 = await lb();
  check(/第 1／2 頁/.test(s0.pos), `點原圖開啟全螢幕放大（${s0.pos}）`);
  check(s0.marks >= 1, '放大檢視也有黃框');
  await p.screenshot({ path: path.join(SHOTS, '20_原圖放大檢視.png') });
  await p.click('#dv-lightbox [data-lb="fit"]'); const sf = await lb();
  await p.click('#dv-lightbox [data-lb="in"]'); const s1 = await lb();
  check(s1.z > sf.z * 1.2, `按＋放大（${Math.round(sf.z * 100)}% → ${Math.round(s1.z * 100)}%）`);
  await p.mouse.move(700, 500); await p.mouse.wheel(0, -300); await p.waitForTimeout(100); const s2 = await lb();
  check(s2.z > s1.z, '滾輪可以縮放');
  await p.mouse.move(700, 500); await p.mouse.down(); await p.mouse.move(560, 380, { steps: 5 }); await p.mouse.up(); const s3 = await lb();
  check(Math.abs(s3.x - s2.x + 140) < 2 && Math.abs(s3.y - s2.y + 120) < 2, '可以拖曳移動');
  await p.keyboard.press('ArrowRight'); const s4 = await lb();
  check(/第 2／2 頁/.test(s4.pos), '按 → 翻到第 2 頁');
  await p.click('#dv-lightbox [data-lb="prev"]'); const s5 = await lb();
  check(/第 1／2 頁/.test(s5.pos), '按「上一頁」回第 1 頁');
  await p.keyboard.press('Escape');
  check(!(await p.$('#dv-lightbox')), '按 Esc 關閉');
  check(await p.evaluate(() => !!document.getElementById('in-review-card')), '關閉後確認畫面還在（Esc 沒有誤關其他東西）');

  // ---------------------------------------------------------------- 2) 有文字層的 PDF：同樣版面
  console.log('\n■ 有文字層的 PDF（03_開庭通知書.pdf）');
  await load('03_開庭通知書.pdf');
  g = await geo();
  check(g.pages >= 1 && g.right && g.right.w > g.left.w * 1.5, `文字層 PDF 也是左窄右寬、右邊是原圖（${g.pages} 頁）`);
  const h1 = await clickField('hearingDate');
  check(h1.marks >= 1 && h1.visible, `點「開庭日期」→ 原圖畫黃框（${h1.marks} 個）`);
  await p.locator('#in-review-card').screenshot({ path: path.join(SHOTS, '21_確認畫面_原圖為主_文字層PDF.png') });
  // 確認登記照常可用
  await p.check('input[data-in-att][value="王大明律師"]').catch(() => {});
  check(!(await p.$eval('#in-confirm', (e) => e.disabled)), '仍可按「確認登記」');

  const ext = unexpected(blocked);
  check(!errs.length, '沒有網頁錯誤' + (errs.length ? '：' + errs.join(' | ') : ''));
  check(!ext.length, '斷網照樣能用（沒有連外）' + (ext.length ? '：' + ext.join(' ') : ''));
  await b.close();
  console.log(fails.length ? `\n結果：${fails.length} 項失敗` : '\n結果：全部通過');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
