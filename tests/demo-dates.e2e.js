// 示範資料日期平移檢查（2026-11-05 體檢）：node tests/demo-dates.e2e.js
// 先在專案根目錄 python3 -m http.server 8765。斷網模式。
// 示範資料會跟著「今天」平移；不管哪一天打開：
//   ① 期限末日（一般期限、末日）一定是工作日（週末、國定假日要順延到次一工作日）
//   ② 開庭日一定是平日
//   ③ 提前提醒＝末日往前推分級表的天數
'use strict';
const { chromium } = require('playwright');
const { offline } = require('./offline');
const DAYS = ['2026-11-05', '2026-11-06', '2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-12-24', '2027-01-27', '2027-02-03', '2027-09-30'];
const wd = (iso) => new Date(iso + 'T00:00:00').getDay();
(async () => {
  const b = await chromium.launch(); const fails = [];
  for (const day of DAYS) {
    const ctx = await b.newContext(); await offline(ctx);
    const p = await ctx.newPage(); const errs = []; p.on('pageerror', (e) => errs.push(String(e)));
    await p.clock.setFixedTime(new Date(day + 'T10:00:00+08:00'));
    await p.goto('http://localhost:8765/index.html?demo=ding#page-cases', { waitUntil: 'load' });
    await p.waitForTimeout(900);
    const data = await p.evaluate(() => ({
      dl: JSON.parse(localStorage.getItem('lf_deadlines') || '[]'),
      hr: JSON.parse(localStorage.getItem('lf_hearings') || '[]'),
    }));
    // 用 index.html 同一份假日表判斷工作日（頁面裡的函式包在 closure 裡讀不到）
    const holidays = await p.evaluate(async () => { const html = await (await fetch('index.html')).text(); const m = html.match(/const HOLIDAYS = \[([\s\S]*?)\];/); return m ? m[1].match(/\d{4}-\d{2}-\d{2}/g) : []; });
    const isBiz = (iso) => wd(iso) !== 0 && wd(iso) !== 6 && !holidays.includes(iso);
    const mains = data.dl.filter((d) => d.kind === 'main' || d.kind === 'general');
    if (!mains.length) fails.push(`${day}：讀不到示範期限`);
    mains.forEach((d) => { if (!isBiz(d.computedDeadline)) fails.push(`${day}：期限「${d.displayTitle}」末日 ${d.computedDeadline} 不是工作日`); });
    data.dl.filter((d) => d.kind === 'reminder').forEach((r) => {
      const m = data.dl.find((x) => x.id === r.linkedDeadlineId); if (!m) return;
      const back = Math.round((new Date(m.computedDeadline) - new Date(r.computedDeadline)) / 86400000);
      if (back !== r.advanceDays) fails.push(`${day}：提前提醒 ${r.computedDeadline} 跟末日 ${m.computedDeadline} 差 ${back} 天，應為 ${r.advanceDays} 天`);
    });
    data.hr.forEach((h) => { if (wd(h.date) === 0 || wd(h.date) === 6) fails.push(`${day}：開庭 ${h.date} 是週末`); });
    if (errs.length) fails.push(`${day}：頁面錯誤 ${errs.join(' | ')}`);
    console.log(`${day}：期限 ${mains.map((d) => d.computedDeadline).join('、')}｜提醒 ${data.dl.filter((d) => d.kind === 'reminder').map((d) => d.computedDeadline).join('、')}｜開庭 ${data.hr.map((h) => h.date).join('、')}`);
    await ctx.close();
  }
  await b.close();
  console.log(fails.length ? '失敗：\n' + fails.join('\n') : '全部通過');
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
