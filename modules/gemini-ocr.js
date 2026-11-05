/* 掃描頁用 Gemini 辨識（可選，預設關閉）— AI 智慧閱卷、AI 自動填共用
 *
 * 為什麼要有這支：本機 OCR（Tesseract，在 modules/pdftext.js）遇到字距很寬的法院判決常認錯字。
 * 使用者可以在畫面上勾選「掃描頁用 Gemini 辨識」，改把「讀不到文字的頁面」轉成圖片送 Gemini 逐字轉錄。
 *
 * 規矩：
 *   - 預設不送：沒勾、或沒有金鑰，就照舊用本機 OCR。勾選狀態只在畫面上，不寫進任何儲存，重新整理就回到沒勾
 *   - 只送「抓不到文字的頁」（pdftext.js 判斷），有文字層的頁不送
 *   - 頁面圖片會原樣送給 Google，沒辦法先遮姓名；轉回來的文字之後照原流程去識別化，再送去分析
 *   - 任何失敗（沒網路、金鑰錯、超過額度…）都退回本機 OCR，並把原因寫在畫面上
 * 金鑰、模型：2026-11-05 起只從「管理員設定」頁（#admin）讀（modules/ai-config.js，存在這台電腦的瀏覽器）。沒設定時勾選框不顯示。
 * 純函式可在 node 測試：node tests/gemini-ocr.test.js（用假回應，不連網）
 */
(function (root) {
  'use strict';
  const API = 'https://generativelanguage.googleapis.com/v1beta/models/';
  const DEFAULT_MODEL = 'gemini-2.5-flash'; // 使用者還沒按「載入模型」時用這個
  const TIMEOUT_MS = 90000;
  const MIN_CHARS = 5;
  const RENDER_WIDTH = 2000;
  const LABEL = '掃描頁用 Gemini 辨識（較準，但頁面圖片會原樣送給 Google，無法先遮姓名）';

  const PROMPT = [
    '你是法院文件的逐字轉錄員。使用者會給你一頁掃描文件的圖片。',
    '請把圖片上的文字一字不差地轉錄成純文字：',
    '- 逐字轉錄，不要摘要、不要改寫、不要翻譯、不要補字、不要修正錯字或標點',
    '- 保留原本的段落與換行；表格每列一行，欄位之間用全形空格分開',
    '- 字距很寬的字（例如「判　　決」）照字的順序接起來即可，不要在每個字之間加空白',
    '- 「○」「Ｏ」等遮蔽符號照抄；看不清楚的字用「□」代替，不要猜',
    '- 頁首、頁尾、頁碼、騎縫章文字也照抄',
    '- 只輸出轉錄的文字本身，不要加任何說明、標題、引號或 Markdown',
  ].join('\n');

  // 「第 2、5 頁由 Gemini 辨識」
  function pagesNote(nums) {
    const list = (nums || []).filter((n) => Number.isFinite(n));
    return list.length ? 'Gemini 讀取完成' : ''; // 2026-11-05：只留一句（事務所已決定直接交給 Google）
  }
  const PAGE_MARK = '（此頁由 Gemini 辨識，請核對原文）';

  function buildRequest(base64, mime, pageNo) {
    return {
      systemInstruction: { parts: [{ text: PROMPT }] },
      contents: [{ role: 'user', parts: [{ text: `請逐字轉錄這一頁${pageNo ? `（第 ${pageNo} 頁）` : ''}。` }, { inline_data: { mime_type: mime || 'image/jpeg', data: String(base64 || '') } }] }],
      generationConfig: { temperature: 0, responseMimeType: 'text/plain' },
    };
  }

  // 把 Google 的錯誤換成看得懂的話；fatal＝後面的頁也不用再試了
  function explainError(status, message) {
    const m = String(message || '');
    if (status === 0) return { reason: '連不上 Google（可能沒有網路）', fatal: true };
    if (status === -1) return { reason: '等太久沒有回應（超過 ' + Math.round(TIMEOUT_MS / 1000) + ' 秒）', fatal: true };
    if (status === 429 || /RESOURCE_EXHAUSTED|quota|rate limit/i.test(m)) return { reason: '超過 Gemini 使用額度，請稍後再試', fatal: true };
    if (status === 401 || status === 403 || /API[_ ]?key|PERMISSION_DENIED|UNAUTHENTICATED/i.test(m)) return { reason: 'Gemini 金鑰無效或沒有權限', fatal: true };
    if (status === 404) return { reason: '找不到選用的 Gemini 模型', fatal: true };
    if (status >= 500) return { reason: 'Google 服務暫時有問題（' + status + '）', fatal: false };
    return { reason: 'Gemini 回傳錯誤（' + status + (m ? '：' + m.slice(0, 80) : '') + '）', fatal: false };
  }

  // 轉錄文字的小整理：拿掉 Markdown 框、中文字之間的半形空白；不改字
  function cleanText(s) {
    const HAN = '　-〿一-鿿豈-﫿＀-￯○';
    let t = String(s || '').replace(/\r/g, '').trim();
    const fence = t.match(/^```[a-z]*\n([\s\S]*?)\n?```$/i); if (fence) t = fence[1];
    t = t.replace(new RegExp(`([${HAN}])[ \\t]+(?=[${HAN}])`, 'g'), '$1');
    return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // 讀 Gemini 回應：回傳 { text } 或 { error, fatal }
  function parseResponse(status, json) {
    const j = json || {};
    if (status < 200 || status >= 300) { const e = explainError(status, j.error && (j.error.status + ' ' + j.error.message)); return { error: e.reason, fatal: e.fatal }; }
    if (j.promptFeedback && j.promptFeedback.blockReason) return { error: 'Gemini 拒絕處理這一頁（' + j.promptFeedback.blockReason + '）', fatal: false };
    const c = (j.candidates || [])[0] || {};
    const text = cleanText(((c.content || {}).parts || []).map((p) => p.text || '').join(''));
    if (text.replace(/[\s　]+/g, '').length >= MIN_CHARS) return { text };
    // 2026-11-05：正常結束但沒有文字＝空白頁，略過、不算失敗
    if (!c.finishReason || c.finishReason === 'STOP') return { text: '', blank: true };
    return { error: '這一頁 Gemini 沒有回傳文字（' + c.finishReason + '）', fatal: false };
  }

  // 金鑰與模型：管理員設定頁（modules/ai-config.js）
  function credentials() {
    const A = root.LF_AI; let key = ''; let model = '';
    try { key = A ? A.getKey() : ''; model = A ? A.getModel() : ''; } catch (e) { /* ignore */ }
    return { key: String(key || '').trim(), model: String(model || '').trim() || DEFAULT_MODEL };
  }

  // 送一頁：回傳 { text } 或 { error, fatal }
  async function recognize(base64, mime, opt) {
    opt = opt || {};
    const f = opt.fetch || root.fetch;
    const ctl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const timer = ctl ? setTimeout(() => ctl.abort(), opt.timeoutMs || TIMEOUT_MS) : null;
    let r;
    try {
      r = await f(`${API}${encodeURIComponent(opt.model || DEFAULT_MODEL)}:generateContent?key=${encodeURIComponent(opt.key || '')}`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(buildRequest(base64, mime, opt.page)), signal: ctl ? ctl.signal : undefined,
      });
    } catch (e) {
      const aborted = e && (e.name === 'AbortError');
      const x = explainError(aborted ? -1 : 0); return { error: x.reason, fatal: x.fatal };
    } finally { if (timer) clearTimeout(timer); }
    const j = await r.json().catch(() => ({}));
    return parseResponse(r.status, j);
  }

  // 頁面轉成圖片：用原本的樣子（不做本機 OCR 用的黑白、去雜點處理），寬度約 2000 像素
  async function renderPage(page) {
    const vp0 = page.getViewport({ scale: 1 });
    const vp = page.getViewport({ scale: Math.min(3, Math.max(1, RENDER_WIDTH / vp0.width)) });
    const cv = root.document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const c2 = cv.getContext('2d'); c2.fillStyle = '#fff'; c2.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: c2, viewport: vp }).promise;
    return cv;
  }

  // 畫面上的勾選框（每個功能各一個；狀態只在畫面上，不記住）
  function checkboxHtml() { return ''; } // 2026-11-05：勾選框拿掉（有金鑰就用 Gemini）

  // 管理員設定改了金鑰：勾選框跟著顯示／隱藏
  try { if (root.addEventListener) root.addEventListener('lf-ai-config', () => { const on = !!credentials().key; root.document.querySelectorAll('.lf-gemini-ocr-wrap').forEach((el) => { el.classList.toggle('hidden', !on); if (!on) { const c = el.querySelector('input'); if (c) c.checked = false; } }); }); } catch (e) { /* ignore */ }

  // 給 LF_PdfText.read 的 opts.remoteOcr：沒勾就回傳 undefined（照舊本機 OCR）
  //   ctx：{ pdf, pages, imagePages }（pdftext.js 傳入）；回傳 { pages:[頁碼], error }
  //   onStatus(text)：進度文字
  function hookFor(checkboxId, onStatus, opt) {
    opt = opt || {};
    // 2026-11-05：不再有勾選框。有設定金鑰 → 掃描頁直接交給 Gemini；沒設定 → 照舊本機 OCR（備用）
    //（畫面上若還有同名勾選框，例如單元測試，照它的勾選狀態）
    const el = root.document && root.document.getElementById(checkboxId);
    if (el ? !el.checked : !(opt.credentials ? opt.credentials() : credentials()).key) return undefined;
    return async function remoteOcr(ctx) {
      const say = (t) => { if (onStatus) { try { onStatus(t); } catch (e) { /* ignore */ } } };
      const cred = opt.credentials ? opt.credentials() : credentials();
      if (!cred.key) return { pages: [], error: '沒有 Gemini 金鑰（請到「AI 智慧閱卷」頁貼上）' };
      const done = []; let error = ''; let fatal = false;
      const list = ctx.imagePages || [];
      for (let k = 0; k < list.length; k++) {
        const pg = ctx.pages[list[k] - 1];
        say(`Gemini 辨識中：掃描頁 ${k + 1}／${list.length}（第 ${pg.n} 頁）`);
        if (opt.onProgress) { try { opt.onProgress({ done: k, total: list.length, page: pg.n, percent: Math.round((k / list.length) * 100), label: `Gemini 辨識中：第 ${k + 1}／${list.length} 頁（文件第 ${pg.n} 頁）` }); } catch (e) { /* ignore */ } }
        const cv = await renderPage(await ctx.pdf.getPage(pg.n));
        const b64 = cv.toDataURL('image/jpeg', 0.9).split(',')[1] || '';
        cv.width = cv.height = 0;
        const r = await recognize(b64, 'image/jpeg', { key: cred.key, model: cred.model, page: pg.n, fetch: opt.fetch });
        if (r.text) {
          pg.text = r.text; pg.chars = r.text.replace(/[\s　]+/g, '').length; pg.image = false; pg.gemini = true; done.push(pg.n);
        } else if (r.blank) {
          pg.text = ''; pg.chars = 0; pg.image = false; pg.blank = true; // 空白頁：略過，不警告
        } else {
          error = `第 ${pg.n} 頁：${r.error}`;
          if (r.fatal) { fatal = true; break; }
        }
      }
      if (opt.onProgress) { try { opt.onProgress(null); } catch (e) { /* ignore */ } }
      return { pages: done, error, fatal, used: true };
    };
  }

  // 失敗原因 → 畫面說明（「Gemini 辨識沒有成功（…），已改用本機辨識」）
  function fallbackNote(err, fatal) {
    return err ? `Gemini 讀取失敗（${err}）${fatal ? '，已改用本機辨識' : ''}` : '';
  }

  const api = { PROMPT, LABEL, PAGE_MARK, DEFAULT_MODEL, buildRequest, parseResponse, explainError, cleanText, recognize, credentials, checkboxHtml, hookFor, pagesNote, fallbackNote };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.LF_GeminiOcr = api;
})(typeof window !== 'undefined' ? window : globalThis);
