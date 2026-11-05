/* 原圖檢視：找出處位置、PDF 文字層字座標。node tests/doc-viewer.test.js */
'use strict';
const assert = require('assert');
const DV = require('../modules/doc-viewer.js');
const P = require('../modules/pdftext.js');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); } }
// 假的一頁：每行一串字，字寬 10、行高 12，第 li 行在 y=100+li*20
const fakeChars = (lines) => { const out = []; lines.forEach((s, li) => [...s].forEach((c, i) => out.push({ c, li, x0: 50 + i * 10, y0: 100 + li * 20, x1: 60 + i * 10, y1: 112 + li * 20 }))); return out; };
const pg1 = { n: 1, w: 595, h: 842, chars: fakeChars(['臺灣臺北地方法院通知書', '案號：115年度訴字第123號']), text: '臺灣臺北地方法院通知書\n案號：115年度訴字第123號' };
const pg2 = { n: 2, w: 595, h: 842, chars: fakeChars(['應到時間：115年11月26日上午10時', '應到處所：第五法庭']), text: '應到時間：115年11月26日上午10時\n應到處所：第五法庭' };

console.log('【找出處位置】');
t('1 出處在第 2 頁 → 跳第 2 頁、黃框框在那一行', () => {
  const r = DV.locate([pg1, pg2], '應到時間：115年11月26日上午10時', P);
  assert.strictEqual(r.page, 2); assert.strictEqual(r.rects.length, 1);
  assert.strictEqual(r.rects[0].y0, 100); assert.strictEqual(r.rects[0].x0, 50);
});
t('2 掃描辨識有錯字（26→2b、時→畤）也找得到', () => {
  const r = DV.locate([pg1, pg2], '應到時間：115年11月2b日上午10畤', P);
  assert.strictEqual(r.page, 2); assert.ok(r.rects.length >= 1); assert.ok(r.score >= P.MATCH_MIN);
});
t('3 跨兩行的出處 → 兩個黃框', () => {
  const r = DV.locate([pg1], '地方法院通知書案號：115年度訴字', P);
  assert.strictEqual(r.page, 1); assert.strictEqual(r.rects.length, 2);
});
t('4 沒有字座標（例如 Gemini 辨識頁）但文字裡有 → 只跳頁、不畫框', () => {
  const r = DV.locate([{ ...pg1, chars: null }, { ...pg2, chars: null }], '應到處所：第五法庭', P);
  assert.strictEqual(r.page, 2); assert.strictEqual(r.rects.length, 0);
});
t('5 找不到、空白出處 → null', () => {
  assert.strictEqual(DV.locate([pg1, pg2], '完全無關的一段話語內容', P), null);
  assert.strictEqual(DV.locate([pg1, pg2], '', P), null);
  assert.strictEqual(DV.locate([], '應到處所', P), null);
});

console.log('【PDF 文字層的字座標】');
const H = 842; const VT = [1, 0, 0, -1, 0, H]; // pdf.js scale 1、沒有旋轉
t('6 一段文字平均分給每個字，座標換成左上角原點', () => {
  const c = P.textItemChars([{ str: '開庭通知', transform: [12, 0, 0, 12, 100, 700], width: 48, height: 12 }], VT);
  assert.strictEqual(c.length, 4);
  assert.deepStrictEqual([c[0].x0, c[0].x1, c[0].y0, c[0].y1], [100, 112, 130, 142]);
  assert.strictEqual(c[3].x0, 136);
});
t('7 同一條基準線算同一行，換行後行號加一', () => {
  const c = P.textItemChars([
    { str: '案號', transform: [12, 0, 0, 12, 100, 700], width: 24 },
    { str: '115', transform: [12, 0, 0, 12, 130, 700.5], width: 18 },
    { str: '法庭', transform: [12, 0, 0, 12, 100, 680], width: 24 },
  ], VT);
  assert.deepStrictEqual(c.map((x) => x.li), [0, 0, 0, 0, 0, 1, 1]);
});
t('8 空字串、缺座標的項目略過', () => {
  assert.strictEqual(P.textItemChars([{ str: '', transform: [12, 0, 0, 12, 0, 0] }, { str: 'A' }], VT).length, 0);
});
t('9 文字層字座標接上找出處：找到正確位置', () => {
  const chars = P.textItemChars([{ str: '應到時間：115年11月26日上午10時', transform: [12, 0, 0, 12, 72, 600], width: 12 * 20 }], VT);
  const r = DV.locate([{ n: 1, w: 595, h: H, chars, text: '' }], '115年11月26日上午10時', P);
  assert.strictEqual(r.page, 1); assert.ok(Math.abs(r.rects[0].y0 - (H - 600 - 12)) < 0.01); assert.ok(r.rects[0].x0 > 72);
});
t('10 黃框位置用百分比畫（縮放視窗不會跑掉）', () => {
  const h = DV.markHTML({ w: 500, h: 1000 }, [{ x0: 100, y0: 200, x1: 200, y1: 220 }]);
  assert.ok(/left:19\.600%;top:19\.800%;width:20\.800%;height:2\.400%/.test(h), h);
});

console.log(`\n結果：${pass} 通過，${fail} 失敗`);
process.exit(fail ? 1 : 0);
