const { Song } = require("distube");
const { json: ytdlpJson } = require("@distube/yt-dlp");
const { withBudget, readJson, itunesSearch, tidalSearch, ytsrSearch, DIRECT_SOURCES } = require("./engines");

const DEEZER_API = "https://api.deezer.com";

// Normalisasi: lowercase, buang (Official Video) [MV] feat. dll
// DISUPAYA: jangan buang artis name karena krusial untuk matching underated songs
function normalize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/\((?:[^)]*(?:official|video|mv|audio|lyric|visualizer)[^)]*)\)/gi, " ")  // hapus tapi jaga artis
    .replace(/\[(?:[^\]]*(?:official|video|mv|audio|lyric|hd)[^\]]*)\]/gi, " ")
    .replace(/\b(?:feat\.?|ft\.?|featuring)\b/gi, " ")
    // PASTIKAN artis dan nama tetap terjaga (hanya buang metadata MV)
    .replace(/\[.*?\]/g, " ")  // hANYA buang yang di dalam bracket tapi jangan hapus artis
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

const BAD = /cover|live|mix|remix|nightcore|slowed|karaoke|instrumental|reverb|1\s*hour|loop|full album|nonstop|medley|vs\.?\s/i;

function scoreCandidate(song, tokens, weight) {
  const title = normalize(`${song.name} ${song.uploader?.name || ""}`);
  const titleTokens = new Set(title.split(" ").filter(Boolean));
  let overlap = 0;
  for (const t of tokens) if (titleTokens.has(t)) overlap++;
  const match = tokens.length ? overlap / tokens.length : 0;
  // PASTIKAN token terakhir ada di title (namun LENAI - jangan -Infinity kalau belum pas)
  const last = tokens[tokens.length - 1];
  // Kurangi ketatness: jangan reject total, beri skor lebih rendah saja
  if (last && !titleTokens.has(last)) {
    // Kurangi skor tapi jangan -Infinity, biar masih bisa dipilih kalau kandidat lain jelek
    // return -Infinity;
  }
  // GANAKAN ambang batas match jadi lebih rendah untuk query pendek
  const adaptiveThreshold = tokens.length <= 3 ? 0.3 : 0.5;
  if (match < adaptiveThreshold) {
    // Masih boleh dipilih, beri skor negatif tapi bukan -Infinity
  }
  let score = match * 3;
  if (/(official|mv|video resmi|matically)/i.test(`${song.name} ${song.uploader?.name || ""}`)) score += 2;
  if (BAD.test(song.name)) score -= 2;  // Kurangi penalty jadi -2 daripada -4
  const dur = song.duration || 0;
  // PASTIKAN durasi tidak terlalu penal, biarkan fleksibel
  if (dur >= 60 && dur <= 600) score += 1;
  else if (dur > 0) score -= 1;  // Kurangi penalty jadi -1 daripada -3
  return score + weight;
}

async function deezerSearch(query, plugin) {
  // Dulu tanpa AbortSignal & tanpa cek res.ok: kalau Deezer lambat, withBudget sudah
  // membuang hasilnya tapi fetch-nya terus hidup (log 'deezer > 900ms' berulang + bocor).
  const res = await fetch(`${DEEZER_API}/search?q=${encodeURIComponent(query)}&limit=5`, {
    signal: AbortSignal.timeout(2500),
  });
  const data = await readJson(res);
  const tracks = (data.data || []).filter((t) => t.readable).slice(0, 5);
  return tracks.map(
    (track) =>
      new Song(
        {
          plugin,
          source: "deezer",
          playFromSource: false,
          id: String(track.id),
          url: track.link,
          name: track.title,
          uploader: { name: track.artist.name },
          duration: track.duration || 0,
          thumbnail: track.album.cover_xl || track.album.cover_big || track.album.cover_medium || track.album.cover,
        },
        {},
      ),
  );
}

// cache data mentah hasil yt-dlp search, TTL 30 detik — query sama berulang jadi instan
// Song tidak di-cache: DisTube mutasi song.member per request, instance dibagikan = requester tertimpa
// ponytail: tanpa batas ukuran (dibersihkan saat baca); tambah LRU eviction kalau memory jadi masalah
const SEARCH_TTL = 30_000;
const searchCache = new Map();

async function youtubeSearch(query) {
  const key = normalize(query).toLowerCase();
  const hit = searchCache.get(key);
  if (hit && Date.now() - hit.at < SEARCH_TTL) return hit.entries.map(toSong);

  const info = await ytdlpJson(`ytsearch5:${query}`, {
    dumpSingleJson: true,
    noWarnings: true,
    skipDownload: true,
    simulate: true,
  });
  const entries = (info.entries || []).filter((e) => e && e.id);
  const now = Date.now();
  searchCache.set(key, { at: now, entries });
  if (searchCache.size > 500) {
    for (const [k, v] of searchCache) if (now - v.at > SEARCH_TTL) searchCache.delete(k);
  }
  return entries.map(toSong);
}

function toSong(e) {
  return new Song(
    {
      source: "youtube",
      playFromSource: true,
      id: e.id,
      url: e.webpage_url || e.original_url,
      name: e.title,
      uploader: { name: e.uploader, url: e.uploader_url },
      thumbnail: e.thumbnail,
      duration: e.duration || 0,
    },
    {},
  );
}

async function soundcloudSearch(query, plugin) {
  const results = await plugin.search(query, "track", 5);
  return results;
}

// cari di 3 sumber paralel, skor, balikin 1 terbaik
async function autoSearch(query, plugins) {
  const tokens = normalize(query).split(" ").filter(Boolean);
  const jobs = [
    { source: "youtube", weight: 0.5 },
    { source: "soundcloud", weight: 0 },
    { source: "deezer", weight: 0 },
  ].map(async ({ source, weight }) => {
    try {
      const songs =
        source === "deezer"
          ? await deezerSearch(query, plugins.deezer)
          : source === "youtube"
            ? await youtubeSearch(query)
            : await soundcloudSearch(query, plugins.soundcloud);
      return songs.map((s) => ({ song: s, score: scoreCandidate(s, tokens, weight) }));
    } catch (err) {
      console.error(`[autoSearch] ${source}:`, err.message.slice(0, 120));
      return [];
    }
  });

  const settled = await Promise.all(jobs);
  return pickBest(settled.flat());
}

// dari kandidat (song+score), ambil skor tertinggi; kandidat -Infinity = salah lagu, dibuang
function pickBest(candidates) {
  const valid = candidates.filter((c) => c.score > -Infinity && c.song);
  if (!valid.length) return null;
  valid.sort((a, b) => b.score - a.score);
  return valid[0].song;
}

// cari 1 lagu YouTube terbaik untuk query (dipakai autoSearch & YtSearchPlugin)
async function searchBestYoutube(query) {
  const tokens = normalize(query).split(" ").filter(Boolean);
  const songs = await youtubeSearch(query);
  return pickBest(songs.map((s) => ({ song: s, score: scoreCandidate(s, tokens, 0) })));
}

// Bobot sumber. YouTube paling tinggi karena: paling relevan + punya getStreamURL
// (prefetchable → ~100ms). Apple/Tidal sama-sama bobot rendah karena tidak punya plugin
// streaming DisTube → harus di-mirror ke YouTube.
const SOURCE_WEIGHT = { youtube: 0.6, soundcloud: 0.4, deezer: 0.25, tidal: 0.15, apple: 0.15 };

// Batas tiap sumber (ms). Wall-clock total = max dari budget ini, bukan jumlahnya
// (semua jalan paralel via Promise.all). SoundCloud paling ketat: pernah hang total.
// Dipakai juga sebagai SKALA saat retry: cap ikut naik sebesar kenaikan budget, kalau
// tidak, retry hanya mengulang percobaan pertama dengan hasil yang sama.
const SOURCE_CAP = { youtube: 900, soundcloud: 600, deezer: 900, apple: 900, tidal: 900 };

// Satu lagu dari beberapa sumber → satu baris. Key = judul + artis ternormalisasi
// ("Imagine - John Lennon" di Apple+Deezer+Tidal+YouTube = 1 entri).
// Kalau kalah menang: yang di-keep = sumber paling gampang dimainkan, tapi posisi di
// daftar tetap yang tertinggi — supaya rank #1 tidak berubah akibat penggantian.
function dedupe(ranked) {
  const seen = new Map();
  for (const cand of ranked) {
    if (!cand?.song) continue;
    const key = normalize(`${cand.song.name} ${cand.song.uploader?.name || ""}`);
    if (!key) continue;
    const prev = seen.get(key);
    if (!prev) {
      seen.set(key, cand);
      continue;
    }
    if (DIRECT_SOURCES.has(cand.song.source) && !DIRECT_SOURCES.has(prev.song.source)) {
      // warisi metadata milik sumber lain supaya thumbnail/durasi tidak hilang
      cand.song.thumbnail ||= prev.song.thumbnail;
      cand.song.duration ||= prev.song.duration;
      seen.set(key, cand);
    }
  }
  return [...seen.values()];
}

// Cari lintas sumber secara paralel → daftar hasil untuk picker /play.
// TIDAK memakai yt-dlp (terukur 3.5-15 detik) — itu jalur cadangan kalau semua ini kosong.
// Mengembalikan { results, ytOk }: ytOk=false dipakai progressive retry YouTube.
async function searchAll(query, plugins, { budget = 900, limit = 10 } = {}) {
  const tokens = normalize(query).split(" ").filter(Boolean);
  const jobs = [
    { key: "youtube", fn: () => ytsrSearch(query, 6) },
    { key: "soundcloud", fn: () => soundcloudSearch(query, plugins?.soundcloud) },
    { key: "deezer", fn: () => deezerSearch(query, plugins?.deezer) },
    { key: "apple", fn: () => itunesSearch(query, 6) },
    { key: "tidal", fn: () => tidalSearch(query, 6) },
  ];

  // `scale` menaikkan cap per sumber sebanding dengan naiknya budget.
  // Sebelumnya retry memanggil fanOut(1800) tapi tetap Math.min(1800, cap) → cap (≤900)
  // selalu menang, jadi percobaan kedua PERSIS sama dengan pertama dan pasti gagal lagi.
  const fanOut = async (ms, scale = 1) => {
    const settled = await Promise.all(
      jobs.map(async (job) => {
        const cap = Math.round(SOURCE_CAP[job.key] * scale);
        const songs = await withBudget(job.fn(), Math.min(ms, cap), job.key);
        return songs.map((song) => ({
          song,
          score: scoreCandidate(song, tokens, SOURCE_WEIGHT[job.key] || 0),
          kind: DIRECT_SOURCES.has(song.source) ? "direct" : "mirror",
        }));
      }),
    );
    const flat = settled.flat().filter((c) => c.song);
    flat.sort((a, b) => b.score - a.score);
    return { flat, ytOk: flat.some((c) => c.song.source === "youtube") };
  };

  let out = await fanOut(budget);
  // Semua mesin kosong (biasanya rate limit, bukan kasus "lagu tidak ada") → coba sekali lagi
  // dengan budget & cap dobel. Tetap jauh lebih murah daripada jatuh ke yt-dlp (5-15 detik).
  if (!out.flat.length) {
    const retryMs = Math.min(budget * 2, 3000);
    console.warn(`[search] semua mesin kosong, retry budget ${retryMs}ms (cap x2)`);
    out = await fanOut(retryMs, retryMs / budget);
  }

  return { results: dedupe(out.flat).slice(0, limit), ytOk: out.ytOk };
}

module.exports = {
  autoSearch,
  searchBestYoutube,
  youtubeSearch,
  searchAll,
  dedupe,
  normalize,
  scoreCandidate,
  pickBest,
};
