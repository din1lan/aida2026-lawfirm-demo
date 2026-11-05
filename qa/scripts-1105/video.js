// 1105 備案影片（約 60 秒，1440×900，斷網模式錄製）：node qa/scripts-1105/video.js
// 先在專案根目錄 python3 -m http.server 8765。輸出 qa/demo-backup-1105b.webm，再用 ffmpeg 轉 mp4
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path'); const os = require('os');
const { offline } = require('../../tests/offline');
const ROOT = path.join(__dirname, '..', '..');
(async () => {
  const VDIR = fs.mkdtempSync(path.join(os.tmpdir(), 'qa-video-'));
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1, recordVideo: { dir: VDIR, size: { width: 1440, height: 900 } } });
  await offline(ctx);
  const p = await ctx.newPage(); p.on('dialog', (d) => d.dismiss());
  const P = (ms = 1800) => p.waitForTimeout(ms); const log = []; const t0 = Date.now();
  const mark = (s) => log.push(((Date.now() - t0) / 1000).toFixed(1) + ' 秒　' + s);
  const smooth = async (sel, block = 'start') => { await p.evaluate(([s, bk]) => { const e = document.querySelector(s); if (e) e.scrollIntoView({ behavior: 'smooth', block: bk }); }, [sel, block]); await P(1600); };
  const scrollMain = async (dy) => { await p.evaluate((y) => document.querySelector('main').scrollBy({ top: y, behavior: 'smooth' }), dy); await P(1500); };
  await p.goto('http://localhost:8765/'); await P(2200); mark('登入畫面（斷網模式）');
  await p.selectOption('#login-role-select', 'ding').catch(() => {}); await P(900);
  await p.click('#form-login button'); await P(2000); mark('王大明登入 → 首頁總覽');
  await p.click('button[data-page="page-ai-brief"]'); await P(1800); mark('AI 智慧閱卷');
  await smooth('#aib-engine', 'center'); await p.selectOption('#aib-engine', 'local'); await P(1200); mark('切換示意版（免金鑰）');
  await p.click('#aib-load-case');
  for (let i = 0; i < 120; i++) {
    const done = await p.evaluate(() => /04_原告民事準備書狀/.test(document.querySelector('#page-ai-brief').innerText) && !/讀取中|下載示範/.test(document.getElementById('aib-pdf-status').textContent));
    if (done) break; await P(250);
  }
  await P(1200); mark('載入 4 份虛構示範文件');
  await smooth('#aib-analyze', 'center'); await p.click('#aib-analyze'); await P(2200); mark('開始分析');
  await smooth('#aib-trace', 'start'); await P(1200); mark('溯源結果：當事人、時間軸（照日期排序）');
  for (let k = 0; k < 3; k++) await scrollMain(380);
  mark('優勢／劣勢／風險（不再互相矛盾）');
  const clickBadge = async (re) => {
    for (const h of await p.$$('#aib-trace .aib-badge')) { const t = (await h.textContent()).trim(); if (re.test(t)) { await h.scrollIntoViewIfNeeded(); await P(900); await h.click(); return t; } }
    return null;
  };
  const t1 = await clickBadge(/^原文 文件3/); await P(3200); mark('點「' + t1 + '」→ 跳到言詞辯論筆錄原句（黃底）');
  await p.keyboard.press('Escape'); await P(1200); mark('按 Esc 關閉視窗');
  const t2 = await clickBadge(/^重點/); await P(3000); mark('點「' + t2 + '」→ 對照法條原文');
  await p.keyboard.press('Escape'); await P(1000);
  await p.click('button[data-page="page-autofill"]'); await P(1500); mark('AI 自動填');
  await p.click('text=範例：民事判決 PDF'); await P(2200);
  await p.click('button:has-text("讓 AI 讀")'); await P(2200);
  await p.evaluate(() => { const el = document.querySelector('[data-af-deadline]'); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); }); await P(4500);
  mark('期限：收文 10/19、上訴 20 日，第 20 日 11/8 是星期日 → 依法順延到 11/9；提前提醒 11/4');
  await p.click('button[data-page="page-cases"]'); await P(3000); mark('案件與時效：代辦總表');
  await p.evaluate(() => document.querySelector('main').scrollTo({ top: 0, behavior: 'smooth' })); await P(1500); mark('結束');
  const v = p.video(); await ctx.close(); const vp = await v.path();
  fs.copyFileSync(vp, path.join(ROOT, 'qa', 'demo-backup-1105b.webm'));
  fs.writeFileSync(path.join(ROOT, 'qa', 'demo-backup-1105b.txt'), '備案影片 qa/demo-backup-1105b.mp4 時間點（斷網模式錄製，Gemini 未使用）\n' + log.join('\n') + '\n');
  console.log(log.join('\n')); await b.close();
})();
