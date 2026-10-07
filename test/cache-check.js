// Self-check cache youtubeSearch: `node test/cache-check.js` (offline, yt-dlp di-stub)
const assert = require("assert");
const path = require("path");
const Module = require("module");
const { createRequire } = Module;

const root = path.join(__dirname, "..");
const req = createRequire(path.join(root, "search.js"));

// stub 2 dependency search.js, pasang di require.cache sebelum load
req.cache[req.resolve("@distube/yt-dlp")] = {
  id: "@distube/yt-dlp",
  filename: req.resolve("@distube/yt-dlp"),
  loaded: true,
  exports: {
    json: async (query) => {
      calls.push(query);
      return {
        entries: [
          { id: "1", title: "Queen - Don't Stop Me Now (Official Video)", webpage_url: "https://yt/1", uploader: "Queen", duration: 220 },
          { id: "2", title: "Queen - Radio Ga Ga", original_url: "https://yt/2", uploader: "Queen", duration: 340 },
        ],
      };
    },
  },
};
req.cache[req.resolve("distube")] = {
  id: "distube",
  filename: req.resolve("distube"),
  loaded: true,
  exports: { Song: class Song { constructor(d) { Object.assign(this, d); } } },
};

const calls = [];
const { youtubeSearch, searchBestYoutube } = req("./search");

(async () => {
  // 1. dua query ekuivalen (beda kapital/bracket) → cukup 1 panggilan yt-dlp
  const a = await youtubeSearch("Queen Don't Stop Me Now");
  const b = await youtubeSearch("QUEEN  Don't Stop Me Now (Official Video)");
  assert.strictEqual(calls.length, 1, `query ekuivalen harus kena cache, calls=${calls.length}`);
  assert.strictEqual(a.length, 2);
  assert.deepStrictEqual(b.map((s) => s.id), a.map((s) => s.id));

  // 2. instance Song berbeda tiap panggilan → DisTube bisa mutasi song.member tanpa tabrak cache
  assert.notStrictEqual(a[0], b[0], "objek Song tidak boleh dibagikan antar-request");
  a[0].member = "userA";
  assert.strictEqual(b[0].member, undefined, "mutasi hasil lama tidak boleh bocor ke hasil baru");

  // 3. query beda → tetap panggil yt-dlp
  await youtubeSearch("Imagine - John Lennon");
  assert.strictEqual(calls.length, 2, "query berbeda tidak boleh kena cache");

  // 4. searchBestYoutube (path /play) juga di-cache
  await searchBestYoutube("Imagine - John Lennon");
  assert.strictEqual(calls.length, 2, "searchBestYoutube harus pakai cache youtubeSearch");

  console.log("✅ cache-check: 4/4 lulus");
})().catch((e) => {
  console.error("❌ cache-check GAGAL:", e.message);
  process.exit(1);
});
