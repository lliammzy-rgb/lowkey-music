// Self-check jalur error yang dulu MEMATIKAN bot + retry pencarian yang dulu sia-sia.
// `node test/crash-check.js` — OFFLINE: fetch & ytsr & yt-dlp di-stub.
//
// Dua hal yang diuji:
//  1. events.js: command yang throw + reply yang gagal (DiscordAPIError 10062) TIDAK
//     boleh melempar keluar. Dulu ini naik ke emit('error') → proses mati.
//  2. search.js: retry harus benar-benar memperpanjang batas waktu. Dulu
//     Math.min(budget*2, SOURCE_CAP) selalu kalah oleh cap → percobaan kedua identik.
const assert = require("assert");
const path = require("path");
const { EventEmitter } = require("events");
const { createRequire } = require("module");

const root = path.join(__dirname, "..");
const req = createRequire(path.join(root, "search.js"));

// ---- stub dependency jaringan/berat, pasang sebelum modul di-load ----
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

// Berapa lama setiap mesin "menggantung". Tes retry menaikkannya sampai lewat cap.
let delayMs = 0;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

req.cache[req.resolve("@distube/ytsr")] = {
  id: "@distube/ytsr",
  filename: req.resolve("@distube/ytsr"),
  loaded: true,
  exports: async () => {
    await sleep(delayMs);
    return {
      items: [
        { type: "video", id: "yt1", url: "https://www.youtube.com/watch?v=yt1", name: "Imagine", duration: "3:05", author: { name: "John Lennon" }, isLive: false },
      ],
    };
  },
};

const jsonRes = (body) => ({ ok: true, status: 200, json: async () => body });
global.fetch = async (url) => {
  await sleep(delayMs);
  const u = String(url);
  if (u.includes("itunes.apple.com")) {
    return jsonRes({ results: [{ trackId: 1, trackName: "Imagine", artistName: "John Lennon", trackViewUrl: "https://music.apple.com/1", trackTimeMillis: 185000 }] });
  }
  if (u.includes("api.tidal.com")) {
    return jsonRes({ items: [{ id: 9, title: "Imagine", artist: { name: "John Lennon" }, duration: 183 }] });
  }
  if (u.includes("api.deezer.com")) {
    return jsonRes({ data: [{ id: 7, readable: true, title: "Imagine", link: "https://deezer/7", artist: { name: "John Lennon" }, album: { cover_medium: "https://img/dz.jpg" }, duration: 180 }] });
  }
  return { ok: false, status: 404, json: async () => ({}) };
};

const { searchAll } = req("./search");
const { registerEvents } = req("./events");
const { Events } = require("discord.js");
const commands = req("./commands");

// plugin soundcloud palsu yang ikut menggantung
const soundcloud = { search: async () => { await sleep(delayMs); return []; } };
const plugins = { soundcloud, deezer: {} };

(async () => {
  // 1. RETRY HARUS BENAR-BENAR MENAMBAH WAKTU.
  // Semua mesin butuh 1200ms, cap awal 900ms → percobaan 1 pasti timeout semua.
  // Percobaan 2 harus pakai cap 1800ms supaya 1200ms itu lolos.
  delayMs = 1200;
  const t = Date.now();
  const first = await searchAll("imagine", plugins, { budget: 900, limit: 10 });
  const elapsed = Date.now() - t;
  assert.ok(
    first.results.length > 0,
    "retry harus menyelamatkan hasil: cap wajib ikut naik, bukan terkunci di 900ms",
  );
  assert.ok(
    elapsed >= 1900,
    `harus ada dua putaran (900ms gagal + 1200ms lolos), dapat ${elapsed}ms`,
  );

  // 2. retry tidak dipakai kalau percobaan pertama sudah berhasil (jangan tambah latensi)
  delayMs = 0;
  const t2 = Date.now();
  const second = await searchAll("imagine", plugins, { budget: 900, limit: 10 });
  assert.ok(second.results.length > 0);
  assert.ok(Date.now() - t2 < 800, "tanpa retry harus selesai cepat, tidak menunggu 2 putaran");

  // 3. Deezer sekarang punya timeout → fetch-nya dibatalkan, bukan menggantung selamanya
  let sawDeezerAbort = false;
  const origFetch = global.fetch;
  global.fetch = async (url, opts) => {
    if (String(url).includes("api.deezer.com")) {
      sawDeezerAbort = Boolean(opts?.signal);
      throw Object.assign(new Error("aborted"), { name: "TimeoutError" });
    }
    return origFetch(url, opts);
  };
  const third = await searchAll("imagine", plugins, { budget: 900, limit: 10 });
  global.fetch = origFetch;
  assert.ok(sawDeezerAbort, "deezerSearch wajib mengirim AbortSignal.timeout");
  assert.ok(third.results.length > 0, "deezer gagal tidak boleh menjatuhkan sumber lain");

  // 4. events.js WAJIB punya listener 'error'. Tanpa ini, satu rejection = proses mati.
  const client = new EventEmitter();
  client.distube = new EventEmitter();
  client.commands = new Map();
  registerEvents(client);
  assert.ok(client.listenerCount(Events.Error) >= 1, "client harus punya listener 'error'");
  assert.ok(client.listenerCount(Events.InteractionCreate) >= 1, "handler interaksi harus terpasang");

  // 5. JALUR YANG DULU MEMATIKAN BOT:
  // command throw → catch di events.js coba reply → reply gagal juga (10062).
  // Dulu reply kedua tanpa .catch() → rejection → emit('error') → crash.
  const unknownInteraction = () => Object.assign(new Error("Unknown interaction"), { code: 10062, status: 404 });
  client.commands.set("boom", {
    execute: async () => {
      throw unknownInteraction();
    },
  });
  const failing = {
    isStringSelectMenu: () => false,
    isButton: () => false,
    isChatInputCommand: () => true,
    commandName: "boom",
    deferred: false,
    replied: false,
    reply: async () => {
      throw unknownInteraction();
    },
    followUp: async () => {
      throw unknownInteraction();
    },
  };
  const handler = client.listeners(Events.InteractionCreate)[0];
  let crashed = null;
  try {
    await handler(failing);
  } catch (e) {
    crashed = e;
  }
  assert.strictEqual(crashed, null, `handler tidak boleh melempar keluar, dapat: ${crashed?.message}`);

  // 6. /play dengan editReply + fetchReply yang gagal → tidak boleh throw, dan
  //    tidak boleh menyimpan state picker yatim.
  const playCmd = commands.find((c) => c.data.name === "play");
  const deadClient = new EventEmitter();
  deadClient.plugins = plugins;
  deadClient.pickers = new Map();
  const deadDistube = { voices: { get: () => null }, play: async () => {} };
  const deadInteraction = {
    client: deadClient,
    guildId: "g1",
    channel: { id: "c1" },
    user: { id: "u1" },
    member: { voice: { channel: { id: "vc1", name: "General" } } },
    options: { getString: () => "imagine" },
    reply: async () => {},
    editReply: async () => {
      throw unknownInteraction();
    },
    fetchReply: async () => {
      throw unknownInteraction();
    },
    deferred: false,
    replied: true,
  };
  let playCrashed = null;
  try {
    await playCmd.execute(deadInteraction, deadDistube);
  } catch (e) {
    playCrashed = e;
  }
  assert.strictEqual(playCrashed, null, `/play tidak boleh throw saat reply gagal: ${playCrashed?.message}`);
  assert.strictEqual(deadClient.pickers.size, 0, "jangan simpan state picker kalau pesannya gagal dibuat");

  console.log("✅ crash-check: 6/6 lulus");
  process.exit(0);
})().catch((e) => {
  console.error("❌ crash-check GAGAL:", e.message);
  console.error(e.stack);
  process.exit(1);
});
