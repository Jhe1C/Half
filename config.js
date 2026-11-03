/* HALF · 設定
 * 兩個值都留空 = 示範模式（資料只存在這台裝置）。
 * 填入 Supabase 專案的 URL 與 anon public key = 雲端模式（兩人共用、即時同步）。
 * 雲端模式：每台裝置輸入一次帳本密碼，之後只要選 Jheyi / Enting。
 * anon key 本來就設計成可以放在前端，資料安全由 supabase/schema.sql 的 RLS 規則保護。
 * 絕對不要把 service_role / secret key 放進這裡。 */
window.HALF_CONFIG = {
  // 兩人共用的登入帳號名稱（不是密碼；密碼只有你們知道，不寫在任何檔案裡）
  SHARED_EMAIL: 'shared@half-ledger.example.com',
  SUPABASE_URL: 'https://dnqhavyctletntgrihyh.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImRucWhhdnljdGxldG50Z3JpaHloIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTM2OTM2OTksImV4cCI6MjEwOTI2OTY5OX0.PYFRl08XP9HIQI5_y60YTGKKwixjtCG11q3YCeDBOlc'
};
