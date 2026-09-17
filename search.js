const { Song } = require("distube");
const { json: ytdlpJson } = require("@distube/yt-dlp");

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
  const res = await fetch(`${DEEZER_API}/search?q=${encodeURIComponent(query)}&limit=5`);
  const data = await res.json();
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
          thumbnail: track.album.cover_xl || track.album.cover_big || track.album.cover_medium || track.album.cover,
        },
        {},
      ),
  );
}

async function youtubeSearch(query) {
  const info = await ytdlpJson(`ytsearch5:${query}`, {
    dumpSingleJson: true,
    noWarnings: true,
    skipDownload: true,
    simulate: true,
  });
  return (info.entries || []).map(
    (e) =>
      new Song(
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
      ),
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

module.exports = { autoSearch, searchBestYoutube };
