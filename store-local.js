/* HALF · 示範模式資料層
 * 資料只存在這台裝置的瀏覽器裡。
 * 可以切換身分扮演另一個人，體驗兩人之間的流程。 */
(function (root) {
  'use strict';
  var KEY = 'half-demo-v2';
  var ME = 'demo-me', HER = 'demo-her';
  var memory = null; // 瀏覽器儲存不可用時的備援

  function uid() {
    return 'x' + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }
  function now(offsetMin) {
    return new Date(Date.now() + (offsetMin || 0) * 60000).toISOString();
  }
  function day(offset) {
    var d = new Date(Date.now() + offset * 86400000);
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }

  function seed() {
    var L = root.HalfLogic;
    var rows = [
      ['房租', '居住', 12000, ME, 'equal', -9, '每月固定'],
      ['電費 · 雙月', '居住', 1260, HER, 'equal', -8, null],
      ['晚餐 · 鍋物', '餐飲', 1280, ME, 'equal', -6, null],
      ['捷運儲值', '交通', 1000, HER, 'full', -5, '幫我儲值'],
      ['電影票 ×2', '娛樂', 640, HER, 'equal', -2, null],
      ['週末採買', '日用', 2346, ME, 'equal', -1, '衛生紙、洗衣精、一週食材'],
      ['早餐', '餐飲', 160, HER, 'equal', 0, null]
    ];
    var expenses = rows.map(function (r, i) {
      var ps = L.payerShare(r[2], r[4], 50);
      var t = now(-(rows.length - i) * 600);
      return {
        id: uid() + i, title: r[0], category: r[1], amount: r[2], payer: r[3], split_mode: r[4],
        payer_share: ps, other_share: r[2] - ps, spent_on: day(r[5]), place: r[1] === '日用' ? '全聯' : null, note: r[6],
        created_by: r[3], last_edited_by: r[3],
        deleted_at: null, created_at: t, updated_at: t
      };
    });
    var logs = [];
    expenses.forEach(function (e) {
      logs.push({ id: uid(), expense_id: e.id, actor: e.created_by, action: 'create', detail: { amount: e.amount }, at: e.created_at });
    });
    return {
      demo: true,
      actingAs: ME,
      ledger: { id: 'demo-ledger', name: '我們的帳本', invite_code: 'DEMO42', category_defaults: {} },
      members: [
        { user_id: ME, display_name: '阿哲', ratio: 60 },
        { user_id: HER, display_name: '小晴', ratio: 40 }
      ],
      expenses: expenses,
      settlements: [],
      logs: logs
    };
  }

  function load() {
    try {
      var raw = localStorage.getItem(KEY);
      if (raw) return JSON.parse(raw);
    } catch (e) { /* 改用記憶體 */ }
    if (memory) return memory;
    memory = seed();
    save(memory);
    return memory;
  }
  function save(s) {
    memory = s;
    try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (e) { /* 只存在記憶體 */ }
    listeners.forEach(function (fn) { setTimeout(fn, 0); });
  }
  var listeners = [];

  function clone(o) { return JSON.parse(JSON.stringify(o)); }
  function fail(msg) { return Promise.reject(new Error(msg)); }

  var store = {
    mode: 'demo',
    init: function () { load(); return Promise.resolve(); },
    getUser: function () { var s = load(); return Promise.resolve({ id: s.actingAs, email: null }); },
    signIn: function () { return Promise.resolve(); },
    signUp: function () { return Promise.resolve(); },
    signOut: function () { return Promise.resolve(); },
    onAuth: function () {},

    getMyLedger: function () {
      var s = load();
      return Promise.resolve({ ledger: clone(s.ledger), members: clone(s.members) });
    },
    createLedger: function () { return Promise.resolve(); },
    joinLedger: function () { return Promise.resolve(); },

    loadAll: function () {
      var s = load();
      return Promise.resolve({ expenses: clone(s.expenses), settlements: clone(s.settlements) });
    },
    subscribe: function (fn) {
      listeners.push(fn);
      var onStorage = function (ev) { if (ev.key === KEY) { memory = null; fn(); } };
      window.addEventListener('storage', onStorage);
      return function () {
        listeners = listeners.filter(function (f) { return f !== fn; });
        window.removeEventListener('storage', onStorage);
      };
    },

    addExpense: function (d) {
      var s = load(), t = now();
      var e = Object.assign({}, d, {
        id: uid(), other_share: d.amount - d.payer_share,
        created_by: s.actingAs, last_edited_by: s.actingAs,
        deleted_at: null, created_at: t, updated_at: t
      });
      s.expenses.push(e);
      s.logs.push({ id: uid(), expense_id: e.id, actor: s.actingAs, action: 'create', detail: { amount: e.amount }, at: t });
      save(s);
      return Promise.resolve(clone(e));
    },
    updateExpense: function (id, patch) {
      var s = load();
      var e = s.expenses.find(function (x) { return x.id === id; });
      if (!e) return fail('找不到這筆帳');
      var detail = {};
      if (patch.amount != null && patch.amount !== e.amount) detail.amount = [e.amount, patch.amount];
      if (patch.title != null && patch.title !== e.title) detail.title = [e.title, patch.title];
      if (patch.payer != null && patch.payer !== e.payer) detail.payer = true;
      if ((patch.split_mode && patch.split_mode !== e.split_mode) || (patch.split_mode === 'fixed' && patch.payer_share !== e.payer_share)) detail.split = [e.split_mode, patch.split_mode || e.split_mode];
      var fields = ['title', 'category', 'amount', 'payer', 'split_mode', 'payer_share', 'spent_on', 'place', 'note'];
      var changed = fields.some(function (f) { return f in patch && (patch[f] || null) !== (e[f] || null); });
      if (!changed) return Promise.resolve(clone(e));
      Object.assign(e, patch);
      e.other_share = e.amount - e.payer_share;
      e.last_edited_by = s.actingAs; e.updated_at = now();
      s.logs.push({ id: uid(), expense_id: id, actor: s.actingAs, action: 'edit', detail: detail, at: e.updated_at });
      save(s);
      return Promise.resolve(clone(e));
    },
    deleteExpense: function (id) {
      var s = load();
      var e = s.expenses.find(function (x) { return x.id === id; });
      if (!e) return fail('找不到這筆帳');
      e.deleted_at = now(); e.last_edited_by = s.actingAs;
      s.logs.push({ id: uid(), expense_id: id, actor: s.actingAs, action: 'delete', detail: {}, at: e.deleted_at });
      save(s);
      return Promise.resolve();
    },
    getLogs: function (expenseId) {
      var s = load();
      return Promise.resolve(clone(s.logs.filter(function (l) { return l.expense_id === expenseId; })));
    },

    addSettlement: function (d) {
      var s = load(), t = now();
      var row = Object.assign({}, d, { id: uid(), created_by: s.actingAs, created_at: t });
      s.settlements.push(row);
      save(s);
      return Promise.resolve(clone(row));
    },
    deleteSettlement: function (id) {
      var s = load();
      s.settlements = s.settlements.filter(function (x) { return x.id !== id; });
      save(s);
      return Promise.resolve();
    },

    updateMember: function (userId, patch) {
      var s = load();
      var m = s.members.find(function (x) { return x.user_id === userId; });
      if (m) Object.assign(m, patch);
      save(s);
      return Promise.resolve();
    },

    // 示範模式專用
    switchIdentity: function () {
      var s = load();
      s.actingAs = s.actingAs === ME ? HER : ME;
      save(s);
      return Promise.resolve(s.actingAs);
    },
    reset: function () {
      memory = null;
      try { localStorage.removeItem(KEY); } catch (e) { /* 忽略 */ }
      save(seed());
      return Promise.resolve();
    }
  };

  root.HalfLocalStore = store;
})(window);
