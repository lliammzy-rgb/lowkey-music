// E2E live: `node test/live-e2e.js`
//
// Yang diuji (bukan mock):
//  - boot stack persis seperti index.js (plugin order, patch getStreamURL)
//  - searchAll ke internet + picker dikirim ke Discord sungguhan (cek Discord terima payload)
//  - prefetch stream URL: ukur selisih cold vs cache-hit
//  - distube.play beneran ke voice channel
//
// BUTUH: .env valid, guild/channel di bawah harus ada, dan bot invited ke guild.
require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const DisTube = require("distube").default;
const { SpotifyPlugin } = require("@distube/spotify");
const { SoundCloudPlugin } = require("@distube/soundcloud");
const { DeezerPlugin } = require("@distube/deezer");
const { DirectLinkPlugin } = require("@distube/direct-link");
const { YtDlpPlugin } = require("@distube/yt-dlp");
const { YtSearchPlugin, getRelatedSongs } = require("../ytsearch");
const { installStreamCache } = require("../prefetch");
const { searchAll } = require("../search");
const { renderPicker, prefetchTop, formatDur, storePicker, progressiveYoutube } = require("../picker");

const TEXT_CHANNEL = process.env.LIVE_TEXT_CHANNEL || "1539610624513015828"; // music-command
const VOICE_CHANNEL = process.env.LIVE_VOICE_CHANNEL || "1557158037653954633"; // 0%
// CATATAN: channel "Zzz" (1557110217060393013) punya deny CONNECT untuk @everyone.
// Bot hanya bisa join VC yang izinkan CONNECT untuknya — defaultnya "0%".
const QUERY = process.argv[2] || "imagine john lennon";

const ms = (t) => `${Date.now() - t}ms`;
const say = (...a) => console.log("[e2e]", ...a);

// Kena rate limit jaringan: bukan bug logika, jangan merah-kan tes live
class SkipNetwork extends Error {}

(async () => {
  const client = new Client({
    intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
  });

  const ytDlpPlugin = new YtDlpPlugin({ update: false });
  YtDlpPlugin.prototype.getRelatedSongs = getRelatedSongs;
  installStreamCache();

  const distube = new DisTube(client, {
    plugins: [new YtSearchPlugin({ update: false }), new SoundCloudPlugin(), new DeezerPlugin(), new DirectLinkPlugin(), new SpotifyPlugin({ api: { clientId: process.env.SPOTIFY_ID, clientSecret: process.env.SPOTIFY_SECRET } }), ytDlpPlugin],
    emitNewSongOnly: true,
    ffmpeg: { path: require("ffmpeg-static") },
  });
  client.distube = distube;
  client.plugins = { ytdlp: ytDlpPlugin };

  let playedAt = null;
  distube.on("playSong", (q, song) => {
    playedAt = Date.now();
    say(`  ▶️ playSong: ${song.name} (${song.uploader?.name})`);
  });
  distube.on("error", (e) => say("  ❌ distube error:", String(e?.message).slice(0, 140)));

  await client.login(process.env.DISCORD_TOKEN);
  say(`bot online: ${client.user.tag}, guild ${client.guilds.cache.size}`);

  let sent = null;
  try {
    // ---- 1. searchAll: berapa lama sampai picker siap ----
    let t = Date.now();
    const { results, ytOk } = await searchAll(QUERY, client.plugins, { budget: 900, limit: 10 });
    say(`1. searchAll: ${ms(t)} — ${results.length} hasil, ytOk=${ytOk}`);
    if (!results.length) throw new SkipNetwork("semua mesin cari kosong — jaringan sedang dibatasi. Jalur cadangan yt-dlp yang dipakai bot.");
    if (!ytOk) say("   (ytsr lewat budget — ini skenario progressive: picker tampil dari sumber lain)");

    // ---- 2. kirim picker asli ke Discord (validasi payload komponen) ----
    const text = await client.channels.fetch(TEXT_CHANNEL);
    t = Date.now();
    const view = renderPicker(QUERY, results, Date.now() - t);
    sent = await text.send(view);
    say(`2. picker terkirim ke Discord: ${ms(t)} — id ${sent.id}`);
    say(`   komponen balasan: ${JSON.stringify(sent.components.map((c) => c.type))}, opsi=${sent.components[0]?.components?.[0]?.options?.length}`);
    assert(sent.components.length === 2, "Discord harus menyimpan 2 action row");
    assert(sent.components[0].components[0].options.length === results.length, "semua opsi harus diterima Discord");

    // ---- 2b. progressive: ytsr gagal di awal → retry di belakang lalu tambah ke menu ----
    storePicker(client, sent, { results, query: QUERY, requester: "e2e" });
    if (!ytOk) {
      t = Date.now();
      await progressiveYoutube(QUERY, sent.id, client);
      const after = client.pickers.get(sent.id)?.results || [];
      const ytCount = after.filter((r) => r.song.source === "youtube").length;
      say(`2b. progressiveYoutube: ${ms(t)} — ${results.length} → ${after.length} hasil, youtube=${ytCount}`);
      assert(ytCount > 0, "progressive harus menyisipkan hasil youtube");
      // jangan pakai `after` lagi: menu sudah di-edit, komponen lama tidak valid
      client.pickers.delete(sent.id);
    }

    // ---- 3. cold vs warm getStreamURL (inti fitur prefetch) ----
    let yt = results.find((r) => r.song.source === "youtube");
    if (!yt) {
      // ytsr gagal di run ini — ambil lewat yt-dlp supaya tes tetap bisa lanjut
      const { searchBestYoutube } = require("../search");
      const best = await searchBestYoutube(QUERY);
      assert(best, "butuh minimal 1 lagu youtube untuk uji stream");
      yt = { song: best, kind: "direct" };
      say("   (youtube diambil via yt-dlp karena ytsr gagal di run ini)");
    }
    t = Date.now();
    const cold = await ytDlpPlugin.getStreamURL(yt.song);
    say(`3a. getStreamURL cold: ${ms(t)}`);
    t = Date.now();
    const warm = await ytDlpPlugin.getStreamURL(yt.song);
    say(`3b. getStreamURL warm: ${ms(t)}  ← inilah yang dirasakan user`);
    assert(warm === cold, "cache harus mengembalikan URL yang sama");

    // ---- 4. simulasi(user): picker muncul → user baca menu 6 detik → klik rank 1.
    // Ini angka yang dirasakan user, dan harusnya ~0ms karena prefetch sudah kelar.
    t = Date.now();
    prefetchTop(client, results);
    await new Promise((r) => setTimeout(r, 8000)); // 3 proses yt-dlp paralel
    say(`4. prefetchTop selesai, menunggu selesai 8s (total ${ms(t)} sejak mulai)`);
    for (const rank of [0, 1, 2]) {
      const r = results[rank];
      if (!r || r.kind !== "direct" || r.song.source !== "youtube") continue;
      const t2 = Date.now();
      await ytDlpPlugin.getStreamURL(r.song);
      say(`4b. klik rank ${rank + 1} → getStreamURL ${Date.now() - t2}ms`);
    }

    // ---- 5. play lewat jalur BARU (persis handlePick: Song + stream.url sudah diisi) ----
    const vc = await client.channels.fetch(VOICE_CHANNEL);
    playedAt = null;
    const song = yt.song;
    song.stream.url = await ytDlpPlugin.getStreamURL(song); // cache hit → 0ms
    song.plugin ??= ytDlpPlugin;
    t = Date.now();
    await distube.play(vc, song, { textChannel: text });
    say(`5. distube.play(Song) selesai: ${ms(t)}`);
    const deadline = Date.now() + 45_000;
    while (!playedAt && Date.now() < deadline) await new Promise((r) => setTimeout(r, 250));
    if (playedAt) say(`5b. AUDIO MULAI ${playedAt - t}ms setelah play() (target <1500ms)`);
    else say("5b. GAGAL: playSong tidak pernah dalam 45 detik");
    assert(playedAt, "audio harus mulai");

    // ---- 5c. klik kedua saat bot SUDAH di voice channel.
// Ini angka "user klik di picker" yang sebenarnya — tanpa biaya join voice.
// (Lagu pertama masih bunyi jadi yang kedua cuma masuk antrian; itu yang diukur.)
    await new Promise((r) => setTimeout(r, 1500));
    const idx2 = results.findIndex((r, i) => i > 0 && r.kind === "direct" && r.song.source === "youtube");
    if (idx2 > 0) {
      const s2 = results[idx2].song;
      t = Date.now();
      await distube.play(vc, s2, { textChannel: text });
      say(`5c. klik rank ${idx2 + 1} (bot sudah di VC) → masuk antrian ${Date.now() - t}ms (target <500ms)`);
      assert(Date.now() - t < 2000, "masuk antrian harus cepat");
    }

    // ---- 6. jalur mirror (Apple → ytsr → Song YouTube) tanpa memutar ----
    const apple = results.find((r) => r.kind === "mirror");
    if (apple) {
      t = Date.now();
      const mirrorQuery = `${apple.song.name} ${apple.song.uploader?.name || ""}`.trim();
      const { withBudget, ytsrSearch } = require("../engines");
      const hits = await withBudget(ytsrSearch(mirrorQuery, 3), 2500, "mirror-e2e");
      say(`6. mirror Apple→YouTube: ${ms(t)} — ${hits[0]?.url || "GAGAL"}`);
      assert(hits[0]?.url?.includes("youtube.com"), "mirror harus menghasilkan URL YouTube");
    }
  } finally {
    // cleanup apa pun yang terjadi — jangan tinggalkan pesan/voice nyangkut
    try {
      distube.stop(client.guilds.cache.first()?.id);
      distube.voices.leave(VOICE_CHANNEL);
    } catch {}
    if (sent) await sent.delete().catch(() => {});
    client.destroy();
    say("selesai (cleanup ok)");
  }
  process.exit(0);
})().catch((e) => {
  if (e instanceof SkipNetwork) {
    console.warn(`[e2e] ⚠️ LEWAT: ${e.message}`);
    process.exit(0);
  }
  console.error("[e2e] GAGAL:", e.message);
  process.exit(1);
});

function assert(cond, msg) {
  if (!cond) throw new Error(`assert: ${msg}`);
}