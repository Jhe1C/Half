const L = require('../logic.js');
const assert = require('node:assert/strict');
const A = 'a', B = 'b';

// 分攤
assert.equal(L.payerShare(1280, 'equal'), 640);
assert.equal(L.payerShare(101, 'equal'), 51);           // 零頭由付款人吸收
assert.equal(L.payerShare(1280, 'ratio', 60), 768);
assert.equal(L.payerShare(999, 'ratio', 33), 330);
assert.equal(L.payerShare(1280, 'fixed', null, 800), 800);
assert.equal(L.payerShare(1280, 'fixed', null, 5000), 1280); // 不超過總額
assert.equal(L.payerShare(1280, 'full'), 0);
assert.equal(L.payerShare(0, 'equal'), 0);

const ex = (o) => Object.assign({ deleted_at: null, category: '餐飲', spent_on: '2026-11-02', created_at: o.t }, o);
const E = [
  ex({ id: 1, payer: A, amount: 1280, payer_share: 640, other_share: 640, t: '2026-11-01T10:00' }),
  ex({ id: 2, payer: B, amount: 160, payer_share: 80, other_share: 80, t: '2026-11-01T11:00' }),
  ex({ id: 3, payer: B, amount: 500, payer_share: 250, other_share: 250, t: '2026-11-01T12:00' }),
  ex({ id: 4, payer: A, amount: 300, payer_share: 150, other_share: 150, t: '2026-11-01T13:00', deleted_at: 'x' }),
  ex({ id: 5, payer: A, amount: 1000, payer_share: 0, other_share: 1000, t: '2026-11-01T14:00', category: '居住', spent_on: '2026-10-30' })
];
const BAL = 640 - 80 - 250 + 1000;
let s = L.summarize(E, [], A);
assert.equal(s.balance, BAL);                       // 刪除的不算，其他立即生效
assert.equal(L.summarize(E, [], B).balance, -BAL);

// 全額結清 → 歸零並開始新的一期
s = L.summarize(E, [{ from_user: B, to_user: A, amount: BAL, created_at: '2026-11-02T09:00' }], A);
assert.equal(s.balance, 0);
assert.equal(s.periodStart, '2026-11-02T09:00');
// 部分結清不重設本期
s = L.summarize(E, [{ from_user: B, to_user: A, amount: 500, created_at: '2026-11-02T09:00' }], A);
assert.equal(s.balance, BAL - 500);
assert.equal(s.periodStart, null);

// 月報
const m = L.monthStats(E, '2026-11', A);
assert.equal(m.count, 3);
assert.equal(m.total, 1940);
assert.equal(m.paidByMe, 1280);
assert.equal(m.myShare, 640 + 80 + 250);
assert.equal(m.categories[0].name, '餐飲');

assert.equal(L.money(31880), '31,880');
assert.equal(L.signed(-320), '−320');
assert.equal(L.signed(1173), '+1,173');
// 計算機
const v = (x) => L.calc(x).value;
assert.equal(v('1280'), 1280);
assert.equal(v('1200+80'), 1280);
assert.equal(v('1200+80×2'), 1360);           // 先乘除後加減
assert.equal(v('100-20*3'), 40);              // 接受 - 與 *
assert.equal(v('1000÷3'), 333);
assert.equal(L.calc('1000÷3').rounded, true);
assert.equal(v('100÷0'), null);
assert.equal(v('120+'), 120);                  // 結尾運算子先忽略
assert.equal(L.calc('120+').hasOp, true);
assert.equal(v('2×3×4−4÷2'), 22);
assert.equal(v('１２０＋８０'), 200);           // 全形
assert.equal(v(''), null);
assert.equal(L.normalizeExpr('12++3'), '12+3');
assert.equal(v('−50+80'), 30);
assert.equal(v('1.5×100'), 150);
console.log('logic tests passed');
