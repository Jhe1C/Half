"""把 ledger-prime 的 bills 轉成 HALF 的匯入 SQL。

用法：python3 tools/import_ledger_prime.py bills.json > import.sql
bills.json：[{id, created_at, name, amount, paid_by, is_debt}, ...]

換算規則（依使用者確認：舊程式顯示 Jheyi 欠 Enting 約 15,000）：
- is_debt = false：paid_by 付錢，兩人均分。
- is_debt = true ：paid_by 是欠錢的一方，欠對方全額 → HALF 記為「對方付、代付（全額由 paid_by 負擔）」。
- 小數金額四捨五入到元（38.5 → 39）。
- 均分的奇數金額，HALF 只能記整數，零頭輪流分給兩人，讓總結餘和舊程式一致。
- 帳本建立者 = Jheyi，另一位成員 = Enting。
"""
import json, sys, math
from datetime import datetime, timezone, timedelta

TPE = timezone(timedelta(hours=8))
CATS = {
    '餐飲': ['飲料', '炸雞', '白飯', '飯糰', 'subway', 'waffle', '不夜侯', '丹丹', '八方悅', '冰', '粥', '勇伯', '卡莫',
            '可頌', '甜甜圈', '蕃薯', '夜市', '牛排', '少點鹽', '必勝客', '蛋餅', '拿坡里', '拿波里', '啟餅', '料理實驗室',
            '早午餐', '烤雞', '鍋', '百香果', '禾十心', '紅烏', '麻糬', '蟬吃茶', '貝果', '食山海', '鴨香飽', '麥味登',
            '雞蛋糕', '買菜', 'lopia', '香菇', '貞心'],
    '日用': ['costco', '家樂福', '酒精'],
    '居住': ['水電'],
    '交通': ['租車', '車票'],
    '娛樂': ['住宿'],
}

def category(name):
    n = name.lower()
    if n.startswith('買菜'):
        return '餐飲'
    for cat, words in CATS.items():
        if any(w in n for w in words):
            return cat
    return '其他'

def q(s):
    return "'" + str(s).replace("'", "''") + "'"

def build(rows):
    out, drift = [], 0.0   # drift：相對舊程式的誤差，正數 = Enting 多欠
    expect = 0.0           # 舊程式的結餘（正 = Enting 欠 Jheyi），金額已四捨五入到元
    for r in sorted(rows, key=lambda x: x['id']):
        amt = int(math.floor(float(r['amount']) + 0.5))
        payer_name = r['paid_by']
        other_name = 'Enting' if payer_name == 'Jheyi' else 'Jheyi'
        title = r['name'].strip() or '（未命名）'
        if r['is_debt']:
            payer = other_name      # 對方先付，paid_by 欠全額
            mode, ps, os_ = 'full', 0, amt
            expect += amt if payer == 'Jheyi' else -amt
        else:
            payer = payer_name
            mode = 'equal'
            exact = amt / 2
            sign = 1 if payer == 'Jheyi' else -1   # other_share 對「Enting 欠 Jheyi」的方向
            expect += sign * exact
            lo, hi = math.floor(exact), math.ceil(exact)
            if lo == hi:
                os_ = lo
            else:
                # 選讓累計誤差最接近 0 的那一邊
                os_ = lo if abs(drift + sign * (lo - exact)) <= abs(drift + sign * (hi - exact)) else hi
                drift += sign * (os_ - exact)
            ps = amt - os_
        ts = datetime.fromisoformat(r['created_at'])
        spent = ts.astimezone(TPE).date().isoformat()
        var = 'jh' if payer == 'Jheyi' else 'en'
        out.append(f"(lid, {q(title[:60])}, {q(category(title))}, {amt}, {var}, '{mode}', {ps}, {os_}, '{spent}', "
                   f"{q('從 ledger-prime 匯入（#%s）' % r['id'])}, {q(r['created_at'])}, {q(r['created_at'])})")
    return out, drift, expect

def main():
    rows = json.load(open(sys.argv[1], encoding='utf8'))
    values, drift, expect = build(rows)
    sys.stdout.write(f"""-- 由 tools/import_ledger_prime.py 產生：{len(values)} 筆，舊程式結餘（Enting 欠 Jheyi）= {expect:g}，換算誤差 = {drift:g}
do $$
declare jh uuid; en uuid; lid uuid;
begin
  select l.id, l.created_by into lid, jh from public.ledgers l order by l.created_at limit 1;
  select m.user_id into en from public.members m where m.ledger_id = lid and m.user_id <> jh;
  if lid is null or jh is null or en is null then raise exception '帳本或兩位成員還沒建立好'; end if;
  if exists (select 1 from public.expenses where ledger_id = lid and note like '從 ledger-prime 匯入%') then
    raise exception '已經匯入過，不重複匯入';
  end if;
  perform set_config('request.jwt.claims', json_build_object('sub', jh::text, 'role', 'authenticated')::text, true);
  insert into public.expenses (ledger_id, title, category, amount, payer, split_mode, payer_share, other_share, spent_on, note, created_at, updated_at) values
  {(','+chr(10)+'  ').join(values)};
end $$;
""")

if __name__ == '__main__':
    main()
