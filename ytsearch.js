// YtSearchPlugin: fallback search DisTube untuk lagu Spotify/Deezer → mirror YouTube terbaik.
// Kenapa ada: DisTube hanya pakai plugin bertipe "extractor" untuk search fallback, dan
// YtDlpPlugin bertipe "playable-extractor" sehingga tidak pernah ikut. Tanpa plugin ini
// lagu Spotify jatuh ke SoundCloud (sering salah rekaman / preview 30 detik → autoskip).
const { YtDlpPlugin } = require("@distube/yt-dlp");
const { searchBestYoutube } = require("./search");

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

module.exports = { YtSearchPlugin };
