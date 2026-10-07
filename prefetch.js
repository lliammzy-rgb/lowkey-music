// Prefetch stream URL.
//
// Fakta terukur: yt-dlp butuh 3.5s (steady) - 15s (cold) buat nge-resolve 1 URL YouTube.
// Picker kasih waktu gratis 2-5 detik waktu user baca menu — masa itu dipakai buat
// nge-resolve URL rank 1-3, jadi waktu user klik: cache hit → hampir instan.
//
// Kenapa di-patch: DisTube memanggil plugin.getStreamURL() waktu play. Dengan nyangkut
// cache di prototype, pemanggil normal (punya DisTube sendiri) ikut keuntungan.
const { YtDlpPlugin } = require("@distube/yt-dlp");

const TTL = 120_000; // URL YouTube bisa basi / IP-bound — 2 menit batas aman
const MAX = 60;

// url → { at, url?, promise? }
const cache = new Map();

const origGetStreamURL = YtDlpPlugin.prototype.getStreamURL;

function installStreamCache() {
  YtDlpPlugin.prototype.getStreamURL = async function (song) {
    const key = song?.url;
    if (!key) return origGetStreamURL.call(this, song);

    const hit = cache.get(key);
    if (hit) {
      if (hit.url && Date.now() - hit.at < TTL) return hit.url; // sudah beres → instan
      if (hit.promise) return hit.promise; // masih di-resolve → tunggu, jangan spawn dobel
    }

    const p = origGetStreamURL.call(this, song);
    cache.set(key, { at: Date.now(), promise: p });

    if (cache.size > MAX) {
      const now = Date.now();
      for (const [k, v] of cache) if (now - v.at > TTL) cache.delete(k);
      while (cache.size > MAX) cache.delete(cache.keys().next().value);
    }

    try {
      const url = await p;
      cache.set(key, { at: Date.now(), url });
      return url;
    } catch (err) {
      cache.delete(key); // gagal → biarkan pemanggil berikutnya coba ulang
      throw err;
    }
  };
}

// Nyalakan buat 1 lagu YouTube, diam-diam. Gagal boleh diam (cache dihapus, retry nanti).
function prefetch(plugin, song) {
  if (!plugin || song?.source !== "youtube" || !song?.url) return;
  plugin.getStreamURL(song).catch(() => {});
}

module.exports = { installStreamCache, prefetch, streamCache: cache };
