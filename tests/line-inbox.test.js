/* LINE 預約收件匣：解析 Make 回傳＋用民眾全名自動比對利衝表。node tests/line-inbox.test.js
 * 直接取出 index.html 裡「lineInboxCore」那段程式來跑，確保測的就是網站實際用的程式。 */
'use strict';
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

const html = fs.readFileSync(path.join(__dirname, '..', 'index.html'), 'utf8');
const from = html.indexOf('// ---- lineInboxCore ----');
const to = html.indexOf('// ---- /lineInboxCore ----');
assert(from > 0 && to > from, '找不到 index.html 的 lineInboxCore 區段');
const ctx = {};
vm.createContext(ctx);
vm.runInContext(`${html.slice(from, to)}\nthis.H = { lineParseFeed, lineConflictCheck };`, ctx);
const { lineParseFeed, lineConflictCheck } = ctx.H;

const b64 = (s) => Buffer.from(s, 'utf8').toString('base64');
const dec = (x) => { try { return Buffer.from(x || '', 'base64').toString('utf8'); } catch (e) { return ''; } };
const row = (n, cols) => [n, ...cols.map(b64)].join('\t');

let pass = 0, fail = 0;
function t(name, fn) { try { fn(); pass++; console.log('  ✓ ' + name); } catch (e) { fail++; console.log('  ✗ ' + name + '\n      ' + (e && e.message)); } }

console.log('【解析 Make 回傳】');
t('1 新格式 7 欄：讀得到客戶全名', () => {
  const r = lineParseFeed('LINEINBOX1\n' + row(12, ['2026-11-05 10:00', '小王', '【租賃糾紛】押金沒退', '0900000123', '2026-11-07 15:00', '待審核', '王小明']), dec);
  assert.strictEqual(r.length, 1);
  assert.strictEqual(r[0].row, '12'); assert.strictEqual(r[0].fullName, '王小明'); assert.strictEqual(r[0].lineName, '小王');
  assert.strictEqual(r[0].slot, '2026-11-07 15:00'); assert.strictEqual(r[0].phone, '0900000123');
});
t('2 舊格式 6 欄（沒有全名）：照樣能用，全名是空字串', () => {
  const r = lineParseFeed('LINEINBOX1\n' + row(3, ['2026-11-05 10:00', '小王', '摘要', '0900000123', '', '待審核']), dec);
  assert.strictEqual(r.length, 1); assert.strictEqual(r[0].fullName, ''); assert.strictEqual(r[0].lineName, '小王');
});
t('3 第 7 欄是空字串（舊資料）也不出錯', () => {
  const r = lineParseFeed('LINEINBOX1\n' + [5, ...['t', '小王', 's', 'p', '', '待審核'].map(b64), ''].join('\t'), dec);
  assert.strictEqual(r[0].fullName, '');
});
t('4 混合新舊資料、Windows 換行、空行都能解析', () => {
  const r = lineParseFeed('LINEINBOX1\r\n' + row(1, ['a', '甲', 's', 'p', '', 'x', '李大華']) + '\r\n\n' + row(2, ['a', '乙', 's', 'p', '', 'x']) + '\n', dec);
  assert.strictEqual(JSON.stringify(r.map((x) => [x.row, x.fullName])), JSON.stringify([['1', '李大華'], ['2', '']]));
});
t('5 不是 LINEINBOX1 開頭（例如錯誤頁）→ 一筆都不收', () => {
  assert.strictEqual(lineParseFeed('<html>error</html>', dec).length, 0);
  assert.strictEqual(lineParseFeed('', dec).length, 0);
});
t('6 沒有暱稱也沒有全名的行略過', () => {
  assert.strictEqual(lineParseFeed('LINEINBOX1\n' + row(9, ['a', '', 's', 'p', '', 'x', '']), dec).length, 0);
});

console.log('【用民眾全名自動比對利衝表】');
const DATA = {
  conflictRecords: [['示範科技股份有限公司', '甲營造股份有限公司', '工程款', '110重訴1', '忠', 'A01'], ['張三豐', '周芷若', '返還借款', '112訴9', '', 'A02']],
  cases: [{ caseNumber: '114訴0000', title: '王小明 返還借款', opponentName: '李大華' }],
  clients: [{ name: '黃志豪' }],
  closedCases: [{ person: '陳阿土', cause: '清償債務' }],
};
t('7 🔴 曾為現有案件對造 → opponent', () => {
  const r = lineConflictCheck('李大華', DATA);
  assert.strictEqual(r.level, 'opponent'); assert.ok(r.hits.some((h) => h.includes('現有案件對造')));
});
t('8 🔴 管制表對造欄命中 → opponent', () => { assert.strictEqual(lineConflictCheck('周芷若', DATA).level, 'opponent'); });
t('9 🟡 本所客戶 → client', () => {
  const r = lineConflictCheck('黃志豪', DATA); assert.strictEqual(r.level, 'client'); assert.deepStrictEqual([...r.hits], ['本所客戶：黃志豪']);
});
t('10 🟡 現有案件當事人／管制表當事人欄／已結案當事人 → client', () => {
  assert.strictEqual(lineConflictCheck('王小明', DATA).level, 'client');
  assert.strictEqual(lineConflictCheck('張三豐', DATA).level, 'client');
  assert.strictEqual(lineConflictCheck('陳阿土', DATA).level, 'client');
});
t('11 ✅ 查無紀錄 → clear', () => {
  const r = lineConflictCheck('鄭家瑜', DATA); assert.strictEqual(r.level, 'clear'); assert.strictEqual(r.hits.length, 0);
});
t('12 同時是客戶又是對造 → 以對造（較嚴重）為準', () => {
  const d = { ...DATA, clients: [...DATA.clients, { name: '李大華' }] };
  const r = lineConflictCheck('李大華', d); assert.strictEqual(r.level, 'opponent'); assert.strictEqual(r.hits.length, 2);
});
t('13 沒有全名 → noname，不比對', () => {
  assert.strictEqual(lineConflictCheck('', DATA).level, 'noname');
  assert.strictEqual(lineConflictCheck('  ', DATA).level, 'noname');
  assert.strictEqual(lineConflictCheck(undefined, DATA).level, 'noname');
});
t('14 前後空白不影響比對', () => { assert.strictEqual(lineConflictCheck(' 李大華 ', DATA).level, 'opponent'); });

console.log(`\n結果：${pass} 通過，${fail} 失敗`);
process.exit(fail ? 1 : 0);
