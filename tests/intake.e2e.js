// 收文登記：瀏覽器實測（每種類別跑一次、掃描檔、照片、Gemini 假回應），截圖到 docs/screenshots/intake/
//   先在專案根目錄 python3 -m http.server 8765，再 node tests/intake.e2e.js
//   沙箱擋外部 CDN 時：CDN_DIR＝本機同版本套件（同 tests/gemini-ocr.e2e.js）；TW_CSS＝先編好的 Tailwind 樣式（只為了截圖好看）
//   不用真金鑰：Gemini 的網址被攔下來，回固定的假答案
'use strict';
const { chromium } = require('playwright');
const fs = require('fs'); const path = require('path');
const FX = path.join(__dirname, 'fixtures', 'intake');
const SHOTS = path.join(__dirname, '..', 'docs', 'screenshots', 'intake');
const asFile = (f) => ({ name: path.basename(f), mimeType: /\.png$/.test(f) ? 'image/png' : 'application/pdf', buffer: fs.readFileSync(f) });
const BASE = process.env.BASE || 'http://localhost:8765/index.html';

async function route(ctx, gem) {
  const dir = process.env.CDN_DIR; const tw = process.env.TW_CSS;
  await ctx.route(/^https:\/\/cdn\.tailwindcss\.com/, (r) => (tw
    ? r.fulfill({ contentType: 'application/javascript', body: `(function(){var s=document.createElement('style');s.textContent=${JSON.stringify(fs.readFileSync(tw, 'utf8'))};document.head.appendChild(s);window.tailwind={};})();` })
    : r.abort()));
  await ctx.route(/^https:\/\/fonts\.(googleapis|gstatic)\.com/, (r) => r.abort());
  await ctx.route(/^https:\/\/generativelanguage\.googleapis\.com\//, gem || ((r) => r.abort()));
  await ctx.route(/^https:\/\/(cdnjs\.cloudflare\.com|cdn\.jsdelivr\.net)\//, (r) => {
    const u = r.request().url(); const H = { 'Access-Control-Allow-Origin': '*' };
    if (!dir) return r.continue();
    const file = (p, type) => r.fulfill({ path: path.join(dir, p), contentType: type || 'application/octet-stream', headers: H });
    let m = u.match(/pdf\.js\/3\.11\.174\/(pdf\.min\.js|pdf\.worker\.min\.js)$/);
    if (m) return file('pdfjs-dist-3.11.174/package/build/' + m[1], 'application/javascript');
    m = u.match(/pdf\.js\/3\.11\.174\/(cmaps|standard_fonts)\/(.+)$/);
    if (m) return file(`pdfjs-dist-3.11.174/package/${m[1]}/${decodeURIComponent(m[2])}`);
    if (/xlsx\/0\.18\.5\/xlsx\.full\.min\.js$/.test(u)) return file('xlsx-0.18.5/package/dist/xlsx.full.min.js', 'application/javascript');
    m = u.match(/npm\/tesseract\.js@5\.1\.1\/dist\/(.+)$/);
    if (m) return file('tesseract.js-5.1.1/package/dist/' + m[1], 'application/javascript');
    m = u.match(/npm\/tesseract\.js-core@5\.1\.1\/(.+)$/);
    if (m) return file('tesseract.js-core-5.1.1/package/' + m[1], m[1].endsWith('.wasm') ? 'application/wasm' : 'application/javascript');
    m = u.match(/npm\/@tesseract\.js-data\/(chi_tra)@1\.0\.0\/(.+)$/);
    if (m) return file(`tesseract.js-data-${m[1]}-1.0.0/package/${m[2]}`);
    return r.abort();
  });
}

// 每種類別一份：檔名、應判類別、要掛的案件（案件 id，或 __new__＋新案名）、要驗的事
const CASES = [
  { f: '01_判決.pdf', cat: 'judgment', caseId: 'c1', expect: { deadline: true } },
  { f: '02_裁定.pdf', cat: 'ruling', caseId: 'c3', expect: { deadline: true } },
  { f: '03_開庭通知書.pdf', cat: 'hearing', caseId: 'c1', expect: { hearing: '2026-11-26' } },
  { f: '04_調解通知書.pdf', cat: 'hearing', caseId: 'c2', expect: { hearing: '2026-12-03' } },
  { f: '05_補繳裁判費裁定.pdf', cat: 'court_fee', newCase: '王虛構 給付貨款', expect: { deadline: true, task: true, amount: '12300' } },
  { f: '06_法院繳費通知.pdf', cat: 'court_fee', caseId: 'c2', expect: { deadlineDate: '2026-11-18', task: true, amount: '3000' } },
  { f: '07_郵局繳款通知單.pdf', cat: 'agency_payment', newCase: '虛構繼承人 遺產分割', expect: { deadlineDate: '2026-11-20', task: true, amount: '100', caseKey: '115重家繼訴8' }, openCase: true },
  { f: '08_法院函.pdf', cat: 'letter', caseId: 'c1', expect: { deadline: true, task: true } },
  { f: '09_對造答辯狀繕本.pdf', cat: 'opp_brief', caseId: 'c3', expect: {} },
  { f: '10_言詞辯論筆錄.pdf', cat: 'transcript', caseId: 'c1', expect: {} },
  { f: '11_送達證書.pdf', cat: 'service_cert', caseId: 'c3', expect: { received: '2026-11-02' } },
  { f: '12_其他.pdf', cat: 'other', pickCase: 'c1', manualDate: '2026-11-30', expect: { deadlineDate: '2026-11-30', task: true } },
  { f: 'S07_郵局繳款通知單_掃描.pdf', cat: 'agency_payment', newCase: '掃描版測試', expect: { deadlineDate: '2026-11-20', task: true }, scan: true },
  { f: 'S05_補繳裁判費裁定_掃描.pdf', cat: 'court_fee', newCase: '掃描版補費', expect: { deadline: true, task: true }, scan: true },
  { f: 'S03_開庭通知書_掃描.pdf', cat: 'hearing', caseId: 'c1', expect: { hearing: '2026-11-26' }, scan: true },
  { f: 'P07_郵局繳款通知單_照片.png', cat: 'agency_payment', newCase: '照片版測試', expect: { deadlineDate: '2026-11-20', task: true, caseKey: '115重家繼訴8' }, scan: true },
];

(async () => {
  fs.mkdirSync(SHOTS, { recursive: true });
  const fails = []; const log = (s) => console.log(s);
  const check = (cond, msg) => { if (!cond) fails.push(msg); log(`  ${cond ? '✓' : '✗'} ${msg}`); };
  const b = await chromium.launch();

  async function open(gem) {
    const ctx = await b.newContext({ viewport: { width: 1360, height: 2200 }, timezoneId: 'Asia/Taipei' });
    await route(ctx, gem);
    // Gemini 情境：金鑰放進「管理員設定」的儲存位置（假的，不是真金鑰）
    if (gem) await ctx.addInitScript((deid) => { try { localStorage.setItem('lf_admin_gemini_key', 'fake-key-for-test-only'); localStorage.setItem('lf_admin_gemini_model', 'gemini-fake'); if (deid) localStorage.setItem('lf_admin_deid_before_send', '1'); } catch (e) { /* ignore */ } }, gem.__deid !== false);
    const p = await ctx.newPage(); const errs = [];
    p.on('pageerror', (e) => { if (!/tailwind/.test(String(e))) errs.push(String(e)); });
    await p.goto(BASE + '?demo=ding#page-autofill', { waitUntil: 'load' });
    await p.waitForFunction(() => !!document.getElementById('in-panel'), null, { timeout: 15000 });
    await p.evaluate(() => window.LF_AutofillHost.showPage('page-autofill'));
    return { ctx, p, errs };
  }
  async function runOne(p, file, engine, opts = {}) {
    if (engine) await p.evaluate((e) => { const s = document.getElementById('in-engine'); s.value = e; s.dispatchEvent(new Event('change')); }, engine);
    await p.setInputFiles('#in-file', asFile(path.join(FX, file))); // 中文路徑在部分環境傳不進去，改傳內容
    await p.waitForFunction(() => /已讀入|讀取失敗/.test(document.getElementById('in-status').textContent), null, { timeout: 120000 });
    await p.click('#in-run');
    // Gemini：先跳出「將送出的版本（已去識別化）」確認視窗（2026-11-05）；opts.cancel 時按取消
    if (engine === 'gemini') {
      await p.waitForSelector('#deid-preview', { timeout: 30000 });
      const pv = await p.evaluate(() => ({ title: document.querySelector('#deid-preview').innerText.slice(0, 40), items: document.querySelectorAll('#deid-list .deid-chk').length, text: document.getElementById('deid-text').innerText }));
      p.__preview = pv;
      await p.click(opts.cancel ? '#deid-cancel' : '#deid-ok');
      if (opts.cancel) { await p.waitForFunction(() => /已取消/.test(document.getElementById('in-status').textContent), null, { timeout: 10000 }); return; }
    }
    await p.waitForFunction(() => /請逐欄確認|⚠/.test(document.getElementById('in-status').textContent), null, { timeout: 180000 });
  }
  const counts = (p) => p.evaluate(() => { const h = window.LF_AutofillHost; return { d: h.getDeadlines().length, t: h.getTasks().length, h: h.getHearings().length, c: h.getCases().length }; });

  // ---------------------------------------------------------------- 1) 每種類別（示意版）
  const { ctx, p, errs } = await open();
  check(await p.evaluate(() => document.querySelector('.navitem[data-page="page-autofill"] span').textContent === '收文登記'), '選單名稱改成「收文登記」');
  // 2026-11-05：只留收文登記一個入口；沒有說明段落；判決、開庭通知（含照片）範例併進收文登記
  check(await p.evaluate(() => { const tl = document.querySelector('#page-autofill [role="tablist"]'); return (!tl || tl.classList.contains('hidden')) && !document.getElementById('in-tab'); }), '沒有「書狀自動填」「開庭通知排行事曆」分頁，只留收文登記');
  check(await p.evaluate(() => !document.querySelector('#page-autofill h2 + p') && !/送 AI 前會先把姓名/.test(document.getElementById('in-panel').innerText)), '頁面上沒有說明文字段落');
  check(await p.evaluate(() => { const t = [...document.querySelectorAll('[data-in-sample]')].map((b) => b.textContent); return ['民事判決', '開庭通知書', '開庭通知書照片', '郵局繳款通知單'].every((x) => t.includes(x)); }), '範例清單有民事判決、開庭通知書（PDF、照片）、郵局繳款通知單');
  await p.screenshot({ path: path.join(SHOTS, '00_收文登記_首頁.png') });
  let i = 0;
  for (const c of CASES) {
    i++;
    log(`\n■ ${c.f}`);
    const before = await counts(p);
    await runOne(p, c.f);
    const cat = await p.$eval('#in-category', (el) => el.value);
    check(cat === c.cat, `類別判斷：${cat}（應為 ${c.cat}）`);
    if (c.expect.amount) check(await p.$eval('[data-in-field="amount"]', (el) => el.value) === c.expect.amount, `金額 ${c.expect.amount}`);
    if (c.expect.caseKey) check(await p.$eval('[data-in-field="caseNumber"]', (el) => el.value) === c.expect.caseKey, `從發文字號解析出案號 ${c.expect.caseKey}`);
    if (c.expect.received) check(await p.$eval('[data-in-field="receivedDate"]', (el) => el.value) === c.expect.received, `收文日 ${c.expect.received}（文件上的送達日期）`);
    if (c.caseId) check(await p.$eval('#in-case', (el) => el.value) === c.caseId, `案號比對到案件 ${c.caseId}`);
    if (c.newCase) { await p.selectOption('#in-case', '__new__'); await p.fill('#in-newcase-name', c.newCase); await p.check('input[data-in-att][value="王大明律師"]'); }
    if (c.pickCase) await p.selectOption('#in-case', c.pickCase);
    if (c.manualDate) { await p.fill('#in-manual-date', c.manualDate); await p.dispatchEvent('#in-manual-date', 'input'); }
    const okRows = await p.$$eval('#in-rows [data-in-status="ok"]', (r) => r.length);
    check(okRows >= 1, `有出處（綠燈）的欄位 ${okRows} 個`);
    const shotName = `${String(i).padStart(2, '0')}_${c.f.replace(/\.(pdf|png)$/, '')}_確認畫面.png`;
    await p.locator('#in-review-card').screenshot({ path: path.join(SHOTS, shotName) });
    const disabled = await p.$eval('#in-confirm', (el) => el.disabled);
    check(!disabled, '可以按「確認登記」');
    await p.click('#in-confirm');
    const done = await p.$eval('#in-done', (el) => el.textContent);
    check(/已登記/.test(done), `寫入：${done}`);
    const after = await counts(p);
    if (c.expect.deadline || c.expect.deadlineDate) check(after.d > before.d, `建了期限（${after.d - before.d} 筆）`);
    if (c.expect.deadlineDate) check(await p.evaluate((d) => window.LF_AutofillHost.getDeadlines().some((x) => x.source === 'intake' && x.computedDeadline === d && x.kind === 'main'), c.expect.deadlineDate), `期限末日 ${c.expect.deadlineDate}`);
    if (c.expect.task) check(after.t > before.t, '建了待辦');
    if (c.expect.hearing) check(await p.evaluate((d) => window.LF_AutofillHost.getHearings().some((x) => x.source === 'intake' && x.date === d), c.expect.hearing), `排進開庭行事曆 ${c.expect.hearing}`);
    const logged = await p.evaluate(() => window.LF_AutofillHost.getCases().some((x) => (x.intakeLog || []).length && x.intakeLog[x.intakeLog.length - 1].fileName));
    check(logged, '案件有收文紀錄');
    if (c.openCase) {
      const cid = await p.evaluate(() => { const cs = window.LF_AutofillHost.getCases(); return cs[cs.length - 1].id; });
      await p.evaluate(() => window.LF_AutofillHost.showPage('page-cases'));
      await p.evaluate((id) => { const b2 = document.querySelector(`.btn-case-detail[data-case-id="${id}"]`); if (b2) b2.click(); }, cid);
      await p.waitForSelector('#cdm-intake-log', { timeout: 5000 }).catch(() => null);
      const txt = await p.evaluate(() => (document.getElementById('cdm-intake-log') || {}).textContent || '');
      check(/收文紀錄（1）/.test(txt) && /其他機關繳款通知/.test(txt) && /2026-11-20/.test(txt), '案件頁「收文紀錄」清單出現這筆');
      const el = await p.$('#cdm-intake-log'); if (el) { await el.scrollIntoViewIfNeeded(); await p.screenshot({ path: path.join(SHOTS, `${String(i).padStart(2, '0')}b_案件頁_收文紀錄.png`) }); }
      // 待辦清單也看得到
      await p.evaluate(() => { const m = document.getElementById('case-detail-modal'); if (m) m.classList.add('hidden'); });
      await p.evaluate(() => window.LF_AutofillHost.showPage('page-autofill'));
    }
  }
  // 重新整理後資料還在
  await p.reload({ waitUntil: 'load' });
  await p.waitForFunction(() => !!window.LF_AutofillHost, null, { timeout: 10000 });
  const persisted = await p.evaluate(() => window.LF_AutofillHost.getCases().reduce((s, c) => s + ((c.intakeLog || []).length), 0));
  check(persisted === CASES.length, `重新整理後收文紀錄還在（${persisted} 筆）`);
  // 待辦頁看得到郵局繳款
  const taskOk = await p.evaluate(() => window.LF_AutofillHost.getTasks().some((t) => t.source === 'intake' && /繳款/.test(t.title) && t.dueDate === '2026-11-20' && t.status === '待辦'));
  check(taskOk, '待辦清單有「繳款」待辦，到期日 2026-11-20');
  check(!errs.length, `頁面錯誤 ${errs.length} 個 ${errs.join(' | ')}`);
  await ctx.close();

  // ---------------------------------------------------------------- 2) Gemini（假回應，不用真金鑰）
  log('\n■ Gemini 假回應：郵局繳款通知單');
  const sent = [];
  const fake = { category: 'agency_payment', fields: {
    caseNumber: { value: '○○院○家○115年度重家繼訴8字第1150099999號', quote: '發文字號：○○院○家○115年度重家繼訴8字第1150099999號', confident: true },
    amount: { value: '新臺幣壹佰元整', quote: '應繳金額：新臺幣壹佰元整', confident: true },
    payDue: { value: '中華民國115年11月20日', quote: '繳款期限：中華民國115年11月20日', confident: true },
    payNo: { value: '9100115103000123', quote: '繳款編號：9100115103000123', confident: true },
    issueDate: { value: '中華民國115年10月30日', quote: '這句是 AI 編的：中華民國115年10月30日', confident: true },
    issuer: { value: '中華郵政股份有限公司', quote: '中華郵政股份有限公司', confident: false },
  } };
  const g = await open(async (r) => {
    sent.push(r.request().postData() || '');
    return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(fake) }] } }] }) });
  });
  check(await g.p.$eval('#in-engine', (el) => el.value) === 'gemini', '有管理員金鑰時自動用 Gemini');
  await runOne(g.p, '07_郵局繳款通知單.pdf', 'gemini');
  if (sent.length !== 1) log('    狀態：' + await g.p.$eval('#in-status', (el) => el.textContent));
  check(sent.length === 1, 'Gemini 只被呼叫 1 次（假回應）');
  check(g.p.__preview && /將送出的版本/.test(g.p.__preview.title), '送出前跳出「將送出的版本（已去識別化）」確認視窗');
  { const line = (g.p.__preview.text.split('\n').find((l) => l.trim().length > 8) || '').trim();
    check(line && JSON.parse(sent[0] || '{}').contents[0].parts[0].text.includes(line), '實際送出的就是確認視窗裡那一份'); }
  check(await g.p.$eval('#in-category', (el) => el.value) === 'agency_payment', 'Gemini 判斷類別：其他機關繳款通知');
  const st = await g.p.$$eval('#in-rows [data-in-row]', (rs) => Object.fromEntries(rs.map((r) => [r.dataset.inRow, r.dataset.inStatus])));
  check(st.caseNumber === 'ok' && st.amount === 'ok' && st.payDue === 'ok', '案號、金額、繳款期限綠燈');
  check(st.issueDate === 'badquote', '發文日期出處是編的 → 黃燈留空');
  check(st.issuer === 'uncertain', '發文機關 AI 沒把握 → 黃燈留空');
  await g.p.locator('#in-review-card').screenshot({ path: path.join(SHOTS, '17_Gemini假回應_黃燈留空.png') });
  // 按「取消，不送出」：Gemini 不會被呼叫
  await runOne(g.p, '07_郵局繳款通知單.pdf', 'gemini', { cancel: true });
  check(sent.length === 1, '確認視窗按取消：沒有送出（Gemini 呼叫次數不變）');
  check(!g.errs.length, `頁面錯誤 ${g.errs.length} 個`);
  await g.ctx.close();

  // ---------------------------------------------------------------- 2a) 去識別化開關關著（預設）：不跳確認視窗、直接送
  {
    const sent2 = []; const gh = async (r) => { sent2.push(r.request().postData() || ''); return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(fake) }] } }] }) }); };
    gh.__deid = false;
    const o = await open(gh);
    await o.p.setInputFiles('#in-file', asFile(path.join(FX, '07_郵局繳款通知單.pdf')));
    await o.p.waitForFunction(() => /已讀入|讀取失敗/.test(document.getElementById('in-status').textContent), null, { timeout: 120000 });
    await o.p.click('#in-run');
    await o.p.waitForFunction(() => /請逐欄確認|⚠/.test(document.getElementById('in-status').textContent), null, { timeout: 60000 });
    check(!(await o.p.$('#deid-preview')) && sent2.length === 1, '去識別化開關關著（預設）：不跳確認視窗，直接送 Gemini');
    check(JSON.parse(sent2[0] || '{}').contents[0].parts[0].text.includes('中華郵政'), '直接送：送出的是原文');
    await o.ctx.close();
  }

  // ---------------------------------------------------------------- 2b) 用範例按鈕跑：判決、開庭通知、繳款通知各一（示意版）
  log('\n■ 範例按鈕：判決、開庭通知、繳款通知');
  const sm = await open();
  for (const [label, cat, ck] of [['民事判決', 'judgment', 'deadline'], ['開庭通知書', 'hearing', 'hearing'], ['郵局繳款通知單', 'agency_payment', 'task']]) {
    const before = await counts(sm.p);
    await sm.p.evaluate((l) => [...document.querySelectorAll('[data-in-sample]')].find((b) => b.textContent === l).click(), label);
    await sm.p.waitForFunction(() => /已讀入|讀取失敗/.test(document.getElementById('in-status').textContent), null, { timeout: 120000 });
    await sm.p.click('#in-run');
    await sm.p.waitForFunction(() => /請逐欄確認|⚠/.test(document.getElementById('in-status').textContent), null, { timeout: 60000 });
    const cat2 = await sm.p.$eval('#in-category', (el) => el.value);
    check(cat2 === cat, `範例「${label}」判斷為 ${cat2}`);
    if (!(await sm.p.$eval('#in-case', (el) => el.value))) { await sm.p.selectOption('#in-case', '__new__'); await sm.p.fill('#in-newcase-name', '範例 ' + label); }
    if (await sm.p.$('input[data-in-att][value="王大明律師"]')) await sm.p.evaluate(() => { const c = document.querySelector('input[data-in-att][value="王大明律師"]'); if (c && !c.checked) c.click(); });
    await sm.p.click('#in-confirm');
    const after = await counts(sm.p);
    if (ck === 'deadline') check(after.d > before.d, '判決 → 建了期限');
    if (ck === 'hearing') check(after.h > before.h, '開庭通知 → 排進開庭行事曆');
    if (ck === 'task') check(after.t > before.t, '繳款通知 → 建了待辦');
  }
  check(!sm.errs.length, `頁面錯誤 ${sm.errs.length} 個`);
  await sm.ctx.close();

  // ---------------------------------------------------------------- 3) 讀不到的檔案也不卡住
  log('\n■ 壞掉的檔案：仍可手動登記');
  const z = await open();
  const bad = path.join(require('os').tmpdir(), 'intake_bad.pdf'); fs.writeFileSync(bad, 'not a pdf');
  await z.p.setInputFiles('#in-file', asFile(bad));
  await z.p.waitForFunction(() => /讀取失敗/.test(document.getElementById('in-status').textContent), null, { timeout: 30000 });
  check(await z.p.$eval('#in-category', (el) => el.value) === 'other', '類別歸「其他」並給空白登記表');
  await z.p.selectOption('#in-case', 'c1'); await z.p.fill('#in-manual-days', '10'); await z.p.dispatchEvent('#in-manual-days', 'input');
  await z.p.click('#in-confirm');
  check(/已登記/.test(await z.p.$eval('#in-done', (el) => el.textContent)), '手動設期限後可以登記');
  await z.p.locator('#in-review-card').screenshot({ path: path.join(SHOTS, '18_讀不到的檔案_手動登記.png') });
  await z.ctx.close();

  await b.close();
  log(`\n結果：${fails.length ? fails.length + ' 項失敗' : '全部通過'}`);
  process.exit(fails.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
