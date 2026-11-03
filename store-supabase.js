/* HALF · 雲端資料層（Supabase）
 * 規則由資料庫端強制執行（見 supabase/schema.sql），前端只負責呼叫。 */
(function (root) {
  'use strict';

  function create(url, anonKey) {
    var sb = root.supabase.createClient(url, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true }
    });
    var ledgerId = null;

    function unwrap(res) {
      if (res.error) {
        var msg = res.error.message || '發生錯誤';
        if (/Invalid login credentials/i.test(msg)) msg = 'Email 或密碼不正確';
        else if (/User already registered/i.test(msg)) msg = '這個 Email 已經註冊過，請直接登入';
        else if (/Password should be at least/i.test(msg)) msg = '密碼至少需要 6 個字元';
        else if (/Email not confirmed/i.test(msg)) msg = '這個 Email 還沒驗證。請到 Supabase 關閉「Confirm email」，或先去信箱點驗證連結';
        else if (/Failed to fetch|NetworkError/i.test(msg)) msg = '連不上伺服器，請確認網路連線';
        throw new Error(msg);
      }
      return res.data;
    }

    return {
      mode: 'cloud',
      init: function () { return Promise.resolve(); },
      getUser: function () {
        return sb.auth.getSession().then(function (r) {
          var u = r.data && r.data.session && r.data.session.user;
          return u ? { id: u.id, email: u.email } : null;
        });
      },
      signIn: function (email, password) {
        return sb.auth.signInWithPassword({ email: email, password: password }).then(unwrap);
      },
      signUp: function (email, password) {
        return sb.auth.signUp({ email: email, password: password }).then(unwrap).then(function (d) {
          if (!d.session) throw new Error('帳號已建立，但需要先驗證 Email。到信箱點驗證連結後再登入，或請到 Supabase 關閉「Confirm email」');
          return d;
        });
      },
      signOut: function () { ledgerId = null; return sb.auth.signOut(); },
      onAuth: function (fn) { sb.auth.onAuthStateChange(function () { fn(); }); },

      getMyLedger: function () {
        return sb.auth.getSession().then(function (r) {
          var u = r.data.session && r.data.session.user;
          if (!u) return null;
          return sb.from('members').select('ledger_id').eq('user_id', u.id).order('joined_at').limit(1)
            .then(unwrap).then(function (rows) {
              if (!rows.length) return null;
              ledgerId = rows[0].ledger_id;
              return Promise.all([
                sb.from('ledgers').select('*').eq('id', ledgerId).single().then(unwrap),
                sb.from('members').select('*').eq('ledger_id', ledgerId).order('joined_at').then(unwrap)
              ]).then(function (res) { return { ledger: res[0], members: res[1] }; });
            });
        });
      },
      createLedger: function (name, displayName) {
        return sb.rpc('create_ledger', { p_name: name, p_display_name: displayName }).then(unwrap);
      },
      joinLedger: function (code, displayName) {
        return sb.rpc('join_ledger', { p_code: code, p_display_name: displayName }).then(unwrap);
      },

      loadAll: function () {
        return Promise.all([
          sb.from('expenses').select('*').eq('ledger_id', ledgerId).order('spent_on', { ascending: false }).order('created_at', { ascending: false }).limit(2000).then(unwrap),
          sb.from('settlements').select('*').eq('ledger_id', ledgerId).order('created_at', { ascending: false }).limit(500).then(unwrap)
        ]).then(function (r) { return { expenses: r[0], settlements: r[1] }; });
      },
      subscribe: function (fn) {
        var timer = null;
        var bump = function () { clearTimeout(timer); timer = setTimeout(fn, 250); };
        var filter = 'ledger_id=eq.' + ledgerId;
        var ch = sb.channel('ledger-' + ledgerId)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'expenses', filter: filter }, bump)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'settlements', filter: filter }, bump)
          .on('postgres_changes', { event: '*', schema: 'public', table: 'members', filter: filter }, bump)
          .subscribe();
        // 回到前景時補抓一次，避免手機休眠期間漏掉更新
        var onVis = function () { if (document.visibilityState === 'visible') bump(); };
        document.addEventListener('visibilitychange', onVis);
        return function () { sb.removeChannel(ch); document.removeEventListener('visibilitychange', onVis); };
      },

      addExpense: function (d) {
        var row = Object.assign({}, d, { ledger_id: ledgerId, other_share: d.amount - d.payer_share });
        return sb.from('expenses').insert(row).select().single().then(unwrap);
      },
      updateExpense: function (id, patch) {
        var p = Object.assign({}, patch);
        if (p.amount != null && p.payer_share != null) p.other_share = p.amount - p.payer_share;
        return sb.from('expenses').update(p).eq('id', id).select().maybeSingle().then(unwrap);
      },
      deleteExpense: function (id) {
        return sb.from('expenses').update({ deleted_at: new Date().toISOString() }).eq('id', id).then(unwrap);
      },
      getLogs: function (expenseId) {
        return sb.from('expense_logs').select('*').eq('expense_id', expenseId).order('at').then(unwrap);
      },

      addSettlement: function (d) {
        var row = Object.assign({}, d, { ledger_id: ledgerId });
        return sb.from('settlements').insert(row).select().single().then(unwrap);
      },
      deleteSettlement: function (id) {
        return sb.from('settlements').delete().eq('id', id).then(unwrap);
      },

      updateMember: function (userId, patch) {
        return sb.from('members').update(patch).eq('ledger_id', ledgerId).eq('user_id', userId).then(unwrap);
      }
    };
  }

  root.HalfSupabaseStore = { create: create };
})(window);
