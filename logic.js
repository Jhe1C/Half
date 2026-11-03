/* HALF · 拆帳邏輯（純函式，不碰畫面與資料庫）
 * 金額一律為新台幣整數元。
 * 結餘符號：正數 = 對方欠我，負數 = 我欠對方。 */
(function (root) {
  'use strict';

  var CATEGORIES = ['餐飲', '日用', '居住', '交通', '娛樂', '其他'];
  var MODES = {
    equal: { label: '均分', hint: '兩人各付一半，零頭由付款人吸收' },
    ratio: { label: '比例', hint: '依兩人約定的比例分攤' },
    fixed: { label: '指定', hint: '直接輸入付款人自己負擔多少' },
    full:  { label: '代付', hint: '付款人先墊，全額由對方負擔' }
  };

  function toInt(n) {
    n = Number(n);
    return isFinite(n) ? Math.round(n) : 0;
  }

  /** 算出付款人自己負擔的金額。
   *  payerRatio：付款人在「比例」模式下負擔的百分比（0–100）
   *  fixedPayerShare：「指定」模式下輸入的付款人負擔 */
  function payerShare(amount, mode, payerRatio, fixedPayerShare) {
    amount = toInt(amount);
    if (amount <= 0) return 0;
    switch (mode) {
      case 'equal': return amount - Math.floor(amount / 2);
      case 'ratio': {
        var r = Math.min(100, Math.max(0, toInt(payerRatio)));
        return Math.round(amount * r / 100);
      }
      case 'fixed': return Math.min(amount, Math.max(0, toInt(fixedPayerShare)));
      case 'full': return 0;
      default: throw new Error('未知的拆法：' + mode);
    }
  }

  /** 這筆支出對「我」的結餘影響（正 = 對方欠我） */
  function expenseEffect(e, meId) {
    return e.payer === meId ? e.other_share : -e.other_share;
  }

  function settlementEffect(s, meId) {
    // 我付錢給對方 → 我欠的變少（結餘往正走）；對方付給我 → 往負走
    return s.from_user === meId ? s.amount : -s.amount;
  }

  function counts(e) { return !e.deleted_at; }

  /** 目前結餘與本期起點。雙方互相信任：新增、修改、結清都立即生效。 */
  function summarize(expenses, settlements, meId) {
    var events = [];
    expenses.forEach(function (e) {
      if (counts(e)) events.push({ t: e.created_at, d: expenseEffect(e, meId), kind: 'e' });
    });
    settlements.forEach(function (s) {
      events.push({ t: s.created_at, d: settlementEffect(s, meId), kind: 's' });
    });
    events.sort(function (a, b) { return a.t < b.t ? -1 : a.t > b.t ? 1 : 0; });
    var bal = 0, periodStart = null;
    events.forEach(function (ev) {
      bal += ev.d;
      if (ev.kind === 's' && bal === 0) periodStart = ev.t;
    });
    return { balance: bal, periodStart: periodStart };
  }

  /** 某月份（'2026-11'）的統計，只算已確認、未刪除的帳 */
  function monthStats(expenses, ym, meId) {
    var list = expenses.filter(function (e) { return counts(e) && String(e.spent_on).slice(0, 7) === ym; });
    var total = 0, paidByMe = 0, myShare = 0, cats = {};
    list.forEach(function (e) {
      total += e.amount;
      if (e.payer === meId) { paidByMe += e.amount; myShare += e.payer_share; }
      else myShare += e.other_share;
      cats[e.category] = (cats[e.category] || 0) + e.amount;
    });
    var categories = Object.keys(cats).map(function (k) { return { name: k, amount: cats[k] }; })
      .sort(function (a, b) { return b.amount - a.amount; });
    return {
      count: list.length,
      total: total,
      paidByMe: paidByMe,
      paidByOther: total - paidByMe,
      myShare: myShare,
      otherShare: total - myShare,
      categories: categories
    };
  }

  /** 計算機：把「1200+80×2」這類算式算成整數元。
   *  只接受數字與 + − × ÷（也接受 - * /），乘除先於加減，不使用 eval。
   *  回傳 { value: 整數或 null, hasOp: 是否含運算子, rounded: 是否有四捨五入, expr: 正規化後的算式 } */
  function normalizeExpr(s) {
    return String(s == null ? '' : s)
      .replace(/[＊*xX]/g, '×').replace(/[／\/]/g, '÷').replace(/[-－—–]/g, '−').replace(/[＋]/g, '+')
      .replace(/[０-９]/g, function (d) { return String.fromCharCode(d.charCodeAt(0) - 0xFEE0); })
      .replace(/[^0-9.+−×÷]/g, '')
      .replace(/([+−×÷])[+−×÷]+/g, '$1')     // 連續運算子只留第一個
      .replace(/^[+×÷]+/, '');                // 開頭不能是 + × ÷
  }
  function calc(input) {
    var expr = normalizeExpr(input);
    var hasOp = /[+−×÷]/.test(expr.replace(/^−/, ''));
    var body = expr.replace(/[+−×÷]+$/, '');  // 結尾的運算子先忽略，邊打邊算
    if (!body) return { value: null, hasOp: hasOp, rounded: false, expr: expr };
    var tokens = body.match(/\d+(?:\.\d+)?|[+−×÷]/g) || [];
    var nums = [], ops = [], neg = false, i = 0;
    if (tokens[0] === '−') { neg = true; i = 1; }
    var termVal = null, termOp = null;
    function pushTerm() { nums.push(termVal); }
    for (; i < tokens.length; i++) {
      var t = tokens[i];
      if (t === '+' || t === '−') { pushTerm(); ops.push(t); termVal = null; continue; }
      if (t === '×' || t === '÷') { termOp = t; continue; }
      var n = parseFloat(t);
      if (isNaN(n)) return { value: null, hasOp: hasOp, rounded: false, expr: expr };
      if (termVal === null) { termVal = neg ? -n : n; neg = false; }
      else if (termOp === '×') termVal = termVal * n;
      else if (termOp === '÷') { if (n === 0) return { value: null, hasOp: hasOp, rounded: false, expr: expr, error: '不能除以 0' }; termVal = termVal / n; }
      termOp = null;
    }
    pushTerm();
    var total = nums[0];
    for (var k = 0; k < ops.length; k++) total = ops[k] === '+' ? total + nums[k + 1] : total - nums[k + 1];
    if (total === null || !isFinite(total)) return { value: null, hasOp: hasOp, rounded: false, expr: expr };
    var r = Math.round(total);
    return { value: r, hasOp: hasOp, rounded: Math.abs(r - total) > 1e-9, expr: expr };
  }

  function money(n) {
    var s = Math.abs(toInt(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
    return (n < 0 ? '−' : '') + s;
  }

  function signed(n) {
    if (n === 0) return '0';
    return (n > 0 ? '+' : '−') + money(Math.abs(n));
  }

  var api = {
    CATEGORIES: CATEGORIES, MODES: MODES,
    payerShare: payerShare, expenseEffect: expenseEffect, settlementEffect: settlementEffect,
    summarize: summarize, monthStats: monthStats, calc: calc, normalizeExpr: normalizeExpr, money: money, signed: signed, toInt: toInt
  };
  root.HalfLogic = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
