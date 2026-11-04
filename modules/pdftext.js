/* PDF 讀文字（AI 自動填、AI 智慧閱卷共用）
 *
 * 為什麼要有這支：台灣法院文件常用「沒有內嵌」的中文字型（細明體、標楷體），
 * pdf.js 要先下載對照表（CMap）才知道每個字碼是哪個中文字。之前沒告訴 pdf.js 對照表放哪，
 * 結果整份中文被丟掉、被誤判成掃描檔。這裡統一帶上對照表與標準字型的位置。
 *
 * 另外逐頁檢查：某頁幾乎沒有文字、但有圖片（掃描檔）→ 在使用者自己的瀏覽器裡做文字辨識（OCR，Tesseract.js 繁體中文）。
 * 圖片不送到任何伺服器；只從 CDN 下載辨識程式與繁中語言檔（第一次約 3MB 傳輸量、解開約 5.8MB，之後瀏覽器會快取）。
 * 辨識失敗（例如沒網路）就照舊標成「圖片頁」，讓畫面明確告訴使用者，不默默漏掉。
 * 純函式（pageText、imagePagesNote、ocrPagesNote、cleanOcr）可在 node 測試：node tests/pdftext.test.js
 */
(function (root) {
  'use strict';
  const BASE = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  const OPTIONS = { cMapUrl: BASE + 'cmaps/', cMapPacked: true, standardFontDataUrl: BASE + 'standard_fonts/' };
  const MIN_PAGE_CHARS = 5; // 一頁少於 5 個字（不算空白）就當「幾乎沒有文字」
  // 文字辨識（OCR）元件：全部釘死版本，從 jsDelivr 下載
  const OCR = {
    script: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js',
    workerPath: 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/worker.min.js',
    corePath: 'https://cdn.jsdelivr.net/npm/tesseract.js-core@5.1.1',
    langPath: 'https://cdn.jsdelivr.net/npm/@tesseract.js-data/chi_tra@1.0.0/4.0.0_best_int',
    lang: 'chi_tra',
    maxWidth: 2200, // 渲染成圖片的最大寬度（像素）：太小辨識差，太大很慢
  };
  const OCR_NOTE = '可能有錯字，請核對原文';

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

  // 中文 OCR 結果常在字和字之間夾空白（「被 告 應 給 付」），把中文之間的空白拿掉
  const CJK = '\u2E80-\u9FFF\uF900-\uFAFF\uFF00-\uFFEF\u3000-\u303F\u25CB\u25EF';
  const HAN = '\u4E00-\u9FFF';
  function cleanOcr(s) {
    const squeeze = (x) => x
      // Tesseract 在每個中文字之間都放空白，一律拿掉（原文真正的間隔由 ocrLinesText 依位置補成全形空格）；緊貼標點的空白也拿掉
      .replace(new RegExp(`([${CJK}])[ \\t]+(?=[${CJK}])`, 'g'), '$1')
      .replace(/[\u3000 \t]+(?=[，。、：；（）「」！？])|([，。、：；（「])[\u3000 \t]+/g, '$1')
      .replace(new RegExp(`([${CJK}])[ \\t]+(?=[0-9A-Za-z])|([0-9A-Za-z])[ \\t]+(?=[${CJK}])`, 'g'), '$1$2')
      .replace(/(\d)[ \t]+(?=[\d,，.])/g, '$1').replace(/([,，.])[ \t]+(?=\d)/g, '$1');
    let t = String(s || '').replace(/\r/g, '');
    // 掃描雜點被認成的孤立符號（前後都是空白或行頭行尾）：_ | [ ] “ ” 等
    t = t.replace(/(^|[ \t])[_|\[\]“”"‘’`~^]+(?=[ \t]|$)/gm, '$1');
    t = squeeze(t);
    // 中文文件的半形標點轉全形（數字中間的逗點保留）
    t = t.replace(/(?<!\d),|,(?!\d)/g, '，').replace(/:/g, '：').replace(/;/g, '；').replace(/\(/g, '（').replace(/\)/g, '）');
    t = squeeze(t);
    t = t.replace(/([）」』])[\]\[|]+/g, '$1'); // 「（虛構）]」這類黏在括號後的雜點
    // 去識別化的「○○」常被認成 00、OO：只在中文字後面、2～3 個、後面不是數字時才換回
    t = t.replace(new RegExp(`([${HAN}])[0OoＯ〇○]{2,3}(?![0-9０-９,，.])`, 'g'), (m, h) => h + '○'.repeat(m.length - 1));
    return t.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
  }

  // 用辨識結果的字詞位置組回每一行：字距明顯比字高的 6 成還寬，才當作原文的間隔（例如「原告　甲○○」）
  function ocrLinesText(data) {
    const lines = [];
    ((data && data.blocks) || []).forEach((bl) => (bl.paragraphs || []).forEach((pa, pi) => {
      if (pi > 0 || lines.length) lines.push('');
      (pa.lines || []).forEach((ln) => {
        const ws = (ln.words || []).filter((w) => w && w.text && w.bbox);
        if (!ws.length) return;
        const hs = ws.map((w) => w.bbox.y1 - w.bbox.y0).sort((a, b) => a - b); const h = hs[Math.floor(hs.length / 2)] || 1;
        let out = ws[0].text;
        for (let i = 1; i < ws.length; i++) { const gap = ws[i].bbox.x0 - ws[i - 1].bbox.x1; out += gap > h * 0.6 ? '\u3000' : ' '; out += ws[i].text; }
        lines.push(out);
      });
    }));
    return lines.length ? lines.join('\n') : String((data && data.text) || '');
  }

  // 「第 2、5 頁為 OCR 辨識，可能有錯字，請核對原文」
  function ocrPagesNote(nums) {
    const list = (nums || []).filter((n) => Number.isFinite(n));
    return list.length ? `第 ${list.join('、')} 頁為 OCR 辨識，${OCR_NOTE}` : '';
  }

  let tessLoading = null;
  function loadTesseract() {
    if (root.Tesseract) return Promise.resolve(root.Tesseract);
    if (typeof document === 'undefined') return Promise.reject(new Error('沒有瀏覽器環境'));
    if (!tessLoading) {
      tessLoading = new Promise((resolve, reject) => {
        const el = document.createElement('script'); el.src = OCR.script; el.async = true;
        el.onload = () => (root.Tesseract ? resolve(root.Tesseract) : reject(new Error('文字辨識元件載入失敗')));
        el.onerror = () => { tessLoading = null; el.remove(); reject(new Error('文字辨識元件載入失敗（需要網路）')); };
        document.head.appendChild(el);
      });
    }
    return tessLoading;
  }

  async function renderToCanvas(page) {
    const vp0 = page.getViewport({ scale: 1 });
    const scale = Math.min(3, Math.max(1, OCR.maxWidth / vp0.width));
    const vp = page.getViewport({ scale });
    const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    return cv;
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

  // 讀整份 PDF：回傳 { pdf, numPages, pages:[{ n, text, chars, image, ocr }], imagePages, ocrPages, blankPages, chars, ocrError, ocrMs }
  //   imagePages＝最後仍讀不到字的圖片頁；ocrPages＝靠 OCR 讀到字的頁
  //   opts.ocr（預設 true）：圖片頁要不要做 OCR；opts.remoteOcr（可選）：先送 Gemini，見 modules/gemini-ocr.js；opts.onProgress({ done, total, page })：辨識進度
  async function read(data, opts) {
    opts = opts || {};
    const pdf = await open(data);
    const pages = []; const imagePages = []; const blankPages = []; let chars = 0;
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const text = pageText((await page.getTextContent()).items);
      const n = squash(text).length; chars += n;
      let image = false;
      if (n < MIN_PAGE_CHARS) { image = await hasImage(page); (image ? imagePages : blankPages).push(i); }
      pages.push({ n: i, text, chars: n, image, ocr: false });
    }
    // 可選：使用者勾選「掃描頁用 Gemini 辨識」時，先送 Gemini（modules/gemini-ocr.js）；沒成功的頁才走下面的本機 OCR
    let remote = { pages: [], error: '' };
    if (imagePages.length && opts.remoteOcr) {
      try { remote = (await opts.remoteOcr({ pdf, pages, imagePages: imagePages.slice(), renderToCanvas })) || remote; } catch (e) { remote = { pages: [], error: (e && e.message) || String(e) }; }
      remote.pages.forEach((n) => { chars += pages[n - 1].chars; });
    }
    const ocrTodo = imagePages.filter((n) => !remote.pages.includes(n));
    const ocrPages = []; let ocrError = ''; let ocrMs = 0;
    if (ocrTodo.length && opts.ocr !== false) {
      const t0 = Date.now(); let worker = null;
      try {
        const report = (done) => { if (opts.onProgress) { try { opts.onProgress({ done, total: ocrTodo.length, page: ocrTodo[done] || null }); } catch (e) { /* ignore */ } } };
        report(0);
        const T = await loadTesseract();
        worker = await T.createWorker(OCR.lang, 1, { workerPath: OCR.workerPath, corePath: OCR.corePath, langPath: OCR.langPath });
        for (let k = 0; k < ocrTodo.length; k++) {
          report(k);
          const pg = pages[ocrTodo[k] - 1];
          const cv = await renderToCanvas(await pdf.getPage(pg.n));
          const r = await worker.recognize(cv, {}, { text: true, blocks: true });
          const text = cleanOcr(ocrLinesText(r && r.data));
          const n = squash(text).length;
          if (n >= MIN_PAGE_CHARS) { pg.text = text; pg.chars = n; pg.image = false; pg.ocr = true; chars += n; ocrPages.push(pg.n); }
          cv.width = cv.height = 0;
        }
        report(ocrTodo.length);
      } catch (e) { ocrError = (e && e.message) || String(e); }
      finally { if (worker) { try { await worker.terminate(); } catch (e) { /* ignore */ } } ocrMs = Date.now() - t0; }
    }
    const stillImage = ocrTodo.filter((n) => !ocrPages.includes(n));
    return { pdf, numPages: pdf.numPages, pages, imagePages: stillImage, ocrPages, blankPages, chars, ocrError, ocrMs, geminiPages: remote.pages, geminiError: remote.error || '' };
  }

  const api = { OPTIONS, OCR, MIN_PAGE_CHARS, pageText, imagePagesNote, ocrPagesNote, cleanOcr, ocrLinesText, open, read };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.LF_PdfText = api;
})(typeof window !== 'undefined' ? window : globalThis);
