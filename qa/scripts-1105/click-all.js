// 1105 體檢：桌機 1440×900、斷網模式，逐頁點每一個看得到的按鈕，記錄頁面錯誤、console 錯誤、本機檔案載入失敗
// 用法：專案根目錄 python3 -m http.server 8765，再 node qa/scripts-1105/click-all.js
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const { offline, unexpected } = require('../../tests/offline');
const OUT = path.join(__dirname, '..', 'screenshots-1105');
const DANGER = /刪除|清空|重設|登出|還原備份|匯入|移除|作廢|結案|永久/;
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const b = await chromium.launch();
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, acceptDownloads: true });
  const blocked = await offline(ctx);
  const p = await ctx.newPage();
  const errs = [], cons = [], failed = [], dialogs = [];
  p.on('pageerror', (e) => errs.push(String(e).slice(0, 200)));
  p.on('console', (m) => { if (m.type() === 'error' && !/ERR_INTERNET_DISCONNECTED|fonts\.g/.test(m.text())) cons.push(m.text().slice(0, 200)); });
  p.on('requestfailed', (r) => { if (/localhost/.test(r.url())) failed.push(r.url()); });
  p.on('dialog', async (d) => { dialogs.push(d.type() + '：' + d.message().slice(0, 80)); try { if (d.type() === 'prompt') await d.dismiss(); else await d.dismiss(); } catch (e) { /* */ } });
  await p.goto('http://localhost:8765/index.html?demo=ding#page-dashboard', { waitUntil: 'load' });
  await p.waitForTimeout(1000);
  const pages = await p.evaluate(() => [...document.querySelectorAll('[data-page], .navitem')].map((a) => a.getAttribute('data-page') || (a.getAttribute('href') || '').replace('#', '')).filter(Boolean));
  const uniq = [...new Set(pages)];
  const rows = []; const stuck = new Set(); const escNotClose = new Set();
  for (const pg of uniq) {
    await p.click(`button.navitem[data-page="${pg}"]`).catch(() => {}); await p.waitForTimeout(500);
    const name = await p.evaluate((h) => { const a = document.querySelector(`[data-page="${h}"], a[href="#${h}"]`); return a ? a.textContent.trim().replace(/\s+/g, ' ') : h; }, pg);
    await p.screenshot({ path: path.join(OUT, `d-${pg}.png`) });
    const before = errs.length + cons.length;
    const n = await p.evaluate((h) => { const sec = document.getElementById(h) || document.querySelector(`.page:not(.hidden)`); return sec ? [...sec.querySelectorAll('button, [role=button], a[href^="#"]')].filter((x) => x.offsetParent).length : 0; }, pg);
    let clicked = 0, skipped = 0;
    for (let i = 0; i < n; i++) {
      if (await p.evaluate((h) => { const s = document.getElementById(h); return !s || s.classList.contains('hidden'); }, pg)) { await p.keyboard.press('Escape').catch(() => {}); await p.click(`button.navitem[data-page="${pg}"]`, { timeout: 1500 }).catch(() => {}); await p.waitForTimeout(200); }
      const info = await p.evaluate(([h, i]) => { const sec = document.getElementById(h) || document.querySelector('.page:not(.hidden)'); const el = sec ? [...sec.querySelectorAll('button, [role=button], a[href^="#"]')].filter((x) => x.offsetParent)[i] : null; if (!el) return null; el.setAttribute('data-qa-i', String(i)); return el.textContent.trim().replace(/\s+/g, ' ').slice(0, 40); }, [pg, i]);
      if (info === null) continue;
      if (DANGER.test(info)) { skipped++; continue; }
      try { await p.click(`#${pg} [data-qa-i="${i}"], .page:not(.hidden) [data-qa-i="${i}"]`, { timeout: 1500 }); clicked++; } catch (e) { skipped++; }
      await p.waitForTimeout(150);
      // 關掉跳出來的視窗
      await p.keyboard.press('Escape').catch(() => {}); await p.waitForTimeout(100);
      const escOpen = await p.evaluate(() => [...document.querySelectorAll('body *')].filter((m) => { const cs = getComputedStyle(m); return cs.position === 'fixed' && m.offsetParent !== undefined && m.getBoundingClientRect().width > 600 && m.getBoundingClientRect().height > 500 && cs.display !== 'none' && cs.visibility !== 'hidden' && !m.closest('#app-sidebar'); }).length);
      for (let k = 0; k < 4; k++) {
        const closed = await p.evaluate(() => {
          const ovs = [...document.querySelectorAll('body *')].filter((m) => { const cs = getComputedStyle(m); const r = m.getBoundingClientRect(); return cs.position === 'fixed' && r.width > 600 && r.height > 500 && cs.display !== 'none' && cs.visibility !== 'hidden' && !m.closest('#app-sidebar') && !m.classList.contains('hidden'); });
          if (!ovs.length) return false;
          const m = ovs[ovs.length - 1];
          const btn = [...m.querySelectorAll('button')].find((x) => x.offsetParent && /^(×|✕|✖|關閉|取消|稍後|返回|知道了|確定|好)$/.test(x.textContent.trim())) || [...m.querySelectorAll('button')].find((x) => x.offsetParent && /關閉|取消|×|✕/.test(x.textContent + (x.getAttribute('aria-label') || '')));
          if (btn) { btn.click(); return true; }
          m.classList.add('hidden'); return 'forced:' + (m.id || m.className.slice(0, 40));
        });
        if (!closed) break;
        if (typeof closed === 'string') stuck.add(`${pg}「${info}」${closed}`);
        await p.waitForTimeout(120);
      }
      if (escOpen) escNotClose.add(`${pg}「${info}」`);
    }
    rows.push({ page: pg, name, buttons: n, clicked, skipped, newErrors: errs.length + cons.length - before });
  }
  const res = { rows, pageErrors: errs, consoleErrors: [...new Set(cons)], localFailed: [...new Set(failed)], externalTried: unexpected(blocked), dialogs: [...new Set(dialogs)], modalNoCloseButton: [...stuck], escDoesNotClose: [...escNotClose] };
  fs.writeFileSync(path.join(__dirname, '..', 'click-all-1105.json'), JSON.stringify(res, null, 1));
  console.log(JSON.stringify(res, null, 1));
  await b.close();
})();
