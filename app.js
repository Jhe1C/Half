/* HALF · 介面
 * 兩人互相信任：任何一方新增、修改、刪除、結清都立即生效，不需要對方確認。
 * 修改紀錄仍會保留在每筆帳的明細裡，方便回查。 */
(function () {
  'use strict';
  var L = window.HalfLogic;
  var cfg = window.HALF_CONFIG || {};
  var store;
  if (cfg.SUPABASE_URL && cfg.SUPABASE_ANON_KEY && window.supabase) store = window.HalfSupabaseStore.create(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, cfg.SHARED_EMAIL);
  else store = window.HalfLocalStore;
  var app = document.getElementById('app');

  var S = {
    phase: 'loading',     // loading | auth | setup | ready
    user: null, ledger: null, members: [], me: null, other: null,
    expenses: [], settlements: [],
    route: 'home', id: null,
    filter: 'all', month: null,
    confirmDelete: false, confirmDelS: null, logs: [], busy: false,
    online: navigator.onLine, toast: null,
    calc: null            // 目前由計算機鍵盤輸入的欄位 id
  };
  var unsub = null;

  // ---------- 小工具 ----------
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }
  function c(a, b) { return 'style="grid-column:' + a + ' / ' + b + '"'; }
  function money(n) { return L.money(n); }
  function pad(n) { return String(n).padStart(2, '0'); }
  function today() {
    var d = new Date();
    return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
  }
  function md(dateStr) { var p = String(dateStr).slice(5, 10).split('-'); return p[0] + '.' + p[1]; }
  function hm(iso) { var d = new Date(iso); return pad(d.getMonth() + 1) + '.' + pad(d.getDate()) + ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes()); }
  function dayOf(iso) { var d = new Date(iso); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  var WEEK = ['週日', '週一', '週二', '週三', '週四', '週五', '週六'];
  var METHOD = { transfer: '轉帳', cash: '現金', other: '其他' };
  function name(uid) {
    if (S.me && uid === S.me.user_id) return '我';
    var m = S.members.find(function (x) { return x.user_id === uid; });
    return m ? m.display_name : '對方';
  }
  function otherName() { return S.other ? S.other.display_name : '對方'; }
  function curYM() { var d = new Date(); return d.getFullYear() + '-' + pad(d.getMonth() + 1); }
  function live() { return S.expenses.filter(function (e) { return !e.deleted_at; }); }
  function sorted(list) {
    return list.slice().sort(function (a, b) {
      if (a.spent_on !== b.spent_on) return a.spent_on < b.spent_on ? 1 : -1;
      return a.created_at < b.created_at ? 1 : -1;
    });
  }
  function toast(msg) {
    S.toast = msg; paintToast();
    clearTimeout(toast.t); toast.t = setTimeout(function () { S.toast = null; paintToast(); }, 2600);
  }
  function paintToast() {
    var el = document.getElementById('toast');
    if (!el) return;
    el.hidden = !S.toast;
    el.textContent = S.toast || '';
  }
  function go(route, id) {
    S.route = route; S.id = id || null; S.confirmDelete = false; S.confirmDelS = null;
    S.calc = null; S.autofocus = route === 'add';
    var h = '#' + route;
    try { if (location.hash !== h) history.pushState(null, '', h); } catch (e) { /* 預覽環境不支援時略過 */ }
    render(); window.scrollTo(0, 0);
  }
  function guard(p) {
    S.busy = true; render();
    return p.then(function (r) { S.busy = false; return r; }, function (e) {
      S.busy = false; render(); toast((e && e.message) || '發生錯誤');
      if (e && typeof e === 'object') e.handled = true;
      throw e;
    });
  }

  // ---------- 資料 ----------
  /* 進入流程：輸入共用密碼（每台裝置一次）→ 選我是誰（每台裝置一次）→ 主畫面 */
  function boot() {
    store.init().then(function () { return store.hasSession(); }).then(function (has) {
      if (!has) { S.phase = 'auth'; render(); return; }
      return enter();
    }).catch(function (e) { S.phase = 'auth'; render(); toast(e && e.message); });
  }
  function enter() {
    return store.getUser().then(function (u) {
      S.user = u;
      if (!u) return toPick();
      return loadLedger();
    });
  }
  function toPick() {
    return store.getMyLedger().then(function (r) {
      S.members = r ? r.members : [];
      S.phase = 'pick'; render();
    });
  }
  function loadLedger() {
    return store.getMyLedger().then(function (r) {
      if (!r) return toPick();
      setLedger(r);
      return refresh().then(function () {
        S.phase = 'ready';
        if (unsub) unsub();
        unsub = store.subscribe(function () { reloadAll(); });
        var h = location.hash.slice(1);
        if (['home', 'ledger', 'stats', 'add', 'settle', 'settings'].indexOf(h) >= 0) S.route = h;
        render();
      });
    });
  }
  function setLedger(r) {
    S.ledger = r.ledger; S.members = r.members;
    var uid = S.user && S.user.id;
    S.me = S.members.find(function (m) { return m.user_id === uid; }) || null;
    S.other = S.members.find(function (m) { return m.user_id !== uid; }) || null;
  }
  function refresh() {
    return store.loadAll().then(function (d) { S.expenses = d.expenses; S.settlements = d.settlements; });
  }
  function reloadAll() {
    return store.getUser().then(function (u) {
      S.user = u;
      return u ? store.getMyLedger() : null;
    }).then(function (r) {
      if (!r) return;
      setLedger(r);
      return refresh();
    }).then(function () {
      if (S.route === 'detail' && S.id) return loadLogs(S.id);
    }).then(function () { if (!isTyping()) render(); })
      .catch(function () { /* 下一次同步會再試 */ });
  }
  function isTyping() {
    var a = document.activeElement;
    return a && /INPUT|TEXTAREA/.test(a.tagName);
  }
  function loadLogs(id) { return store.getLogs(id).then(function (l) { S.logs = l; }); }

  // ---------- 共用區塊 ----------
  function metaBar(right) {
    var d = new Date();
    return '<div class="g meta">' +
      '<a href="#home" ' + c(1, 5) + ' data-go="home">HALF</a>' +
      '<span ' + c(5, 9) + '>' + d.getFullYear() + ' / ' + pad(d.getMonth() + 1) + '</span>' +
      '<span ' + c(9, 13) + '>' + (right || '<a href="#settings" data-go="settings">設定</a>') + '</span>' +
      '</div><hr class="rule">';
  }
  function topBar(back, title, right) {
    return '<div class="g top">' +
      '<a href="#' + back + '" data-go="' + back + '" ' + c(1, 5) + '>' + (back === 'home' ? '× 關閉' : '← 返回') + '</a>' +
      '<span class="b" ' + c(5, 9) + '>' + esc(title) + '</span>' +
      '<span ' + c(9, 13) + '>' + (right || '') + '</span></div><hr class="rule">';
  }
  function secHead(n, label, right) {
    return '<div class="g sec-h"><span class="num" ' + c(1, 3) + '>' + n + '</span>' +
      '<span ' + c(3, right ? 9 : 13) + '>' + label + '</span>' +
      (right ? '<span ' + c(9, 13) + '>' + right + '</span>' : '') + '</div>';
  }
  function nav() {
    var items = [['home', '01', '結餘'], ['ledger', '02', '明細'], ['stats', '03', '月報']];
    return '<nav class="nav" aria-label="主選單"><div class="g">' +
      items.map(function (it, i) {
        return '<a href="#' + it[0] + '" data-go="' + it[0] + '" ' + c(1 + i * 3, 4 + i * 3) +
          (S.route === it[0] ? ' aria-current="page"' : '') + '><span>' + it[1] + '</span><span>' + it[2] + '</span></a>';
      }).join('') +
      '<a href="#add" class="add" data-go="add" aria-label="記一筆" ' + c(10, 13) + '>+</a></div></nav>';
  }
  function strips() {
    var h = '';
    if (!S.online) h += '<div class="g strip"><span ' + c(1, 13) + '>離線中 · 恢復連線後會自動同步</span></div>';
    if (store.mode === 'demo' && S.phase === 'ready') {
      h += '<div class="g strip"><span ' + c(1, 8) + '>示範模式 · 目前扮演「' + esc(S.me ? S.me.display_name : '') + '」</span>' +
        '<span ' + c(8, 13) + '><button data-act="switch">改扮 ' + esc(otherName()) + '</button></span></div>';
    }
    return h;
  }
  function dayParts(dateStr) {
    var d = new Date(dateStr + 'T00:00:00');
    return { day: pad(d.getDate()), wd: (d.getMonth() + 1) + '月 ' + WEEK[d.getDay()] };
  }
  /* 一列 = 一個 12 欄網格。第一行：日期｜項目｜金額；第二行：星期｜說明｜標記。兩行各自基線對齊。 */
  function expenseRow(e, first) {
    var eff = L.expenseEffect(e, S.me.user_id);
    var dp = dayParts(e.spent_on);
    var sub = esc(e.category) + ' · ' + esc(name(e.payer)) + '付 ' + money(e.amount) + ' · ' + L.MODES[e.split_mode].label;
    return '<button class="row' + (first ? ' first' : '') + '" data-open="' + esc(e.id) + '">' +
      '<span class="r-day">' + (first ? dp.day : '') + '</span>' +
      '<span class="r-title">' + esc(e.title) + '</span>' +
      '<span class="r-amt ' + (eff > 0 ? 'pos' : eff < 0 ? 'neg' : 'zero') + '">' + (eff === 0 ? '0' : L.signed(eff)) + '</span>' +
      '<span class="r-wd">' + (first ? dp.wd : '') + '</span>' +
      '<span class="r-sub">' + sub + '</span>' +
      '</button>';
  }
  function settlementRow(s, first) {
    var dp = dayParts(dayOf(s.created_at));
    var asking = S.confirmDelS === s.id;
    return '<div class="row' + (first ? ' first' : '') + '">' +
      '<span class="r-day">' + (first ? dp.day : '') + '</span>' +
      '<span class="r-title">結清 · ' + esc(name(s.from_user)) + ' → ' + esc(name(s.to_user)) + '</span>' +
      '<span class="r-amt zero">' + money(s.amount) + '</span>' +
      '<span class="r-wd">' + (first ? dp.wd : '') + '</span>' +
      '<span class="r-sub">' + METHOD[s.method] + (s.note ? ' · ' + esc(s.note) : '') + '</span>' +
      (asking
        ? '<span class="r-wide"><span class="b">刪除這筆結清？</span><button class="link xs wood" style="min-height:32px" data-del-s-yes="' + esc(s.id) + '">刪除</button><button class="link xs gray" style="min-height:32px" data-del-s-no>取消</button></span>'
        : '<span class="r-tag"><button class="link xs" data-del-s="' + esc(s.id) + '">刪除</button></span>') +
      '</div>';
  }
  /* items: [{ d: 'YYYY-MM-DD', kind: 'e'|'s', row }]，同一天只在第一列顯示日期 */
  function listHtml(items, flat) {
    var last = null;
    return '<div class="list' + (flat ? ' flat' : '') + '">' + items.map(function (it) {
      var first = it.d !== last; last = it.d;
      return it.kind === 's' ? settlementRow(it.row, first) : expenseRow(it.row, first);
    }).join('') + '</div>';
  }

  // ---------- 畫面 ----------
  function vLoading() { return '<div class="loading">HALF · 載入中</div>'; }

  function vAuth() {
    return '<div class="stack grow enter">' +
      '<div class="g meta"><span class="b" ' + c(1, 5) + '>HALF</span><span ' + c(5, 9) + '>雙人拆帳</span></div><hr class="rule">' +
      '<div class="g" style="padding-top:20px"><h1 class="hero" ' + c(1, 13) + '>HALF</h1>' +
      '<p class="xs gray" style="grid-column:1 / 9;padding-top:16px">兩個人，一個數字。先算清楚誰欠誰，再記下錢花在哪。</p></div>' +
      '<hr class="rule" style="margin-top:28px">' + secHead('01', '輸入帳本密碼') +
      '<form id="auth-form" class="stack" novalidate>' +
      '<div class="g field"><label for="a-pw" ' + c(1, 4) + '>密碼</label><input class="input" id="a-pw" type="password" autocomplete="current-password" required ' + c(4, 13) + '></div>' +
      '<div class="g"><p class="err" id="a-err" ' + c(4, 13) + '></p></div>' +
      '<div class="g" style="padding-top:12px"><button class="btn" type="submit" ' + c(1, 13) + (S.busy ? ' disabled' : '') + '>進入<span>→</span></button></div>' +
      '</form><div class="grow"></div>' +
      '<div class="g" style="padding-block:20px"><p class="xs gray" ' + c(1, 10) + '>每台裝置只需要輸入一次。</p></div></div>';
  }

  function vPick() {
    return '<div class="stack grow enter">' +
      '<div class="g meta"><span class="b" ' + c(1, 5) + '>HALF</span><span ' + c(5, 9) + '>雙人拆帳</span></div><hr class="rule">' +
      '<div class="g" style="padding-block:28px 8px"><h1 class="xl w8" ' + c(1, 13) + '>你是誰？</h1>' +
      '<p class="xs gray" style="grid-column:1 / 10;padding-top:14px">這台裝置會記住，之後可以在設定裡更換。</p></div>' +
      '<div class="g" style="padding-block:20px;row-gap:8px">' + S.members.map(function (m) {
        return '<button class="btn" data-pick="' + esc(m.user_id) + '" ' + c(1, 13) + ' style="min-height:64px;font-size:20px">' + esc(m.display_name) + '<span>→</span></button>';
      }).join('') + '</div><div class="grow"></div></div>';
  }

  function vHome() {
    var me = S.me.user_id;
    var sum = L.summarize(S.expenses, S.settlements, me);
    var b = sum.balance;
    var on = otherName();
    var label = b > 0 ? esc(on) + '欠你' : b < 0 ? '你欠' + esc(on) : '目前兩清';
    var since = sum.periodStart ? '本期自 ' + md(dayOf(sum.periodStart)) + ' 起' : '尚未結清過';
    var periodCount = live().filter(function (e) { return !sum.periodStart || e.created_at > sum.periodStart; }).length;

    var h = metaBar() + secHead('01', '結餘 · ' + since);
    h += '<div class="g enter" style="padding-top:24px">' +
      '<p class="m b" ' + c(1, 13) + '>' + label + '</p>' +
      '<div class="money" style="grid-column:1 / 13;margin-top:6px"><span class="cur">NT$</span><span class="hero' + (b > 0 ? ' wood' : '') + '">' + money(Math.abs(b)) + '</span></div>' +
      '<p class="xs gray" style="grid-column:1 / 9;margin-top:16px">本期 ' + periodCount + ' 筆共同支出。</p></div>';

    h += '<div class="g" style="padding-block:24px">' +
      (b !== 0 ? '<a class="btn wood" href="#settle" data-go="settle" ' + c(1, 9) + '>結清 NT$' + money(Math.abs(b)) + '<span>→</span></a>'
        : '<span ' + c(1, 9) + '></span>') +
      '<a class="btn" href="#add" data-go="add" ' + c(9, 13) + '>記一筆<span>+</span></a></div>';

    var ms = L.monthStats(S.expenses, curYM(), me);
    var pctMe = ms.total ? Math.round(ms.paidByMe / ms.total * 1000) / 10 : 50;
    h += '<hr class="rule">' + secHead('02', '本月 · ' + ms.count + ' 筆', '共 ' + money(ms.total));
    h += '<div class="g" style="row-gap:6px;padding-top:14px;align-items:baseline">' +
      '<span class="xs gray" ' + c(5, 9) + '>已付</span><span class="xs gray" ' + c(9, 13) + '>應付</span>' +
      '<span class="m b" ' + c(1, 5) + '>我</span><span class="m" ' + c(5, 9) + '>' + money(ms.paidByMe) + '</span><span class="m" ' + c(9, 13) + '>' + money(ms.myShare) + '</span>' +
      '<span class="m b" ' + c(1, 5) + '>' + esc(on) + '</span><span class="m" ' + c(5, 9) + '>' + money(ms.paidByOther) + '</span><span class="m" ' + c(9, 13) + '>' + money(ms.otherShare) + '</span></div>' +
      '<div class="bar" style="margin-top:16px" aria-hidden="true"><div class="ink" style="width:' + pctMe + '%"></div><div class="wd" style="flex:1"></div></div>' +
      '<div class="g xs" style="padding-block:8px 18px"><span ' + c(1, 7) + '>我付 ' + Math.round(pctMe) + '%</span><span ' + c(7, 13) + '>' + esc(on) + '付 ' + (ms.total ? 100 - Math.round(pctMe) : 50) + '%</span></div>';

    var recent = sorted(live()).slice(0, 5).map(function (e) { return { d: e.spent_on, kind: 'e', row: e }; });
    h += '<hr class="rule">' + secHead('03', '最近', '<a href="#ledger" data-go="ledger" class="b">全部明細 →</a>');
    h += recent.length ? '<div style="padding-top:12px">' + listHtml(recent, true) + '</div>'
      : '<p class="xs gray" style="padding-block:16px">還沒有任何帳。按「記一筆」新增第一筆。</p>';
    return h + '<div class="grow"></div>' + nav();
  }

  function vLedger() {
    var me = S.me.user_id;
    var list = live();
    if (S.filter === 'me') list = list.filter(function (e) { return e.payer === me; });
    if (S.filter === 'other') list = list.filter(function (e) { return e.payer !== me; });
    var items = sorted(list).map(function (e) { return { d: e.spent_on, kind: 'e', row: e, t: e.created_at }; });
    if (S.filter === 'all') {
      S.settlements.forEach(function (s) { items.push({ d: dayOf(s.created_at), kind: 's', row: s, t: s.created_at }); });
      items.sort(function (a, b) { return a.d !== b.d ? (a.d < b.d ? 1 : -1) : (a.t < b.t ? 1 : -1); });
    }
    var f = [['all', '全部'], ['me', '我付'], ['other', esc(otherName()) + '付']];
    var h = metaBar(live().length + ' 筆') +
      '<div class="g" style="padding-top:18px;align-items:end"><h1 class="xl w8" style="grid-column:1 / 9;font-size:64px">明細</h1>' +
      '<p class="xs gray" style="grid-column:9 / 13;padding-bottom:6px"><span class="wood b">+</span> 對方欠你<br><span class="b" style="color:var(--ink)">−</span> 你欠對方</p></div>' +
      '<div class="g" style="padding-block:18px 14px" role="radiogroup" aria-label="篩選">' +
      f.map(function (x, i) {
        return '<label class="opt" ' + c(1 + i * 4, 5 + i * 4) + '><input type="radio" name="flt" value="' + x[0] + '"' + (S.filter === x[0] ? ' checked' : '') + ' data-filter><span>' + x[1] + '</span></label>';
      }).join('') + '</div>';
    h += items.length ? listHtml(items) : '<hr class="rule-2"><p class="xs gray" style="padding-block:16px">這裡還沒有帳。</p>';
    return h + '<div class="grow"></div>' + nav();
  }

  function vDetail() {
    var e = S.expenses.find(function (x) { return x.id === S.id; });
    if (!e) return topBar('ledger', '單筆') + '<p class="xs gray" style="padding-block:20px">找不到這筆帳，可能已被刪除。</p>';
    var me = S.me.user_id;
    var eff = L.expenseEffect(e, me);
    var myShare = e.payer === me ? e.payer_share : e.other_share;
    var hisShare = e.amount - myShare;
    var effTxt = eff === 0 ? '不產生欠款' : eff > 0 ? esc(otherName()) + '欠你 NT$' + money(eff) : '你欠' + esc(otherName()) + ' NT$' + money(-eff);

    var h = topBar('ledger', '單筆', e.deleted_at ? '' : '<button data-act="edit">編輯</button>');
    if (e.deleted_at) h += '<div class="g strip wd"><span ' + c(1, 13) + '>這筆帳已刪除，不計入結餘</span></div>';
    h += '<div class="g enter" style="padding-top:20px">' +
      '<p class="xs gray" ' + c(1, 13) + '>' + esc(e.category) + ' · ' + e.spent_on.replace(/-/g, '.') + (e.place ? ' · ' + esc(e.place) : '') + '</p>' +
      '<h1 class="b" style="grid-column:1 / 13;margin-top:6px;font-size:44px;line-height:1.05;letter-spacing:-0.02em;overflow-wrap:anywhere">' + esc(e.title) + '</h1>' +
      '<div class="money" style="grid-column:1 / 13;margin-top:10px"><span class="cur">NT$</span><span class="xl w8">' + money(e.amount) + '</span></div></div>';

    h += '<div class="g" style="padding-block:22px 20px">' +
      '<div class="receipt" ' + c(1, 6) + ' aria-hidden="true"><div class="dot"></div><div class="sq"></div><div class="ln"></div><div class="ln" style="width:70%"></div><span class="xs">' + esc(e.category) + '</span></div>' +
      '<div class="g xs" style="grid-column:6 / 13;grid-template-columns:repeat(7,minmax(0,1fr));row-gap:10px;align-content:start">' +
      '<span ' + c(1, 3) + '>付款</span><span class="b" ' + c(3, 8) + '>' + esc(name(e.payer)) + '</span>' +
      '<span ' + c(1, 3) + '>拆法</span><span class="b" ' + c(3, 8) + '>' + L.MODES[e.split_mode].label + '</span>' +
      (e.note ? '<span ' + c(1, 3) + '>備註</span><span class="wrap" ' + c(3, 8) + '>' + esc(e.note) + '</span>' : '') +
      '</div></div>';

    h += '<hr class="rule">' + secHead('01', '分攤結果') +
      '<div class="g" style="padding-block:12px 18px;align-items:baseline">' +
      '<span class="xs gray" ' + c(1, 7) + '>我負擔</span><span class="xs gray" ' + c(7, 13) + '>' + esc(otherName()) + '負擔</span>' +
      '<span class="l b" ' + c(1, 7) + '>' + money(myShare) + '</span><span class="l b" ' + c(7, 13) + '>' + money(hisShare) + '</span>' +
      '<p class="s b wood" style="grid-column:1 / 13;padding-top:10px">→ ' + effTxt + '</p></div>';

    var actLabel = { create: '建立', edit: '修改', delete: '刪除', restore: '復原' };
    h += '<hr class="rule">' + secHead('02', '紀錄') + '<div class="g xs" style="row-gap:8px;padding-block:12px 20px">';
    S.logs.forEach(function (l, i) {
      var det = '';
      if (l.action === 'create' && l.detail && l.detail.amount) det = ' · NT$' + money(l.detail.amount);
      if (l.action === 'edit' && l.detail) {
        var parts = [];
        if (l.detail.amount) parts.push('金額 ' + money(l.detail.amount[0]) + ' → ' + money(l.detail.amount[1]));
        if (l.detail.title) parts.push('名稱');
        if (l.detail.payer) parts.push('付款人');
        if (l.detail.split) parts.push('拆法');
        if (parts.length) det = ' · ' + parts.join('、');
      }
      var last = i === S.logs.length - 1;
      h += '<span class="' + (last ? 'b' : '') + '" ' + c(1, 5) + '>' + hm(l.at) + '</span>' +
        '<span class="' + (last ? 'b' : '') + '" ' + c(5, 13) + '>' + esc(name(l.actor)) + ' ' + (actLabel[l.action] || l.action) + det + '</span>';
    });
    if (!S.logs.length) h += '<span ' + c(1, 13) + '>沒有紀錄</span>';
    h += '</div>';

    if (!e.deleted_at) {
      h += '<hr class="rule"><div class="g" style="padding-block:16px 24px;row-gap:8px">';
      if (S.confirmDelete) {
        h += '<p class="s b" ' + c(1, 13) + '>確定刪除「' + esc(e.title) + '」？</p>' +
          '<button class="btn wood small" data-act="delete-yes" ' + c(1, 7) + '>刪除</button>' +
          '<button class="btn line small" data-act="delete-no" ' + c(7, 13) + '>取消</button>';
      } else {
        h += '<button class="link xs" data-act="delete" ' + c(1, 7) + '>刪除這筆帳</button>';
      }
      h += '</div>';
    }
    return h;
  }

  function defaultMode(cat) {
    var d = S.ledger && S.ledger.category_defaults;
    return (d && d[cat]) || 'equal';
  }

  function vForm() {
    var editing = S.route === 'edit';
    var e = editing ? S.expenses.find(function (x) { return x.id === S.id; }) : null;
    var me = S.me.user_id;
    var d = e || { title: '', category: '餐飲', amount: '', payer: me, split_mode: defaultMode('餐飲'), payer_share: '', spent_on: today(), place: '', note: '' };
    var h = topBar(editing ? 'detail' : 'home', editing ? '編輯' : '記一筆', '<span class="xs">' + md(today()) + '</span>');
    h += '<form id="exp-form" class="stack grow" novalidate>';
    h += '<div class="g" style="padding-top:20px"><span class="num" ' + c(1, 3) + '>01</span><label for="f-amount" class="xs gray" ' + c(3, 13) + '>金額 · 新台幣</label>' +
      '<div class="money" style="grid-column:1 / 13;margin-top:10px;align-items:flex-end"><span class="cur" style="padding-bottom:8px">NT$</span>' +
      '<input class="amount-in calc-in" id="f-amount" inputmode="none" autocomplete="off" enterkeyhint="done" placeholder="0" value="' + esc(d.amount) + '"></div>' +
      '<p class="calc-res" id="f-amount-res" style="grid-column:1 / 13"></p></div>';
    h += '<div class="g field" style="padding-top:20px"><label for="f-title" ' + c(1, 3) + '>項目</label><input class="input" id="f-title" maxlength="60" placeholder="例如：晚餐" value="' + esc(d.title) + '" ' + c(3, 13) + '></div>';
    h += '<div class="g" style="padding-block:6px 18px;row-gap:8px" role="radiogroup" aria-label="類別"><span class="xs gray" style="grid-column:1 / 3;align-self:center">類別</span>' +
      L.CATEGORIES.map(function (k, i) {
        var a = [3, 6, 9][i % 3], b = [6, 9, 13][i % 3];
        return '<label class="opt" style="grid-column:' + a + ' / ' + b + '"><input type="radio" name="cat" value="' + k + '"' + (d.category === k ? ' checked' : '') + '><span>' + k + '</span></label>';
      }).join('') + '</div>';

    h += '<hr class="rule">' + secHead('02', '誰付的');
    h += '<div class="g" style="padding-block:10px 18px">' + S.members.map(function (m, i) {
      return '<label class="opt big" ' + c(1 + i * 6, 7 + i * 6) + '><input type="radio" name="payer" value="' + esc(m.user_id) + '"' + (d.payer === m.user_id ? ' checked' : '') + '><span>' + esc(m.user_id === me ? '我' : m.display_name) + '</span></label>';
    }).join('') + '</div>';

    h += '<hr class="rule">' + secHead('03', '怎麼分');
    h += '<div class="g" style="padding-top:10px">' + Object.keys(L.MODES).map(function (k, i) {
      return '<label class="opt w" ' + c(1 + i * 3, 4 + i * 3) + '><input type="radio" name="mode" value="' + k + '"' + (d.split_mode === k ? ' checked' : '') + '><span style="min-height:44px">' + L.MODES[k].label + '</span></label>';
    }).join('') + '<p class="xs gray" id="mode-hint" style="grid-column:1 / 13;padding-top:8px"></p></div>';
    h += '<div class="g field" id="fixed-row" hidden><label for="f-fixed" ' + c(1, 6) + ' id="fixed-label">付款人負擔</label><input class="input calc-in" id="f-fixed" inputmode="none" autocomplete="off" value="' + (e && e.split_mode === 'fixed' ? e.payer_share : '') + '" ' + c(6, 13) + '><p class="calc-res" id="f-fixed-res" ' + c(6, 13) + '></p></div>';
    h += '<div class="g" style="padding-top:14px;align-items:baseline">' +
      '<span class="xs gray" ' + c(1, 7) + '>我負擔</span><span class="xs gray" ' + c(7, 13) + '>' + esc(otherName()) + '負擔</span>' +
      '<span class="l b" id="sh-me" ' + c(1, 7) + '>0</span><span class="l b" id="sh-other" ' + c(7, 13) + '>0</span>' +
      '<p class="s b wood" id="effect" style="grid-column:1 / 13;padding-top:10px"></p></div>';

    h += '<hr class="rule" style="margin-top:20px">' + secHead('04', '選填');
    h += '<div class="g field"><label for="f-date" ' + c(1, 3) + '>日期</label><input class="input" id="f-date" type="date" value="' + esc(d.spent_on) + '" ' + c(3, 13) + '></div>';
    h += '<div class="g field"><label for="f-place" ' + c(1, 3) + '>地點</label><input class="input" id="f-place" maxlength="60" value="' + esc(d.place || '') + '" ' + c(3, 13) + '></div>';
    h += '<div class="g field"><label for="f-note" ' + c(1, 3) + '>備註</label><textarea class="input" id="f-note" maxlength="300" rows="2" ' + c(3, 13) + '>' + esc(d.note || '') + '</textarea></div>';
    h += '<div class="g"><p class="err" id="f-err" ' + c(1, 13) + '></p></div>';
    h += '<div class="grow"></div><div class="g" style="padding-block:12px 24px">' +
      '<button class="btn" type="submit" ' + c(1, 13) + (S.busy ? ' disabled' : '') + '>' + (editing ? '儲存修改' : '儲存') + '<span>→</span></button></div>';
    h += '</form>';
    return h;
  }

  function readForm() {
    var f = document.getElementById('exp-form');
    if (!f) return null;
    var get = function (n) { var x = f.querySelector('input[name="' + n + '"]:checked'); return x ? x.value : null; };
    var amount = L.calc(document.getElementById('f-amount').value).value || 0;
    var payer = get('payer'), mode = get('mode');
    var pm = S.members.find(function (m) { return m.user_id === payer; });
    var fixed = L.calc(document.getElementById('f-fixed').value).value || 0;
    var ps = L.payerShare(amount, mode, pm ? pm.ratio : 50, fixed);
    return {
      amount: amount, title: document.getElementById('f-title').value.trim(), category: get('cat'),
      payer: payer, split_mode: mode, payer_share: ps,
      spent_on: document.getElementById('f-date').value || today(),
      place: document.getElementById('f-place').value.trim() || null,
      note: document.getElementById('f-note').value.trim() || null
    };
  }

  function updatePreview() {
    var v = readForm();
    if (!v) return;
    showCalc(document.getElementById('f-amount'));
    showCalc(document.getElementById('f-fixed'));
    var me = S.me.user_id;
    var myShare = v.payer === me ? v.payer_share : v.amount - v.payer_share;
    document.getElementById('sh-me').textContent = money(myShare);
    document.getElementById('sh-other').textContent = money(v.amount - myShare);
    var owe = v.amount - v.payer_share;
    var on = otherName();
    document.getElementById('effect').textContent = !v.amount ? '輸入金額後會顯示結果'
      : owe === 0 ? '→ 不產生欠款'
      : v.payer === me ? '→ ' + on + '欠你 NT$' + money(owe) : '→ 你欠' + on + ' NT$' + money(owe);
    var hint = L.MODES[v.split_mode].hint;
    if (v.split_mode === 'ratio') {
      hint = '依約定比例：' + S.members.map(function (m) { return (m.user_id === me ? '我' : m.display_name) + ' ' + m.ratio; }).join(' : ') + '（可在設定調整）';
    }
    document.getElementById('mode-hint').textContent = hint;
    document.getElementById('fixed-row').hidden = v.split_mode !== 'fixed';
    document.getElementById('fixed-label').textContent = (v.payer === me ? '我' : on) + '自己負擔';
  }

  function vSettle() {
    var me = S.me.user_id;
    var b = L.summarize(S.expenses, S.settlements, me).balance;
    var on = otherName();
    var h = topBar('home', '結清', '');
    if (b === 0) {
      return h + '<div class="g" style="padding-top:28px"><p class="xl b" ' + c(1, 13) + '>目前兩清</p><p class="xs gray" style="grid-column:1 / 9;padding-top:12px">沒有需要結清的金額。</p></div>';
    }
    var owedToMe = b > 0;
    h += '<form id="settle-form" class="stack grow" novalidate>';
    h += '<div class="g enter" style="padding-top:28px">' +
      '<span class="num" ' + c(1, 3) + '>01</span><span class="xs gray" ' + c(3, 13) + '>目前結餘</span>' +
      '<p class="b" style="grid-column:1 / 13;font-size:22px;margin-top:24px">' + (owedToMe ? esc(on) + ' → 我' : '我 → ' + esc(on)) + '</p>' +
      '<div class="money wood" style="grid-column:1 / 13;margin-top:8px"><span class="cur">NT$</span><span class="hero">' + money(Math.abs(b)) + '</span></div></div>';
    h += '<hr class="rule" style="margin-top:28px">' + secHead('02', '這次付多少');
    h += '<div class="g field"><label for="s-amount" ' + c(1, 4) + '>金額</label><input class="input calc-in" id="s-amount" inputmode="none" autocomplete="off" value="' + Math.abs(b) + '" ' + c(4, 13) + '><p class="calc-res" id="s-amount-res" ' + c(4, 13) + '></p></div>' +
      '<p class="xs gray" style="padding-bottom:6px">可以改成較小的金額，做部分結清。</p>';
    h += '<hr class="rule">' + secHead('03', '怎麼付');
    h += '<div class="g" style="padding-block:10px 4px">' + [['transfer', '轉帳'], ['cash', '現金'], ['other', '其他']].map(function (m, i) {
      return '<label class="opt" ' + c(1 + i * 4, 5 + i * 4) + '><input type="radio" name="method" value="' + m[0] + '"' + (i === 0 ? ' checked' : '') + '><span style="min-height:44px">' + m[1] + '</span></label>';
    }).join('') + '</div>';
    h += '<div class="g field"><label for="s-note" ' + c(1, 4) + '>備註</label><input class="input" id="s-note" maxlength="100" placeholder="例如：轉帳末五碼" ' + c(4, 13) + '></div>';
    h += '<div class="g xs" style="padding-top:12px"><span class="num" ' + c(1, 3) + '>04</span><p ' + c(3, 11) + '>記錄後立即計入。結餘歸零時本期封存，紀錄隨時可在明細回查，也可以刪除。</p></div>';
    h += '<div class="g"><p class="err" id="s-err" ' + c(1, 13) + '></p></div>';
    h += '<div class="grow"></div><div class="g" style="padding-block:12px 24px">' +
      '<button class="btn wood" type="submit" ' + c(1, 13) + (S.busy ? ' disabled' : '') + '>' + (owedToMe ? '記錄：' + esc(on) + '已付我' : '記錄：我已付給' + esc(on)) + '<span>→</span></button></div></form>';
    return h;
  }

  function vStats() {
    var me = S.me.user_id;
    var ym = S.month || curYM();
    var y = +ym.slice(0, 4), m = +ym.slice(5, 7);
    var ms = L.monthStats(S.expenses, ym, me);
    var max = ms.categories.length ? ms.categories[0].amount : 1;
    var pctMe = ms.total ? Math.round(ms.paidByMe / ms.total * 1000) / 10 : 50;
    var on = otherName();
    var h = metaBar('<button class="link xs b" data-month="-1" style="min-height:0">← 上月</button>') +
      '<div class="g" style="padding-top:14px;align-items:end">' +
      '<p class="w3" style="grid-column:1 / 9;font-size:132px;line-height:0.82;letter-spacing:-0.06em">' + pad(m) + '</p>' +
      '<p class="xs gray" style="grid-column:9 / 13;padding-bottom:4px">' + y + '<br>共同支出<br>' + ms.count + ' 筆' +
      (ym < curYM() ? '<br><button class="link xs b" data-month="1" style="min-height:24px">下月 →</button>' : '') + '</p></div>';
    h += '<div class="g" style="padding-block:18px 20px;align-items:baseline">' +
      '<span class="xs gray" ' + c(1, 7) + '>總計</span><span class="xs gray" ' + c(7, 13) + '>我負擔</span>' +
      '<span class="l w8" ' + c(1, 7) + '>' + money(ms.total) + '</span><span class="l b" ' + c(7, 13) + '>' + money(ms.myShare) + '</span></div>';
    h += '<hr class="rule">' + secHead('01', '花在哪裡');
    if (!ms.categories.length) h += '<p class="xs gray" style="padding-block:14px">這個月沒有帳。</p>';
    ms.categories.forEach(function (k, i) {
      h += '<div class="g" style="row-gap:4px;padding-top:12px;align-items:baseline">' +
        '<span class="s b" ' + c(1, 5) + '>' + esc(k.name) + '</span>' +
        '<span class="xs gray" ' + c(5, 9) + '>' + Math.round(k.amount / ms.total * 100) + '%</span>' +
        '<span class="s' + (i === 0 ? ' b' : '') + '" ' + c(9, 13) + '>' + money(k.amount) + '</span>' +
        '<div class="cat-track" style="grid-column:1 / 13" aria-hidden="true"><div class="cat-bar' + (i === 0 ? ' top1' : '') + '" style="width:' + (k.amount / max * 100) + '%"></div></div></div>';
    });
    h += '<div style="height:20px"></div><hr class="rule">' + secHead('02', '誰先墊的');
    h += '<div class="g s" style="padding-top:10px"><span ' + c(1, 7) + '><b>我</b> ' + money(ms.paidByMe) + '</span><span ' + c(7, 13) + '><b>' + esc(on) + '</b> ' + money(ms.paidByOther) + '</span></div>' +
      '<div class="bar" style="margin-top:8px" aria-hidden="true"><div class="ink" style="width:' + pctMe + '%"></div><div class="wd" style="flex:1"></div></div>';
    return h + '<div class="grow"></div>' + nav();
  }

  function vSettings() {
    var me = S.me, other = S.other;
    var n = 1;
    function num() { return pad(n++); }
    var h = topBar('home', '設定', '');
    h += '<form id="set-form" class="stack">';
    h += secHead(num(), '稱呼');
    h += '<div class="g field"><label for="st-me" ' + c(1, 4) + '>我</label><input class="input" id="st-me" maxlength="20" value="' + esc(me.display_name) + '" ' + c(4, 13) + '></div>';
    if (other) h += '<div class="g field"><label for="st-other" ' + c(1, 4) + '>對方</label><input class="input" id="st-other" maxlength="20" value="' + esc(other.display_name) + '" ' + c(4, 13) + '></div>';
    if (other) {
      h += '<hr class="rule" style="margin-top:12px">' + secHead(num(), '「比例」拆法的約定');
      h += '<div class="g field"><label for="st-ratio" ' + c(1, 4) + '>我負擔 %</label><input class="input" id="st-ratio" type="number" min="0" max="100" value="' + me.ratio + '" ' + c(4, 8) + '><span class="xs gray" id="st-ratio-o" ' + c(8, 13) + '>' + esc(other.display_name) + ' ' + (100 - me.ratio) + '%</span></div>';
    }
    h += '<div class="g" style="padding-block:14px 20px"><button class="btn small" type="submit" ' + c(1, 7) + '>儲存</button></div></form>';

    h += '<hr class="rule">' + secHead(num(), '這台裝置');
    h += '<div class="g" style="padding-block:10px 20px;row-gap:8px">';
    if (!window.HALF_NO_EXPORT) h += '<button class="btn line small" data-act="export" ' + c(1, 13) + '>匯出全部明細（CSV）<span>↓</span></button>';
    if (store.mode === 'demo') {
      h += '<button class="btn line small" data-act="switch" ' + c(1, 13) + '>改扮' + esc(other ? other.display_name : '對方') + '，體驗對方的畫面<span>⇄</span></button>' +
        '<button class="btn line small" data-act="reset" ' + c(1, 13) + '>重設示範資料</button>' +
        '<p class="xs gray" ' + c(1, 13) + '>目前是示範模式，資料只存在這台裝置。</p>';
    } else {
      h += '<p class="xs gray" ' + c(1, 13) + '>這台裝置目前是「' + esc(me.display_name) + '」在用。</p>' +
        '<button class="btn line small" data-act="forget" ' + c(1, 13) + '>這台裝置不是我，重新選擇<span>⇄</span></button>' +
        '<button class="btn line small" data-act="signout" ' + c(1, 13) + '>登出這台裝置<span>↗</span></button>' +
        '<p class="xs gray" ' + c(1, 13) + '>登出後，這台裝置要重新輸入帳本密碼。</p>';
    }
    h += '</div>';
    return h;
  }

  // ---------- 計算機鍵盤 ----------
  // 金額欄位用 inputmode="none"，手機不會跳出系統鍵盤，改由這組鍵盤輸入；電腦上仍可直接打字。
  var KEYS = [
    ['C', 'fn', '清除'], ['⌫', 'fn', '刪除一位'], ['÷', 'op', '除'], ['×', 'op', '乘'],
    ['7'], ['8'], ['9'], ['−', 'op', '減'],
    ['4'], ['5'], ['6'], ['+', 'op', '加'],
    ['1'], ['2'], ['3'], ['=', 'eq', '等於'],
    ['0', 'zero'], ['00'], ['done', 'done', '完成']
  ];
  var kp = document.createElement('div');
  kp.className = 'keypad'; kp.id = 'keypad'; kp.hidden = true;
  kp.setAttribute('role', 'group'); kp.setAttribute('aria-label', '計算機鍵盤');
  kp.innerHTML = '<div class="kp-inner"><div class="g kp-head"><span class="kp-expr" id="kp-expr"></span><span class="kp-val" id="kp-val"></span></div>' +
    '<div class="kp-keys">' + KEYS.map(function (k) {
      var label = k[0] === 'done' ? '完成<span>↵</span>' : k[0];
      return '<button type="button" class="key ' + (k[1] || '') + '" data-key="' + k[0] + '"' + (k[2] ? ' aria-label="' + k[2] + '"' : '') + '>' + label + '</button>';
    }).join('') + '</div></div>';
  document.body.appendChild(kp);

  function calcEl() { return S.calc ? document.getElementById(S.calc) : null; }
  function amountInvalid(id) {
    var el = document.getElementById(id);
    return !!(el && el.value && L.calc(el.value).value === null);
  }
  function showCalc(el) {
    var r = L.calc(el.value);
    var res = document.getElementById(el.id + '-res');
    var txt = '';
    if (r.error) txt = r.error;
    else if (r.hasOp && r.value !== null) txt = '= <b>' + money(r.value) + '</b>' + (r.rounded ? '　已四捨五入到元' : '');
    if (res) res.innerHTML = txt;
    if (el.id === 'f-amount') {
      var len = el.value.length;
      el.classList.toggle('mid', len > 6 && len <= 10);
      el.classList.toggle('small', len > 10);
    }
    if (S.calc === el.id) {
      document.getElementById('kp-expr').textContent = el.value || '輸入金額，可用 + − × ÷';
      document.getElementById('kp-val').textContent = r.value !== null ? '= ' + money(r.value) : (r.error || '');
    }
  }
  function openKeypad(el) {
    S.calc = el.id;
    kp.hidden = false;
    document.documentElement.style.setProperty('--kp-h', kp.offsetHeight + 'px');
    document.documentElement.classList.add('kp-open');
    showCalc(el);
    var box = el.getBoundingClientRect();
    if (box.bottom > window.innerHeight - kp.offsetHeight - 16 || box.top < 0) {
      window.scrollBy({ top: box.bottom - (window.innerHeight - kp.offsetHeight) + 72, behavior: 'smooth' });
    }
  }
  function closeKeypad() {
    if (!S.calc && kp.hidden) return;
    S.calc = null;
    kp.hidden = true;
    document.documentElement.style.setProperty('--kp-h', '0px');
    document.documentElement.classList.remove('kp-open');
  }
  function settle(el) {
    var r = L.calc(el.value);
    if (r.value !== null && r.hasOp) el.value = String(r.value);
  }
  function pressKey(k) {
    var el = calcEl();
    if (!el) return;
    var v = el.value;
    var isOp = /^[+−×÷]$/.test(k);
    if (/^\d+$/.test(k)) {
      if (v === '0') v = '';
      if (v.length < 40) v += (k === '00' && (v === '' || /[+−×÷]$/.test(v))) ? '0' : k;
    } else if (isOp) {
      if (v === '' && k !== '−') return;
      v = /[+−×÷]$/.test(v) ? v.slice(0, -1) + k : v + k;
    } else if (k === '⌫') v = v.slice(0, -1);
    else if (k === 'C') v = '';
    else if (k === '=' || k === 'done') {
      var r = L.calc(v);
      if (r.value !== null) v = String(r.value);
    }
    el.value = v;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    if (k === 'done') { el.blur(); closeKeypad(); }
  }
  // 按住鍵盤時不讓輸入框失去焦點
  kp.addEventListener('pointerdown', function (ev) { if (ev.target.closest('.key')) ev.preventDefault(); });
  kp.addEventListener('mousedown', function (ev) { ev.preventDefault(); });
  kp.addEventListener('click', function (ev) {
    var key = ev.target.closest('[data-key]');
    if (key) pressKey(key.getAttribute('data-key'));
  });
  document.addEventListener('focusin', function (ev) {
    var t = ev.target;
    if (t.classList && t.classList.contains('calc-in')) openKeypad(t);
    else if (S.calc && t !== document.body && !kp.contains(t)) closeKeypad();
  });
  document.addEventListener('focusout', function (ev) {
    if (!(ev.target.classList && ev.target.classList.contains('calc-in'))) return;
    settle(ev.target);
    showCalc(ev.target);
    if (S.route === 'add' || S.route === 'edit') updatePreview();
    setTimeout(function () {
      var a = document.activeElement;
      if (!(a && a.classList && a.classList.contains('calc-in')) && !kp.contains(a)) closeKeypad();
    }, 0);
  });
  document.addEventListener('keydown', function (ev) {
    var t = ev.target;
    if (ev.key === 'Enter' && t.classList && t.classList.contains('calc-in')) {
      ev.preventDefault(); pressKey('done');
    }
  });

  // ---------- 繪製 ----------
  function render() {
    var v;
    if (S.phase === 'loading') v = vLoading();
    else if (S.phase === 'auth') v = vAuth();
    else if (S.phase === 'pick') v = vPick();
    else {
      switch (S.route) {
        case 'ledger': v = vLedger(); break;
        case 'stats': v = vStats(); break;
        case 'detail': v = vDetail(); break;
        case 'add': case 'edit': v = vForm(); break;
        case 'settle': v = vSettle(); break;
        case 'settings': v = vSettings(); break;
        default: v = vHome();
      }
    }
    var calcRoute = S.phase === 'ready' && (S.route === 'add' || S.route === 'edit' || S.route === 'settle');
    var keep = S.calc;
    app.innerHTML = strips() + v;
    if (!calcRoute) closeKeypad();
    if (S.phase === 'ready' && (S.route === 'add' || S.route === 'edit')) updatePreview();
    if (calcRoute) {
      Array.prototype.forEach.call(app.querySelectorAll('.calc-in'), showCalc);
      var target = keep && document.getElementById(keep);
      if (!target && S.autofocus) target = document.getElementById('f-amount');
      S.autofocus = false;
      if (target) target.focus({ preventScroll: true });
      else closeKeypad();
    }
    paintToast();
  }

  // ---------- 事件 ----------
  document.addEventListener('click', function (ev) {
    var t = ev.target.closest('[data-go],[data-open],[data-act],[data-month],[data-pick],[data-del-s],[data-del-s-yes],[data-del-s-no]');
    if (!t) return;
    if (t.hasAttribute('data-go')) { ev.preventDefault(); return go(t.getAttribute('data-go'), t.getAttribute('data-go') === 'detail' ? S.id : null); }
    if (t.hasAttribute('data-open')) {
      var id = t.getAttribute('data-open');
      S.logs = []; go('detail', id); loadLogs(id).then(render); return;
    }
    if (t.hasAttribute('data-month')) {
      var ym = S.month || curYM(), y = +ym.slice(0, 4), m = +ym.slice(5, 7) + +t.getAttribute('data-month');
      if (m < 1) { m = 12; y--; } if (m > 12) { m = 1; y++; }
      S.month = y + '-' + pad(m); return render();
    }
    if (t.hasAttribute('data-pick')) {
      store.pickIdentity(t.getAttribute('data-pick'));
      S.route = 'home';
      try { history.replaceState(null, '', '#home'); } catch (e) { /* 略過 */ }
      return guard(enter());
    }
    if (t.hasAttribute('data-del-s')) { S.confirmDelS = t.getAttribute('data-del-s'); return render(); }
    if (t.hasAttribute('data-del-s-no')) { S.confirmDelS = null; return render(); }
    if (t.hasAttribute('data-del-s-yes')) {
      return guard(store.deleteSettlement(t.getAttribute('data-del-s-yes'))).then(refresh).then(function () { S.confirmDelS = null; render(); toast('已刪除結清紀錄'); });
    }
    var act = t.getAttribute('data-act');
    if (act === 'switch') {
      store.switchIdentity().then(function () { return reloadAll(); }).then(function () { toast('現在扮演「' + S.me.display_name + '」'); });
    } else if (act === 'reset') {
      store.reset().then(reloadAll).then(function () { go('home'); toast('示範資料已重設'); });
    } else if (act === 'edit') {
      go('edit', S.id);
    } else if (act === 'delete') {
      S.confirmDelete = true; render();
    } else if (act === 'delete-no') {
      S.confirmDelete = false; render();
    } else if (act === 'delete-yes') {
      guard(store.deleteExpense(S.id)).then(refresh).then(function () { go('ledger'); toast('已刪除'); });
    } else if (act === 'forget') {
      if (unsub) { unsub(); unsub = null; }
      store.forgetIdentity().then(function () { S.user = null; S.route = 'home'; return toPick(); });
    } else if (act === 'signout') {
      if (unsub) { unsub(); unsub = null; }
      store.signOut().then(function () { S.user = null; S.phase = 'auth'; S.route = 'home'; render(); });
    } else if (act === 'export') {
      exportCsv();
    }
  });

  document.addEventListener('change', function (ev) {
    var t = ev.target;
    if (t.hasAttribute('data-filter')) { S.filter = t.value; return render(); }
    if (t.closest('#exp-form')) {
      if (t.name === 'mode') t.form.dataset.modeTouched = '1';
      if (t.name === 'cat' && !t.form.dataset.modeTouched && S.route === 'add') {
        var r = t.form.querySelector('input[name="mode"][value="' + defaultMode(t.value) + '"]');
        if (r) r.checked = true;
      }
      updatePreview();
    }
  });
  document.addEventListener('input', function (ev) {
    var t = ev.target;
    if (t.classList && t.classList.contains('calc-in')) {
      var clean = L.normalizeExpr(t.value).slice(0, 40);
      if (clean !== t.value) t.value = clean;
      showCalc(t);
    }
    if (t.closest('#exp-form')) updatePreview();
    if (t.id === 'st-ratio') {
      var o = document.getElementById('st-ratio-o');
      var v = Math.min(100, Math.max(0, L.toInt(t.value)));
      if (o) o.textContent = otherName() + ' ' + (100 - v) + '%';
    }
  });

  document.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var f = ev.target;
    if (f.id === 'auth-form') {
      var pw = document.getElementById('a-pw').value;
      var err = document.getElementById('a-err');
      if (!pw) { err.textContent = '請輸入密碼'; return; }
      return guard(store.signIn(pw)).then(enter)
        .catch(function (e) { var el = document.getElementById('a-err'); if (el) el.textContent = e.message; });
    }
    if (f.id === 'exp-form') {
      var v = readForm(), ferr = document.getElementById('f-err');
      if (!v.amount || v.amount < 0) { ferr.textContent = '請輸入金額'; document.getElementById('f-amount').focus(); return; }
      if (!v.title) { ferr.textContent = '請輸入項目名稱'; document.getElementById('f-title').focus(); return; }
      if (amountInvalid('f-amount')) { ferr.textContent = '金額算式有誤，請檢查'; return; }
      if (v.split_mode === 'fixed' && (L.calc(document.getElementById('f-fixed').value).value || 0) > v.amount) { ferr.textContent = '自己負擔的金額不能超過總額'; return; }
      var editing = S.route === 'edit', id = S.id;
      var p2 = editing ? store.updateExpense(id, v) : store.addExpense(v);
      return guard(p2).then(function () {
        return refresh().then(function () {
          if (editing) { S.logs = []; go('detail', id); loadLogs(id).then(render); toast('已儲存修改'); }
          else { go('home'); toast('已記下'); }
        });
      });
    }
    if (f.id === 'settle-form') {
      var me2 = S.me.user_id, other = S.other.user_id;
      var b = L.summarize(S.expenses, S.settlements, me2).balance;
      var amt = L.calc(document.getElementById('s-amount').value).value || 0;
      var serr = document.getElementById('s-err');
      if (amt <= 0) { serr.textContent = '請輸入金額'; return; }
      if (amt > Math.abs(b)) { serr.textContent = '金額不能超過目前結餘 NT$' + money(Math.abs(b)); return; }
      var method = f.querySelector('input[name="method"]:checked').value;
      var note = document.getElementById('s-note').value.trim() || null;
      var owedToMe = b > 0;
      var row = { from_user: owedToMe ? other : me2, to_user: owedToMe ? me2 : other, amount: amt, method: method, note: note };
      return guard(store.addSettlement(row)).then(refresh).then(function () {
        go('home'); toast(amt === Math.abs(b) ? '已結清，結餘歸零' : '已記錄結清 NT$' + money(amt));
      });
    }
    if (f.id === 'set-form') {
      var jobs = [];
      var nme = document.getElementById('st-me').value.trim();
      var ratioEl = document.getElementById('st-ratio');
      var ratio = ratioEl ? Math.min(100, Math.max(0, L.toInt(ratioEl.value))) : null;
      var mp = {};
      if (nme && nme !== S.me.display_name) mp.display_name = nme;
      if (ratio != null && ratio !== S.me.ratio) mp.ratio = ratio;
      var op = {};
      if (S.other) {
        var no = document.getElementById('st-other').value.trim();
        if (no && no !== S.other.display_name) op.display_name = no;
        if (ratio != null && 100 - ratio !== S.other.ratio) op.ratio = 100 - ratio;
      }
      // 依序寫入，避免兩筆同時改同一份文件互相覆蓋
      var chain = Promise.resolve();
      if (Object.keys(mp).length) chain = chain.then(function () { return store.updateMember(S.me.user_id, mp); });
      if (S.other && Object.keys(op).length) chain = chain.then(function () { return store.updateMember(S.other.user_id, op); });
      return guard(chain).then(reloadAll).then(function () { render(); toast('已儲存'); });
    }
  });

  function exportCsv() {
    var rows = [['日期', '項目', '類別', '金額', '付款人', '拆法', '我負擔', '對方負擔', '地點', '備註']];
    sorted(live()).forEach(function (e) {
      var mine = e.payer === S.me.user_id ? e.payer_share : e.other_share;
      rows.push([e.spent_on, e.title, e.category, e.amount, name(e.payer), L.MODES[e.split_mode].label, mine, e.amount - mine, e.place || '', e.note || '']);
    });
    var csv = '﻿' + rows.map(function (r) {
      return r.map(function (x) { x = String(x); return /[",\n]/.test(x) ? '"' + x.replace(/"/g, '""') + '"' : x; }).join(',');
    }).join('\n');
    var blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
    var a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'half-' + today() + '.csv';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(function () { URL.revokeObjectURL(a.href); }, 1000);
    toast('已產生 CSV');
  }

  window.addEventListener('popstate', function () {
    var h = location.hash.slice(1) || 'home';
    if (S.phase !== 'ready') return;
    if (h === 'detail' && !S.id) h = 'ledger';
    if (h === 'edit' && !S.id) h = 'home';
    S.route = h; S.confirmDelete = false; render();
  });
  // 已在畫面上提示過的錯誤，不再丟到主控台
  window.addEventListener('unhandledrejection', function (ev) { if (ev.reason && ev.reason.handled) ev.preventDefault(); });
  window.addEventListener('online', function () { S.online = true; reloadAll(); });
  window.addEventListener('offline', function () { S.online = false; render(); });

  // ---------- PWA ----------
  if ('serviceWorker' in navigator && /^https:|^http:\/\/localhost/.test(location.href) && !window.HALF_NO_SW) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('sw.js').catch(function () { /* 不支援時照常運作 */ });
    });
  }

  render();
  boot();
})();
