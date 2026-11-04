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
const W = (text, conf, x) => ({ text, symbols: [...text].map((c) => ({ text: c, confidence: conf })) });
const L = (conf, ...words) => ({ confidence: conf, words });
const DATA = (...lines) => ({ blocks: [{ paragraphs: [{ lines }] }] });
ok('OCR 後處理：字距空白拿掉、被切斷的行接回同一段、段落開頭才換段', () => {
  const r = T.ocrPageText(DATA(
    L(90, W('上', 90), W('訴', 90), W('人', 90), W('王小明', 90)),
    L(90, W('上列當事人間請求返還價金事件，上訴人對於中華', 90)),
    L(90, W('民國一一三年三月一日判決提起上訴，本院判決如', 90)),
    L(90, W('下：', 90)),
    L(90, W('一、上訴人主張：兩造於民國一一二年六月一日簽', 90)),
    L(90, W('訂買賣契約。', 90))));
  assert.strictEqual(r.text, '上訴人王小明\n上列當事人間請求返還價金事件，上訴人對於中華民國一一三年三月一日判決提起上訴，本院判決如下：\n一、上訴人主張：兩造於民國一一二年六月一日簽訂買賣契約。');
  assert.strictEqual(r.skipped, 0);
});
ok('OCR 後處理：亂碼行（低信心、中文少）丟掉並計數，正常行留下', () => {
  const r = T.ocrPageText(DATA(L(88, W('被上訴人則以上訴人未依約驗收等語置辯。', 88)), L(5, W('-@e#', 5), W('OK', 5)), L(0, W('呈TEEEE', 0)), L(45, W('人', 45))));
  assert.strictEqual(r.text, '被上訴人則以上訴人未依約驗收等語置辯。'); assert.strictEqual(r.skipped, 3);
});
ok('OCR 後處理：低信心的字在標示版加〔?〕，送 AI 的版本不加', () => {
  const r = T.ocrPageText(DATA(L(80, { text: '汞認', symbols: [{ text: '汞', confidence: 30 }, { text: '認', confidence: 95 }] }, W('被上訴人', 95))));
  assert.strictEqual(r.text, '汞認被上訴人'); assert.strictEqual(r.marked, '汞〔?〕認被上訴人');
});
ok('OCR 後處理：沒有逐行資料時退回整頁文字', () => {
  assert.strictEqual(T.ocrPageText({ text: '被 告 應 給 付' }).text, '被告應給付');
});
ok('OCR 元件版本全部釘死（不會自動跳新版）', () => {
  for (const k of ['script', 'workerPath', 'corePath', 'langPath']) assert(/@\d+\.\d+\.\d+/.test(T.OCR[k]), k);
});
console.log(`\n全部通過（${n} 項）`);
