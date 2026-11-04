/* PDF 讀文字共用函式測試：node tests/pdftext.test.js
 * 只測不需要瀏覽器的部分（片段接成文字、圖片頁提示、讀取參數）；真正讀 PDF 的部分在 docs/PDF轉錄修正.md 的瀏覽器實測。 */
'use strict';
const assert = require('assert');
const T = require('../modules/pdftext.js');
let n = 0; const ok = (name, fn) => { fn(); n++; console.log('✓ ' + name); };
const it = (str, y, hasEOL = false, h = 12) => ({ str, transform: [h, 0, 0, h, 50, y], height: h, hasEOL });

ok('讀取參數帶中文字型對照表與標準字型（同 3.11.174 版）', () => {
  assert.strictEqual(T.OPTIONS.cMapUrl, 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/');
  assert.strictEqual(T.OPTIONS.cMapPacked, true);
  assert.strictEqual(T.OPTIONS.standardFontDataUrl, 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/standard_fonts/');
});
ok('同一行的片段直接接起來，一個字都不少', () => {
  assert.strictEqual(T.pageText([it('被告應給付', 700), it('原告新臺幣', 700), it('參拾伍萬元。', 700, true)]), '被告應給付原告新臺幣參拾伍萬元。\n');
});
ok('有 hasEOL 照原樣換行（與舊寫法相同）', () => {
  assert.strictEqual(T.pageText([it('主文', 700, true), it('理由', 680, true)]), '主文\n理由\n');
});
ok('沒有 hasEOL 但換到下一行時補換行，不讓兩行黏在一起', () => {
  assert.strictEqual(T.pageText([it('原告甲○○', 700), it('被告乙○○', 680)]), '原告甲○○\n被告乙○○');
});
ok('空片段、缺欄位不會壞掉', () => {
  assert.strictEqual(T.pageText([{ str: '', hasEOL: true }, null, { str: '字' }]), '\n字');
  assert.strictEqual(T.pageText(undefined), '');
});
ok('圖片頁提示文字', () => {
  assert.strictEqual(T.imagePagesNote([2]), '第 2 頁是圖片、讀不到文字');
  assert.strictEqual(T.imagePagesNote([2, 5]), '第 2、5 頁是圖片、讀不到文字');
  assert.strictEqual(T.imagePagesNote([]), '');
});
ok('OCR 提示文字', () => {
  assert.strictEqual(T.ocrPagesNote([1, 3]), '第 1、3 頁為 OCR 辨識，可能有錯字，請核對原文');
  assert.strictEqual(T.ocrPagesNote([]), '');
});
ok('OCR 清理：中文字間空白拿掉、半形標點轉全形、數字逗點保留', () => {
  assert.strictEqual(T.cleanOcr('被告應給付新臺幣 1 8 6 , 0 0 0 元 , 民法第 184 條 :'), '被告應給付新臺幣186,000元，民法第184條：');
  assert.strictEqual(T.cleanOcr('原 告 甲 ○ ○ (虛構 )'), '原告甲○○（虛構）');
  assert.strictEqual(T.cleanOcr('原告 (虛構 ) 住址'), '原告（虛構）住址');
});
ok('OCR 清理：○○ 被認成 00／OO 時換回，一般數字不動', () => {
  assert.strictEqual(T.cleanOcr('原告庚00 (虛構)'), '原告庚○○（虛構）');
  assert.strictEqual(T.cleanOcr('被告辛OO住'), '被告辛○○住');
  assert.strictEqual(T.cleanOcr('第100頁、新臺幣3000元'), '第100頁、新臺幣3000元');
});
ok('OCR 清理：掃描雜點的孤立符號拿掉，多餘空行收掉', () => {
  assert.strictEqual(T.cleanOcr('原告 “ 庚 _ 住\n\n\n\n下一行 | '), '原告庚住\n\n下一行');
});
ok('OCR 依位置組行：字距很寬的地方留全形空格（原告　姓名），一般字距不留', () => {
  const W = (text, x0, x1) => ({ text, bbox: { x0, x1, y0: 0, y1: 48 } });
  const data = { blocks: [{ paragraphs: [{ lines: [{ words: [W('原', 240, 290), W('告', 300, 345), W('庚', 411, 460), W('00', 462, 540)] }] }, { lines: [{ words: [W('主', 240, 288), W('文', 300, 338)] }] }] }] };
  assert.strictEqual(T.ocrLinesText(data), '原 告\u3000庚 00\n\n主 文');
  assert.strictEqual(T.cleanOcr(T.ocrLinesText(data)), '原告\u3000庚○○\n\n主文');
  assert.strictEqual(T.ocrLinesText({ text: '沒有位置資料時用純文字' }), '沒有位置資料時用純文字');
});
ok('OCR 元件版本全部釘死（不會自動跳新版）', () => {
  for (const k of ['script', 'workerPath', 'corePath', 'langPath']) assert(/@\d+\.\d+\.\d+/.test(T.OCR[k]), k);
});
console.log(`\n全部通過（${n} 項）`);
