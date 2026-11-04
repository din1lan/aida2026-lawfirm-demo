/*
 * 客戶進度回報草稿（範本版）
 * 規格：docs/進度回報-規格.md
 *
 * 只產生草稿文字，不寄出、不連網、不用 AI。
 * 瀏覽器：window.ProgressReport；Node：module.exports（給測試用）。
 */
(function (root) {
  'use strict';

  var CLOSING = '如有疑問，歡迎與我們聯絡。';
  var UPCOMING_DEADLINE_DAYS = 30;
  var MAX_DEADLINES = 3;
  var MAX_ITEM_LEN = 40;

  // 各訴訟階段的白話說明
  var STAGE_TEXT = {
    '委任': '我們已完成委任手續，目前正在整理資料、規劃後續處理方式。',
    '起訴': '本案已進入法院程序（起訴階段），由法院受理中。',
    '一審': '本案目前在第一審法院審理中。',
    '二審': '本案目前在第二審（上訴）法院審理中。',
    '三審': '本案目前在第三審法院審理中。',
    '執行': '本案目前進入強制執行程序，也就是請法院協助實際執行。',
    '已結案': '本案已經結案。',
  };

  var WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六'];

  // 給律師的提醒（不自動刪，只提醒）
  var RISKY_WORDS = ['保證', '一定會', '一定能', '必定', '必勝', '穩贏', '勝訴', '有把握', '包贏', '絕對'];
  var ID_RE = /[A-Z][12]\d{8}/;
  var PHONE_RE = /09\d{2}-?\d{3}-?\d{3}/;

  // ---------- 小工具 ----------
  function clean(v) {
    if (v === null || v === undefined) return '';
    var s = String(v).replace(/\s+/g, ' ').trim();
    if (/^(—|-|－|無|未填|undefined|null|NaN)$/i.test(s)) return '';
    return s;
  }
  function cap(s, n) { return s.length > n ? s.slice(0, n) + '…' : s; }
  function isISO(d) { return typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d) && !isNaN(Date.parse(d + 'T00:00:00Z')); }
  function dayDiff(a, b) { return Math.round((Date.parse(b + 'T00:00:00Z') - Date.parse(a + 'T00:00:00Z')) / 86400000); }

  function fmtDate(iso, today, forceYear) {
    var y = +iso.slice(0, 4), m = +iso.slice(5, 7), d = +iso.slice(8, 10);
    var wd = WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
    var showYear = forceYear || !isISO(today) || today.slice(0, 4) !== iso.slice(0, 4);
    return (showYear ? y + ' 年 ' : '') + m + ' 月 ' + d + ' 日（星期' + wd + '）';
  }
  function fmtTime(t) {
    var m = /^(\d{1,2}):(\d{2})/.exec(clean(t));
    if (!m) return '';
    var h = +m[1], mm = m[2];
    if (h > 23) return '';
    var part = h < 12 ? '上午' : (h < 18 ? '下午' : '晚上');
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return part + ' ' + h12 + ':' + mm;
  }
  function splitLines(s) {
    if (s === null || s === undefined) return [];
    return String(s).split(/\r?\n/).map(function (x) { return clean(x.replace(/^[\s・•\-*、\d.)]+/, '')); }).filter(Boolean);
  }

  // ---------- 核心：產生草稿文字（純函式） ----------
  function buildProgressReport(input) {
    input = input || {};
    var c = input.caseData || {};
    var notes = input.notes || {};
    var today = isISO(input.today) ? input.today : new Date().toISOString().slice(0, 10);
    var hearings = (input.hearings || []).filter(function (h) { return h && isISO(h.date); })
      .slice().sort(function (a, b) { return a.date.localeCompare(b.date) || String(a.time || '').localeCompare(String(b.time || '')); });
    // 只用給當事人看有意義的期限：main（動作期限）、general（一般法定期限）；
    // 排除系統內部的 reminder（提前提醒）、transcript（筆錄調閱）等事務所內部事項
    var deadlines = (input.deadlines || []).filter(function (d) {
      return d && isISO(d.computedDeadline) && (!d.kind || d.kind === 'main' || d.kind === 'general');
    });

    var out = [];
    var person = clean(c.person);
    out.push(person ? person + ' 您好：' : '您好：');

    var cause = clean(c.cause), no = clean(c.caseNumber);
    var subject = cause ? '「' + cap(cause, MAX_ITEM_LEN) + '」案件' : '您委託的案件';
    out.push('以下向您報告' + subject + (no ? '（案號 ' + no + '）' : '') + '目前的進度。');

    // 目前階段
    var stage = STAGE_TEXT[clean(c.status)] || '';
    if (c.mediationOngoing && clean(c.status) !== '已結案') stage += '目前雙方也在進行調解。';
    if (stage) out.push('【目前進度】\n' + stage);

    // 上次開庭（今天以前最近一場）
    var past = hearings.filter(function (h) { return h.date < today; });
    var last = past[past.length - 1];
    var lastResult = clean(notes.lastResult);
    if (last) {
      var lp = '【上次開庭】\n' + fmtDate(last.date, today) + '已開庭。';
      if (lastResult) lp += '\n結果：' + lastResult;
      out.push(lp);
    } else if (lastResult) {
      out.push('【上次開庭】\n' + lastResult);
    }

    // 下次開庭（今天起最近一場）
    var next = hearings.filter(function (h) { return h.date >= today; })[0];
    if (next) {
      var when = fmtDate(next.date, today, true);
      var tm = next.allDay ? '' : fmtTime(next.time);
      if (tm) when += tm;
      var court = clean(next.courtNameRaw) || clean(c.court);
      var room = clean(next.courtroom);
      var where = [court, room].filter(Boolean).join(' ');
      out.push('【下次開庭】\n' + when + (where ? '\n地點：' + where : '') + '\n開庭前我們會再與您確認是否需要到場。');
    }

    // 近期期限（今天起 30 天內，最多 3 筆）
    var seen = {};
    var soon = deadlines.filter(function (d) {
      var diff = dayDiff(today, d.computedDeadline);
      return diff >= 0 && diff <= UPCOMING_DEADLINE_DAYS;
    }).sort(function (a, b) { return a.computedDeadline.localeCompare(b.computedDeadline); })
      .map(function (d) {
        var action = clean(d.action), ev = clean(d.eventType);
        // general 期限的 eventType 是「觸發事件」（如：收到民事判決），要改寫成「…後的法定期限截止」
        if (d.kind === 'general' && !action) return { date: d.computedDeadline, what: ev ? cap(ev, MAX_ITEM_LEN) + '後的法定期限截止' : '', general: true };
        return { date: d.computedDeadline, what: cap(action || ev, MAX_ITEM_LEN) };
      })
      .filter(function (x) { var k = x.date + x.what; if (!x.what || seen[k]) return false; seen[k] = 1; return true; })
      .slice(0, MAX_DEADLINES);
    if (soon.length) {
      out.push('【近期重要日期】\n' + soon.map(function (x) { return '・' + fmtDate(x.date, today) + (x.general ? '：' : '前：') + x.what; }).join('\n'));
    }

    // 需要當事人配合
    var todo = splitLines(notes.clientTodo);
    if (todo.length) {
      out.push('【需要您協助準備】\n' + todo.map(function (x) { return '・' + x; }).join('\n') + '\n準備好後請與我們聯絡，我們再協助確認。');
    }

    out.push(CLOSING);

    var atts = (Array.isArray(c.attorneys) && c.attorneys.length ? c.attorneys : String(c.attorney || '').split('、'))
      .map(clean).filter(Boolean);
    if (atts.length) out.push(atts.join('、') + ' 敬上');

    return out.join('\n\n');
  }

  // 檢查律師可能要注意的字眼（只提醒，不改字）
  function checkDraft(text) {
    var s = String(text || '');
    var warns = [];
    var hits = RISKY_WORDS.filter(function (w) { return s.indexOf(w) >= 0; });
    if (hits.length) warns.push('草稿中有「' + hits.join('、') + '」，可能被當事人理解為對結果的保證，建議改寫。');
    if (ID_RE.test(s)) warns.push('草稿中疑似有身分證字號，傳送前請確認。');
    if (PHONE_RE.test(s)) warns.push('草稿中疑似有手機號碼，傳送前請確認。');
    if (s.indexOf(CLOSING) < 0) warns.push('結尾固定句「' + CLOSING + '」被刪掉了。');
    return warns;
  }

  // 預留：之後可接 AI 潤稿。fn(text) 回傳 Promise<string> 或 string。本版不設定。
  var polisher = null;
  function setPolisher(fn) { polisher = typeof fn === 'function' ? fn : null; }

  // ---------- 畫面（只在瀏覽器） ----------
  function h(s) { return String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, function (ch) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]; }); }

  function copyText(text, ta) {
    if (root.navigator && root.navigator.clipboard && root.navigator.clipboard.writeText) {
      return root.navigator.clipboard.writeText(text).then(function () { return true; }, function () { return fallbackCopy(ta); });
    }
    return Promise.resolve(fallbackCopy(ta));
  }
  function fallbackCopy(ta) {
    try { ta.focus(); ta.select(); return document.execCommand('copy'); } catch (e) { return false; }
  }

  /**
   * opts: { caseData, hearings, deadlines, today, onSaveNotes(notes) }
   */
  function open(opts) {
    opts = opts || {};
    var c = opts.caseData || {};
    var saved = c.progressReportNotes || {};
    var old = document.getElementById('pr-modal');
    if (old) old.remove();

    var wrap = document.createElement('div');
    wrap.id = 'pr-modal';
    wrap.setAttribute('role', 'dialog');
    wrap.setAttribute('aria-label', '客戶進度回報草稿');
    wrap.style.cssText = 'position:fixed;inset:0;z-index:70;background:rgba(15,23,42,.55);display:flex;align-items:center;justify-content:center;padding:16px;';
    wrap.innerHTML =
      '<div style="background:#fff;border-radius:12px;box-shadow:0 10px 30px rgba(0,0,0,.25);width:100%;max-width:720px;max-height:100%;overflow:auto;padding:20px;font-size:14px;color:#334155;box-sizing:border-box;font-family:system-ui,-apple-system,Noto Sans TC,Microsoft JhengHei,sans-serif;">' +
        '<div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;">' +
          '<div><div style="font-weight:700;font-size:16px;color:#0f172a;">📨 客戶進度回報草稿</div>' +
          '<div style="font-size:12px;color:#64748b;margin-top:2px;">' + h(clean(c.caseNumber)) + ' ' + h(clean(c.title)) + '｜系統不會自動寄出，請複製後自行貼到 LINE 或 Email</div></div>' +
          '<button type="button" id="pr-close" aria-label="關閉" style="font-size:20px;color:#94a3b8;background:none;border:0;cursor:pointer;">✕</button>' +
        '</div>' +
        '<div style="display:grid;grid-template-columns:repeat(auto-fit,minmax(240px,1fr));gap:10px;margin-top:12px;">' +
          '<label style="font-size:12px;color:#64748b;">最近一次開庭結果（選填，白話寫）<textarea id="pr-last" rows="3" style="box-sizing:border-box;font-family:inherit;display:block;width:100%;margin-top:4px;border:1px solid #cbd5e1;border-radius:6px;padding:6px;font-size:13px;" placeholder="例：法官請雙方補提資料，下次開庭再審理">' + h(saved.lastResult || '') + '</textarea></label>' +
          '<label style="font-size:12px;color:#64748b;">需要當事人準備的事（選填，一行一項）<textarea id="pr-todo" rows="3" style="box-sizing:border-box;font-family:inherit;display:block;width:100%;margin-top:4px;border:1px solid #cbd5e1;border-radius:6px;padding:6px;font-size:13px;" placeholder="例：醫療收據正本">' + h(saved.clientTodo || '') + '</textarea></label>' +
        '</div>' +
        '<div style="font-size:12px;color:#64748b;margin-top:10px;">草稿（可直接修改）</div>' +
        '<textarea id="pr-draft" rows="22" style="box-sizing:border-box;font-family:inherit;display:block;width:100%;margin-top:4px;border:1px solid #a5b4fc;border-radius:6px;padding:10px;font-size:14px;line-height:1.6;"></textarea>' +
        '<div id="pr-warn" style="display:none;margin-top:8px;font-size:12px;background:#fffbeb;border:1px solid #fcd34d;color:#92400e;border-radius:6px;padding:8px;"></div>' +
        '<div style="display:flex;justify-content:space-between;align-items:center;gap:8px;margin-top:12px;flex-wrap:wrap;">' +
          '<button type="button" id="pr-regen" style="font-size:13px;padding:6px 12px;border:1px solid #cbd5e1;border-radius:6px;background:#fff;cursor:pointer;">↺ 依資料重新產生</button>' +
          '<div style="display:flex;align-items:center;gap:8px;">' +
            '<span id="pr-status" style="font-size:12px;color:#059669;"></span>' +
            (polisher ? '<button type="button" id="pr-polish" style="font-size:13px;padding:6px 12px;border:1px solid #a5b4fc;border-radius:6px;background:#eef2ff;cursor:pointer;">✨ AI 潤稿</button>' : '') +
            '<button type="button" id="pr-copy" style="font-size:13px;padding:6px 16px;border:0;border-radius:6px;background:#1e293b;color:#fff;cursor:pointer;">📋 複製</button>' +
          '</div>' +
        '</div>' +
      '</div>';
    document.body.appendChild(wrap);

    var $ = function (id) { return document.getElementById(id); };
    var draft = $('pr-draft'), last = $('pr-last'), todo = $('pr-todo'), warn = $('pr-warn'), status = $('pr-status');
    var edited = false;

    function notes() { return { lastResult: last.value, clientTodo: todo.value }; }
    function showWarn() {
      var w = checkDraft(draft.value);
      warn.style.display = w.length ? 'block' : 'none';
      warn.innerHTML = w.map(function (x) { return '⚠ ' + h(x); }).join('<br>');
    }
    function regen() {
      draft.value = buildProgressReport({ caseData: c, hearings: opts.hearings, deadlines: opts.deadlines, notes: notes(), today: opts.today });
      edited = false;
      showWarn();
    }
    function saveNotes() {
      if (typeof opts.onSaveNotes === 'function') {
        try { opts.onSaveNotes({ lastResult: last.value.trim(), clientTodo: todo.value.trim() }); } catch (e) { /* 存不了也不影響草稿 */ }
      }
    }
    function onNotes() {
      saveNotes();
      if (edited && !root.confirm('草稿已手動修改過，要依新資料重新產生嗎？（手動修改會被覆蓋）')) return;
      regen();
    }
    function close() { saveNotes(); wrap.remove(); }

    last.addEventListener('change', onNotes);
    todo.addEventListener('change', onNotes);
    draft.addEventListener('input', function () { edited = true; status.textContent = ''; showWarn(); });
    $('pr-regen').addEventListener('click', function () {
      if (edited && !root.confirm('要放棄手動修改，依資料重新產生嗎？')) return;
      regen();
    });
    $('pr-copy').addEventListener('click', function () {
      copyText(draft.value, draft).then(function (ok) {
        status.style.color = ok ? '#059669' : '#b45309';
        status.textContent = ok ? '✓ 已複製，可貼到 LINE 或 Email' : '無法自動複製，請在草稿框按 Ctrl+A、Ctrl+C';
      });
    });
    if (polisher && $('pr-polish')) {
      $('pr-polish').addEventListener('click', function () {
        status.textContent = '潤稿中…';
        Promise.resolve(polisher(draft.value)).then(function (t) {
          if (typeof t === 'string' && t.trim()) { draft.value = t; edited = true; showWarn(); }
          status.textContent = '';
        }, function () { status.textContent = '潤稿失敗，草稿未變更'; });
      });
    }
    $('pr-close').addEventListener('click', close);
    wrap.addEventListener('click', function (e) { if (e.target === wrap) close(); });

    regen();
    return wrap;
  }

  var api = {
    buildProgressReport: buildProgressReport,
    checkDraft: checkDraft,
    setPolisher: setPolisher,
    open: open,
    CLOSING: CLOSING,
    STAGE_TEXT: STAGE_TEXT,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  if (root && typeof root === 'object' && root.document) root.ProgressReport = api;
})(typeof window !== 'undefined' ? window : this);
