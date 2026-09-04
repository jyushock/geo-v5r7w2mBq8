/*
 * Service Worker — 訪問済みリソースのランタイムキャッシュ
 *
 * 方針:
 *  - HTML(ナビゲーション)     : ネットワーク優先 → 失敗時キャッシュ(オフライン)
 *  - 自オリジンの静的資産/CDN : stale-while-revalidate（即時表示＋裏で更新）
 *  - 地図タイル / 各種API     : キャッシュしない（ToS・鮮度配慮で素通し）
 *
 * 更新方法: デプロイ時に下の VERSION を上げると旧キャッシュを破棄して入れ替わる。
 */
const VERSION = 'v6';   // v6: 本体を app.js に切り出し（maplibre 6系のESM化に伴う）
const STATIC_CACHE  = `static-${VERSION}`;
const RUNTIME_CACHE = `runtime-${VERSION}`;

// オフライン時のナビゲーション用に最低限プリキャッシュ
/* app.js は本体そのもの。index.html だけあっても地図が出ないので、
   オフライン初回でも動くようプリキャッシュに含める。 */
const PRECACHE = ['./', './index.html', './app.js', './manifest.json'];

// キャッシュ対象に含めてよいCDN（ライブラリのみ）
const CACHEABLE_CDN = ['https://unpkg.com/'];

self.addEventListener('install', (event) => {
    self.skipWaiting();
    event.waitUntil(
        caches.open(STATIC_CACHE)
            .then((cache) => cache.addAll(PRECACHE))
            .catch(() => { /* オフライン等で失敗してもインストールは継続 */ })
    );
});

self.addEventListener('activate', (event) => {
    event.waitUntil((async () => {
        const keys = await caches.keys();
        await Promise.all(
            keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k))
        );
    })());
});

function isCacheable(request, url) {
    if (request.method !== 'GET') return false;
    /* 同期API は素通し。ここを stale-while-revalidate に入れると、GET /api/state が
       1回前の応答（別の端末・別のセッションのこともある）を返し、古い内容を取り込む。 */
    if (url.origin === self.location.origin && url.pathname.startsWith('/api/')) return false;
    if (url.origin === self.location.origin) return true;            // 自オリジン資産
    return CACHEABLE_CDN.some((prefix) => url.href.startsWith(prefix)); // 許可CDNのみ
}

self.addEventListener('fetch', (event) => {
    const request = event.request;
    const url = new URL(request.url);

    // HTML（ページ遷移）: ネットワーク優先、失敗時はキャッシュからオフライン表示
    if (request.mode === 'navigate') {
        event.respondWith(
            fetch(request)
                .then((response) => {
                    const copy = response.clone();
                    caches.open(STATIC_CACHE)
                        .then((cache) => cache.put('./index.html', copy))
                        .catch(() => {});
                    return response;
                })
                .catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
        );
        return;
    }

    // タイル・API等は素通し（キャッシュしない）
    if (!isCacheable(request, url)) return;

    // 静的資産/CDN: stale-while-revalidate
    event.respondWith((async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const cached = await cache.match(request);
        const network = fetch(request)
            .then((response) => {
                if (response && response.ok) cache.put(request, response.clone());
                return response;
            })
            .catch(() => null);
        return cached || (await network) || new Response('', { status: 504, statusText: 'offline' });
    })());
});
