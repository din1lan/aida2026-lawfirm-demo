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
    scale: 3,          // pdf.js 算圖倍率（A4 約 1786×2526 像素）
    colorDrop: true,   // 灰階時取 RGB 最亮的值：紅色印章、彩色對話框會變淡，黑字不受影響
    binarize: true,    // 用 Otsu 法自動決定門檻，轉成純黑白（去掉灰色雜點、底色）
    despeckle: true,   // 去掉孤立的小黑點（掃描雜點）
    psm: '',           // Tesseract 版面模式；空白＝預設（實測改 6 沒有差別）
    lowConf: 70,       // 單字信心低於這個分數，在標示版文字後面加〔?〕
    dropConf: 20,      // 整行信心低於這個分數（且中文比例不高或字很少）就當亂碼丟掉
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

  // ---- OCR 後處理：逐行整理 → 丟掉亂碼行 → 被切斷的行接回同一段；低信心的字在「標示版」後面加〔?〕 ----
  const HEAD_RE = /^(（[一二三四五六七八九十百]+）|\([一二三四五六七八九十0-9]+\)|[一二三四五六七八九十百]+、|[0-9０-９]+[、.．]|主文|理由|事實及理由|事實|據上論結|據上論斷|中華民國|審判長|法官|書記官|附表|附件|以上正本)/;
  const ROLE_RE = /^(被上訴人|上訴人|原告|被告|聲請人|相對人|抗告人|再抗告人|參加人|法定代理人|訴訟代理人|複代理人|選任辯護人|辯護人)/;
  const isHan = (c) => /[一-鿿○]/.test(c);
  // 行頭的雜點（“ ” - . 。 等）、行尾黏在中文後面的 1～3 個英文字母或單一數字（「如下1」「虛構）ee」）、行尾多出的半形點拿掉
  function trimEdges(s) {
    return String(s || '')
      .replace(/^[“”"'‘’\-–—_.。,，·•:：;；\s]+(?=\S)/, '')
      .replace(/(?<=[\u4E00-\u9FFF）」。：；！？])[A-Za-z]{1,3}$/, '')
      .replace(/(?<=[\u4E00-\u9FFF）」：；！？])(?<![第條項款號年月日])[0-9]$/, '')
      .replace(/(?<=[\u4E00-\u9FFF。）])[.]+$/, '')
      .trim();
  }
  function ocrLines(data, opt) {
    opt = opt || {}; const low = opt.lowConf == null ? 60 : opt.lowConf;
    const out = [];
    ((data && data.blocks) || []).forEach((bl) => (bl.paragraphs || []).forEach((pa) => (pa.lines || []).forEach((ln) => {
      const ws = (ln.words || []).filter((w) => w && w.text);
      if (!ws.length) return;
      const plain = trimEdges(cleanOcr(ws.map((w) => w.text).join(' ')));
      const marked = trimEdges(cleanOcr(ws.map((w) => (w.symbols && w.symbols.length ? w.symbols.map((s) => s.text + (s.confidence < low && /[一-鿿0-9]/.test(s.text) ? '〔?〕' : '')).join('') : w.text)).join(' ')));
      const nz = squash(plain); if (!nz) return;
      const han = [...nz].filter(isHan).length;
      out.push({ plain, marked, conf: typeof ln.confidence === 'number' ? ln.confidence : 100, hanRatio: han / [...nz].length, len: [...nz].length });
    })));
    return out;
  }
  // 亂碼行：信心很低，或中文比例低又信心不高，或只剩一兩個字又信心不高
  function isJunkLine(l, opt) {
    opt = opt || {};
    const hard = opt.dropConf == null ? 20 : opt.dropConf;
    if (l.conf < hard && (l.hanRatio < 0.85 || l.len <= 6)) return true;
    if (l.hanRatio < 0.5 && l.conf < 60) return true;
    if (l.len <= 2 && l.conf < 50) return true;
    return false;
  }
  // 被切斷的行接回同一段：遇到段落開頭（一、（一）主文 理由…）、短的當事人行，或上一行明顯比較短（段落最後一行）才換段
  function joinLines(lines) {
    const maxLen = Math.max(1, ...lines.map((l) => l.len));
    const paras = [];
    lines.forEach((l, i) => {
      const prev = lines[i - 1];
      const brk = !prev || HEAD_RE.test(squash(l.plain)) || (ROLE_RE.test(squash(l.plain)) && l.len < maxLen * 0.6) || prev.len < maxLen * 0.7 || /[：:]$/.test(prev.plain);
      if (brk) paras.push({ plain: l.plain, marked: l.marked });
      else { const p = paras[paras.length - 1]; p.plain += l.plain; p.marked += l.marked; }
    });
    return { text: paras.map((p) => p.plain).join('\n'), marked: paras.map((p) => p.marked).join('\n') };
  }
  function ocrPageText(data, opt) {
    const all = ocrLines(data, opt);
    const keep = all.filter((l) => !isJunkLine(l, opt));
    if (!all.length) { const t = cleanOcr((data && data.text) || ''); return { text: t, marked: t, skipped: 0 }; }
    const j = joinLines(keep);
    return { text: j.text, marked: j.marked, skipped: all.length - keep.length };
  }

  // ---- 紙本印的東西（不是正文）：左右邊界行號 01～31、頁底文件序號（16～20 碼英數）、單獨頁碼 ----
  // 只刪「整行就是這些」或「句尾空白後的 2 位數行號」；正文裡的金額、日期、條號、卷頁不動
  const NUM_UNIT = '[年月日時分秒元萬億千百條項款目頁號卷冊歲人件次個位筆張份週天成%％]';
  function stripPrintMarks(text) {
    let removed = 0;
    const lines = String(text || '').split('\n');
    const out = [];
    for (let line of lines) {
      const t = line.trim();
      if (t && (
        /^\d{1,2}$/.test(t) ||                                                         // 行號 01、2
        /^[-－—–~～]?\s*\d{1,3}\s*[-－—–~～]?$/.test(t) ||                           // 頁碼 - 3 -、12
        /^第\s*\d{1,4}\s*頁(\s*[，,／/、]?\s*共\s*\d{1,4}\s*頁)?$/.test(t) ||       // 第 3 頁，共 12 頁
        /^\d{1,4}\s*[\/／]\s*\d{1,4}$/.test(t) ||                                     // 3/12
        /^(?=[0-9A-Za-z]*[A-Za-z])(?=[0-9A-Za-z]*\d)[0-9A-Za-z]{12,24}$/.test(t)       // 0000PCD416DAA173A3AA
      )) { removed++; continue; }
      const before = line;
      // 句尾「空白＋2 位數行號」：前面是中文或標點，而且不是「新臺幣 50」「第 12」這種
      line = line.replace(new RegExp(`(?<=[\\u4e00-\\u9fff，。、；：）」』！？])(?<![幣第共約計逾達為至及約前後])[ \\t\\u3000]+\\d{2}[ \\t\\u3000]*$`), '');
      // 行頭「2 位數行號＋空白」：後面不是單位（「12 月」「50 萬元」不動）
      line = line.replace(new RegExp(`^[ \\t\\u3000]*\\d{2}[ \\t\\u3000]+(?=[\\u4e00-\\u9fff（「])(?!${NUM_UNIT})`), '');
      if (line !== before) removed++;
      out.push(line);
    }
    return { text: out.join('\n').replace(/\n{3,}/g, '\n\n').trim(), removed };
  }

  // 「第 2、5 頁為 OCR 辨識，可能有錯字，請核對原文」
  function ocrPagesNote(nums) {
    const list = (nums || []).filter((n) => Number.isFinite(n));
    return list.length ? `第 ${list.join('、')} 頁為 OCR 辨識，${OCR_NOTE}` : '';
  }

  // 「第 2 頁有 3 行、第 4 頁有 1 行無法辨識，已略過」
  function skippedNote(pages) {
    const list = (pages || []).filter((p) => p && p.skippedLines > 0);
    return list.length ? list.map((p) => `第 ${p.n} 頁有 ${p.skippedLines} 行`).join('、') + '無法辨識，已略過' : '';
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

  // 辨識前處理（純函式，直接改 rgba）：灰階 →（可選）Otsu 二值化 →（可選）去孤立雜點。回傳使用的門檻
  function preprocess(rgba, w, h, opt) {
    opt = opt || {};
    const n = w * h; const g = new Uint8Array(n); const hist = new Uint32Array(256);
    for (let i = 0; i < n; i++) {
      const r = rgba[i * 4], gg = rgba[i * 4 + 1], b = rgba[i * 4 + 2];
      const v = opt.colorDrop ? Math.max(r, gg, b) : Math.round(0.299 * r + 0.587 * gg + 0.114 * b);
      g[i] = v; hist[v]++;
    }
    let th = -1;
    if (opt.binarize) {
      let sum = 0; for (let t = 0; t < 256; t++) sum += t * hist[t];
      let sumB = 0, wB = 0, best = -1;
      for (let t = 0; t < 256; t++) {
        wB += hist[t]; if (!wB) continue; const wF = n - wB; if (!wF) break;
        sumB += t * hist[t]; const mB = sumB / wB, mF = (sum - sumB) / wF; const between = wB * wF * (mB - mF) * (mB - mF);
        if (between > best) { best = between; th = t; }
      }
      for (let i = 0; i < n; i++) g[i] = g[i] <= th ? 0 : 255;
      if (opt.despeckle) {
        const src = g.slice();
        for (let y = 1; y < h - 1; y++) for (let x = 1; x < w - 1; x++) {
          const i = y * w + x; if (src[i]) continue;
          let dark = 0; for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dy || dx) && !src[i + dy * w + dx]) dark++;
          if (dark <= 1) g[i] = 255;
        }
      }
    }
    for (let i = 0; i < n; i++) { rgba[i * 4] = rgba[i * 4 + 1] = rgba[i * 4 + 2] = g[i]; rgba[i * 4 + 3] = 255; }
    return th;
  }

  async function renderToCanvas(page) {
    const vp = page.getViewport({ scale: OCR.scale || 3 });
    const cv = document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
    const ctx = cv.getContext('2d'); ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, cv.width, cv.height);
    await page.render({ canvasContext: ctx, viewport: vp }).promise;
    if (OCR.colorDrop || OCR.binarize) {
      const im = ctx.getImageData(0, 0, cv.width, cv.height);
      preprocess(im.data, cv.width, cv.height, OCR);
      ctx.putImageData(im, 0, 0);
    }
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
        if (OCR.psm) await worker.setParameters({ tessedit_pageseg_mode: String(OCR.psm) });
        for (let k = 0; k < ocrTodo.length; k++) {
          report(k);
          const pg = pages[ocrTodo[k] - 1];
          const cv = await renderToCanvas(await pdf.getPage(pg.n));
          const r = await worker.recognize(cv, {}, { text: true, blocks: true });
          const res = ocrPageText(r && r.data, OCR);
          const n = squash(res.text).length;
          if (n >= MIN_PAGE_CHARS) { pg.text = res.text; pg.marked = res.marked; pg.skippedLines = res.skipped; pg.chars = n; pg.image = false; pg.ocr = true; chars += n; ocrPages.push(pg.n); }
          cv.width = cv.height = 0;
        }
        report(ocrTodo.length);
      } catch (e) { ocrError = (e && e.message) || String(e); }
      finally { if (worker) { try { await worker.terminate(); } catch (e) { /* ignore */ } } ocrMs = Date.now() - t0; }
    }
    // 辨識出來的頁（Gemini 與本機 OCR 共用）：拿掉紙本上印的行號、頁碼、文件序號
    let printMarks = 0;
    pages.filter((pg) => pg.ocr || pg.gemini).forEach((pg) => {
      const a = stripPrintMarks(pg.text); printMarks += a.removed; pg.text = a.text;
      if (pg.marked) pg.marked = stripPrintMarks(pg.marked).text;
      const n = squash(pg.text).length; chars += n - pg.chars; pg.chars = n;
    });
    const stillImage = ocrTodo.filter((n) => !ocrPages.includes(n));
    return { printMarks, pdf, numPages: pdf.numPages, pages, imagePages: stillImage, ocrPages, blankPages, chars, ocrError, ocrMs, geminiPages: remote.pages, geminiError: remote.error || '' };
  }

  const api = { OPTIONS, OCR, MIN_PAGE_CHARS, pageText, imagePagesNote, ocrPagesNote, cleanOcr, ocrPageText, isJunkLine, joinLines, preprocess, skippedNote, stripPrintMarks, open, read };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.LF_PdfText = api;
})(typeof window !== 'undefined' ? window : globalThis);
