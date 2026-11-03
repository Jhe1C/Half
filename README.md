# HALF 雙人拆帳 · 網頁 App

兩個人共用的拆帳本。核心是「現在誰欠誰多少」，附帶記錄每筆消費。
以網頁 App（PWA）形式運作：用網址打開，可以加到手機主畫面，開起來像一般 App。

網址：<https://jhe1c.github.io/Half/>

```
前端（PWA，純 HTML/CSS/JS，不需編譯）→ GitHub Pages
後端（Supabase 專案 half：Postgres 資料庫 + 登入 + 即時同步）
```

## 怎麼用

1. 打開網址，輸入**帳本密碼**。每台裝置只需要輸入一次。
2. 選「我是誰」：Jheyi 或 Enting。這台裝置會記住，之後打開直接進主畫面。
3. 加到手機主畫面：
   - iPhone：用 Safari 打開 → 分享按鈕 → **加入主畫面**
   - Android：用 Chrome 打開 → 右上選單 → **安裝應用程式**（或「加到主畫面」）

換人用同一台裝置：設定 → 「這台裝置不是我，重新選擇」。
不想讓這台裝置再看到帳：設定 → 「登出這台裝置」，之後要重新輸入密碼。

兩人互相信任：任何一方新增、修改、刪除、結清都**立即生效**，不需要對方確認。每筆帳的明細仍會保留修改紀錄（誰在什麼時候改了什麼），方便回查。

**輸入金額**：金額欄位不會跳出手機的數字鍵盤，而是跳出 App 自己的計算機（+ − × ÷）。輸入 `1200+80×2` 會即時顯示 `= 1,360`，按「完成」或離開欄位時自動換成結果；乘除先於加減，除不盡四捨五入到元。在電腦上也可以直接打字（`* / -` 也能用）。

## 安全設計

網站和程式碼都是公開的，所以安全全部靠資料庫端的規則（`supabase/schema.sql`）：

| 規則 | 實作 |
|---|---|
| 沒輸入密碼的人什麼都讀不到、寫不進 | 所有資料表開啟 RLS，只開放給登入的帳號 |
| 只有一個共用登入帳號，任何人都無法再註冊 | `auth.users` 上的 `only_one_account` 觸發器 |
| 修改紀錄自動保留，無法偽造 | `expenses_log` 觸發器；`expense_logs` 沒有開放寫入 |
| 刪除是軟刪除，紀錄保留 | `deleted_at` 欄位 |
| 結清記錄後不能改，記錯可刪除 | `settlements` 只開放新增與刪除 |

- `config.js` 裡的 anon key 和共用帳號名稱是公開的（官方設計就是放在前端），**密碼沒有寫在任何檔案裡**。
- 絕對不要把 Supabase 的 `service_role` / `secret` key 放進這個 repo。
- 想換密碼：Supabase 後台 → half 專案 → Authentication → Users → 那個帳號 → Reset password，或請 Claude 協助。換完後每台裝置要重新輸入一次。

結餘不存在資料庫裡，每次由前端從「未刪除的支出 + 結清紀錄」算出來（`logic.js`），所以不會有數字對不上的問題。「本期」是指上一次結餘歸零之後的期間。

## 拆法

| 拆法 | 計算 |
|---|---|
| 均分 | 各付一半，奇數金額的 1 元零頭由付款人吸收 |
| 比例 | 依設定頁的約定百分比（預設 50 : 50），四捨五入到元 |
| 指定 | 直接輸入付款人自己負擔多少，其餘由對方負擔 |
| 代付 | 付款人先墊，全額由對方負擔 |

## 舊資料（ledger-prime）

`tools/import_ledger_prime.py` 把舊程式 ledger-prime 的 `bills` 轉成 HALF 的帳：

- `is_debt = false`：paid_by 付錢、兩人均分。
- `is_debt = true`：paid_by 是欠錢的一方，欠對方全額 → 記為「對方付、代付」。
- 小數金額四捨五入到元；均分的奇數金額零頭輪流分配，讓總結餘和舊程式一致。
- 可以重複執行：已匯入的舊編號（記在備註「#編號」）會略過，只補新的帳。舊程式裡修改或刪除的帳不會同步。

2026-11-03 已匯入 84 筆，結餘 Jheyi 欠 Enting 15,115（舊程式 15,114.5，差 0.5 元來自 38.5 → 39）。

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html` | 入口 |
| `styles.css` | 瑞士國際主義風格：12 欄網格、基線對齊、Inter / Noto Sans TC 多字重、黑 · 灰 · 米白 · 木橘 |
| `logic.js` | 拆帳計算與計算機算式（純函式，不用 eval） |
| `app.js` | 所有畫面與互動 |
| `store-supabase.js` | 雲端資料層 |
| `store-local.js` | 示範模式資料層（`config.js` 清空時使用，資料只存在瀏覽器） |
| `config.js` | Supabase 網址、anon key、共用帳號名稱 |
| `sw.js`、`manifest.webmanifest`、`icons/` | PWA：加入主畫面、離線開啟 |
| `supabase/schema.sql` | 資料庫結構、權限、觸發器（新專案從這份建立） |
| `tools/import_ledger_prime.py` | 舊資料轉換 |
| `tests/` | 測試（不需上傳到網站，GitHub Pages 會一起發布但不影響使用） |

## 改版

改完檔案後，把 `sw.js` 第一行的 `VERSION` 改成新的字串，再推上 GitHub。手機下次開啟就會拿到新版。

## 測試

```bash
cd tests
npm install
node logic.test.cjs                   # 拆帳計算、計算機
node sql.test.mjs                     # 資料庫權限與規則
node import.test.mjs <匯入SQL檔>       # 舊資料匯入結果
```

## 要注意的事

- **Supabase 免費方案**：專案一週沒有任何使用會被暫停，到後台按一下就能恢復；兩人每天記帳不會碰到。方案內容以 <https://supabase.com/pricing> 為準。
- **離線**：App 外殼可以離線開啟，但記帳需要網路。離線時畫面頂端會顯示提示。
- **備份**：設定頁可以匯出 CSV。
- half 專案裡的 `legacy_*` 資料表是早期版本留下的空結構，可以在 Supabase 後台刪除。
