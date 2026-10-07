// Self-check autocomplete /play.
// `node test/autocomplete-check.js` — OFFLINE: fetch di-stub.
//
// Yang diuji, dan kenapa:
//  1. saran muncul untuk ketikan ≥3 huruf, dan KOSONG untuk <3 (tanpa menyentuh jaringan)
//  2. `value` saran bisa dibalik jadi Song (inti jalur pintas)
//  3. token kadaluarsa → masih bisa jadi query, bukan query sampah
//  4. user yang mengetik manual TIDAK dianggap memilih saran
//  5. dedupe: satu lagu muncul berkali-kali dari iTunes → satu saran
//  6. query identik & ketikan cepat tidak menembak jaringan berkali-kali
//  7. jumlah saran tidak pernah lebih dari 25 & name/value ≤ 100 char (batas Discord)
//  8. /play dengan value saran memutar TANPA searchAll & tanpa picker (jalur pintas)
//  9. events.js merutekan isAutocomplete() → dropdown tidak menggantung
const assert = require("assert");
const path = require("path");
const { EventEmitter } = require("events");
const { createRequire } = require("module");

const root = path.join(__dirname, "..");
const req = createRequire(path.join(root, "autocomplete.js"));

req.cache[req.resolve("distube")] = {
  id: "distube",
  filename: req.resolve("distube"),
  loaded: true,
  exports: {
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

// ytsr dihitung: autocomplete tidak boleh memakainya (ytsr 1.7-12s > deadline 3s),
// tapi picker/resolvePlayable sah-sah saja memakainya untuk mirror.
let ytsrCalls = 0;
let ytsrItems = [];
req.cache[req.resolve("@distube/ytsr")] = {
  id: "@distube/ytsr",
  filename: req.resolve("@distube/ytsr"),
  loaded: true,
  exports: async () => {
    ytsrCalls++;
    return { items: ytsrItems };
  },
};

const json = (body) => ({ ok: true, status: 200, json: async () => body });
let itunesCalls = 0;
let itunesItems = [];
global.fetch = async (url) => {
  const u = String(url);
  if (u.includes("itunes.apple.com")) {
    itunesCalls++;
    return json({ results: itunesItems });
  }
  return json({});
};

const ac = req("./autocomplete");
const { autocompleteSearch, parseChoice, renderChoices, MIN_CHARS } = ac;
const { Song } = req("distube");
const { registerEvents } = req("./events");
const { Events } = require("discord.js");
const commands = req("./commands");

const appleItem = (id, name, artist) => ({
  trackId: id,
  trackName: name,
  artistName: artist,
  trackViewUrl: `https://music.apple.com/${id}`,
  trackTimeMillis: 185000,
});
const mkSong = (o) => new Song(o);

(async () => {
  const client = { autoPicks: new Map() };
  const plugins = {};

  // 1. ambang minimum huruf — tidak menyentuh jaringan sama sekali
  ac._reset();
  ytsrCalls = 0;
  itunesCalls = 0;
  itunesItems = [appleItem(1, "Imagine", "John Lennon")];
  assert.deepStrictEqual(await autocompleteSearch("im", plugins), [], "di bawah 3 huruf harus kosong");
  assert.strictEqual(itunesCalls, 0, "di bawah 3 huruf TIDAK boleh menyentuh jaringan");
  assert.strictEqual(MIN_CHARS, 3);

  // 2. saran + value bisa dibalik jadi Song
  const res = await autocompleteSearch("imagine john lennon", plugins);
  assert.ok(res.length >= 1, "harus ada saran untuk query normal");
  assert.strictEqual(ytsrCalls, 0, "autocomplete TIDAK boleh memakai ytsr (1.7-12s)");
  const choices = renderChoices(res, client);
  assert.ok(choices.length >= 1 && choices.length <= 25, "jumlah saran 1..25");
  for (const c of choices) {
    assert.ok(c.name.length <= 100, "name <= 100 char");
    assert.ok(c.value.length <= 100, "value <= 100 char");
  }
  const back = parseChoice(choices[0].value, client);
  assert.ok(back?.song, "value saran harus bisa dibalik jadi Song");
  assert.strictEqual(back.song.id, "1");
  assert.strictEqual(back.kind, "mirror", "apple = mirror (harus dicarikan padanan YouTube)");

  // 2b. token sama untuk lagu sama → render berulang tidak menumpuk store
  renderChoices(res, client);
  renderChoices(res, client);
  assert.strictEqual(client.autoPicks.size, 1, "render berulang tidak boleh menumpuk token");

  // 3. token kadaluarsa → fallback ke judul, bukan query sampah
  const dead = parseChoice("ac_deadbeef00|Imagine John Lennon", client);
  assert.deepStrictEqual(dead, { query: "Imagine John Lennon" }, "token mati harus jadi query judul");
  assert.strictEqual(parseChoice("ac_deadbeef00", client), null, "token tanpa judul = null");
  assert.strictEqual(parseChoice("imagine john lennon", client), null, "ketikan manual = bukan pilihan");
  assert.strictEqual(parseChoice(undefined, client), null);

  // 5. dedupe: iTunes sering balas lagu sama berkali-kali (versi album/single/remaster)
  ac._reset();
  itunesItems = [
    appleItem(1, "Imagine", "John Lennon"),
    appleItem(2, "Imagine", "John Lennon"),
    appleItem(3, "Imagine", "John Lennon"),
  ];
  const deduped = await autocompleteSearch("imagine lennon", plugins);
  assert.strictEqual(deduped.length, 1, "lagu yang sama tidak boleh memenuhi daftar saran");

  // 6. query identik dua kali → jaringan cuma sekali
  ac._reset();
  itunesCalls = 0;
  await autocompleteSearch("adele hello", plugins);
  await autocompleteSearch("adele hello", plugins);
  assert.strictEqual(itunesCalls, 1, "query identik harus dilayani dari cache");

  // 6b. ketikan cepat (query sama, dua panggilan bersamaan) → jaringan cuma sekali
  ac._reset();
  itunesCalls = 0;
  await Promise.all([autocompleteSearch("queen bohemian", plugins), autocompleteSearch("queen bohemian", plugins)]);
  assert.strictEqual(itunesCalls, 1, "panggilan bersamaan harus disatukan (inflight)");

  // 7. batas 25: iTunes boleh balas banyak, saran tetap dipotong
  ac._reset();
  itunesItems = Array.from({ length: 40 }, (_, i) => appleItem(100 + i, `Song ${i}`, `Artist ${i}`));
  const many = renderChoices(await autocompleteSearch("song artist", plugins, { limit: 25 }), client);
  assert.strictEqual(many.length, 25, "maks 25 saran (batas keras Discord)");

  // 8. JALUR PINTAS: /play dengan value saran memutar tanpa picker.
  ac._reset();
  const playCmd = commands.find((c) => c.data.name === "play");
  const played = [];
  const autoClient = new EventEmitter();
  autoClient.plugins = plugins;
  autoClient.pickers = new Map();
  autoClient.autoPicks = new Map();
  const song = mkSong({
    source: "youtube",
    playFromSource: true,
    id: "yt1",
    url: "https://www.youtube.com/watch?v=yt1",
    name: "Imagine - John Lennon",
    uploader: { name: "John Lennon" },
    duration: 185,
  });
  const token = renderChoices([{ song, kind: "direct" }], autoClient)[0].value;
  const distube = {
    voices: { get: () => null },
    play: async (_vc, s) => played.push(s),
    plugins,
  };
  const interaction = {
    client: autoClient,
    guildId: "g1",
    channel: { id: "c1" },
    user: { id: "u1" },
    member: { voice: { channel: { id: "vc1", name: "General" } } },
    options: { getString: () => token },
    reply: async () => {},
    editReply: async () => {},
    fetchReply: async () => ({ id: "m1", edit: async () => {} }),
    deferred: false,
    replied: true,
  };
  await playCmd.execute(interaction, distube);
  assert.strictEqual(played.length, 1, "saran yang dipilih harus langsung diputar");
  assert.strictEqual(played[0].id, "yt1");
  assert.strictEqual(autoClient.pickers.size, 0, "jalur pintas TIDAK boleh bikin picker");

  // 8b. saran "mirror" harus tetap bisa diputar (dicari padanannya), bukan gagal diam
  ac._reset();
  ytsrItems = [
    {
      type: "video",
      id: "ytm1",
      url: "https://www.youtube.com/watch?v=ytm1",
      name: "Imagine (Official Video)",
      duration: "3:05",
      author: { name: "John Lennon" },
      isLive: false,
    },
  ];
  const mirrorSong = mkSong({
    source: "apple",
    playFromSource: false,
    id: "1440853776",
    url: "https://music.apple.com/1440853776",
    name: "Imagine",
    uploader: { name: "John Lennon" },
    duration: 185,
  });
  const mirrorToken = renderChoices([{ song: mirrorSong, kind: "mirror" }], autoClient)[0].value;
  const mirrorPlayed = [];
  const mirrorDistube = {
    voices: { get: () => null },
    play: async (_vc, s) => mirrorPlayed.push(s),
    plugins,
  };
  await playCmd.execute({ ...interaction, options: { getString: () => mirrorToken } }, mirrorDistube);
  assert.strictEqual(mirrorPlayed.length, 1, "saran mirror harus tetap diputar lewat pencarian padanan");
  assert.strictEqual(mirrorPlayed[0].source, "youtube", "saran mirror diputar sebagai YouTube");

  // 9. events.js merutekan autocomplete ke command.autocomplete
  const routed = new EventEmitter();
  routed.distube = new EventEmitter();
  routed.commands = new Map([
    ["play", { data: { name: "play" }, autocomplete: async (i) => i.respond([{ name: "x", value: "y" }]) }],
  ]);
  registerEvents(routed);
  let responded = null;
  const autoIt = {
    isAutocomplete: () => true,
    isStringSelectMenu: () => false,
    isButton: () => false,
    commandName: "play",
    respond: async (c) => {
      responded = c;
    },
  };
  const handler = routed.listeners(Events.InteractionCreate)[0];
  await handler(autoIt);
  assert.deepStrictEqual(responded, [{ name: "x", value: "y" }], "autocomplete harus dirutekan ke command");

  // 9b. command tanpa autocomplete + autocomplete yang throw → tetap dijawab (tidak menggantung)
  routed.commands.set("plain", { data: { name: "plain" } });
  responded = null;
  await handler({ ...autoIt, commandName: "plain" });
  assert.deepStrictEqual(responded, [], "command tanpa handler autocomplete harus balas kosong");

  routed.commands.set("boom", {
    data: { name: "boom" },
    autocomplete: async () => {
      throw new Error("boom");
    },
  });
  responded = null;
  await handler({ ...autoIt, commandName: "boom" });
  assert.deepStrictEqual(responded, [], "autocomplete yang error harus tetap dijawab kosong");

  console.log("✅ autocomplete-check: 9/9 lulus");
  process.exit(0);
})().catch((e) => {
  console.error("❌ autocomplete-check GAGAL:", e.message);
  console.error(e.stack);
  process.exit(1);
});
