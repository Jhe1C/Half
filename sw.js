/* HALF · Service Worker
 * 快取 App 外殼，讓它能加入主畫面、離線也打得開。
 * 帳務資料一律走網路（Supabase），不快取，避免看到過期的結餘。
 * 改版時把 VERSION 加一，使用者下次開啟就會拿到新版。 */
var VERSION = 'half-v5';
var SHELL = [
  './', './index.html', './styles.css', './config.js', './logic.js',
  './store-local.js', './store-supabase.js', './app.js', './manifest.webmanifest',
  './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', function (e) {
  e.waitUntil(caches.open(VERSION).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});

self.addEventListener('activate', function (e) {
  e.waitUntil(caches.keys().then(function (keys) {
    return Promise.all(keys.filter(function (k) { return k !== VERSION; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});

self.addEventListener('fetch', function (e) {
  var req = e.request;
  if (req.method !== 'GET') return;
  var url = new URL(req.url);
  if (/supabase\.co$/.test(url.hostname)) return; // 資料不快取

  // 自己的檔案：網路優先，失敗才用快取（確保改版即時生效）
  if (url.origin === self.location.origin) {
    e.respondWith(fetch(req).then(function (res) {
      var copy = res.clone();
      caches.open(VERSION).then(function (c) { c.put(req, copy); });
      return res;
    }).catch(function () {
      return caches.match(req).then(function (r) { return r || caches.match('./index.html'); });
    }));
    return;
  }

  // 字型與函式庫：快取優先
  if (/fonts\.(googleapis|gstatic)\.com$|cdn\.jsdelivr\.net$/.test(url.hostname)) {
    e.respondWith(caches.match(req).then(function (hit) {
      return hit || fetch(req).then(function (res) {
        var copy = res.clone();
        caches.open(VERSION).then(function (c) { c.put(req, copy); });
        return res;
      });
    }));
  }
});
