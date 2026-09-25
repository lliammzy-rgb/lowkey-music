// Live test autoplay: bot asli join VC, putar lagu pendek, autoplay on,
// verifikasi lagu related otomatis diputar. `node test/autoplay-live.js`
require("dotenv").config();
const { Client, GatewayIntentBits } = require("discord.js");
const DisTube = require("distube");
const { SpotifyPlugin } = require("@distube/spotify");
const { SoundCloudPlugin } = require("@distube/soundcloud");
const { DeezerPlugin } = require("@distube/deezer");
const { DirectLinkPlugin } = require("@distube/direct-link");
const { YtDlpPlugin } = require("@distube/yt-dlp");
const { YtSearchPlugin, getRelatedSongs } = require("../ytsearch");
const { registerEvents } = require("../events");
const { youtubeSearch } = require("../search");

const GUILD_ID = "1538499236314746950";
const VC_ID = "1552760860680650813";
const TEXT_ID = "1539610624513015828";

const stamp = (m) => console.log(`[${((Date.now() - T0) / 1000).toFixed(1)}s] ${m}`);
let T0 = Date.now();
require("events").EventEmitter.defaultMaxListeners = 20;

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildVoiceStates,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
  ],
});

const spotifyPlugin = new SpotifyPlugin({
  api: { clientId: process.env.SPOTIFY_ID, clientSecret: process.env.SPOTIFY_SECRET },
});
const ytDlpPlugin = new YtDlpPlugin({ update: false }); // hindari menulis ulang yt-dlp.exe saat test
YtDlpPlugin.prototype.getRelatedSongs = getRelatedSongs; // sama seperti index.js
const ytSearchPlugin = new YtSearchPlugin({ update: false });

const distube = new DisTube.default(client, {
  plugins: [ytSearchPlugin, new SoundCloudPlugin(), new DeezerPlugin(), new DirectLinkPlugin(), spotifyPlugin, ytDlpPlugin],
  emitNewSongOnly: true,
  ffmpeg: { path: require("ffmpeg-static") },
});
client.distube = distube;
distube.setMaxListeners(30);

registerEvents(client);

// Labeli ulang event distube supaya kejadian autoplay kelihatan di log
distube.on("playSong", (q, s) => stamp(`playSong: ${s.name} (${Math.round(s.duration)}s) autoplay=${q.autoplay} len=${q.songs.length}`));
distube.on("finishSong", (q, s) => stamp(`finishSong: ${s.name} len=${q.songs.length} autoplay=${q.autoplay}`));
distube.on("finish", (q) => stamp(`FINISH (autoplay off / no related) len=${q.songs.length}`));
distube.on("noRelated", (q, e) => stamp(`NO_RELATED: ${e?.message ?? e}`));
distube.on("deleteQueue", (q) => stamp(`deleteQueue → bot keluar voice`));
distube.on("error", (e, q) => stamp(`error: ${e.message?.slice(0, 160)}`));

let playCount = 0;
let done = false;
let skippedEarly = false;
distube.on("playSong", (q, s) => {
  playCount++;
  // Lagu 1 berdurasi panjang? Skip otomatis setelah 20s biar test tidak nunggu 5 menit.
  if (playCount === 1 && s.duration > 45 && !skippedEarly) {
    skippedEarly = true;
    stamp(`lagu 1 panjang (${Math.round(s.duration)}s) → skip dalam 20s`);
    setTimeout(() => {
      q.skip().catch((e) => stamp(`skip error: ${e.message?.slice(0, 120)}`));
    }, 20000);
  }
  if (playCount === 2 && !done) {
    done = true;
    stamp("=== SUKSES: lagu ke-2 (autoplay related) mulai diputar ===");
    setTimeout(async () => {
      try { await distube.stop(GUILD_ID); } catch {}
      try { distube.voices.leave(GUILD_ID); } catch {}
      stamp("cleanup selesai — exit");
      client.destroy();
      process.exit(0);
    }, 5000);
  }
});

const HARD_TIMEOUT = setTimeout(() => {
  stamp(`TIMEOUT 420s — playCount=${playCount}, autoplay TIDAK jalan`);
  process.exit(2);
}, 420000);

client.once("ready", async () => {
  T0 = Date.now();
  stamp(`bot login: ${client.user.tag}`);
  const vc = await client.channels.fetch(VC_ID);
  const text = await client.channels.fetch(TEXT_ID);

  // Pilih lagu PENDEK (<=45 detik) biar test cepat & tetap lewat jalur handleSongFinish
  stamp("mencari video pendek untuk test...");
  const { json: ytdlpJson } = require("@distube/yt-dlp");
  let song = null;
  for (const q of ["short clip", "funny short"]) {
    const info = await ytdlpJson(`ytsearch20:${q}`, {
      dumpSingleJson: true, noWarnings: true, skipDownload: true, simulate: true,
    });
    const short = (info.entries || [])
      .filter((e) => e.duration && e.duration >= 5 && e.duration <= 45 && !e.is_live)
      .sort((a, b) => a.duration - b.duration)[0];
    if (short) {
      song = { name: short.title, duration: short.duration, url: short.webpage_url || `https://youtu.be/${short.id}` };
      break;
    }
    stamp(`"${q}" tidak ada <=45s`);
  }
  if (!song) {
    stamp("tidak ketemu video <=60 detik — exit");
    process.exit(3);
  }
  stamp(`dipilih: ${song.name} (${Math.round(song.duration)}s)`);

  // Requester harus "orang" supaya embed play#1 = Now Playing biasa,
  // dan hanya lagu related (member=bot) yang tampil sebagai 🤖 Autoplay.
  // (tanpa GuildMembers intent → fetch manual 1 ID, jangan fetch semua member)
  let requester = vc.guild.members.me;
  try {
    const msgs = await text.messages.fetch({ limit: 50 });
    const human = msgs.find((m) => m.author && !m.author.bot);
    if (human) requester = await vc.guild.members.fetch(human.author.id);
  } catch (e) {
    stamp(`requester fallback ke bot: ${e.message?.slice(0, 80)}`);
  }
  stamp(`requester: ${requester.user?.tag} (bot=${requester.user?.bot})`);

  client.distubeAutoplay.set(GUILD_ID, true); // setara /autoplay on
  stamp("autoplay ON (via Map) — play()...");
  await distube.play(vc, song.url, { textChannel: text, member: requester });
});

client.login(process.env.DISCORD_TOKEN);
