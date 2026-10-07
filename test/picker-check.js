// Self-check picker + mesin pencari multi-sumber.
// `node test/picker-check.js` — OFFLINE: fetch & ytsr & yt-dlp di-stub.
const assert = require("assert");
const path = require("path");
const { createRequire } = require("module");

const root = path.join(__dirname, "..");
const req = createRequire(path.join(root, "picker.js"));

// ---- stub dependency jaringan/berat, pasang sebelum modul di-load ----
req.cache[req.resolve("distube")] = {
  id: "distube",
  filename: req.resolve("distube"),
  loaded: true,
  exports: {
    // meniru Song DisTube v5: ada `stream.playFromSource` (tempat stream.url di-cache)
    Song: class Song {
      constructor(d) {
        Object.assign(this, d);
        this.stream = { playFromSource: d.playFromSource };
      }
    },
    isURL: () => false,
  },
};

req.cache[req.resolve("@distube/yt-dlp")] = {
  id: "@distube/yt-dlp",
  filename: req.resolve("@distube/yt-dlp"),
  loaded: true,
  exports: {
    json: async () => ({ entries: [] }),
    YtDlpPlugin: class YtDlpPlugin {
      async getStreamURL(song) {
        return `stream://${song.id}`;
      }
    },
  },
};

const YTSR_ITEMS = [
  {
    type: "video",
    id: "yt1",
    url: "https://www.youtube.com/watch?v=yt1",
    name: "Imagine - John Lennon",
    thumbnail: "https://img/1.jpg",
    duration: "3:05",
    author: { name: "John Lennon" },
    isLive: false,
  },
  {
    type: "video",
    id: "yt2",
    url: "https://www.youtube.com/watch?v=yt2",
    name: "Imagine (Live at Madison Square Garden)",
    thumbnail: "https://img/2.jpg",
    duration: "1:02:11",
    author: { name: "John Lennon" },
    isLive: false,
  },
  { type: "video", id: "yt3", name: "LIVE NOW", isLive: true, url: "https://x" }, // harus dibuang
];
req.cache[req.resolve("@distube/ytsr")] = {
  id: "@distube/ytsr",
  filename: req.resolve("@distube/ytsr"),
  loaded: true,
  exports: async () => ({ items: YTSR_ITEMS }),
};

// ---- stub fetch (iTunes / Tidal / Deezer) ----
const json = (body, status = 200) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
});
let fetchCalls = [];
global.fetch = async (url) => {
  fetchCalls.push(String(url));
  const u = String(url);
  if (u.includes("itunes.apple.com")) {
    return json({
      results: [
        {
          trackId: 1,
          trackName: "Imagine",
          artistName: "John Lennon",
          trackViewUrl: "https://music.apple.com/1",
          artworkUrl100: "https://img/100x100.jpg",
          trackTimeMillis: 185000,
        },
      ],
    });
  }
  if (u.includes("api.tidal.com")) {
    return json({ items: [{ id: 9, title: "Imagine", artist: { name: "John Lennon" }, duration: 183 }] });
  }
  if (u.includes("api.deezer.com")) {
    return json({
      data: [{ id: 7, readable: true, title: "Imagine", link: "https://deezer/7", artist: { name: "John Lennon" }, album: { cover_medium: "https://img/dz.jpg" } }],
    });
  }
  return json({}, 404);
};

const { withBudget, toSeconds, SOURCE_META, DIRECT_SOURCES } = req("./engines");
const { searchAll, dedupe } = req("./search");
const { renderPicker, storePicker, prefetchTop, formatDur, PREFIX, handlePick, handleControl } = req("./picker");

// ---- fake interaction/client untuk menguji handler komponen ----
function fakeInteraction(over = {}) {
  const calls = { reply: [], update: [], editReply: [], deferUpdate: 0 };
  const it = {
    customId: `${PREFIX}quick`,
    values: [],
    user: { id: "user1" },
    guildId: "g1",
    channel: { id: "c1" },
    member: { voice: { channel: { id: "vc1", name: "General" } } },
    message: { id: "msg1" },
    deferred: false,
    replied: false,
    reply: async (m) => {
      calls.reply.push(m);
      it.replied = true;
    },
    update: async (m) => {
      calls.update.push(m);
      it.replied = true;
    },
    deferUpdate: async () => {
      calls.deferUpdate++;
      it.deferred = true;
    },
    editReply: async (m) => {
      calls.editReply.push(m);
    },
    ...over,
  };
  return { it, calls };
}

function fakeClient(queue = null) {
  const played = [];
  return {
    played,
    pickers: new Map(),
    distubeAutoplay: new Map(),
    plugins: { ytdlp: { getStreamURL: async () => "u" } },
    distube: {
      voices: { get: () => null },
      play: async (vc, song, opts) => {
        played.push({ vc, song, opts });
      },
      getQueue: () => queue,
    },
  };
}

const mkQueue = () => ({
  paused: false,
  autoplay: false,
  pause() {
    this.paused = true;
  },
  resume() {
    this.paused = false;
  },
  skip: async () => ({ name: "Next", url: "https://yt/next" }),
});

const direct = (url = "https://www.youtube.com/watch?v=abc") => ({
  results: [{ song: { source: "youtube", name: "A", url, stream: { playFromSource: true } }, kind: "direct" }],
  query: "q",
  requester: "user1",
});

const mk = (source, name, artist, score) => ({
  song: { source, name, uploader: { name: artist }, url: `https://${source}/x`, duration: 180 },
  score,
  kind: DIRECT_SOURCES.has(source) ? "direct" : "mirror",
});

(async () => {
  // 1. withBudget: cepat lolos, lambat & gagal → []
  assert.deepStrictEqual(await withBudget(Promise.resolve([1]), 200, "fast"), [1], "promise cepat harus lolos");
  assert.deepStrictEqual(
    await withBudget(new Promise((r) => setTimeout(() => r([2]), 200)), 30, "slow"),
    [],
    "promise lewat budget harus dibuang, bukan menggantung",
  );
  assert.deepStrictEqual(await withBudget(Promise.reject(new Error("boom")), 200, "rej"), [], "promise gagal → []");

  // 2. toSeconds: "3:05" → 185, "1:02:11" → 3731, sampah → 0
  assert.strictEqual(toSeconds("3:05"), 185);
  assert.strictEqual(toSeconds("1:02:11"), 3731);
  assert.strictEqual(toSeconds("bogus"), 0);

  // 3. dedupe: lagu sama dari beberapa sumber → 1 baris, yang bisa langsung diputar menang,
  //    tapi POSISI tetap milik yang skornya tertinggi (rank #1 tidak bergeser).
  const d1 = dedupe([mk("apple", "Imagine", "John Lennon", 9), mk("youtube", "Imagine", "John Lennon", 5)]);
  assert.strictEqual(d1.length, 1, "lagu sama harus jadi 1 entri");
  assert.strictEqual(d1[0].song.source, "youtube", "sumber direct harus menang dari mirror");
  assert.strictEqual(d1[0].score, 5, "skor ikut entri yang menang");

  const d3 = dedupe([
    mk("apple", "Song A", "Artist A", 9),
    mk("tidal", "Song B", "Artist B", 8),
    mk("youtube", "Song A", "Artist A", 5),
  ]);
  assert.strictEqual(d3.length, 2, "Song A & Song B berbeda → 2 entri");
  assert.deepStrictEqual(
    d3.map((c) => `${c.song.source}:${c.song.name}`),
    ["youtube:Song A", "tidal:Song B"],
    "Song A diganti sumbernya tapi posisinya tetap di atas Song B",
  );
  const d4 = dedupe([mk("apple", "Song C", "Artist A", 9), mk("tidal", "Song C", "Artist A", 1)]);
  assert.strictEqual(d4[0].song.source, "apple", "mirror tidak boleh diturunkan oleh mirror lain");

  // 4. searchAll: fan-out paralel, ytOk true, hasil ter-dedupe, tanpa duplikat
  fetchCalls = [];
  const { results, ytOk } = await searchAll("Imagine John Lennon", {}, { budget: 500, limit: 10 });
  assert.strictEqual(ytOk, true, "ytOk harus true kalau youtube mengembalikan hasil");
  assert.ok(results.length >= 2, `harus ada hasil, dapat ${results.length}`);
  const keys = results.map((r) => `${r.song.name}|${r.song.uploader?.name}`.toLowerCase());
  assert.strictEqual(new Set(keys).size, keys.length, "tidak boleh ada duplikat setelah dedupe");
  assert.ok(
    results.every((r) => r.kind === "direct" || r.kind === "mirror"),
    "tiap hasil harus punya kind",
  );
  assert.ok(
    results.some((r) => r.song.source === "youtube"),
    "hasil youtube harus ada",
  );
  assert.ok(!results.some((r) => r.song.name === "LIVE NOW"), "video live harus dibuang");
  assert.ok(fetchCalls.some((u) => u.includes("itunes.apple.com")), "iTunes harus dipanggil");
  assert.ok(fetchCalls.some((u) => u.includes("api.tidal.com")), "Tidal harus dipanggil");

  // 5. renderPicker: select menu 1 opsi per hasil, value = index (bukan string user),
  //    tombol cepat ada, dan total komponen ≤ batas Discord (5 baris).
  const view = renderPicker("Imagine John Lennon", results, 640);
  assert.ok(view.embeds?.[0]?.data?.description?.length > 0, "embed harus punya deskripsi daftar");
  assert.ok(view.components.length <= 5, "komponen maksimal 5 baris");
  const menu = view.components[0].components[0];
  assert.strictEqual(menu.data.custom_id, `${PREFIX}play`);
  assert.strictEqual(menu.options.length, results.length, "opsi menu harus sebanyak hasil");
  assert.deepStrictEqual(
    menu.options.map((o) => o.data.value),
    results.map((_, i) => String(i)),
    "value menu harus index integer, bukan teks bebas",
  );
  assert.ok(menu.options.every((o) => o.data.label.length <= 100 && o.data.description.length <= 100), "label/desc ≤100 char");
  const btnIds = view.components[1].components.map((b) => b.data.custom_id);
  assert.deepStrictEqual(btnIds, [`${PREFIX}quick`, `${PREFIX}rand`, `${PREFIX}cancel`]);

  // 6. storePicker: state per message id, sekali pakai, dan TIDAK menyimpan apa pun dari user
  const client = {};
  const fakeMsg = { id: "msg1", edit: async () => {} };
  storePicker(client, fakeMsg, { results, query: "Imagine John Lennon", requester: "user1" });
  const st = client.pickers.get("msg1");
  assert.ok(st, "state picker harus tersimpan per message id");
  assert.strictEqual(st.results, results);
  assert.strictEqual(st.requester, "user1");
  assert.ok(!("token" in st) && !("content" in st), "state tidak boleh menyimpan data sensitif");

  // 7. prefetchTop: hanya menyentuh lagu youtube direct, maksimal 3 proses paralel
  const seen = [];
  const stubClient = { plugins: { ytdlp: { getStreamURL: async (s) => { seen.push(s.id); return "u"; } } } };
  prefetchTop(stubClient, results);
  await new Promise((r) => setTimeout(r, 20));
  assert.ok(seen.length <= 3, `prefetch maksimal 3 proses, dapat ${seen.length}`);
  assert.ok(seen.every((id) => id.startsWith("yt")), "hanya lagu youtube yang di-prefetch");

  // 8. formatDur + label sumber lengkap
  assert.strictEqual(formatDur(0), "?:??");
  assert.strictEqual(formatDur(185), "3:05");
  assert.strictEqual(formatDur(59), "0:59");
  for (const s of ["youtube", "soundcloud", "deezer", "apple", "tidal"]) {
    assert.ok(SOURCE_META[s]?.emoji && SOURCE_META[s]?.label, `label sumber ${s} harus ada`);
  }
  assert.ok(DIRECT_SOURCES.has("youtube") && DIRECT_SOURCES.has("soundcloud"), "youtube & soundcloud = direct");
  assert.ok(!DIRECT_SOURCES.has("deezer"), "deezer bukan direct (InfoExtractorPlugin)");

  // 9. handlePick: tombol ⚡ → defer, main, state sekali pakai
  const c1 = fakeClient();
  c1.pickers.set("msg1", direct());
  const p1 = fakeInteraction();
  await handlePick(p1.it, c1);
  assert.strictEqual(p1.calls.deferUpdate, 1, "harus deferUpdate sebelum kerja berat");
  assert.strictEqual(c1.played.length, 1, "distube.play harus dipanggil");
  assert.strictEqual(c1.played[0].song.url, "https://www.youtube.com/watch?v=abc");
  assert.strictEqual(c1.played[0].song.stream.url, "u", "warmStream harus mengisi stream.url sebelum play (hemat 1x spawn yt-dlp)");
  assert.ok(!c1.pickers.has("msg1"), "state picker harus sekali pakai");
  assert.ok(p1.calls.editReply.length >= 2, "harus menampilkan status lalu hasil");

  // 10. handlePick: pilihan tidak valid (index di luar jangkauan) → tidak boleh memutar
  const c2 = fakeClient();
  c2.pickers.set("msg1", direct());
  const p2 = fakeInteraction({ customId: `${PREFIX}play`, values: ["99"] });
  await handlePick(p2.it, c2);
  assert.strictEqual(c2.played.length, 0, "pilihan nggak valid tidak boleh memutar");
  assert.strictEqual(p2.calls.reply.length, 1, "harus menjawab dengan pesan error");

  // 11. handlePick: value adalah teks bebas (bukan integer) → Number() = NaN → ditolak
  const c3 = fakeClient();
  c3.pickers.set("msg1", direct());
  const p3 = fakeInteraction({ customId: `${PREFIX}play`, values: ["<@me>"] });
  await handlePick(p3.it, c3);
  assert.strictEqual(c3.played.length, 0, "teks user tidak boleh lolos ke pemutar");

  // 12. handlePick: menu kadaluarsa → pesan error, tidak ada akses ke data lama
  const c4 = fakeClient();
  const p4 = fakeInteraction();
  await handlePick(p4.it, c4);
  assert.strictEqual(c4.played.length, 0);
  assert.match(p4.calls.reply[0].content, /kadaluwarsa/i);

  // 13. handlePick: batal hanya oleh requester
  const c5 = fakeClient();
  c5.pickers.set("msg1", direct());
  const p5 = fakeInteraction({ customId: `${PREFIX}cancel`, user: { id: "lain" } });
  await handlePick(p5.it, c5);
  assert.strictEqual(c5.pickers.has("msg1"), true, "yang bukan requester tidak boleh batal");
  const c5b = fakeClient();
  c5b.pickers.set("msg1", direct());
  const p5b = fakeInteraction({ customId: `${PREFIX}cancel` });
  await handlePick(p5b.it, c5b);
  assert.strictEqual(c5b.pickers.has("msg1"), false, "requester boleh batal");

  // 14. handlePick: tidak di voice → jangan ambil alih
  const c6 = fakeClient();
  c6.pickers.set("msg1", direct());
  const p6 = fakeInteraction({ member: { voice: { channel: null } } });
  await handlePick(p6.it, c6);
  assert.strictEqual(c6.played.length, 0);
  assert.strictEqual(c6.pickers.has("msg1"), true, "state tetap ada agar user bisa pilih ulang");

  // 15. handlePick: sumber mirror (Apple) → di-mirror ke YouTube via ytsr
  const c7 = fakeClient();
  c7.pickers.set("msg1", {
    results: [{ song: { source: "apple", name: "Imagine", uploader: { name: "John Lennon" }, url: "https://music.apple.com/x" }, kind: "mirror" }],
    query: "q",
    requester: "user1",
  });
  const p7 = fakeInteraction();
  await handlePick(p7.it, c7);
  assert.strictEqual(c7.played.length, 1, "mirror tetap harus memutar");
  assert.match(c7.played[0].song.url, /youtube\.com/, "mirror harus dilempar ke YouTube, bukan URL Apple (tidak ada pluginnya)");

  // 16. handleControl: pause resume pakai pause()/resume() — DisTube v5 TIDAK punya togglePause
  for (const id of ["np_pause", "toggle_pause"]) {
    const q = mkQueue();
    const cb = fakeClient(q);
    const p = fakeInteraction({ customId: id });
    await handleControl(p.it, cb);
    assert.strictEqual(q.paused, true, `${id} pertama harus pause`);
    const p2 = fakeInteraction({ customId: id });
    await handleControl(p2.it, fakeClient(q));
    assert.strictEqual(q.paused, false, `${id} kedua harus resume`);
  }

  // 17. handleControl: skip + autoplay + tanpa antrian
  const q = mkQueue();
  const cs = fakeClient(q);
  const ps = fakeInteraction({ customId: "np_skip" });
  await handleControl(ps.it, cs);
  assert.match(ps.calls.reply[0].content, /⏭️/);

  const pa = fakeInteraction({ customId: "np_autoplay" });
  await handleControl(pa.it, fakeClient(q));
  assert.strictEqual(q.autoplay, true, "tombol autoplay harus menghidupkan autoplay");
  assert.strictEqual(pa.it.client, undefined, "client dipakai dari argumen, bukan interaction");

  const pn = fakeInteraction();
  await handleControl(pn.it, fakeClient(null));
  assert.match(pn.calls.reply[0].content, /Belum ada antrian/);

// 18. integrasi command: /search & /play query polos harus sama-sama menampilkan picker
  const commands = req("./commands");
  const cmd = (name) => commands.find((c) => c.data.name === name);

  async function runCommand(name, { inVoice = true, query = "imagine john lennon" } = {}) {
    const client = fakeClient();
    const calls = { editReply: [], reply: [] };
    const message = { id: "m-cmd", edit: async () => {} };
    const interaction = {
      client,
      commandName: name,
      guildId: "g1",
      channel: { id: "c1" },
      user: { id: "user1" },
      member: inVoice ? { voice: { channel: { id: "vc1", name: "General" } } } : { voice: { channel: null } },
      options: { getString: () => query },
      reply: async (m) => calls.reply.push(m),
      editReply: async (m) => calls.editReply.push(m),
      fetchReply: async () => message,
      deferred: false,
      replied: true,
    };
    await cmd(name).execute(interaction, client.distube);
    return { client, calls, message };
  }

  const rSearch = await runCommand("search", { inVoice: false });
  assert.ok(rSearch.client.pickers.get("m-cmd"), "/search tanpa voice tetap harus menampilkan picker");
  const searchView = rSearch.calls.editReply.at(-1);
  assert.ok(searchView?.embeds?.length && searchView?.components?.length, "/search harus mengirim embed + komponen");
  assert.strictEqual(rSearch.client.played.length, 0, "/search tidak boleh langsung memutar");

  const rPlay = await runCommand("play");
  assert.ok(rPlay.client.pickers.get("m-cmd"), "/play query polos harus menampilkan picker");

  const rPlayNoVc = await runCommand("play", { inVoice: false });
  assert.ok(!rPlayNoVc.client.pickers.get("m-cmd"), "/play tanpa voice harus ditolak sebelum mencari");
  assert.strictEqual(rPlayNoVc.calls.reply.length, 1, "/play tanpa voice harus menolak dengan satu reply");
  assert.match(rPlayNoVc.calls.reply[0].content, /voice channel/i);

  // 19. safeError: pesan error yang dikirim ke channel publik tidak boleh memuat path lokal
  const { safeError } = req("./theme");
  const leaky = [
    "Error: C:\\Users\\USER\\Downloads\\lowkey-music\\node_modules\\@distube\\yt-dlp\\dist\\index.js:187 failed",
    "yt-dlp exited 1 at /home/user/bot/cookies.json",
    "file:///C:/Users/USER/AppData/Local/Temp/cookies.txt missing",
  ];
  for (const raw of leaky) {
    const out = safeError(raw);
    assert.ok(!/[A-Za-z]:[\\/]/.test(out), `path Windows bocor: ${out}`);
    assert.ok(!/\/(?:home|Users|AppData)\//.test(out), `path POSIX bocor: ${out}`);
    assert.ok(out.includes("<path>"), `harus menandai lokasi: ${out}`);
  }
  // URL normal tidak boleh dirusak
  const url = "see https://www.youtube.com/watch?v=abc for info";
  assert.strictEqual(safeError(url), url, "URL tidak boleh disamarkan sebagai path");
  assert.strictEqual(safeError("pesan biasa"), "pesan biasa");
  assert.ok(safeError("x".repeat(500), 100).length === 100, "harus dipotong sesuai max");

  console.log("✅ picker-check: 19/19 lulus");
  process.exit(0);
})().catch((e) => {
  console.error("❌ picker-check GAGAL:", e.message);
  console.error(e.stack);
  process.exit(1);
});