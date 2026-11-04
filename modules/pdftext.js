/* PDF 讀文字（AI 自動填、AI 智慧閱卷共用）
 *
 * 為什麼要有這支：台灣法院文件常用「沒有內嵌」的中文字型（細明體、標楷體），
 * pdf.js 要先下載對照表（CMap）才知道每個字碼是哪個中文字。之前沒告訴 pdf.js 對照表放哪，
 * 結果整份中文被丟掉、被誤判成掃描檔。這裡統一帶上對照表與標準字型的位置。
 *
 * 另外逐頁檢查：某頁幾乎沒有文字、但有圖片 → 標成「圖片頁」，讓畫面明確告訴使用者，不再默默漏掉。
 * 純函式（pageText、imagePagesNote）可在 node 測試：node tests/pdftext.test.js
 */
(function (root) {
  'use strict';
  const BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  const OPTIONS = { cMapUrl: BASE + 'cmaps/', cMapPacked: true, standardFontDataUrl: BASE + 'standard_fonts/' };
  const MIN_PAGE_CHARS = 5; // 一頁少於 5 個字（不算空白）就當「幾乎沒有文字」

  const squash = (s) => String(s || '').replace(/[\s　]+/g, '');

  // 把 pdf.js 的文字片段接成一頁文字。
  // 原本只看 hasEOL 換行；有些 PDF 換行時不帶 hasEOL，前後兩行會黏在一起，所以再看位置：往下移了就補換行。
  function pageText(items) {
    let out = ''; let lastY = null; let lastH = 0;
    for (const it of items || []) {
      if (!it || typeof it.str !== 'string') continue;
      const t = it.transform || [];
      const y = typeof t[5] === 'number' ? t[5] : null;
      const h = Math.abs(it.height || t[3] || 0) || 10;
      if (y !== null && lastY !== null && it.str && out && !out.endsWith('\n') && Math.abs(y - lastY) > Math.max(h, lastH) * 0.6) out += '\n';
      out += it.str;
      if (it.hasEOL) out += '\n';
      if (y !== null && it.str) { lastY = y; lastH = h; }
    }
    return out;
  }

  // 「第 2、5 頁是圖片、讀不到文字」
  function imagePagesNote(nums) {
    const list = (nums || []).filter((n) => Number.isFinite(n));
    if (!list.length) return '';
    return `第 ${list.join('、')} 頁是圖片、讀不到文字`;
  }

  function open(data) {
    const lib = root.pdfjsLib;
    if (!lib) throw new Error('PDF 讀取元件沒有載入（需要網路）');
    return lib.getDocument(Object.assign({ data }, OPTIONS)).promise;
  }

  // 這頁有沒有畫圖片（只對幾乎沒字的頁面檢查，省時間）
  async function hasImage(page) {
    const lib = root.pdfjsLib; const OPS = (lib && lib.OPS) || {};
    const want = new Set([OPS.paintImageXObject, OPS.paintInlineImageXObject, OPS.paintImageMaskXObject, OPS.paintJpegXObject, OPS.paintImageXObjectRepeat, OPS.paintInlineImageXObjectGroup].filter((x) => x !== undefined));
    try { const ol = await page.getOperatorList(); return ol.fnArray.some((f) => want.has(f)); } catch (e) { return false; }
  }

  // 讀整份 PDF：回傳 { pdf, numPages, pages:[{ n, text, chars, image }], imagePages:[頁碼], blankPages:[頁碼], chars }
  async function read(data) {
    const pdf = await open(data);
    const pages = []; const imagePages = []; const blankPages = []; let chars = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const text = pageText((await page.getTextContent()).items);
      const n = squash(text).length; chars += n;
      let image = false;
      if (n < MIN_PAGE_CHARS) { image = await hasImage(page); (image ? imagePages : blankPages).push(i); }
      pages.push({ n: i, text, chars: n, image });
    }
    return { pdf, numPages: pdf.numPages, pages, imagePages, blankPages, chars };
  }

  const api = { OPTIONS, MIN_PAGE_CHARS, pageText, imagePagesNote, open, read };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.LF_PdfText = api;
})(typeof window !== 'undefined' ? window : globalThis);
