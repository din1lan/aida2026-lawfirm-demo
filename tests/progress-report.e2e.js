// 執行：先在專案根目錄 python3 -m http.server 8765，再 node tests/progress-report.e2e.js
// 用 Playwright（環境已預裝）在 3 件示範案件上產生草稿並截圖到 docs/screenshots/
'use strict';
const { chromium } = require('playwright');
const path = require('path');
const BASE = process.env.BASE || 'http://localhost:8765/index.html';
const OUT = path.join(__dirname, '..', 'docs', 'screenshots');

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 1000 }, deviceScaleFactor: 2 });
  const page = await ctx.newPage();
  // 示範資料的開庭/期限在 2026 年 7–8 月，把瀏覽器時間固定在 2026-07-20，才看得到「下次開庭」「近期期限」
  await page.clock.setFixedTime(new Date('2026-07-20T10:00:00+08:00'));
  const errors = [];
  const envErrors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(BASE + '?demo=ding#page-cases', { waitUntil: 'load' });
  await page.waitForTimeout(800);

  const results = [];
  async function openDraft(caseId) {
    await page.evaluate(() => { const m = document.getElementById('pr-modal'); if (m) m.remove(); });
    await page.evaluate(() => { location.hash = '#page-cases'; });
    // 2026-11-05：案件列表改成可收合卡片，先展開
    await page.evaluate(() => { const d = document.querySelector('details[data-fold="cases-list"]'); if (d) d.open = true; });
    await page.locator(`.btn-case-detail[data-case-id="${caseId}"]`).first().click();
    await page.locator('#cdm-progress-report').click();
    await page.locator('#pr-modal').waitFor();
  }
  async function closeAll() {
    await page.locator('#pr-close').click();
    await page.locator('#cdm-close').click();
  }

  for (const [id, fill] of [['c1', true], ['c2', false], ['c3', false]]) {
    await openDraft(id);
    if (fill) {
      await page.fill('#pr-last', '法官請雙方在下次開庭前補提損害金額的計算資料。');
      await page.dispatchEvent('#pr-last', 'change');
      await page.fill('#pr-todo', '醫療收據正本\n請假證明（公司開立）');
      await page.dispatchEvent('#pr-todo', 'change');
    }
    const text = await page.inputValue('#pr-draft');
    results.push({ id, text });
    await page.locator('#pr-modal > div').screenshot({ path: path.join(OUT, `progress-report-${id}.png`) });
    await closeAll();
  }

  // 律師手動修改 → 出現提醒；按複製
  await openDraft('c3');
  await page.fill('#pr-draft', (await page.inputValue('#pr-draft')) + '\n（本案保證勝訴）');
  await page.dispatchEvent('#pr-draft', 'input');
  const warnVisible = await page.isVisible('#pr-warn');
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write']);
  await page.click('#pr-copy');
  await page.waitForTimeout(300);
  const status = await page.textContent('#pr-status');
  const clip = await page.evaluate(() => navigator.clipboard.readText().catch(() => ''));
  await page.locator('#pr-modal > div').screenshot({ path: path.join(OUT, 'progress-report-warning.png') });
  await closeAll();

  // 重新整理後，c1 填的兩個欄位還在（存在瀏覽器）
  await page.reload({ waitUntil: 'load' });
  await page.waitForTimeout(800);
  await openDraft('c1');
  const kept = await page.inputValue('#pr-last');
  const aiBtn = await page.locator('#pr-polish').count();

  console.log(JSON.stringify({ results, warnVisible, status, clipHasWarnText: clip.includes('保證勝訴'), notesKeptAfterReload: kept.length > 0, aiButtonShown: aiBtn > 0, pageErrors: errors, envErrors }, null, 2));
  await browser.close();
  const ok = results.every((r) => r.text.includes('如有疑問，歡迎與我們聯絡')) && warnVisible && kept && !aiBtn && !errors.length;
  process.exit(ok ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(1); });
