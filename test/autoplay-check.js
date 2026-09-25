// Self-check autoplay: jalankan `node test/autoplay-check.js`
//   node >= 18, tanpa framework test.
const assert = require("assert");
const { getRelatedSongs } = require("../ytsearch");

// Stub "this" seperti plugin YtDlpPlugin (yang dipanggil DisTube via plugin.getRelatedSongs(song))
const pluginStub = { getRelatedSongs };

function mkSong(id, name, url, extra = {}) {
  return { id, name, url, uploader: { name: "Queen" }, isLive: false, duration: 240, ...extra };
}

let calls = [];

(async () => {
  // 1. Query utama = artis mix, lagu live/terlalu panjang dibuang, plugin di-inject
  {
    calls = [];
    const fakeSearch = async (q) => {
      calls.push(q);
      if (calls.length === 1) {
        return [
          mkSong("a", "Radio Ga Ga (Official Video)", "https://yt/a", { isLive: true }), // buang: live
          mkSong("b", "Some 3 Hour Mix", "https://yt/b", { duration: 10800 }), // buang: kepanjangan
          mkSong("c", "Don't Stop Me Now", "https://yt/c"), // ✅ lolos
        ];
      }
      return [mkSong("z", "should not be reached", "https://yt/z")];
    };
    const out = await pluginStub.getRelatedSongs(mkSong("q1", "Bohemian Rhapsody", "https://yt/q1"), fakeSearch);
    assert.strictEqual(calls.length, 1, "query pertama sudah ada hasil → tidak lanjut query ke-2");
    assert.match(calls[0], /^Queen audio$/, `query utama harus "Queen audio", dapat: ${calls[0]}`);
    assert.deepStrictEqual(out.map((s) => s.id), ["c"], "live + durasi >20 menit harus dibuang");
    assert.strictEqual(out[0].plugin, pluginStub, "song.plugin harus = plugin agar stream URL bisa diambil");
  }

  // 2. Judul dibersihkan dari "(Official Video)"/"[MV]", dan URL lagu asal tidak ikut
  {
    calls = [];
    const fakeSearch = async (q) => {
      calls.push(q);
      if (calls.length === 1) return []; // mix artis nihil → jatuh ke query ke-2
      return [mkSong("same", "Same Song", "https://yt/q1"), mkSong("d", "Under Pressure", "https://yt/d")];
    };
    const src = mkSong("q1", "Bohemian Rhapsody (Official Video) [MV]", "https://yt/q1");
    const out = await pluginStub.getRelatedSongs(src, fakeSearch);
    assert.strictEqual(calls[1], "Bohemian Rhapsody Queen", `query ke-2 salah: ${calls[1]}`);
    assert.deepStrictEqual(out.map((s) => s.id), ["d"], "URL sama dengan lagu asal harus dibuang");
  }

  // 3. Semua search gagal → [] (DisTube lempar NO_RELATED, bot tetap di voice, tidak crash)
  {
    const boom = async () => {
      throw new Error("yt-dlp down");
    };
    const out = await pluginStub.getRelatedSongs(mkSong("q", "Song", "https://yt/q"), boom);
    assert.deepStrictEqual(out, [], "harus []. bukan melempar error");
  }

  // 4. Song tanpa judul & artis → [] tanpa memanggil search
  {
    let hit = 0;
    const out = await pluginStub.getRelatedSongs({ id: "x", name: "", uploader: null }, async () => {
      hit++;
      return [];
    });
    assert.strictEqual(hit, 0, "tidak boleh ada call search");
    assert.deepStrictEqual(out, []);
  }

  // 5. Dedup lintas-query: hasil yang sudah seen tidak boleh dobel
  {
    calls = [];
    const dup = mkSong("d1", "Same URL Twice", "https://yt/dup");
    const fakeSearch = async (q) => {
      calls.push(q);
      return [dup];
    };
    const out = await pluginStub.getRelatedSongs(mkSong("q", "Solo", "https://yt/solo", { uploader: { name: "" } }), fakeSearch);
    assert.strictEqual(out.length, 1, "duplikat URL tidak boleh dobel");
  }

  console.log("✅ autoplay-check: 5/5 lulus");
})().catch((e) => {
  console.error("❌ autoplay-check GAGAL:", e.message);
  process.exit(1);
});
