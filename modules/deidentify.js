/* ==========================================================================
 * 去識別化模組（送 AI 前遮個資、AI 回來後還原）
 * 規格：docs/去識別化-規格.md
 *
 * 對外只有：
 *   deidentify(text, knownNames, options) → { text, map, items }
 *   reidentify(text, map)                 → 還原後的文字
 *   reidentifyDeep(obj, map)              → 把物件裡所有字串都還原（AI 回傳的 JSON 用）
 *   findLeftoverTokens(text, map)         → 還原後仍殘留、認不出的代號
 *   joinSpacedHan(text)                   → 把「上　訴　人」這種拉開的字合回去
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
  const SURNAMES_2 = ['歐陽', '司馬', '上官', '諸葛', '東方', '皇甫', '尉遲', '公孫', '慕容', '長孫', '令狐', '夏侯', '司徒', '張簡', '范姜', '張廖', '亓官', '端木', '西門', '南宮', '第五', '呼延', '萬俟', '澹臺', '宇文', '鮮于', '左丘'];
  // 只放常見、且不容易跟一般詞混淆的姓（「連帶」「程序」「方面」「向原告」會誤判，所以不放 連程方向 等字；罕見姓請用已知名單）
  const SURNAMES_1 = '陳林黃張李王吳劉蔡楊許鄭謝洪郭邱曾廖賴徐周葉蘇莊呂江何蕭羅高潘簡朱鍾游彭詹胡施沈余盧梁趙顏柯翁魏孫戴范宋鄧杜傅侯曹薛丁卓阮馬董温溫唐藍蔣紀姚馮歐湯康姜汪鄒巫鐘黎涂龔嚴韓袁陸柳凃邵錢伍倪譚駱熊秦顧俞雷粘饒闕崔尹辜褚殷賈';
  // 較少見但台灣常見於戶籍的姓（只用在「角色字＋姓名」的前後文規則）；刻意不放容易當一般詞開頭的字（平、表、進、前、好、處、陷、詐…）
  const SURNAMES_EXT = '冷井卞亓麥甘包祝談繆艾牛喬花金石古田白毛方夏易寇岳邢裴韋童連傳翟聶申池利紀宗龍蒲樊左單習郝閻杭溫邱湛酈晏景童戚池華全向應米賀尤付柴萬龐費鄔房裘缪荊鞏隋關藺霍虞嵇桂章伏'.replace(/[平表進前好處陷詐]/g, '');
  // 名字的字不會是這些（多半是虛詞、動詞）
  const GIVEN_STOP = new Set('稱述報情於與及和等之為係已應則向對即亦均自在就以因所並仍曾未主不是有無的了也都將被把請要會可能得須需另再又才尚依據如若雖但而且或到從給至由否所訴代理律原告'.split(''));
  // 寬鬆規則（不靠姓氏表）抓到的 2～4 字若含這些詞，就不是姓名（「上訴人主張，」「原告負擔。」…）
  const LOOSE_STOP = /主張|聲明|抗辯|陳述|陳稱|請求|負擔|提起|起訴|上訴|否認|答辯|聲請|不服|則以|所述|所辯|部分|部份|全部|敗訴|勝訴|駁回|代理|律師|法院|本院|判決|裁定|同意|爭執|自認|到庭|簽名|蓋章|給付|繳納|支付|清償|等人|等語|雙方|兩造|本人|之前|之後|以上|以下|如下|如上|在案|在卷|部分|公司|負責|地址|住所|居所|電話|身分|統一|編號|未到|到場|在場|稱|即為|部門|名義|合意|簽訂|契約|借款|款項|當事|對造|本件|本案|原審|二審|一審|姓名|不詳|年籍/;
  // 低信心候選（不是姓氏開頭）若含這些常見法律用語、動詞片語，就連「建議」都不列
  const LEGAL_TERMS = /詐欺|詐騙|錯誤|陷於|表示|處理|進行|平安|事務|主張|請求|給付|同意|契約|服務|超渡|謝意|感謝|好喔|好的|好啊|謝謝|前開|前揭|上開|上述|同上|如前|所稱|所謂|所有|權利|義務|責任|損害|賠償|侵權|過失|故意|違約|解除|撤銷|無效|返還|交付|支付|清償|借款|借貸|買賣|租賃|承攬|委任|贈與|保證|擔保|抵押|質權|利息|違約金|訴訟|起訴|上訴|抗告|再審|調解|和解|判決|裁定|審理|辯論|開庭|到庭|證據|證明|證人|鑑定|事實|理由|爭點|主文|聲明|陳述|答辯|否認|自認|承認|爭執|抗辯|反駁|認定|判斷|斟酌|審酌|足認|可採|不採|駁回|准許|負擔|費用|金額|款項|新臺幣|帳戶|匯款|轉帳|收受|取得|占有|使用|收益|處分|移轉|登記|繼承|遺產|扶養|監護|離婚|婚姻|子女|財產|分配|協議|約定|通知|催告|寄送|送達|收到|告知|說明|回覆|聯絡|見面|討論|溝通|確認|核對|檢查|修繕|維修|施工|工程|交屋|驗收|付款|收款|報酬|工資|薪資|資遣|解僱|勞動|加班|休假|傷害|醫療|治療|住院|看診|恐嚇|竊盜|侵占|背信|偽造|毀損|妨害|公然|侮辱|誹謗|毆打|行為|情形|情事|部分|全部|一切|相關|有關|關於|對於|由於|因此|然而|但是|並且|而且|或者|以及|為了|因為|所以|如果|即使|雖然|已經|仍然|尚未|曾經|始終|一直|立即|隨即|嗣後|其後|之後|之前|當時|目前|現在|今日|昨日|明日|本件|本案|該案|其他|另外|此外|再者|又稱|即稱|稱為|名為|作為|成為|認為|以為|視為|屬於|位於|居住|工作|經營|營業|開設|設立|成立|負責|擔任|代表|代理|授權|委託|聘請|僱用|受僱|雇主|員工|職員|股東|董事|公司|商行|企業|店家|客戶|廠商|朋友|同事|鄰居|家屬|親屬|父親|母親|配偶|兒子|女兒|兄弟|姊妹|狐狸|貓狗|動物|宗教|法會|祭拜|祈福|消災|改運|算命|風水|命理/;
  // 姓氏開頭但其實是一般詞（「方面」「金錢」「何時」…）
  const SURNAME_WORDS = /^(方面|方式|方法|方才|金錢|金額|金融|石頭|白天|夏天|何時|何以|何況|何謂|周知|周遭|高度|高額|高興|全部|全額|全體|全數|向來|向其|應該|應予|應即|應付|應當|關於|關係|單獨|單方|易於|連帶|連續|田地|林地|花費|花錢|毛病|古董|章程|童年|華人|利息|利益|宗教|申請|申報|習慣|左右|萬元|費用|房屋|房租|景氣|江湖|洪水|黃金|余額|余款|葉子|程序|孫子|馬上|朱紅|游戲|游泳|施工|施行|施用|沈默|曾經|曾於|許可|許多|陳述|陳報|陳稱|楊柳|林木|簡單|簡易|簡訊|蘇醒|莊園|吳語|潘朵|鄭重|韓國|雷同|雷射|熊熊|秦朝|顧客|顧慮|蔣某|紀錄|姚某|湯匙|康復|汪洋|巫術|黎明|嚴重|嚴格|袁某|陸續|柳丁|錢財|伍佰|倪某|譚某|駱駝|俞某|饒恕|崔某|尹某|辜負|褚某|殷切|賈某|龔某|唐突|藍色|董事|馬路|白色|石油|古代|田野|毛巾|夏季|易手|寇讎|岳父|岳母|邢某|裴某|童話|翟某|申訴|池中|利用|宗旨|龍眼|蒲團|樊籠|左方|單位|單據|習俗|湛藍|景象|戚某|華麗|全然|向前|應允|米飯|賀禮|尤其|付款|付清|付出|柴火|萬一|龐大|費時|房間|關閉|關心|霍亂|虞某|桂圓|章節|伏筆|冷靜|冷氣|井然|包括|包含|包裝|祝福|談話|談判|艾草|牛肉|喬裝|花園|甘願|麥克)/;
  // 「XXX律師」前面若是這些詞，就不是律師姓名（「委任律師」「選任律師」…）
  const LAWYER_STOP = /委任|選任|指定|本件|聘請|擔任|執業|承辦|主辦|公設|扶助|法扶|義務|專利|代理|辯護|另委|改委|陪同|諮詢|事務所|全體/;
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
   * @param {{keep?: string[], useRules?: boolean, joinHanSpaces?: boolean}} options keep：律師在預覽取消勾選、不要遮的原文；joinHanSpaces（預設 true）：先拿掉中文字之間的空白
   */
  // 「上　訴　人　王　小　明」→「上訴人　王小明」：只合併「一個字、空白、一個字…」這種被拉開的字，
  // 一般句子裡的空白（例如「李大華 否認」）不動
  function joinSpacedHan(text) {
    return String(text || '').replace(/(?<![\u4e00-\u9fff○〇])[\u4e00-\u9fff○〇](?:[ \t\u3000]+[\u4e00-\u9fff○〇](?![\u4e00-\u9fff○〇]))+/g, (m) => m.replace(/[ \t\u3000]+/g, ''));
  }

  // 送給 AI 的頁首不放檔名（檔名常含當事人姓名、案號），只留看得出文件種類的字
  const DOC_TYPES = ['全案整理報告', '民事起訴狀', '刑事起訴書', '起訴狀', '起訴書', '答辯狀', '準備書狀', '準備書', '上訴理由狀', '上訴狀', '抗告狀', '聲請狀', '陳報狀', '陳述意見狀', '言詞辯論筆錄', '準備程序筆錄', '調解筆錄', '和解筆錄', '筆錄', '判決', '裁定', '開庭通知書', '通知書', '傳票', '支付命令', '存證信函', '契約', '協議書', '診斷證明書', '估價單', '收據', '證物', '證據', '鑑定報告', '附表', '委任狀'];
  function safeFileLabel(name) {
    const n = String(name || '');
    const civil = /民事/.test(n) ? '民事' : /刑事/.test(n) ? '刑事' : /行政/.test(n) ? '行政' : '';
    const hit = DOC_TYPES.find((d) => n.includes(d));
    if (!hit) return '';
    return /^(民事|刑事)/.test(hit) || hit === '全案整理報告' ? hit : civil + hit;
  }

  function deidentify(text, knownNames, options) {
    const opt = Object.assign({ keep: [], useRules: true }, options || {});
    const keep = new Set(opt.keep || []);
    let t = String(text == null ? '' : text);
    // 掃描檔 OCR、或排版成寬字距的文件，常見「上　訴　人　王　小　明」：中文字（含○）之間的空白先拿掉，
    // 角色字與姓名規則、已知名單才比對得到。只改送給 AI 的版本；原文出處比對由呼叫端用原文做。
    if (opt.joinHanSpaces !== false) t = joinSpacedHan(t);

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
    let suggestions = [];
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
      // 2026-11-04：罕見姓氏也要抓 —— 不靠姓氏表，改靠前後文：
      //  (a) 角色字後面 2～4 個中文字，後面緊接「住／設／居／即／，、。；括號／律師／換行」
      //  (b) 行頭或「、，：（」之後的 2～3 個中文字＋「律師」
      const okLoose = (n) => n && !/○/.test(n) && !GIVEN_STOP.has(n[0]) && !LOOSE_STOP.test(n) && !ROLE_WORDS.includes(n);
      // 信心分級：'high'＝姓氏開頭、長度合理 → 預設遮；'low'＝不是姓氏開頭 → 只列為「可能是人名」，預設不遮；null＝不是人名
      const sugg = new Map();
      const classify = (n) => {
        if (!okLoose(n)) return null;
        if (SURNAME_WORDS.test(n)) return null;
        if (SURNAMES_2.some((x) => n.startsWith(x))) return n.length >= 3 && n.length <= 4 ? 'high' : null;
        if ((SURNAMES_1.includes(n[0]) || SURNAMES_EXT.includes(n[0])) && n.length >= 2 && n.length <= 3) return 'high';
        if (LEGAL_TERMS.test(n)) return null;
        return 'low';
      };
      const take = (n, label) => { const c = classify(n); if (c === 'high') found.push({ name: n, label }); else if (c === 'low' && !sugg.has(n)) sugg.set(n, label); return c; };
      const anchRe = new RegExp(`(?:${ROLE_WORDS.map(escRe).join('|')})[ \\t\\u3000]*[：:]?[ \\t\\u3000]*(${HAN}{2,4}?)(?=[ \\t\\u3000]*(?:住|設|居|即|[，,、。；;（(）)]|律師|\\n|$))`, 'gm');
      while ((m = anchRe.exec(t))) take(m[1], /^[ \t\u3000]*律師/.test(t.slice(m.index + m[0].length)) ? '律師' : '人名');
      const lawLineRe = new RegExp(`(?<=^|[\\s\\u3000、，,：:（(])(${HAN}{2,3})[ \\t\\u3000]*律師`, 'gm');
      while ((m = lawLineRe.exec(t))) { if (!LAWYER_STOP.test(m[1])) take(m[1], '律師'); }
      //  (c) 名單接續：「證人【人名C】、冷大華及井小明、卞美美等人」—— 角色字後面用「、及與和暨」串起來的每一個都是姓名
      //      整串每一段都要像姓名（2～4 字或已換好的代號），才算數；「原告與被告間」這種不會動
      const listRe = new RegExp(`(?:${ROLE_WORDS.map(escRe).join('|')})[ \\t\\u3000]*[：:]?[ \\t\\u3000]*([^，,。；;\\n]{2,80}?)(?=等人|等|[，,。；;\\n]|$)`, 'gm');
      while ((m = listRe.exec(t))) {
        const parts = m[1].split(/[、及與和暨]/).map((x) => x.replace(/[ \t\u3000]+/g, ''));
        if (parts.length < 2) continue;
        const looks = parts.every((x) => /^【[^】]+】$/.test(x) || (new RegExp(`^${HAN}{2,4}$`).test(x) && classify(x)));
        if (!looks) continue;
        parts.filter((x) => !/^【/.test(x)).forEach((x) => take(x, '人名'));
      }
      //  (d) 2026-11-05：前面沒有角色字、單獨出現在句子裡的名字（「嗣後陳小美向原告表示…」「由林志強開車…」）
      //      只抓「常見姓氏開頭」：前面是行頭、標點或「與及和跟由向對經請將被據把讓給替幫為之」，
      //      後面是標點或常見動詞。三字（姓＋兩字名）→ 預設遮；兩字 → 只列為「可能是人名，請確認」、預設不遮。
      //      地名、機關（…市、…局、…院）和一般詞（SURNAME_WORDS、LEGAL_TERMS、LOOSE_STOP）一律不算。
      {
        const freeSur = `(?:${s2}|[${SURNAMES_1}])`;
        const before = '(?<=^|[\\s\\u3000，,。、；;：:「」『』（）()]|與|及|和|跟|同|由|向|對|經|請|將|被|據|把|讓|給|替|幫|為|之|係|即|後|嗣|查|另|乃|遂|但|故|且|而|再|又|日)';
        const after = '(?=[\\s\\u3000，,。、；;：:「」『』（）()]|$|於|向|對|跟|與|及|和|稱|說|表示|曾|已|亦|也|則|並|即|又|還|就|才|都|會|要|在|到|去|來|把|將|帶|拿|打|找|問|回|給|寄|傳|是|有|沒|不|的|主張|陳稱|證稱|到庭|簽|收|借|匯|交|開|先生|小姐|女士|太太)';
        const freeRe = new RegExp(`${before}(${freeSur}${HAN}{1,2})${after}`, 'gm');
        const PLACE_END = /[市縣區鄉鎮村里路街局署院部會所處科組股庭行社館校店園廠站港橋山河湖島國省州]$/;
        const GIVEN_BAD = /[於與及和之的了是有在到為被把將向對以因所而但並等此其各該本某另每全這那哪何誰什麼們嗎呢吧啊喔年月日時分元萬千百個次件條項款號人物事情]/;
        while ((m = freeRe.exec(t))) {
          const n = m[1];
          if (PLACE_END.test(n) || SURNAME_WORDS.test(n) || LEGAL_TERMS.test(n) || LOOSE_STOP.test(n) || ROLE_WORDS.includes(n)) continue;
          const sl = SURNAMES_2.some((x) => n.startsWith(x)) ? 2 : 1;
          const given = n.slice(sl);
          if (!given || GIVEN_STOP.has(given[0]) || GIVEN_BAD.test(given)) continue;
          if (given.length === 2 && sl === 1) { found.push({ name: n, label: '人名' }); continue; }
          if (!sugg.has(n)) sugg.set(n, '人名');
        }
      }
      // 低信心候選：文件裡還在（沒被別的規則遮掉）的才列出，預設不遮
      suggestions = [...sugg.entries()].filter(([n]) => !found.some((f) => f.name === n) && !byOriginal.has(n) && !keep.has(n) && t.includes(n)).map(([name, label]) => ({ name, label }));
      found.forEach(({ name, label }) => {
        if (keep.has(name) || byOriginal.has(name) || personToken.has(name)) return;
        if (SURNAME_WORDS.test(name)) return; // 「何時」「方面」這類姓氏字開頭的一般詞
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
    return { text: t, map, items, suggestions };
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

  return { deidentify, reidentify, reidentifyDeep, findLeftoverTokens, knownNamesFromCase, joinSpacedHan, safeFileLabel, _toHalf: toHalf };
});
