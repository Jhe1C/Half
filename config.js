/* HALF · 設定
 * 兩個值都留空 = 示範模式（資料只存在這台裝置）。
 * 填入 Supabase 專案的 URL 與 anon public key = 雲端模式（兩人共用、即時同步）。
 * 位置：Supabase 後台 → Project Settings → API。
 * anon key 本來就設計成可以放在前端，資料安全由 schema.sql 的 RLS 規則保護。 */
window.HALF_CONFIG = {
  SUPABASE_URL: '',
  SUPABASE_ANON_KEY: ''
};
