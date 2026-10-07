// Mesin pencari eksternal buat picker /play.
//
// Kenapa file ini ada: yt-dlp (engine lama) terukur 3.5-15 DETIK cuma buat cari judul.
// Sumber di sini balapan paralel dengan budget keras — yang lambat dibuang, picker tetap
// muncul dari yang cepat. Semua gratis, tanpa API key (Tidal pakai token web publik).
const { Song } = require("distube");
const ytsr = require("@distube/ytsr");

const ITUNES_API = "https://itunes.apple.com/search";
const TIDAL_API = "https://api.tidal.com/v1/search/tracks";
// token yang dipakai web player Tidal (listen.tidal.com). Kalau Tidal rotasi → 401 →
// sumber ini hilang sendiri, sisanya tetap jalan. Bisa dioverride lewat env.
const TIDAL_TOKEN = process.env.TIDAL_TOKEN || "CzET4vdadNUFQ5JU";

const SOURCE_META = {
  youtube: { emoji: "▶️", label: "YouTube" },
  soundcloud: { emoji: "🟠", label: "SoundCloud" },
  deezer: { emoji: "🟣", label: "Deezer" },
  apple: { emoji: "🍎", label: "Apple Music" },
  tidal: { emoji: "🌊", label: "Tidal" },
};

// Sumber yang bisa diputar langsung oleh plugin-nya (tanpa mirror YouTube).
// Deezer TIDAK termasuk: pluginnya InfoExtractorPlugin → cuma kasih metadata,
// streamnya tetap dicari di YouTube.
const DIRECT_SOURCES = new Set(["youtube", "soundcloud"]);

// Budget: kalau sumber lewat batas, hasilnya dibuang & picker lanjut pakai sumber lain.
// Sumber yang hang (SoundCloud pernah hang total) tidak boleh menahan semuanya.
function withBudget(promise, ms, label) {
  const p = Promise.resolve(promise);
  p.catch(() => {}); // kalau kalah balapan jangan jadi unhandled rejection
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} > ${ms}ms`)), ms);
    if (timer.unref) timer.unref();
  });
  return Promise.race([p, timeout]).then(
    (v) => {
      clearTimeout(timer);
      return v;
    },
    (e) => {
      clearTimeout(timer);
      console.warn(`[engine] ${e.message}`);
      return [];
    },
  );
}

async function readJson(res) {
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

// "3:54" / "1:02:11" → detik
function toSeconds(str) {
  const parts = String(str || "").split(":").map(Number);
  if (!parts.length || parts.some(Number.isNaN)) return 0;
  return parts.reduce((acc, n) => acc * 60 + n, 0);
}

async function itunesSearch(query, limit = 6) {
  const url = `${ITUNES_API}?term=${encodeURIComponent(query)}&media=music&entity=song&limit=${limit}`;
  const data = await readJson(await fetch(url, { signal: AbortSignal.timeout(2500) }));
  return (data.results || [])
    .filter((t) => t.trackId && t.trackName)
    .map(
      (t) =>
        new Song(
          {
            source: "apple",
            playFromSource: false,
            id: String(t.trackId),
            url: t.trackViewUrl,
            name: t.trackName,
            uploader: { name: t.artistName },
            thumbnail: (t.artworkUrl100 || "").replace("100x100", "600x600") || undefined,
            duration: t.trackTimeMillis ? Math.round(t.trackTimeMillis / 1000) : 0,
          },
          {},
        ),
    );
}

async function tidalSearch(query, limit = 6) {
  const url = `${TIDAL_API}?query=${encodeURIComponent(query)}&limit=${limit}&countryCode=US`;
  const data = await readJson(
    await fetch(url, { headers: { "x-tidal-token": TIDAL_TOKEN }, signal: AbortSignal.timeout(2500) }),
  );
  return (data.items || [])
    .filter((t) => t.id && t.title)
    .map(
      (t) =>
        new Song(
          {
            source: "tidal",
            playFromSource: false,
            id: String(t.id),
            url: `https://tidal.com/track/${t.id}`,
            name: t.title,
            uploader: { name: t.artist?.name },
            duration: t.duration || 0,
          },
          {},
        ),
    );
}

// ytsr = YouTube search lewat API internal, ~700ms. Kadang balas "Unsupported YouTube
// Search response" (rate limit / format berubah) → lempar error, ditangani withBudget.
async function ytsrSearch(query, limit = 6) {
  const r = await ytsr(query, { limit });
  return (r.items || [])
    .filter((i) => i.type === "video" && i.id && !i.isLive)
    .map(
      (i) =>
        new Song(
          {
            source: "youtube",
            playFromSource: true,
            id: i.id,
            url: i.url || `https://www.youtube.com/watch?v=${i.id}`,
            name: i.name,
            uploader: { name: i.author?.name },
            thumbnail: i.thumbnail,
            duration: toSeconds(i.duration),
          },
          {},
        ),
    );
}

module.exports = {
  withBudget,
  itunesSearch,
  tidalSearch,
  ytsrSearch,
  toSeconds,
  SOURCE_META,
  DIRECT_SOURCES,
  TIDAL_TOKEN,
};
