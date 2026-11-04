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
console.log(`\n全部通過（${n} 項）`);
