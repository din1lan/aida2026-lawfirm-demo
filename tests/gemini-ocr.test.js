/* 掃描頁用 Gemini 辨識 測試：node tests/gemini-ocr.test.js
 * 全部用假回應（假的 fetch、假的 PDF、假的畫面），不連網、不用任何真的金鑰。文字都是虛構的。 */
'use strict';
const assert = require('assert');
const G = require('../modules/gemini-ocr.js');
const T = require('../modules/pdftext.js');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const FAKE_KEY = 'fake-key-for-test';
const ok = (text, finishReason) => ({ status: 200, json: { candidates: [{ content: { parts: [{ text }] }, finishReason: finishReason || 'STOP' }] } });
const err = (status, message, st) => ({ status, json: { error: { code: status, status: st || '', message } } });
// 假的 fetch：依序回傳 replies，並記下送出的內容
function fakeFetch(replies) {
  const calls = [];
  const f = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    const r = replies[Math.min(calls.length - 1, replies.length - 1)];
    if (r === 'offline') throw new TypeError('Failed to fetch');
    return { status: r.status, ok: r.status >= 200 && r.status < 300, json: async () => r.json };
  };
  f.calls = calls; return f;
}

// 假的畫面（勾選框、金鑰欄、畫布）與假的 PDF（pages：每頁的文字；空字串＝掃描頁）
function fakeDom(checked, key) {
  const els = { 'my-box': { checked }, 'aib-gemini-key': { value: key || '' }, 'aib-gemini-model': { value: 'gemini-test-model' } };
  global.document = {
    getElementById: (id) => els[id] || null,
    createElement: () => ({ width: 0, height: 0, getContext: () => ({ fillRect() {} }), toDataURL: () => 'data:image/jpeg;base64,RkFLRQ==' }),
  };
}
function fakePdf(pageTexts) {
  const OPS = { paintImageXObject: 85 };
  global.pdfjsLib = {
    OPS,
    getDocument: () => ({ promise: Promise.resolve({
      numPages: pageTexts.length,
      getPage: async (n) => ({
        getTextContent: async () => ({ items: pageTexts[n - 1] ? [{ str: pageTexts[n - 1], transform: [12, 0, 0, 12, 50, 700], height: 12, hasEOL: true }] : [] }),
        getOperatorList: async () => ({ fnArray: pageTexts[n - 1] ? [] : [OPS.paintImageXObject] }),
        getViewport: ({ scale }) => ({ width: 600 * scale, height: 800 * scale }),
        render: () => ({ promise: Promise.resolve() }),
      }),
    }) }),
  };
}
function cleanup() { delete global.document; delete global.pdfjsLib; delete global.Tesseract; }

// ── 送出的內容 ──
test('01 送出的指示要求逐字轉錄、不摘要、不改寫、保留段落、只回純文字', () => {
  const b = G.buildRequest('QUJD', 'image/jpeg', 3);
  const sys = b.systemInstruction.parts[0].text;
  ['逐字', '不要摘要', '不要改寫', '段落', '只輸出轉錄的文字'].forEach((w) => assert.ok(sys.includes(w), '指示要有「' + w + '」'));
  assert.strictEqual(b.generationConfig.responseMimeType, 'text/plain');
  assert.strictEqual(b.generationConfig.temperature, 0);
  const img = b.contents[0].parts.find((p) => p.inline_data);
  assert.deepStrictEqual(img.inline_data, { mime_type: 'image/jpeg', data: 'QUJD' });
  assert.ok(b.contents[0].parts[0].text.includes('第 3 頁'));
});

// ── 讀回應 ──
test('02 正常回應：回傳轉錄文字，保留段落換行', () => {
  const r = G.parseResponse(200, ok('臺灣虛構地方法院民事判決\n\n原告　甲○○\n被告　乙○○').json);
  assert.strictEqual(r.text, '臺灣虛構地方法院民事判決\n\n原告　甲○○\n被告　乙○○');
});
test('03 回應包了 Markdown 框、中文字之間夾半形空白：拿掉，但不改字、保留全形空格', () => {
  const r = G.parseResponse(200, ok('```\n主 文\n被告應給付原告　新臺幣 參拾伍萬元。\n```').json);
  assert.strictEqual(r.text, '主文\n被告應給付原告　新臺幣參拾伍萬元。');
});
test('04 回應是空的或只有幾個字：當成失敗（之後退回本機）', () => {
  assert.ok(G.parseResponse(200, ok('  ').json).error.includes('沒有回傳文字'));
  assert.ok(G.parseResponse(200, { candidates: [{ finishReason: 'RECITATION' }] }).error.includes('RECITATION'));
  assert.ok(G.parseResponse(200, { promptFeedback: { blockReason: 'SAFETY' } }).error.includes('SAFETY'));
});
test('05 金鑰錯：說明「金鑰無效」，而且後面的頁不再試', () => {
  const r = G.parseResponse(400, err(400, 'API key not valid. Please pass a valid API key.', 'INVALID_ARGUMENT').json);
  assert.ok(r.error.includes('金鑰無效')); assert.strictEqual(r.fatal, true);
  assert.ok(G.parseResponse(403, err(403, 'denied', 'PERMISSION_DENIED').json).error.includes('金鑰無效'));
});
test('06 超過額度：說明「超過 Gemini 使用額度」', () => {
  const r = G.parseResponse(429, err(429, 'Resource has been exhausted (e.g. check quota).', 'RESOURCE_EXHAUSTED').json);
  assert.ok(r.error.includes('超過 Gemini 使用額度')); assert.strictEqual(r.fatal, true);
});
test('07 Google 伺服器錯誤：說明「暫時有問題」，下一頁仍可再試', () => {
  const r = G.parseResponse(503, err(503, 'The model is overloaded.', 'UNAVAILABLE').json);
  assert.ok(r.error.includes('暫時有問題')); assert.strictEqual(r.fatal, false);
});

// ── 實際呼叫（假的 fetch）──
test('08 沒網路：說明「連不上 Google」', async () => {
  const r = await G.recognize('QUJD', 'image/jpeg', { key: FAKE_KEY, fetch: fakeFetch(['offline']) });
  assert.ok(r.error.includes('連不上 Google')); assert.strictEqual(r.fatal, true);
});
test('09 呼叫網址：用選的模型、金鑰放在網址參數（沿用網站現有作法）', async () => {
  const f = fakeFetch([ok('判決書第一頁內容（虛構）')]);
  const r = await G.recognize('QUJD', 'image/jpeg', { key: FAKE_KEY, model: 'gemini-test-model', fetch: f });
  assert.strictEqual(r.text, '判決書第一頁內容（虛構）');
  assert.ok(f.calls[0].url.startsWith('https://generativelanguage.googleapis.com/v1beta/models/gemini-test-model:generateContent?key=' + FAKE_KEY));
});

// ── 開關：預設不送 ──
test('10 沒勾選：不提供 Gemini 辨識（照舊本機 OCR）', () => {
  fakeDom(false, FAKE_KEY);
  try { assert.strictEqual(G.hookFor('my-box'), undefined); assert.strictEqual(G.hookFor('不存在的框'), undefined); } finally { cleanup(); }
});
test('11 勾選框預設沒打勾、也不寫進任何儲存', () => {
  const h = G.checkboxHtml('x1');
  assert.ok(/type="checkbox"/.test(h)); assert.ok(!/checked/.test(h));
  assert.ok(h.includes('頁面圖片會原樣送給 Google，無法先遮姓名'));
  const src = require('fs').readFileSync(require('path').join(__dirname, '..', 'modules', 'gemini-ocr.js'), 'utf8');
  assert.ok(!/(localStorage|sessionStorage)\.setItem/.test(src), '不應寫入儲存');
});
test('12 勾了但沒有金鑰：不送，退回本機，並說明原因', async () => {
  fakeDom(true, ''); fakePdf(['', '這一頁有文字層的內容（虛構）']);
  const f = fakeFetch([ok('不應被呼叫')]);
  try {
    const rd = await T.read(new Uint8Array(1), { remoteOcr: G.hookFor('my-box', null, { fetch: f }) });
    assert.strictEqual(f.calls.length, 0);
    assert.ok(rd.geminiError.includes('沒有 Gemini 金鑰'));
    assert.deepStrictEqual(rd.geminiPages, []);
    assert.ok(rd.ocrError, '應該改走本機 OCR（node 裡沒有瀏覽器，所以本機 OCR 也會失敗）');
    assert.deepStrictEqual(rd.imagePages, [1]);
  } finally { cleanup(); }
});

// ── 跟 PDF 讀取串起來 ──
test('13 只送讀不到文字的頁；有文字層的頁不送；成功的頁不再跑本機 OCR', async () => {
  fakeDom(true, FAKE_KEY); fakePdf(['第一頁有文字層（虛構）', '', '第三頁有文字層（虛構）', '']);
  const f = fakeFetch([ok('第二頁　掃描　內容（虛構）'), ok('第四頁掃描內容（虛構）')]);
  try {
    const rd = await T.read(new Uint8Array(1), { remoteOcr: G.hookFor('my-box', null, { fetch: f }) });
    assert.strictEqual(f.calls.length, 2, '只送 2 張掃描頁');
    assert.ok(f.calls[0].body.contents[0].parts[0].text.includes('第 2 頁'));
    assert.ok(f.calls[1].body.contents[0].parts[0].text.includes('第 4 頁'));
    assert.deepStrictEqual(rd.geminiPages, [2, 4]);
    assert.deepStrictEqual(rd.imagePages, []); assert.deepStrictEqual(rd.ocrPages, []);
    assert.strictEqual(rd.ocrError, '', '全部成功時不應載入本機 OCR');
    assert.strictEqual(rd.pages[1].text, '第二頁　掃描　內容（虛構）'); assert.strictEqual(rd.pages[1].gemini, true);
    assert.strictEqual(rd.pages[0].text, '第一頁有文字層（虛構）\n'); assert.ok(!rd.pages[0].gemini);
    assert.ok(rd.chars > 20);
  } finally { cleanup(); }
});
test('14 中途超過額度：已成功的頁保留，其餘不再送、退回本機 OCR', async () => {
  fakeDom(true, FAKE_KEY); fakePdf(['', '', '']);
  const f = fakeFetch([ok('第一頁掃描內容（虛構）'), err(429, 'quota', 'RESOURCE_EXHAUSTED')]);
  try {
    const rd = await T.read(new Uint8Array(1), { remoteOcr: G.hookFor('my-box', null, { fetch: f }) });
    assert.strictEqual(f.calls.length, 2, '第 3 頁不再送');
    assert.deepStrictEqual(rd.geminiPages, [1]);
    assert.ok(rd.geminiError.includes('第 2 頁') && rd.geminiError.includes('額度'));
    assert.deepStrictEqual(rd.imagePages, [2, 3], '剩下的頁交給本機 OCR（node 裡會失敗，所以仍是圖片頁）');
  } finally { cleanup(); }
});
test('15 沒勾選時 PDF 讀取完全照舊（不會呼叫 Gemini）', async () => {
  fakeDom(false, FAKE_KEY); fakePdf(['', '有文字（虛構）']);
  try {
    const rd = await T.read(new Uint8Array(1), { remoteOcr: G.hookFor('my-box') });
    assert.deepStrictEqual(rd.geminiPages, []); assert.strictEqual(rd.geminiError, '');
    assert.deepStrictEqual(rd.imagePages, [1]);
  } finally { cleanup(); }
});
test('16 畫面說明：Gemini 頁標示「圖片沒遮、分析有遮」，失敗說明已改用本機', () => {
  const n = G.pagesNote([2, 5]);
  assert.ok(n.startsWith('第 2、5 頁由 Gemini 辨識')); assert.ok(n.includes('沒有遮姓名')); assert.ok(n.includes('會先遮姓名'));
  assert.strictEqual(G.pagesNote([]), '');
  assert.ok(G.PAGE_MARK.includes('此頁由 Gemini 辨識'));
  assert.ok(G.fallbackNote('第 1 頁：連不上 Google（可能沒有網路）').includes('已改用本機辨識'));
  assert.strictEqual(G.fallbackNote(''), '');
});
test('17 轉回來的文字照原流程去識別化：姓名在分析那一步會被遮', () => {
  const D = require('../modules/deidentify.js');
  const text = G.parseResponse(200, ok('原告王小明主張被告李大華應給付新臺幣500,000元。').json).text;
  const r = D.deidentify(text, [{ name: '王小明', role: 'client' }, { name: '李大華', role: 'opponent' }]);
  assert.ok(!r.text.includes('王小明') && !r.text.includes('李大華'));
});

(async () => {
  let pass = 0, fail = 0;
  for (const t of tests) {
    try { await t.fn(); pass++; console.log('  ✓ ' + t.name); } catch (e) { fail++; console.log('  ✗ ' + t.name + '\n      ' + (e && e.message)); }
  }
  console.log(`結果：${pass} 通過，${fail} 失敗（共 ${tests.length} 個案例）`);
  process.exit(fail ? 1 : 0);
})();
