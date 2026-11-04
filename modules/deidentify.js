/* ==========================================================================
 * 去識別化模組（送 AI 前遮個資、AI 回來後還原）
 * 規格：docs/去識別化-規格.md
 *
 * 對外只有：
 *   deidentify(text, knownNames, options) → { text, map, items }
 *   reidentify(text, map)                 → 還原後的文字
 *   reidentifyDeep(obj, map)              → 把物件裡所有字串都還原（AI 回傳的 JSON 用）
 *   findLeftoverTokens(text, map)         → 還原後仍殘留、認不出的代號
 *   knownNamesFromCase(caseRecord)        → 從案件資料整理出已知名單
 *
 * 鐵則：這個模組不寫任何儲存（localStorage 等）、不連網、不印 console。
 *       對照表（map）只是一般物件，由呼叫端用完即丟。
 * 瀏覽器：<script src="modules/deidentify.js"> 之後用 window.Deid.xxx；Node：require('./modules/deidentify.js')
 * ========================================================================== */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.Deid = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const D = '[0-9０-９]';            // 半形或全形數字
  const HAN = '[\\u4e00-\\u9fff]';
  const NB = '(?<![0-9０-９])';      // 前面不是數字
  const NA = '(?![0-9０-９])';       // 後面不是數字
  const SEP = '[-\\u0020\\u3000]';   // 數字間的分隔（不跨行）

  // 常見姓氏（複姓放前面，比對時先試）
  const SURNAMES_2 = ['歐陽', '司馬', '上官', '諸葛', '東方', '皇甫', '尉遲', '公孫', '慕容', '長孫', '令狐', '夏侯', '司徒', '張簡', '范姜', '張廖'];
  // 只放常見、且不容易跟一般詞混淆的姓（「連帶」「程序」「方面」「向原告」會誤判，所以不放 連程方向 等字；罕見姓請用已知名單）
  const SURNAMES_1 = '陳林黃張李王吳劉蔡楊許鄭謝洪郭邱曾廖賴徐周葉蘇莊呂江何蕭羅高潘簡朱鍾游彭詹胡施沈余盧梁趙顏柯翁魏孫戴范宋鄧杜傅侯曹薛丁卓阮馬董温溫唐藍蔣紀姚馮歐湯康姜汪鄒巫鐘黎涂龔嚴韓袁陸柳凃邵錢伍倪譚駱熊秦顧俞雷粘饒闕崔尹辜褚殷賈';
  // 名字的字不會是這些（多半是虛詞、動詞）
  const GIVEN_STOP = new Set('稱述報情於與及和等之為係已應則向對即亦均自在就以因所並仍曾未主不是有無的了也都將被把請要會可能得須需另再又才尚依據如若雖但而且或到從給至由否所訴代理律原告'.split(''));
  // 角色字：後面接的通常是人名
  const ROLE_WORDS = ['再抗告人', '被上訴人', '訴訟代理人', '法定代理人', '選任辯護人', '複代理人', '上訴人', '被聲請人', '聲請人', '相對人', '告訴人', '告發人', '被告人', '抗告人', '債權人', '債務人', '辯護人', '代理人', '具狀人', '撰狀人', '申請人', '關係人', '當事人', '證人', '原告', '被告', '房東', '房客', '出租人', '承租人', '配偶', '受僱人', '僱用人', '委任人', '受任人', '連帶保證人', '保證人', '對造'];
  const TITLES = ['先生', '小姐', '女士', '太太'];
  const COMPANY_SUFFIX = '(?:股份有限公司|有限公司|企業社|實業社|商行)';
  const CITY = '(?:(?:臺北|台北|新北|桃園|臺中|台中|臺南|台南|高雄|基隆|新竹|嘉義)市|(?:新竹|苗栗|彰化|南投|雲林|嘉義|屏東|宜蘭|花蓮|臺東|台東|澎湖|金門|連江)縣)';
  const ROAD_CH = '[^\\s0-9０-９，。、；：:「」『』（）()【】\\[\\]住居設於在為址位至往從自寄送與及和之係即到是]';
  const NUMCH = '[0-9０-９一二三四五六七八九十]';
  const DOOR = `(?:${NUMCH}+段)?(?:${D}+巷)?(?:${D}+弄)?${D}+(?:之${D}+)?號(?:${D}+樓)?(?:之${D}+)?`;

  const LETTERS = (n) => { let s = ''; n += 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; };
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const toHalf = (s) => s.replace(/[０-９Ａ-Ｚａ-ｚ]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));

  // 姓名角色 → 代號標籤
  const ROLE_LABEL = { client: '當事人', opponent: '對造', related: '關係人', lawyer: '律師', company: '公司', person: '人名', other: '遮蔽' };
  const LABEL_OF = (r) => ROLE_LABEL[r] || (Object.values(ROLE_LABEL).includes(r) ? r : '人名');
  const PERSON_LABELS = ['當事人', '對造', '關係人', '律師', '人名'];

  // 從案件資料整理已知名單（欄位不存在就略過）
  function knownNamesFromCase(c) {
    if (!c) return [];
    const out = [];
    const add = (name, role) => {
      String(name || '').split(/[、,，;；\/]/).map((s) => s.trim().replace(/律師$/, '')).filter((s) => s.length >= 2 && s !== '—').forEach((n) => {
        out.push({ name: n, role: /(股份有限公司|有限公司|企業社|實業社|商行)$/.test(n) ? 'company' : role });
      });
    };
    add(c.person, 'client');
    add(c.clientName, 'client');
    add(c.opponentName, 'opponent');
    add(c.opponentAttorney, 'lawyer');
    (Array.isArray(c.attorneys) ? c.attorneys : [c.attorney]).forEach((a) => add(a, 'lawyer'));
    (Array.isArray(c.relatedParties) ? c.relatedParties : String(c.relatedParties || '').split(/[、,，]/)).forEach((r) => add(r && r.name ? r.name : r, 'related'));
    return out;
  }

  function normalizeKnown(knownNames) {
    const list = [];
    (knownNames || []).forEach((k) => {
      if (!k) return;
      const o = typeof k === 'string' ? { name: k, role: 'person' } : { name: k.name, role: k.role || 'person' };
      o.name = String(o.name || '').trim();
      if (o.name.length >= 2 && !list.some((x) => x.name === o.name)) list.push(o);
    });
    return list.sort((a, b) => b.name.length - a.name.length);
  }

  /**
   * 遮蔽
   * @param {string} text 原文
   * @param {Array<string|{name,role}>} knownNames 已知名單；role：client 當事人／opponent 對造／related 關係人／lawyer 律師／company 公司／person 人名／other 遮蔽
   * @param {{keep?: string[], useRules?: boolean}} options keep：律師在預覽取消勾選、不要遮的原文
   */
  function deidentify(text, knownNames, options) {
    const opt = Object.assign({ keep: [], useRules: true }, options || {});
    const keep = new Set(opt.keep || []);
    let t = String(text == null ? '' : text);

    const map = { entries: [] };           // { token, original, label, kind }
    const byOriginal = new Map();          // 原文 → entry
    const counters = {};                   // 標籤 → 已用幾個
    const personToken = new Map();         // 人名全名 → 代號（稱謂寫法共用）
    const counts = new Map();              // 原文 → 出現次數

    const newToken = (label, isPerson) => {
      const n = counters[label] || 0; counters[label] = n + 1;
      return `【${label}${isPerson ? LETTERS(n) : n + 1}】`;
    };
    const tokenFor = (original, label, kind) => {
      if (byOriginal.has(original)) return byOriginal.get(original).token;
      const isPerson = PERSON_LABELS.includes(label) || label === '公司' || label === '遮蔽';
      const e = { token: newToken(label, isPerson), original, label, kind };
      byOriginal.set(original, e); map.entries.push(e);
      return e.token;
    };
    const bump = (o) => counts.set(o, (counts.get(o) || 0) + 1);
    // 把 re 抓到的（或其中第 g 組）換成代號
    const sub = (re, label, kind, g) => {
      t = t.replace(re, (...m) => {
        const whole = m[0], part = g ? m[g] : whole;
        if (!part || keep.has(part.trim())) return whole;
        const p = part.trim();
        bump(p);
        return whole.replace(p, tokenFor(p, label, kind));
      });
    };

    // 1) 有固定格式的資料（先做，避免被人名規則切壞）
    sub(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, 'Email', 'email');
    sub(new RegExp(`(?<![A-Za-z0-9Ａ-Ｚａ-ｚ])[A-Za-zＡ-Ｚａ-ｚ][12891２８９]${D}{8}${NA}`, 'g'), '身分證', 'id');
    sub(new RegExp(`(?:帳號|帳戶|戶號|账号)\\s*[：:]?\\s*(?:為|是)?\\s*[：:]?\\s*((?:\\(${D}{3}\\)\\s*)?${D}(?:${D}|${SEP}){6,22}${D})`, 'g'), '帳號', 'account', 1);
    sub(new RegExp(`(?:營利事業統一編號|統一編號|統編)\\s*[：:]?\\s*(?:為|是)?\\s*[：:]?\\s*(${D}{8})${NA}`, 'g'), '統編', 'taxid', 1);
    // 手機：09xx-xxx-xxx、+886 9xx xxx xxx
    sub(new RegExp(`${NB}(?:(?:\\+|＋)?886${SEP}?|[0０])[9９]${D}{2}${SEP}?${D}{3}${SEP}?${D}{3}${NA}`, 'g'), '電話', 'phone');
    // 市話：(02)2345-6789、02-23456789、+886-2-2345-6789、可帶分機
    sub(new RegExp(`${NB}(?:(?:(?:\\+|＋)?886${SEP}?${D}{1,2}${SEP}?|[（(][0０]${D}{1,2}[）)]${SEP}?|[0０][2-8２-８]${D}?${SEP})${D}{3,4}${SEP}?${D}{4}|[0０][2-8２-８]${D}{7,8})(?:${SEP}?(?:#|＃|分機)${D}{1,5})?${NA}`, 'g'), '電話', 'phone');
    // 地址：有縣市（門牌可省略到路名）或「路街＋門牌號」；開頭若黏到角色字（原告、住）就切掉
    const addrSub = (re) => {
      t = t.replace(re, (whole) => {
        let a = whole;
        for (let changed = true; changed;) {
          changed = false;
          for (const w of ROLE_WORDS) if (a.startsWith(w) && a.length > w.length + 2) { a = a.slice(w.length); changed = true; }
        }
        if (keep.has(a)) return whole;
        bump(a);
        return whole.slice(0, whole.length - a.length) + tokenFor(a, '地址', 'address');
      });
    };
    addrSub(new RegExp(`${CITY}${HAN}{0,3}?(?:[區鄉鎮市])?(?:${HAN}{1,3}[里村](?:${D}+鄰)?)?${ROAD_CH}{1,6}?(?:路|街|大道)(?:${DOOR})?`, 'g'));
    addrSub(new RegExp(`${ROAD_CH}{1,7}?(?:路|街|大道)${DOOR}`, 'g'));

    // 2) 已知名單（長名先換）
    const known = normalizeKnown(knownNames);
    const nameRe = (name) => new RegExp(`${escRe(name)}(?![東西南北]?(?:路|街|大道|巷)|[一二三四五六七八九十]?段)`, 'g');
    known.forEach(({ name, role }) => {
      if (keep.has(name)) return;
      const label = LABEL_OF(role);
      const re = nameRe(name);
      if (!re.test(t)) { if (PERSON_LABELS.includes(label)) personToken.set(name, null); return; }
      t = t.replace(nameRe(name), () => { bump(name); return tokenFor(name, label, role === 'company' ? 'company' : 'name'); });
      if (PERSON_LABELS.includes(label)) personToken.set(name, byOriginal.get(name).token);
    });

    // 3) 規則補抓
    if (opt.useRules) {
      const found = []; // { name, label }
      const s2 = SURNAMES_2.map(escRe).join('|');
      const nameCore = `((?:${s2})${HAN}{1,2}|[${SURNAMES_1}]${HAN}{1,2})`;
      const trimName = (n) => {
        const sl = SURNAMES_2.some((s) => n.startsWith(s)) ? 2 : 1;
        let g = n.slice(sl);
        if (GIVEN_STOP.has(g[0])) return null;
        if (g.length === 2 && GIVEN_STOP.has(g[1])) g = g.slice(0, 1);
        return n.slice(0, sl) + g;
      };
      let m;
      const lawRe = new RegExp(`${nameCore}律師`, 'g');
      while ((m = lawRe.exec(t))) { const k = trimName(m[1]); if (k) found.push({ name: k, label: '律師' }); }
      const roleRe = new RegExp(`(?:${ROLE_WORDS.map(escRe).join('|')})\\s*[：:]?\\s*${nameCore}`, 'g');
      while ((m = roleRe.exec(t))) { const n = trimName(m[1]); if (n) found.push({ name: n, label: '人名' }); }
      found.forEach(({ name, label }) => {
        if (keep.has(name) || byOriginal.has(name) || personToken.has(name)) return;
        if (!new RegExp(escRe(name)).test(t)) return;
        t = t.replace(nameRe(name), () => { bump(name); return tokenFor(name, label, 'name'); });
        personToken.set(name, byOriginal.get(name).token);
      });

      // 公司名：「…股份有限公司」，往前抓到標點／角色字為止
      const coRe = new RegExp(`([A-Za-z0-9\\u4e00-\\u9fff]{1,8}?)${COMPANY_SUFFIX}`, 'g');
      t = t.replace(coRe, (whole, pre, off, all) => {
        // 從比對起點往前不再延伸；把開頭的角色字、虛詞去掉
        let p = pre;
        for (let changed = true; changed;) {
          changed = false;
          for (const w of ROLE_WORDS.concat(['與', '及', '和', '向', '對', '於', '由', '為', '係', '之', '即', '經', '將', '請', '告'])) {
            if (p.startsWith(w) && p.length > w.length) { p = p.slice(w.length); changed = true; }
          }
        }
        const name = p + whole.slice(pre.length);
        if (keep.has(name) || p.length < 1) return whole;
        bump(name);
        return whole.slice(0, whole.length - name.length) + tokenFor(name, '公司', 'company');
      });

      // 姓＋稱謂：王先生 → 【當事人A】先生（只有同姓只有一位已知人名時才對應到那個人）
      const titleRe = new RegExp(`((?:${s2})|[${SURNAMES_1}])(${TITLES.join('|')})`, 'g');
      t = t.replace(titleRe, (whole, sur, title) => {
        if (keep.has(whole)) return whole;
        const same = [...personToken.entries()].filter(([n, tk]) => tk && n.startsWith(sur));
        let tk;
        if (same.length === 1) tk = same[0][1];
        else tk = tokenFor(sur + '某', '人名', 'name'); // 認不出是誰：給一個獨立代號（還原時用下方的寫法對照）
        bump(whole);
        const composite = tk + title;
        if (!byOriginal.has('稱謂:' + whole)) {
          const e = { token: composite, original: whole, label: '稱謂', kind: 'title' };
          byOriginal.set('稱謂:' + whole, e); map.entries.push(e);
        }
        return composite;
      });
    }

    // 對外給預覽畫面用的清單
    const items = map.entries.filter((e) => e.kind !== 'title' && !(e.original.endsWith('某') && e.kind === 'name'))
      .map((e) => ({ original: e.original, token: e.token, label: e.label, kind: e.kind, count: counts.get(e.original) || 0 }));
    map.entries.filter((e) => e.kind === 'title').forEach((e) => items.push({ original: e.original, token: e.token, label: '稱謂', kind: 'title', count: counts.get(e.original) || 0 }));
    return { text: t, map, items };
  }

  // 一個代號（如【當事人A】）在 AI 回傳中可能的各種寫法
  function tokenPattern(token) {
    const m = token.match(/^【(.+?)([A-Z]+|\d+)】(.*)$/);
    if (!m) return new RegExp(escRe(token), 'g');
    const [, label, id, tail] = m;
    const idPat = id.split('').map((c) => `[${c}${String.fromCharCode(c.charCodeAt(0) + 0xFEE0)}]`).join('');
    const tailPat = tail ? `\\s*${escRe(tail)}` : '';
    return new RegExp(`[【\\[「『(（〔<]?\\s*${escRe(label)}\\s*${idPat}(?![A-Za-z0-9Ａ-Ｚａ-ｚ０-９])\\s*[】\\]」』)）〕>]?${tailPat}`, 'g');
  }

  /** 還原：代號換回原文；AI 改寫過的代號（空格、括號、全形）也認得 */
  function reidentify(text, map) {
    let t = String(text == null ? '' : text);
    if (!map || !Array.isArray(map.entries)) return t;
    // 先處理「代號＋稱謂」，再處理長代號（AA 先於 A 已由邊界保證）
    const list = map.entries.slice().sort((a, b) => (b.kind === 'title') - (a.kind === 'title') || b.token.length - a.token.length);
    list.forEach((e) => {
      // 用暫存記號避免換回的原文又被下一個規則改到
      t = t.replace(tokenPattern(e.token), () => '\u0000' + map.entries.indexOf(e) + '\u0001');
    });
    return t.replace(/\u0000(\d+)\u0001/g, (_, i) => {
      const e = map.entries[Number(i)];
      return e.kind === 'name' && e.original.endsWith('某') ? e.original.slice(0, -1) : e.original;
    });
  }

  /** AI 回傳的 JSON：所有字串欄位都還原 */
  function reidentifyDeep(obj, map) {
    if (typeof obj === 'string') return reidentify(obj, map);
    if (Array.isArray(obj)) return obj.map((x) => reidentifyDeep(x, map));
    if (obj && typeof obj === 'object') { const o = {}; Object.keys(obj).forEach((k) => { o[k] = reidentifyDeep(obj[k], map); }); return o; }
    return obj;
  }

  /** 還原後仍殘留、像代號的字（例如 AI 自己編的【當事人C】） */
  function findLeftoverTokens(text, map) {
    const labels = ['當事人', '對造', '關係人', '律師', '人名', '公司', '遮蔽', '電話', '身分證', 'Email', '地址', '帳號', '統編'];
    const re = new RegExp(`[【\\[]\\s*(?:${labels.join('|')})\\s*(?:[A-ZＡ-Ｚ]+|[0-9０-９]+)\\s*[】\\]]`, 'g');
    return [...new Set(String(text || '').match(re) || [])];
  }

  return { deidentify, reidentify, reidentifyDeep, findLeftoverTokens, knownNamesFromCase, _toHalf: toHalf };
});
