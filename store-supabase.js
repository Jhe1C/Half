/* HALF · 雲端資料層（Supabase）
 * 兩人共用一個登入帳號：每台裝置輸入一次帳本密碼，之後在裝置上選「我是誰」。
 * 未登入的人什麼都讀不到、改不了（規則在 supabase/schema.sql）。 */
(function (root) {
  'use strict';
  var ID_KEY = 'half-me';
  var memoryId = null;

  function readId() { try { return localStorage.getItem(ID_KEY) || memoryId; } catch (e) { return memoryId; } }
  function writeId(v) {
    memoryId = v;
    try { if (v) localStorage.setItem(ID_KEY, v); else localStorage.removeItem(ID_KEY); } catch (e) { /* 只存在記憶體 */ }
  }

  function create(url, anonKey, sharedEmail) {
    var sb = root.supabase.createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, storageKey: 'half-auth' }
    });

    function unwrap(res) {
      if (res.error) {
        var msg = res.error.message || '發生錯誤';
        if (/Invalid login credentials/i.test(msg)) msg = '密碼不正確';
        else if (/Failed to fetch|NetworkError|Load failed/i.test(msg)) msg = '連不上伺服器，請確認網路連線';
        else if (/JWT|not authorized|permission denied/i.test(msg)) msg = '登入已失效，請重新輸入密碼';
        throw new Error(msg);
      }
      return res.data;
    }
    function me() { return readId(); }

    return {
      mode: 'cloud',
      init: function () { return Promise.resolve(); },
      hasSession: function () {
        return sb.auth.getSession().then(function (r) { return !!(r.data && r.data.session); });
      },
      signIn: function (password) {
        return sb.auth.signInWithPassword({ email: sharedEmail, password: password }).then(unwrap);
      },
      signOut: function () { writeId(null); return sb.auth.signOut(); },

      /* 這台裝置選的身分（jheyi / enting），還沒選則為 null */
      getUser: function () {
        var id = readId();
        return Promise.resolve(id === 'jheyi' || id === 'enting' ? { id: id } : null);
      },
      pickIdentity: function (id) { writeId(id); return Promise.resolve(); },
      forgetIdentity: function () { writeId(null); return Promise.resolve(); },

      getMyLedger: function () {
        return Promise.all([
          sb.from('people').select('*').order('sort').then(unwrap),
          sb.from('settings').select('*').eq('id', 1).maybeSingle().then(unwrap)
        ]).then(function (r) {
          var st = r[1] || {};
          return {
            ledger: { id: 'main', name: st.name || '我們的帳本', category_defaults: st.category_defaults || {} },
            members: r[0].map(function (p) { return { user_id: p.id, display_name: p.display_name, ratio: p.ratio }; })
          };
        });
      },

      loadAll: function () {
        return Promise.all([
          sb.from('expenses').select('*').order('spent_on', { ascending: false }).order('created_at', { ascending: false }).limit(5000).then(unwrap),
          sb.from('settlements').select('*').order('created_at', { ascending: false }).limit(1000).then(unwrap)
        ]).then(function (r) { return { expenses: r[0], settlements: r[1] }; });
      },
      subscribe: function (fn) {
        var timer = null;
        var bump = function () { clearTimeout(timer); timer = setTimeout(fn, 250); };
        var ch = sb.channel('half')
          .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses' }, bump)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements' }, bump)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'people' }, bump)
          .subscribe();
        // 回到前景時補抓一次，避免手機休眠期間漏掉更新
        var onVis = function () { if (document.visibilityState === 'visible') bump(); };
        document.addEventListener('visibilitychange', onVis);
        return function () { sb.removeChannel(ch); document.removeEventListener('visibilitychange', onVis); };
      },

      addExpense: function (d) {
        var row = Object.assign({}, d, { other_share: d.amount - d.payer_share, created_by: me(), last_edited_by: me() });
        return sb.from('expenses').insert(row).select().single().then(unwrap);
      },
      updateExpense: function (id, patch) {
        var p = Object.assign({}, patch, { last_edited_by: me() });
        if (p.amount != null && p.payer_share != null) p.other_share = p.amount - p.payer_share;
        return sb.from('expenses').update(p).eq('id', id).select().maybeSingle().then(unwrap);
      },
      deleteExpense: function (id) {
        return sb.from('expenses').update({ deleted_at: new Date().toISOString(), last_edited_by: me() }).eq('id', id).then(unwrap);
      },
      getLogs: function (expenseId) {
        return sb.from('expense_logs').select('*').eq('expense_id', expenseId).order('at').then(unwrap);
      },

      addSettlement: function (d) {
        var row = Object.assign({}, d, { created_by: me() });
        return sb.from('settlements').insert(row).select().single().then(unwrap);
      },
      deleteSettlement: function (id) {
        return sb.from('settlements').delete().eq('id', id).then(unwrap);
      },

      updateMember: function (personId, patch) {
        return sb.from('people').update(patch).eq('id', personId).then(unwrap);
      }
    };
  }

  root.HalfSupabaseStore = { create: create };
})(window);
