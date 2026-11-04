// 去識別化模組測試：node tests/deidentify.test.js
// 測試資料全部是明顯虛構的人名（王小明、李大華、測試甲…），電話、證號都是假的
const assert = require('assert');
const { deidentify, reidentify, reidentifyDeep, findLeftoverTokens, knownNamesFromCase, safeFileLabel } = require('../modules/deidentify.js');

const tests = [];
const test = (name, fn) => tests.push({ name, fn });
const has = (s, sub) => assert.ok(s.includes(sub), `應包含「${sub}」\n實際：${s}`);
const no = (s, sub) => assert.ok(!s.includes(sub), `不應包含「${sub}」\n實際：${s}`);
const roundTrip = (text, known) => { const r = deidentify(text, known); assert.strictEqual(reidentify(r.text, r.map), text, '還原後應與原文完全相同'); return r; };

const K = [{ name: '王小明', role: 'client' }, { name: '李大華', role: 'opponent' }];

// ── 一般書狀段落 ──
test('01 一般書狀段落：當事人、對造換成代號且保留角色字', () => {
  const t = '原告王小明主張，被告李大華於民國113年3月1日向原告借款新臺幣500,000元。';
  const r = roundTrip(t, K);
  has(r.text, '原告【當事人A】主張'); has(r.text, '被告【對造A】於');
  no(r.text, '王小明'); no(r.text, '李大華');
  has(r.text, '113年3月1日'); has(r.text, '500,000元'); // 案情要保留
});
test('02 法條、案號、金額不會被誤遮', () => {
  const t = '案號：114年度訴字第0000號，依民法第478條及第233條第1項請求新臺幣500,000元。';
  const r = deidentify(t, K);
  assert.strictEqual(r.text, t);
});
test('03 同名出現多次：整份都用同一個代號', () => {
  const t = '王小明交付款項。嗣後王小明多次催討，王小明並寄發存證信函。';
  const r = roundTrip(t, K);
  assert.strictEqual(r.text.split('【當事人A】').length - 1, 3);
  assert.strictEqual(r.items.find((x) => x.original === '王小明').count, 3);
});
test('04 不同人給不同代號，同角色依序 A、B', () => {
  const r = deidentify('王小明與張測試共同起訴', [{ name: '王小明', role: 'client' }, { name: '張測試', role: 'client' }]);
  has(r.text, '【當事人A】'); has(r.text, '【當事人B】');
});
test('05 名字是常見詞的一部分：王大明要遮，大明路不能動', () => {
  const t = '王大明住在大明路附近，每天走大明路上班。';
  const r = roundTrip(t, [{ name: '王大明', role: 'client' }]);
  has(r.text, '【當事人A】住在大明路附近'); has(r.text, '走大明路上班');
});
test('06 名字剛好是路名開頭：「林森」不會切壞「林森北路」', () => {
  const t = '證人林森表示，當天他在林森北路等候。';
  const r = roundTrip(t, [{ name: '林森', role: 'related' }]);
  has(r.text, '證人【關係人A】表示'); has(r.text, '林森北路');
});
test('07 長名字先換：李明德不會被「李明」切成兩半', () => {
  const t = '李明與李明德是兄弟。';
  const r = roundTrip(t, [{ name: '李明', role: 'client' }, { name: '李明德', role: 'related' }]);
  has(r.text, '【當事人A】與【關係人A】是兄弟');
});

// ── 電話 ──
test('08 手機：0912-345-678、0912345678、0912 345 678 都要遮', () => {
  const r = deidentify('聯絡0912-345-678或0912345678或0912 345 678', []);
  no(r.text, '345'); assert.strictEqual((r.text.match(/【電話\d】/g) || []).length, 3);
});
test('09 手機：+886 912 345 678 國際寫法', () => {
  const r = deidentify('手機+886 912 345 678', []);
  has(r.text, '手機【電話1】');
});
test('10 市話：(02)2345-6789、02-23456789、04-2345-6789#12', () => {
  const r = deidentify('市話(02)2345-6789，傳真02-23456789，公司04-2345-6789#12。', []);
  no(r.text, '2345'); no(r.text, '#12'); assert.strictEqual((r.text.match(/【電話\d】/g) || []).length, 3);
});
test('11 全形數字電話也認得', () => {
  const r = deidentify('電話０９１２－３４５－６７８', []);
  // 全形破折號不是標準分隔，至少不能把號碼原樣留下
  const r2 = deidentify('電話０９１２３４５６７８', []);
  has(r2.text, '電話【電話1】');
  assert.ok(r.text);
});
test('12 同一支電話出現兩次用同一個代號', () => {
  const r = deidentify('請撥0912-345-678，再撥一次0912-345-678', []);
  assert.strictEqual(r.items.filter((x) => x.kind === 'phone').length, 1);
});

// ── 身分證、Email、帳號、統編 ──
test('13 身分證字號', () => {
  const r = roundTrip('身分證統一編號：A123456789', []);
  has(r.text, '【身分證1】');
});
test('14 身分證：不會把一般英數字當身分證（如型號 AB12345678）', () => {
  const r = deidentify('機器型號AB12345678', []);
  no(r.text, '【身分證');
});
test('15 Email', () => {
  const r = roundTrip('請寄到 test.wang@example.com 謝謝', []);
  has(r.text, '【Email1】'); no(r.text, 'example.com');
});
test('16 銀行帳號（有「帳號」二字才遮，避免誤遮其他數字）', () => {
  const r = roundTrip('匯入台北富邦銀行帳號：012-3456-7890123，金額500,000元', []);
  has(r.text, '帳號：【帳號1】'); has(r.text, '台北富邦銀行'); has(r.text, '500,000元');
});
test('17 統一編號', () => {
  const r = roundTrip('公司統一編號 12345678', []);
  has(r.text, '【統編1】');
});

// ── 地址 ──
test('18 完整地址：縣市＋區＋路段＋號＋樓', () => {
  const r = roundTrip('被告住臺北市中正區重慶南路一段122號5樓，迄今未搬遷。', []);
  has(r.text, '被告住【地址1】，迄今');
});
test('19 沒有縣市的地址：中山路5號之1', () => {
  const r = roundTrip('店面位於中山路5號之1，租金每月3萬元。', []);
  has(r.text, '位於【地址1】，'); has(r.text, '3萬元');
});
test('20 只有路名沒有門牌、也沒有縣市：不遮（這不是個人地址）', () => {
  const r = deidentify('兩人約在大明路的咖啡店見面', []);
  no(r.text, '【地址');
});

// ── 規則補抓人名 ──
test('21 規則補抓：已知名單沒有的「房東黃美玲」、「林淑芬律師」', () => {
  const t = '此有店面房東黃美玲可證。訴訟代理人林淑芬律師。後來黃美玲又到場。';
  const r = roundTrip(t, K);
  no(r.text, '黃美玲'); no(r.text, '林淑芬'); has(r.text, '律師');
});
test('22 規則不誤判：「代理人陳稱」不是人名、「被告連帶給付」不是人名', () => {
  const t = '原告訴訟代理人陳稱：被告應連帶給付。被告連帶負責。';
  const r = deidentify(t, []);
  assert.strictEqual(r.text, t);
});
test('23 王先生：同姓只有一位已知人名時對到同一人，還原回「王先生」', () => {
  const t = '王小明表示，王先生當天有到場。';
  const r = roundTrip(t, K);
  has(r.text, '【當事人A】先生');
});
test('24 公司名：已知名單與規則都能遮', () => {
  const t = '被告甲營造股份有限公司與測試物流有限公司簽約。';
  const r = roundTrip(t, [{ name: '甲營造股份有限公司', role: 'opponent' }]);
  no(r.text, '甲營造'); no(r.text, '測試物流'); has(r.text, '簽約');
});

// ── 還原 ──
test('25 AI 改寫代號：空格、方括號、引號、全形字母都能還原', () => {
  const r = deidentify('原告王小明與被告李大華', K);
  const ai = '當事人 A 主張借款；[對造A] 抗辯合夥；「當事人A」勝訴機率高；當事人Ａ應補證；【 對造 A 】不認。';
  const back = reidentify(ai, r.map);
  no(back, '當事人'); no(back, '對造');
  has(back, '王小明主張借款'); has(back, '李大華 抗辯'); has(back, '王小明應補證');
});
test('26 還原不會誤換：當事人AB 不是 當事人A、電話12 不是 電話1', () => {
  const r = deidentify('王小明 0912-345-678', K);
  const back = reidentify('當事人AB 與 電話12 與 當事人A 與 電話1', r.map);
  has(back, '當事人AB'); has(back, '電話12'); has(back, '王小明'); has(back, '0912-345-678');
});
test('27 AI 自己編的代號會被抓出來提醒', () => {
  const r = deidentify('原告王小明', K);
  const back = reidentify('【當事人A】與【當事人C】', r.map);
  assert.deepStrictEqual(findLeftoverTokens(back, r.map), ['【當事人C】']);
});
test('28 AI 回傳的 JSON：每個字串欄位都還原', () => {
  const r = deidentify('原告王小明主張被告李大華借款', K);
  const g = { summary: '【當事人A】訴請【對造A】還款', sections: [{ title: '爭點', items: [{ text: '對造A 是否借款', quote: '被告【對造A】借款', tier: '原文' }] }] };
  const back = reidentifyDeep(g, r.map);
  assert.strictEqual(back.summary, '王小明訴請李大華還款');
  assert.strictEqual(back.sections[0].items[0].quote, '被告李大華借款');
  assert.strictEqual(back.sections[0].items[0].tier, '原文');
});

// ── 律師在預覽畫面的調整 ──
test('29 取消勾選：keep 裡的原文不遮', () => {
  const r = deidentify('原告王小明，電話0912-345-678', K, { keep: ['0912-345-678'] });
  has(r.text, '0912-345-678'); has(r.text, '【當事人A】');
});
test('30 手動補一個名字：用 role=other 就會被遮', () => {
  const r = roundTrip('後來小巷咖啡老闆也來了', [{ name: '小巷咖啡', role: 'other' }]);
  has(r.text, '【遮蔽A】');
});

// ── 從案件帶入名單 ──
test('31 從案件資料帶入：當事人、對造、律師（去掉「律師」二字）', () => {
  const ks = knownNamesFromCase({ person: '王小明', opponentName: '李大華', attorneys: ['陳測試律師'], opponentAttorney: '林測試律師' });
  assert.deepStrictEqual(ks.map((k) => k.name + '/' + k.role), ['王小明/client', '李大華/opponent', '林測試/lawyer', '陳測試/lawyer']);
});
test('32 多份文件全文一起遮：頁首【文件1：…】不受影響', () => {
  const t = '【文件1：01_民事起訴狀｜第1頁】\n原告：王小明\n\n【文件2：02_民事答辯狀｜第1頁】\n被告：李大華 否認王小明的主張';
  const r = roundTrip(t, K);
  has(r.text, '【文件1：01_民事起訴狀｜第1頁】'); has(r.text, '否認【當事人A】的主張');
});
test('33 不換行跨行：電話後面換行的數字不會被黏進帳號', () => {
  const r = deidentify('帳號：0123456789012\n114年3月1日', []);
  has(r.text, '\n114年3月1日');
});

// ── 寬字距／掃描檔 OCR 文字（2026-11-04）：「上　訴　人　王　小　明」這種字被拉開的寫法也要遮得到 ──
const spacedNo = (r, ...names) => names.forEach((n) => { no(r.text, n); no(r.text.replace(/[\s\u3000]+/g, ''), n); });
test('34 寬字距：上　訴　人／被上訴人後面的姓名遮得到（沒有已知名單、只靠規則）', () => {
  const r = deidentify('上　訴　人　王　小　明\n被上訴人　李　大　華\n上列當事人間請求返還價金事件', []);
  spacedNo(r, '王小明', '李大華'); has(r.text, '上訴人'); has(r.text, '被上訴人');
});
test('35 寬字距：訴訟代理人、複代理人的律師姓名遮得到', () => {
  const r = deidentify('訴訟代理人　陳　大　文　律師\n複　代　理　人　林　小　華　律師', []);
  spacedNo(r, '陳大文', '林小華'); has(r.text, '律師');
});
test('36 寬字距：已知名單的姓名被拉開寫也遮得到，整份同一個代號', () => {
  const r = deidentify('上　訴　人　王　小　明\n上訴人王小明主張兩造於民國一一二年簽約。', K);
  spacedNo(r, '王小明'); assert.strictEqual((r.text.match(/【當事人A】/g) || []).length, 2, r.text);
});
test('37 寬字距：原　　告／被　　告（兩個字拉很開）也遮得到，還原得回真名', () => {
  const r = deidentify('原　　告　王小明\n被　　告　李大華', K);
  spacedNo(r, '王小明', '李大華');
  const back = reidentify(r.text, r.map); has(back, '王小明'); has(back, '李大華');
});
test('38 OCR 結果（字之間沒有空白、角色緊貼姓名）也遮得到', () => {
  const r = deidentify('上訴人張志明\n被上訴人黃美玲\n上訴人張志明主張：被上訴人黃美玲未交付標的物。', []);
  spacedNo(r, '張志明', '黃美玲');
});
test('39 已經匿名的「○○○」不被當成人名，也不出錯', () => {
  const t = '上　訴　人　○○○\n被上訴人　○○○';
  const r = deidentify(t, []);
  assert.strictEqual(r.items.length, 0, JSON.stringify(r.items)); has(r.text, '○○○');
});
test('40 一般句子裡的空白不動（只合併被拉開的單字）', () => {
  const r = deidentify('被告：李大華 否認王小明的主張', K);
  has(r.text, '【對造A】 否認');
});

// ── 角色字後面沒有冒號、罕見姓氏（2026-11-04）：不靠姓氏表，靠前後文抓。姓名全部虛構，刻意用罕見姓（冷、井、亓官、殷、龔、卞）──
test('41 上訴人＋姓名＋住【地址】（無冒號、罕見姓）', () => {
  const r = deidentify('上訴人冷若冰住臺北市中正區測試路1號', []); no(r.text, '冷若冰'); has(r.text, '上訴人【'); has(r.text, '住【地址');
});
test('42 被上訴人＋四字姓名（複姓）＋住', () => {
  const r = deidentify('被上訴人亓官明月住新北市板橋區範例街2號', []); no(r.text, '亓官明月'); has(r.text, '被上訴人【');
});
test('43 姓名後接「設」（公司所在地寫法）', () => {
  const r = deidentify('上訴人井上雲設臺中市西區測試路3號', []); no(r.text, '井上雲');
});
test('44 姓名後接「即」（即某商行負責人）', () => {
  const r = deidentify('聲請人冷玉珍即冷記商行負責人', []); no(r.text, '冷玉珍');
});
test('45 姓名後接「，」「、」：一行兩個角色都抓', () => {
  const r = deidentify('上訴人冷若冰，被上訴人井上雲、告訴人殷國華、相對人龔麗娟', []);
  ['冷若冰', '井上雲', '殷國華', '龔麗娟'].forEach((n) => no(r.text, n));
});
test('46 姓名在行尾（換行）：債權人／債務人／法定代理人', () => {
  const r = deidentify('債權人冷明哲\n債務人井文彬\n法定代理人卞美惠', []);
  ['冷明哲', '井文彬', '卞美惠'].forEach((n) => no(r.text, n));
});
test('47 原告／被告無冒號＋罕見姓，後面接逗號', () => {
  const r = deidentify('原告冷素貞，被告井俊傑。', []); no(r.text, '冷素貞'); no(r.text, '井俊傑');
});
test('48 訴訟代理人列表：第二位律師獨立一行「XXX律師」也遮', () => {
  const r = deidentify('訴訟代理人　陳大文律師\n　　　　　　冷小華律師', []);
  no(r.text, '陳大文'); no(r.text, '冷小華'); has(r.text, '【律師B】律師');
});
test('49 複代理人＋罕見姓律師（無冒號）', () => {
  const r = deidentify('複代理人冷志豪律師', []); no(r.text, '冷志豪'); has(r.text, '【律師A】律師');
});
test('50 行內「、XXX律師」列舉也遮', () => {
  const r = deidentify('上訴人之訴訟代理人為陳大文律師、殷小華律師', []); no(r.text, '殷小華'); no(r.text, '陳大文');
});
test('51 不誤遮：「上訴人主張，」「原告負擔。」「委任律師到庭」「選任辯護人」', () => {
  const t = '上訴人主張，被上訴人則以：訴訟費用由原告負擔。委任律師到庭，本件由選任辯護人到庭，原告之訴駁回。';
  const r = deidentify(t, []); assert.strictEqual(r.text, t, JSON.stringify(r.items));
});
test('52 不誤遮：已匿名的「上訴人○○○住」、角色後面接一般句子', () => {
  const t = '上訴人○○○住所不明。被告對於原告之請求，均不爭執。';
  const r = deidentify(t, []); assert.strictEqual(r.text, t, JSON.stringify(r.items));
});
test('53 抓到的姓名在全文其他地方也一起遮、可還原', () => {
  const t = '上訴人冷若冰住臺北市中正區測試路1號\n冷若冰主張兩造間有借貸關係。';
  const r = deidentify(t, []); no(r.text, '冷若冰'); assert.strictEqual(reidentify(r.text, r.map), t);
});
test('54 檔名不送 AI：只留文件種類，姓名與案號都拿掉', () => {
  assert.strictEqual(safeFileLabel('冷若冰_民事起訴狀_113訴123.pdf'), '民事起訴狀');
  assert.strictEqual(safeFileLabel('03_言詞辯論筆錄'), '言詞辯論筆錄');
  assert.strictEqual(safeFileLabel('井上雲判決書'), '判決');
  assert.strictEqual(safeFileLabel('全案整理報告_2026-11-04'), '全案整理報告');
  assert.strictEqual(safeFileLabel('冷若冰的資料'), '');
});

test('55 Gemini 轉錄的多個空白：「上訴人　　姓名　　住【地址】」也遮', () => {
  const r = deidentify('上訴人　　冷若冰　　住臺北市中正區測試路1號\n被上訴人  井上雲  住新北市板橋區範例街2號', []);
  no(r.text, '冷若冰'); no(r.text, '井上雲');
});
test('56 訴訟代理人下一行縮排的「　　　　XXX律師」、姓名與律師之間有空白也遮', () => {
  const r = deidentify('訴訟代理人　陳大文律師\n　　　　冷小華律師\n　　　　井大明　律師', []);
  ['陳大文', '冷小華', '井大明'].forEach((n) => no(r.text, n));
});
test('57 證人名單「、及與」接續的姓名一起遮（含已遮成代號的第一位）', () => {
  const r = deidentify('證人王小明、冷大華及井小明、卞美美等人到庭結證。', [{ name: '王小明', role: 'person' }]);
  ['王小明', '冷大華', '井小明', '卞美美'].forEach((n) => no(r.text, n)); has(r.text, '等人到庭');
});
test('58 名單規則不誤遮：「原告與被告間」「被告及其訴訟代理人」「上訴人及被上訴人」', () => {
  const t = '原告與被告間請求返還借款事件，被告及其訴訟代理人到庭，上訴人及被上訴人均不爭執。';
  const r = deidentify(t, []); assert.strictEqual(r.text, t, JSON.stringify(r.items));
});

let pass = 0; const fails = [];
for (const t of tests) {
  try { t.fn(); pass++; console.log('  ✓ ' + t.name); }
  catch (e) { fails.push(t.name); console.log('  ✗ ' + t.name + '\n    ' + String(e.message).split('\n').join('\n    ')); }
}
console.log(`\n結果：${pass} / ${tests.length} 通過`);
process.exit(fails.length ? 1 : 0);
