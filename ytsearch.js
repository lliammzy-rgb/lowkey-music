// YtSearchPlugin: fallback search DisTube untuk lagu Spotify/Deezer → mirror YouTube terbaik.
// Kenapa ada: DisTube hanya pakai plugin bertipe "extractor" untuk search fallback, dan
// YtDlpPlugin bertipe "playable-extractor" sehingga tidak pernah ikut. Tanpa plugin ini
// lagu Spotify jatuh ke SoundCloud (sering salah rekaman / preview 30 detik → autoskip).
const { YtDlpPlugin } = require("@distube/yt-dlp");
const { searchBestYoutube, youtubeSearch } = require("./search");

// Autoplay DisTube native butuh Plugin.getRelatedSongs(song), tapi bawaan @distube/yt-dlp
// SELALU return [] → DisTube lempar NO_RELATED → queue dibuang → bot keluar voice.
// Ini pengganti: cari lagu lain dari artis yang sama lewat YouTube.
// Dipasang di YtDlpPlugin.prototype (lihat index.js) supaya YtSearchPlugin ikut mewarisi.
async function getRelatedSongs(song, searchFn = youtubeSearch) {
  const strip = (s) =>
    (s || "")
      // buang kelompok "(Official Video)" / "[MV]" / "{Lyrics}" dst (semua jenis kurung)
      .replace(/[([{]\s*[^)\]}]*\b(official\s*(music\s*)?video|lyrics?|visualizer|audio|mv)\b[^)\]}]*[)\]}]/gi, " ")
      // buang kata sisanya kalau berdiri sendiri
      .replace(/\b(official\s*(music\s*)?video|lyrics?|visualizer|mv)\b/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  const title = strip(song?.name);
  const artist = strip(song?.uploader?.name);
  const queries = [];
  if (artist) queries.push(`${artist} audio`); // lagu lain artis yang sama (genre/era identik)
  if (title && artist) queries.push(`${title} ${artist}`);
  else if (title) queries.push(title);

  const seen = new Set([song?.url].filter(Boolean));
  for (const q of queries) {
    let results = [];
    try {
      results = await searchFn(q);
    } catch (err) {
      console.error(`[autoplay] "${q}": ${err.message?.slice(0, 150) ?? err}`);
      continue;
    }
    const pool = results
      .filter((s) => !s.isLive && (!s.duration || s.duration <= 1200)) // buang live/mix 1 jam
      .filter((s) => {
        const url = s.url || "";
        if (!url || seen.has(url)) return false;
        seen.add(url);
        return true;
      });
    if (pool.length) {
      // plugin = `this` supaya DisTube bisa ambil stream URL-nya saat lagu ini dimuat
      for (const s of pool) s.plugin = this;
      return pool;
    }
  }
  return [];
}

class YtSearchPlugin extends YtDlpPlugin {
  // ikut fallback search DisTube (YtDlpPlugin = "playable-extractor", tidak ikut)
  type = "extractor";

  // jangan pernah menang resolve URL — biar YtDlpPlugin asli (posisi terakhir) yang handle
  validate() {
    return false;
  }

  // redam warning bawaan YtDlpPlugin.init (cek posisi terakhir) — tidak relevan utk plugin search
  init() {}

  async searchSong(query) {
    try {
      const song = await searchBestYoutube(query);
      if (song) song.plugin = this;
      return song;
    } catch (err) {
      console.error(`[YtSearchPlugin] ${err.message?.slice(0, 150) ?? err}`);
      return null;
    }
  }
}

module.exports = { YtSearchPlugin, getRelatedSongs };
