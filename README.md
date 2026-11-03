# HALF 雙人拆帳 · 網頁 App

兩個人共用的拆帳本。核心是「現在誰欠誰多少」，附帶記錄每筆消費。
以網頁 App（PWA）形式運作：用網址打開，可以加到手機主畫面，開起來像一般 App。

```
前端（PWA，純 HTML/CSS/JS，不需編譯）
  └─ 放在任何靜態網站空間：Netlify、GitHub Pages、Cloudflare Pages
後端（Supabase：Postgres 資料庫 + 帳號登入 + 即時同步）
  └─ 規則寫在資料庫裡：只有帳本的兩位成員看得到、改得到資料
```

兩人互相信任：任何一方新增、修改、刪除、結清都**立即生效**，不需要對方確認。每筆帳的明細仍會保留修改紀錄，方便回查。

`config.js` 留空時是**示範模式**：資料只存在這台裝置，可以切換身分模擬兩個人，適合先試玩。
填入 Supabase 設定後是**雲端模式**：兩人各用自己的手機登入，資料即時同步。

**輸入金額**：金額欄位不會跳出手機的數字鍵盤，而是跳出 App 自己的計算機（+ − × ÷）。輸入 `1200+80×2` 會即時顯示 `= 1,360`，按「完成」或離開欄位時自動換成結果；乘除先於加減，除不盡四捨五入到元。在電腦上也可以直接打字（`* / -` 也能用）。

---

## 上線步驟（約 20 分鐘）

### 1. 建立 Supabase 專案

1. 到 <https://supabase.com> 註冊，按 **New project**。區域選離台灣近的（例如 Tokyo 或 Singapore），設定資料庫密碼後建立。
2. 左側 **SQL Editor** → **New query**，把 `supabase/schema.sql` 整份貼上，按 **Run**。看到 `Success` 就完成。
3. 左側 **Authentication** → **Sign In / Providers** → **Email**：
   - 建議關閉 **Confirm email**。只有你們兩個人用，不需要寄驗證信；Supabase 內建的寄信服務有很低的頻率限制，開著反而容易卡住註冊。
   - 想保留驗證信也可以，註冊後到信箱點連結再登入即可。
4. 左側 **Project Settings** → **API**（或 **API Keys**），複製：
   - **Project URL**
   - **anon public** key（新版後台可能叫 **publishable key**，用這把）
   - ⚠️ 不要複製 `service_role` / `secret` key，那把有完整權限，不能放在前端。

### 2. 填設定

打開 `config.js`，貼上剛剛複製的兩個值：

```js
window.HALF_CONFIG = {
  SUPABASE_URL: 'https://xxxxxxxx.supabase.co',
  SUPABASE_ANON_KEY: 'eyJ...或 sb_publishable_...'
};
```

anon / publishable key 本來就是設計給前端使用的公開金鑰，資料安全由 `schema.sql` 裡的 Row Level Security 規則保護。

### 3. 放上網站（擇一）

PWA 必須用 **https** 網址才能加入主畫面、離線開啟，以下三種都有免費 https。

- **Netlify Drop（最簡單）**：到 <https://app.netlify.com/drop>，把整個資料夾拖進去，得到一個網址。之後改版再拖一次。
- **GitHub Pages**：建一個 repository，上傳所有檔案，到 **Settings → Pages** 選 `main` 分支，等一兩分鐘得到網址。
- **Cloudflare Pages**：連結 GitHub repository 或直接上傳資料夾。

`tests/` 資料夾不需要上傳。

### 4. 兩個人開始用

1. 你打開網址 → **註冊新帳號** → **開新帳本**，畫面會出現 6 碼邀請碼。
2. 對方打開同一個網址 → 註冊自己的帳號 → **加入帳本**，輸入邀請碼。
3. 加到主畫面：
   - iPhone：用 Safari 打開 → 分享按鈕 → **加入主畫面**
   - Android：用 Chrome 打開 → 右上選單 → **安裝應用程式**（或「加到主畫面」）

---

## 規則（雲端模式由資料庫強制執行）

| 規則 | 實作位置 |
|---|---|
| 只有帳本的兩位成員看得到、改得到資料 | RLS policy + `is_member()` |
| 一本帳最多兩人 | `join_ledger()` |
| 任一方都能新增、修改、刪除，立即生效 | RLS policy |
| 修改紀錄自動保留，無法偽造 | `expenses_log` 觸發器；`expense_logs` 沒有開放寫入的 policy |
| 刪除是軟刪除，紀錄保留 | `deleted_at` 欄位 |
| 結清記錄後立即生效；記錯可刪除，不能改 | `settlements` 只開放新增與刪除 |

結餘不存在資料庫裡，每次由前端從「未刪除的支出 + 結清紀錄」算出來（`logic.js`），所以不會有數字對不上的問題。
「本期」是指上一次結餘歸零之後的期間。

## 拆法

| 拆法 | 計算 |
|---|---|
| 均分 | 各付一半，奇數金額的 1 元零頭由付款人吸收 |
| 比例 | 依設定頁的約定百分比（預設 50 : 50），四捨五入到元 |
| 指定 | 直接輸入付款人自己負擔多少，其餘由對方負擔 |
| 代付 | 付款人先墊，全額由對方負擔 |

## 檔案

| 檔案 | 用途 |
|---|---|
| `index.html` | 入口 |
| `styles.css` | 瑞士國際主義風格：12 欄網格、基線對齊、Inter / Noto Sans TC 多字重、黑 · 灰 · 米白 · 木橘 |
| `logic.js` | 拆帳計算與計算機算式（純函式，不用 eval） |
| `app.js` | 所有畫面與互動 |
| `store-local.js` | 示範模式資料層（瀏覽器儲存） |
| `store-supabase.js` | 雲端模式資料層 |
| `config.js` | Supabase 設定 |
| `sw.js`、`manifest.webmanifest`、`icons/` | PWA：加入主畫面、離線開啟 |
| `supabase/schema.sql` | 資料庫結構、權限、觸發器 |
| `tests/` | 測試（不需上傳） |

## 改版

改完檔案後，把 `sw.js` 第一行的 `VERSION` 改成新的字串（例如 `half-v2`），再重新上傳。手機下次開啟就會拿到新版。

## 測試

```bash
cd tests
npm install
node logic.test.cjs     # 拆帳計算
node sql.test.mjs       # 用記憶體中的 Postgres 跑 schema.sql 的權限與流程規則
```

## 要注意的事

- **Supabase 免費方案**：專案一週沒有任何使用會被暫停，到後台按一下就能恢復；兩人每天記帳不會碰到。其他額度（資料庫 500 MB、每月 5 萬名活躍使用者）對兩個人來說非常充足。方案內容會變動，以 <https://supabase.com/pricing> 為準。
- **離線**：App 外殼可以離線開啟，但記帳需要網路。離線時畫面頂端會顯示提示。
- **備份**：設定頁可以匯出 CSV。Supabase 免費方案沒有自動備份可下載，重要的話定期匯出。
- **忘記密碼**：目前沒做忘記密碼流程。可以到 Supabase 後台 **Authentication → Users** 幫對方重設。
