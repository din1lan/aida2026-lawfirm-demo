// 執行：node tests/progress-report.test.js
'use strict';
const assert = require('assert');
const { buildProgressReport, checkDraft, CLOSING } = require('../modules/progress-report.js');

const TODAY = '2026-07-20';
const baseCase = {
  id: 'c1', caseNumber: '113訴101', title: '林小華 損害賠償', person: '林小華', cause: '損害賠償',
  attorneys: ['王大明律師'], status: '一審', court: '臺灣臺北地方法院', mediationOngoing: false,
  idNumber: 'A123456789', contractTotalAmount: 500000, receivedAmount: 200000, opponentName: '甲營造股份有限公司',
};
const pastHearing = { id: 'h0', caseId: 'c1', date: '2026-06-30', time: '10:00', courtNameRaw: '臺灣臺北地方法院民事庭' };
const nextHearing = { id: 'h1', caseId: 'c1', date: '2026-07-28', time: '09:30', courtNameRaw: '臺灣臺北地方法院民事庭', courtroom: '第三法庭' };
const laterHearing = { id: 'h2', caseId: 'c1', date: '2026-09-10', time: '14:00', courtNameRaw: '臺灣臺北地方法院民事庭' };
const deadline = { id: 'd2', kind: 'main', caseId: 'c1', action: '補繳裁判費', eventType: '補繳裁判費', computedDeadline: '2026-07-27' };
const reminder = { id: 'd3', kind: 'reminder', caseId: 'c1', action: '補繳裁判費', eventType: '提醒：補繳裁判費', computedDeadline: '2026-07-22' };
const fullNotes = { lastResult: '法官請雙方補提資料，下次開庭再審理。', clientTodo: '醫療收據正本\n請假證明' };

const FORBIDDEN = ['未填', 'undefined', 'null', 'NaN', '保證', '勝訴', '一定會', '有把握', '穩贏'];
function commonChecks(t) {
  FORBIDDEN.forEach((w) => assert.ok(!t.includes(w), `不應出現「${w}」：\n${t}`));
  assert.ok(t.includes(CLOSING), '必須有固定結尾句');
  // 不洩漏內部資料
  ['A123456789', '500000', '500,000', '甲營造'].forEach((w) => assert.ok(!t.includes(w), `不應出現內部資料「${w}」`));
}

let pass = 0, fail = 0;
function test(name, fn) {
  try { fn(); pass++; console.log('✓', name); }
  catch (e) { fail++; console.log('✗', name, '\n   ', e.message.split('\n').join('\n    ')); }
}

test('1. 資料齊全：每一段都出現且順序正確', () => {
  const t = buildProgressReport({ caseData: baseCase, hearings: [pastHearing, nextHearing, laterHearing], deadlines: [deadline, reminder], notes: fullNotes, today: TODAY });
  commonChecks(t);
  const order = ['林小華 您好：', '損害賠償', '113訴101', '【目前進度】', '【上次開庭】', '【下次開庭】', '【近期重要日期】', '【需要您協助準備】', CLOSING, '王大明律師 敬上'];
  let pos = -1;
  order.forEach((k) => { const p = t.indexOf(k); assert.ok(p > pos, `「${k}」位置不對`); pos = p; });
  assert.ok(t.includes('2026 年 7 月 28 日（星期二）上午 9:30'), '下次開庭日期時間');
  assert.ok(t.includes('地點：臺灣臺北地方法院民事庭 第三法庭'));
  assert.ok(t.includes('6 月 30 日（星期二）已開庭'));
  assert.ok(t.includes('結果：法官請雙方補提資料'));
  assert.ok(t.includes('・醫療收據正本') && t.includes('・請假證明'));
  assert.ok(t.trim().endsWith('王大明律師 敬上'));
});

test('2. 沒有下次開庭：不出現【下次開庭】', () => {
  const t = buildProgressReport({ caseData: baseCase, hearings: [pastHearing], deadlines: [deadline], notes: fullNotes, today: TODAY });
  commonChecks(t);
  assert.ok(!t.includes('【下次開庭】'));
  assert.ok(t.includes('【上次開庭】'));
});

test('3. 沒有期限：不出現【近期重要日期】', () => {
  const t = buildProgressReport({ caseData: baseCase, hearings: [nextHearing], deadlines: [], today: TODAY });
  commonChecks(t);
  assert.ok(!t.includes('【近期重要日期】'));
});

test('4. 系統內部「提前提醒」不寄給當事人；超過 30 天、已過期的期限不列', () => {
  const far = { ...deadline, id: 'dx', action: '提出上訴理由', computedDeadline: '2026-09-30' };
  const passed = { ...deadline, id: 'dy', action: '陳報地址', computedDeadline: '2026-07-01' };
  const t = buildProgressReport({ caseData: baseCase, deadlines: [reminder, far, passed], today: TODAY });
  commonChecks(t);
  assert.ok(!t.includes('【近期重要日期】'), t);
  assert.ok(!t.includes('提醒：'));
});

test('5. 什麼資料都沒有：只剩稱呼、開場、結尾，不出現空段落', () => {
  const t = buildProgressReport({ caseData: {}, today: TODAY });
  commonChecks(t);
  assert.strictEqual(t, '您好：\n\n以下向您報告您委託的案件目前的進度。\n\n' + CLOSING);
});

test('6. 欄位只填「—」「無」「未填」視為沒有資料', () => {
  const c = { ...baseCase, person: '—', cause: '無', caseNumber: '未填', attorneys: ['—'], status: '' };
  const h = { ...nextHearing, courtNameRaw: '—', courtroom: '-', time: '' };
  const t = buildProgressReport({ caseData: { ...c, court: '' }, hearings: [h], notes: { lastResult: '—', clientTodo: '無' }, today: TODAY });
  commonChecks(t);
  assert.ok(t.startsWith('您好：'));
  assert.ok(!t.includes('案號'));
  assert.ok(!t.includes('地點'), '法院法庭都沒有就不寫地點');
  assert.ok(!t.includes('—') && !t.includes('敬上') && !t.includes('【目前進度】') && !t.includes('【需要您協助準備】'));
  assert.ok(t.includes('2026 年 7 月 28 日（星期二）\n'), '沒有時間只寫日期');
});

test('7. 欄位很長：期限事項截斷 40 字，律師自填內容完整保留且不出錯', () => {
  const longAction = '補正'.repeat(60);
  const longNote = '這是一段很長的開庭結果說明。'.repeat(40);
  const t = buildProgressReport({ caseData: { ...baseCase, cause: '損害賠償'.repeat(30) }, deadlines: [{ ...deadline, action: longAction }], notes: { lastResult: longNote }, hearings: [pastHearing], today: TODAY });
  commonChecks(t);
  const line = t.split('\n').find((l) => l.startsWith('・') && l.includes('補正'));
  assert.ok(line.endsWith('…') && line.length < 70, '期限事項要截斷：' + line);
  assert.ok(t.includes(longNote), '律師自填內容不截斷');
});

test('8. 整日開庭不寫時間；法院缺時用案件法院', () => {
  const h = { ...nextHearing, allDay: true, courtNameRaw: '', courtroom: '' };
  const t = buildProgressReport({ caseData: baseCase, hearings: [h], today: TODAY });
  assert.ok(!/上午|下午/.test(t.split('【下次開庭】')[1]));
  assert.ok(t.includes('地點：臺灣臺北地方法院'));
});

test('9. 多場未來開庭只列最近一場；當天開庭算「下次」', () => {
  const todayH = { ...nextHearing, id: 'ht', date: TODAY, time: '15:00' };
  const t = buildProgressReport({ caseData: baseCase, hearings: [laterHearing, todayH, nextHearing], today: TODAY });
  assert.strictEqual((t.match(/【下次開庭】/g) || []).length, 1);
  assert.ok(t.includes('7 月 20 日（星期一）下午 3:00'));
  assert.ok(!t.includes('9 月 10 日'));
});

test('10. 調解中、執行、已結案階段的白話說明', () => {
  const t1 = buildProgressReport({ caseData: { ...baseCase, status: '一審', mediationOngoing: true }, today: TODAY });
  assert.ok(t1.includes('第一審法院審理中。目前雙方也在進行調解。'));
  const t2 = buildProgressReport({ caseData: { ...baseCase, status: '執行' }, today: TODAY });
  assert.ok(t2.includes('強制執行程序，也就是請法院協助實際執行'));
  const t3 = buildProgressReport({ caseData: { ...baseCase, status: '已結案', mediationOngoing: true }, today: TODAY });
  assert.ok(t3.includes('本案已經結案。') && !t3.includes('調解'));
});

test('11. 壞資料（日期格式錯、null、時間怪）不會讓程式出錯', () => {
  const t = buildProgressReport({
    caseData: { ...baseCase, attorneys: null, attorney: '王大明律師、林淑芬律師' },
    hearings: [null, { date: '2026/07/28' }, { date: '' }, { ...nextHearing, time: '99:99' }],
    deadlines: [null, { computedDeadline: 'abc', action: 'x' }, { ...deadline, action: '', eventType: '' }],
    today: TODAY,
  });
  commonChecks(t);
  assert.ok(t.includes('王大明律師、林淑芬律師 敬上'));
  assert.ok(!/上午|下午/.test(t));
  assert.ok(!t.includes('【近期重要日期】'), '沒有事項名稱的期限不列');
});

test('12. 跨年：上次開庭／期限不同年才寫年份', () => {
  const t = buildProgressReport({ caseData: baseCase, hearings: [{ ...pastHearing, date: '2025-12-30' }], deadlines: [{ ...deadline, computedDeadline: '2027-01-05' }], today: '2026-12-20' });
  assert.ok(t.includes('2025 年 12 月 30 日'));
  assert.ok(t.includes('2027 年 1 月 5 日'));
});

test('13. 需要準備事項：清掉前面的符號、空行', () => {
  const t = buildProgressReport({ caseData: baseCase, notes: { clientTodo: '1. 存摺影本\n\n・ 身分證影本\n- 租約' }, today: TODAY });
  assert.ok(t.includes('・存摺影本\n・身分證影本\n・租約'), t);
});

test('14. checkDraft：偵測保證字眼、身分證、手機、結尾被刪', () => {
  assert.deepStrictEqual(checkDraft('您好\n' + CLOSING), []);
  const w = checkDraft('本案保證勝訴，身分證 A123456789，電話 0912-345-678');
  assert.strictEqual(w.length, 4, w.join(' / '));
});

test('16. 一般法定期限改寫成「…後的法定期限截止」；內部筆錄調閱不列', () => {
  const gen = { id: 'd1', kind: 'general', eventType: '收到民事判決', periodDays: 20, computedDeadline: '2026-07-30' };
  const tr = { id: 'tr1', kind: 'transcript', eventType: '筆錄調閱確認', action: '筆錄調閱確認', computedDeadline: '2026-07-25' };
  const t = buildProgressReport({ caseData: baseCase, deadlines: [gen, tr], today: TODAY });
  assert.ok(t.includes('・7 月 30 日（星期四）：收到民事判決後的法定期限截止'), t);
  assert.ok(!t.includes('筆錄'));
});

test('15. 範本本身（資料齊全）不觸發任何提醒', () => {
  const t = buildProgressReport({ caseData: baseCase, hearings: [pastHearing, nextHearing], deadlines: [deadline], notes: fullNotes, today: TODAY });
  assert.deepStrictEqual(checkDraft(t), []);
});

console.log(`\n${pass} 通過，${fail} 失敗`);
process.exit(fail ? 1 : 0);
