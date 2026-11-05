/* 原圖檢視（收文登記的逐欄確認畫面用，2026-11-05）
 *
 * 原圖上的字才是原文，所以確認畫面以原圖為主：
 *   - panel()：右側大圖，多頁直排；點某一欄時捲到該頁，有座標就畫黃框
 *   - lightbox()：點原圖全螢幕放大，可縮放（滾輪、＋－）、拖曳、翻頁（← →），Esc 關閉
 *   - locate()：用「原文出處那一句」在各頁的字座標裡找位置（沿用 modules/pdftext.js 的模糊比對）
 * 頁面圖只在使用者自己的瀏覽器裡畫出來，不上傳。
 * 純函式 locate 可在 node 測試：node tests/doc-viewer.test.js
 */
(function (root) {
  'use strict';
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
  const squash = (s) => String(s || '').normalize('NFKC').replace(/[\s　]+/g, '');

  // ---------------------------------------------------------------- 找出處位置（純函式）
  /**
   * pages：[{ n, w, h, chars:[{c,li,x0,y0,x1,y1}] | null, text }]（座標＝頁面單位，左上角為原點）
   * 回傳 { page, rects:[{x0,y0,x1,y1}], score } ；找不到座標但某頁文字含有這句 → { page, rects:[] } ；都沒有 → null
   */
  function locate(pages, quote, P) {
    const q = String(quote || '');
    if (!q.trim() || !pages || !pages.length) return null;
    let best = null;
    if (P && P.matchQuote) {
      pages.forEach((pg) => {
        if (!pg.chars || !pg.chars.length) return;
        const m = P.matchQuote(pg.chars, q);
        if (m && m.score >= (P.MATCH_MIN || 0.6) && (!best || m.score > best.score)) best = { page: pg.n, rects: P.quoteRects(pg.chars, m.start, m.end), score: m.score };
      });
    }
    if (best) return best;
    const k = squash(q).slice(0, 12);
    if (k.length < 2) return null;
    const hit = pages.find((pg) => squash(pg.text).includes(k));
    return hit ? { page: hit.n, rects: [], score: 0 } : null;
  }

  // ---------------------------------------------------------------- 畫出頁面圖
  /** PDF 每頁畫成圖（寬約 1400 像素）。回傳 [{ n, url, w, h, px, py }]：w/h＝頁面單位，px/py＝圖片像素 */
  async function renderPdfPages(pdf, opts) {
    const o = opts || {}; const out = [];
    const want = o.width || 1400; const maxPages = o.maxPages || 30;
    for (let i = 1; i <= Math.min(pdf.numPages, maxPages); i++) {
      const page = await pdf.getPage(i);
      const v1 = page.getViewport({ scale: 1 });
      const s = Math.max(1, Math.min(3, want / v1.width));
      const vp = page.getViewport({ scale: s });
      const cv = root.document.createElement('canvas'); cv.width = Math.round(vp.width); cv.height = Math.round(vp.height);
      const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, cv.width, cv.height);
      await page.render({ canvasContext: g, viewport: vp }).promise;
      out.push({ n: i, url: cv.toDataURL('image/jpeg', 0.85), w: v1.width, h: v1.height, px: cv.width, py: cv.height });
      cv.width = cv.height = 0;
    }
    return out;
  }
  /** 照片：一頁，頁面單位＝照片原始像素 */
  function imagePage(dataUrl) {
    return new Promise((res) => {
      const im = new root.Image();
      im.onload = () => res([{ n: 1, url: dataUrl, w: im.naturalWidth, h: im.naturalHeight, px: im.naturalWidth, py: im.naturalHeight }]);
      im.onerror = () => res([]);
      im.src = dataUrl;
    });
  }

  // ---------------------------------------------------------------- 樣式（只給這個模組用的 class，不靠預先編好的 Tailwind）
  function ensureStyle() {
    const d = root.document; if (d.getElementById('dv-style')) return;
    const st = d.createElement('style'); st.id = 'dv-style';
    st.textContent = [
      '.dv-split{display:flex;gap:16px;align-items:flex-start}',
      '.dv-left{flex:0 0 36%;max-width:36%;min-width:0}',
      '.dv-right{flex:1 1 auto;min-width:0;position:sticky;top:8px}',
      '.dv-split.dv-noimg .dv-left{flex:1 1 auto;max-width:none}',
      '@media (max-width:767px){.dv-split{flex-direction:column}.dv-left{flex:1 1 auto;max-width:none;width:100%}.dv-right{position:static;width:100%}}',
      '.dv-field{padding:6px 8px;border-bottom:1px solid #e2e8f0;border-left:3px solid transparent;cursor:pointer}',
      '.dv-field:hover{background:#f8fafc}.dv-field.dv-active{background:#fefce8;border-left-color:#eab308}',
      '.dv-field .dv-l{font-size:12px;font-weight:600;color:#334155;margin-bottom:2px}',
      '.dv-quote{font-size:11px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;margin-top:1px}',
      '.dv-field.dv-active .dv-quote{white-space:normal;color:#64748b}',
      '.dv-bar{display:flex;align-items:center;gap:8px;font-size:12px;color:#64748b;margin-bottom:4px}',
      '.dv-bar button{border:1px solid #cbd5e1;border-radius:6px;padding:2px 10px;background:#fff;color:#334155}',
      '.dv-bar button:hover{background:#f1f5f9}',
      '.dv-scroll{max-height:82vh;overflow:auto;background:#e2e8f0;border:1px solid #cbd5e1;border-radius:8px;padding:8px}',
      '.dv-page{position:relative;margin:0 auto 8px;background:#fff;box-shadow:0 1px 3px rgba(0,0,0,.15);cursor:zoom-in}',
      '.dv-page img{display:block;width:100%;height:auto;user-select:none;-webkit-user-drag:none}',
      '.dv-page .dv-no{position:absolute;right:6px;bottom:4px;font-size:11px;color:#64748b;background:rgba(255,255,255,.85);padding:0 4px;border-radius:4px}',
      '.dv-mark{position:absolute;background:rgba(250,204,21,.35);outline:2px solid #eab308;border-radius:2px;pointer-events:none}',
      '.dv-hint{font-size:11px;color:#b45309;margin-top:4px;min-height:1em}',
      '#dv-lightbox{position:fixed;inset:0;z-index:9999;background:rgba(15,23,42,.92);display:flex;flex-direction:column}',
      '#dv-lightbox .dv-lb-bar{background:#0f172a;position:relative;z-index:1;display:flex;align-items:center;gap:8px;padding:8px 12px;color:#e2e8f0;font-size:14px;flex-wrap:wrap}',
      '#dv-lightbox .dv-lb-bar button{border:1px solid #475569;border-radius:6px;padding:4px 12px;background:#1e293b;color:#f1f5f9}',
      '#dv-lightbox .dv-lb-bar button:hover{background:#334155}#dv-lightbox .dv-lb-bar button:disabled{opacity:.35}',
      '#dv-lightbox .dv-lb-stage{flex:1;overflow:hidden;position:relative;cursor:grab;touch-action:none}',
      '#dv-lightbox .dv-lb-stage.dv-drag{cursor:grabbing}',
      '#dv-lightbox .dv-lb-inner{position:absolute;left:0;top:0;transform-origin:0 0;background:#fff}',
      '#dv-lightbox .dv-lb-inner img{display:block;width:100%;height:100%;user-select:none;-webkit-user-drag:none}',
    ].join('\n');
    d.head.appendChild(st);
  }
  const markHTML = (pg, rects) => (rects || []).map((r) => {
    const pad = 2;
    const l = ((r.x0 - pad) / pg.w) * 100, t = ((r.y0 - pad) / pg.h) * 100;
    const w = ((r.x1 - r.x0 + pad * 2) / pg.w) * 100, h = ((r.y1 - r.y0 + pad * 2) / pg.h) * 100;
    return `<div class="dv-mark" style="left:${l.toFixed(3)}%;top:${t.toFixed(3)}%;width:${w.toFixed(3)}%;height:${h.toFixed(3)}%"></div>`;
  }).join('');

  // ---------------------------------------------------------------- 右側原圖
  /** el：放原圖的容器；pages：renderPdfPages / imagePage 的結果。回傳 { show(n, rects, hint), open(n) } */
  function panel(el, pages, opts) {
    ensureStyle();
    const o = opts || {};
    const st = { n: 1, marks: {} };
    el.innerHTML = `
      <div class="dv-bar"><span>原圖（原文以原圖為準）</span><span data-dv-pos>第 1／${pages.length} 頁</span><button type="button" data-dv-zoom style="margin-left:auto">⤢ 放大檢視</button></div>
      <div class="dv-scroll" data-dv-scroll>${pages.map((pg) => `<div class="dv-page" data-dv-page="${pg.n}"><img src="${esc(pg.url)}" alt="原圖第 ${pg.n} 頁" draggable="false" /><div data-dv-marks></div><span class="dv-no">${pg.n}／${pages.length}</span></div>`).join('')}</div>
      <div class="dv-hint" data-dv-hint></div>`;
    const scroller = el.querySelector('[data-dv-scroll]');
    const posEl = el.querySelector('[data-dv-pos]');
    const pageEl = (n) => el.querySelector(`[data-dv-page="${n}"]`);
    const curPage = () => {
      const top = scroller.scrollTop + 40; let n = 1;
      pages.forEach((pg) => { const p = pageEl(pg.n); if (p && p.offsetTop - scroller.offsetTop <= top) n = pg.n; });
      return n;
    };
    scroller.addEventListener('scroll', () => { st.n = curPage(); posEl.textContent = `第 ${st.n}／${pages.length} 頁`; });
    el.querySelectorAll('[data-dv-page]').forEach((p) => p.addEventListener('click', () => api.open(Number(p.dataset.dvPage))));
    el.querySelector('[data-dv-zoom]').addEventListener('click', () => api.open(st.n));
    const api = {
      show(n, rects, hint) {
        el.querySelectorAll('[data-dv-marks]').forEach((m) => { m.innerHTML = ''; });
        st.marks = {};
        const pg = pages.find((x) => x.n === n);
        el.querySelector('[data-dv-hint]').textContent = hint || '';
        if (!pg) return;
        st.n = n; posEl.textContent = `第 ${n}／${pages.length} 頁`;
        const pe = pageEl(n); if (!pe) return;
        if (rects && rects.length) { st.marks[n] = rects; pe.querySelector('[data-dv-marks]').innerHTML = markHTML(pg, rects); }
        // 捲到該頁；有黃框就讓黃框落在可視範圍上方約 1/4 處
        const y0 = rects && rects.length ? Math.min(...rects.map((r) => r.y0)) / pg.h : 0;
        const target = pe.offsetTop - scroller.offsetTop + y0 * pe.offsetHeight - (rects && rects.length ? scroller.clientHeight / 4 : 8);
        scroller.scrollTop = Math.max(0, target);
      },
      open(n) { lightbox(pages, n || st.n, st.marks, o); },
      get page() { return st.n; },
    };
    return api;
  }

  // ---------------------------------------------------------------- 全螢幕放大檢視
  function lightbox(pages, startN, marks, opts) {
    ensureStyle();
    const d = root.document; const old = d.getElementById('dv-lightbox'); if (old) old.remove();
    const box = d.createElement('div'); box.id = 'dv-lightbox'; box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', '原圖放大檢視');
    box.innerHTML = `<div class="dv-lb-bar">
        <button type="button" data-lb="prev">‹ 上一頁</button><span data-lb="pos"></span><button type="button" data-lb="next">下一頁 ›</button>
        <span style="width:16px"></span>
        <button type="button" data-lb="out" title="縮小（-）">－</button><span data-lb="pct" style="min-width:3.5em;text-align:center"></span><button type="button" data-lb="in" title="放大（+）">＋</button>
        <button type="button" data-lb="fit">符合畫面</button><button type="button" data-lb="one">100%</button>
        <span style="margin-left:auto;font-size:12px;color:#94a3b8">滾輪縮放・拖曳移動・← → 翻頁</span>
        <button type="button" data-lb="close" title="關閉（Esc）">✕ 關閉（Esc）</button>
      </div>
      <div class="dv-lb-stage" data-lb="stage"><div class="dv-lb-inner" data-lb="inner"><img alt="" draggable="false" /><div data-lb="marks"></div></div></div>`;
    d.body.appendChild(box);
    const q = (k) => box.querySelector(`[data-lb="${k}"]`);
    const stage = q('stage'); const inner = q('inner'); const img = inner.querySelector('img');
    const v = { i: Math.max(0, pages.findIndex((p) => p.n === startN)), z: 1, x: 0, y: 0 };
    const apply = () => { inner.style.transform = `translate(${v.x}px,${v.y}px) scale(${v.z})`; q('pct').textContent = Math.round(v.z * 100) + '%'; };
    const fit = () => {
      const pg = pages[v.i]; const W = stage.clientWidth, Hh = stage.clientHeight;
      v.z = Math.min((W - 24) / pg.px, (Hh - 24) / pg.py); v.x = (W - pg.px * v.z) / 2; v.y = Math.max(12, (Hh - pg.py * v.z) / 2); apply();
    };
    const zoomAt = (f, cx, cy) => {
      const nz = Math.max(0.1, Math.min(8, v.z * f));
      v.x = cx - ((cx - v.x) * nz) / v.z; v.y = cy - ((cy - v.y) * nz) / v.z; v.z = nz; apply();
    };
    const center = () => [stage.clientWidth / 2, stage.clientHeight / 2];
    const show = (i) => {
      v.i = Math.max(0, Math.min(pages.length - 1, i)); const pg = pages[v.i];
      img.src = pg.url; img.alt = `原圖第 ${pg.n} 頁`;
      inner.style.width = pg.px + 'px'; inner.style.height = pg.py + 'px';
      q('marks').innerHTML = markHTML(pg, (marks || {})[pg.n]);
      q('pos').textContent = `第 ${pg.n}／${pages.length} 頁`;
      q('prev').disabled = v.i === 0; q('next').disabled = v.i === pages.length - 1;
      fit();
      // 有黃框：放大到黃框附近
      const r = ((marks || {})[pg.n] || [])[0];
      if (r) { const k = Math.min(2.5, Math.max(v.z, (stage.clientWidth * 0.6) / ((r.x1 - r.x0) / pg.w * pg.px))); const cx = ((r.x0 + r.x1) / 2 / pg.w) * pg.px, cy = ((r.y0 + r.y1) / 2 / pg.h) * pg.py; v.z = k; v.x = stage.clientWidth / 2 - cx * k; v.y = stage.clientHeight / 2 - cy * k; apply(); }
    };
    const close = () => { d.removeEventListener('keydown', onKey, true); root.removeEventListener('resize', fit); box.remove(); if (opts && opts.onClose) opts.onClose(); };
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'ArrowLeft' || e.key === 'PageUp') { e.preventDefault(); show(v.i - 1); }
      else if (e.key === 'ArrowRight' || e.key === 'PageDown') { e.preventDefault(); show(v.i + 1); }
      else if (e.key === '+' || e.key === '=') { e.preventDefault(); zoomAt(1.25, ...center()); }
      else if (e.key === '-' || e.key === '_') { e.preventDefault(); zoomAt(0.8, ...center()); }
    }
    d.addEventListener('keydown', onKey, true);
    root.addEventListener('resize', fit);
    q('close').addEventListener('click', close);
    q('prev').addEventListener('click', () => show(v.i - 1));
    q('next').addEventListener('click', () => show(v.i + 1));
    q('in').addEventListener('click', () => zoomAt(1.25, ...center()));
    q('out').addEventListener('click', () => zoomAt(0.8, ...center()));
    q('fit').addEventListener('click', fit);
    q('one').addEventListener('click', () => { const [cx, cy] = center(); zoomAt(1 / v.z, cx, cy); });
    stage.addEventListener('wheel', (e) => { e.preventDefault(); const b = stage.getBoundingClientRect(); zoomAt(e.deltaY < 0 ? 1.15 : 1 / 1.15, e.clientX - b.left, e.clientY - b.top); }, { passive: false });
    let drag = null;
    stage.addEventListener('pointerdown', (e) => { drag = { x: e.clientX - v.x, y: e.clientY - v.y }; stage.classList.add('dv-drag'); try { stage.setPointerCapture(e.pointerId); } catch (er) { /* ignore */ } });
    stage.addEventListener('pointermove', (e) => { if (!drag) return; v.x = e.clientX - drag.x; v.y = e.clientY - drag.y; apply(); });
    const end = () => { drag = null; stage.classList.remove('dv-drag'); };
    stage.addEventListener('pointerup', end); stage.addEventListener('pointercancel', end);
    show(v.i);
    return { close, show: (n) => show(pages.findIndex((p) => p.n === n)), get state() { return { page: pages[v.i].n, zoom: v.z, x: v.x, y: v.y }; } };
  }

  const api = { locate, renderPdfPages, imagePage, panel, lightbox, markHTML };
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (typeof window !== 'undefined') window.LF_DocViewer = api;
})(typeof window !== 'undefined' ? window : globalThis);
