// Picker hasil pencarian: select menu 10 opsi + tombol cepat.
//
// Kenapa perlu: hasil pencarian multi-sumber punya beberapa versi (official, MV, cover,
// remix). Diblur jadi user tidak bisa pilih → lag 3.5 detik wasted tiap user salah pilih.
//
// State disimpan per message id (Map di client.pickers) → tidak ada data yang bisa diubah
// user lewat component (value cuma index integer), dan kadaluarsa 60 detik.
const {
  EmbedBuilder,
  ActionRowBuilder,
  StringSelectMenuBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require("discord.js");
const { color, safeError } = require("./theme");
const { SOURCE_META, withBudget, ytsrSearch } = require("./engines");
const { prefetch } = require("./prefetch");
const { normalize, scoreCandidate, dedupe, searchBestYoutube } = require("./search");

const PICKER_TTL = 60_000;
const PREFETCH_N = 3; // proses yt-dlp paralel. Jangan lebih: tiap satu ~150MB RAM.
const PREFIX = "pick_";

const trunc = (s, n) => {
  const str = String(s ?? "");
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
};

function formatDur(sec) {
  if (!sec || sec < 0) return "?:??";
  const m = Math.floor(sec / 60);
  return `${m}:${String(Math.floor(sec % 60)).padStart(2, "0")}`;
}

const badge = (song) => SOURCE_META[song.source] || { label: song.source };
const embed = (description) => new EmbedBuilder().setColor(color).setDescription(description);

// Tanpa emoji: "langsung" bisa diputar apa adanya, "mirror" dicarikan padanan di YouTube.
const KIND_TAG = { direct: "[langsung]", mirror: "[mirror]" };

function renderPicker(query, results, elapsed) {
  const list = results
    .map((r, i) => {
      const s = r.song;
      const b = badge(s);
      const tag = KIND_TAG[r.kind] || KIND_TAG.mirror;
      return `\`${i + 1}.\` ${tag} [${trunc(s.name, 55) || "Tanpa judul"}](${s.url})\n   ${trunc(s.uploader?.name ?? "?", 32)} • ${formatDur(s.duration)} • ${b.label}`;
    })
    .join("\n");

  const sources = [...new Set(results.map((r) => badge(r.song).label))];
  const view = new EmbedBuilder()
    .setColor(color)
    .setTitle(trunc(`Cari: ${query}`, 256))
    .setDescription(list || "Tidak ada hasil.")
    .setFooter({
      text: `${results.length} hasil • ${sources.join(" • ")}${elapsed ? ` • ${elapsed}ms` : ""}`,
    });

  const thumb = results.find((r) => r.song.thumbnail)?.song.thumbnail;
  if (thumb) view.setThumbnail(thumb);

  const menu = new ActionRowBuilder().addComponents(
    new StringSelectMenuBuilder()
      .setCustomId(`${PREFIX}play`)
      .setPlaceholder("Pilih lagu untuk diputar")
      .addOptions(
        results.map((r, i) => ({
          label: trunc(`${i + 1}. ${r.song.name || "Tanpa judul"}`, 100),
          description: trunc(`${r.song.uploader?.name || "?"} • ${formatDur(r.song.duration)} • ${badge(r.song).label}`, 100),
          value: String(i), // hanya integer — user tidak bisa menyuntik string bebas
        })),
      ),
  );

  const buttons = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}quick`).setLabel("Main #1").setStyle(ButtonStyle.Success),
    new ButtonBuilder().setCustomId(`${PREFIX}rand`).setLabel("Acak").setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId(`${PREFIX}cancel`).setLabel("Batal").setStyle(ButtonStyle.Danger),
  );

  return { embeds: [view], components: [menu, buttons] };
}

const store = (client) => client.pickers || (client.pickers = new Map());

function storePicker(client, message, data) {
  const pickers = store(client);
  pickers.set(message.id, { ...data, message, at: Date.now() });
  const timer = setTimeout(() => {
    if (!pickers.delete(message.id)) return; // sudah dipakai/bersih
    message.edit({ embeds: [embed("Menu pencarian kadaluwarsa. Ulangi `/play` ya.")], components: [] }).catch(() => {});
  }, PICKER_TTL);
  timer.unref?.();
  return message;
}

// Resolusi ke objek Song yang siap diputar (bukan URL string).
// Sumber non-direct (Apple/Tidal/Deezer) tidak punya plugin streaming DisTube → mirror ke
// YouTube lewat ytsr (~700ms), bukan yt-dlp (~5 detik). yt-dlp hanya jaring pengaman terakhir.
async function resolvePlayable(picked) {
  if (picked.kind === "direct") return picked.song;
  const query = `${picked.song.name} ${picked.song.uploader?.name || ""}`.trim();
  const hits = await withBudget(ytsrSearch(query, 3), 3000, "mirror");
  if (hits[0]) return hits[0];
  // ytsr lagi buruk → pakai yt-dlp. Lambat, tapi tidak ada jalan buntu.
  return await searchBestYoutube(query).catch(() => null);
}

// DisTube#attachStreamInfo short-circuit di baris pertama:
//   if (song.stream.playFromSource) { if (song.stream.url) return; ... }
// Kalau stream.url diisi duluan dari cache prefetch, DisTube tidak spawn yt-dlp DUA kali
// (resolve metadata + ambil URL) — sisa ~1 detik saja (join voice + ffmpeg).
async function warmStream(client, song) {
  if (!song?.stream?.playFromSource) return;
  const plugin = song.source === "soundcloud" ? client.plugins?.soundcloud : client.plugins?.ytdlp;
  if (!plugin?.getStreamURL) return;
  try {
    song.stream.url = await plugin.getStreamURL(song);
    song.plugin ??= plugin;
  } catch (err) {
    // biarkan DisTube coba sendiri (dia masih punya jalur normal)
    console.warn(`[picker] warm stream gagal: ${String(err?.message).slice(0, 100)}`);
  }
}

function prefetchTop(client, results) {
  const ytdlp = client.plugins?.ytdlp;
  if (!ytdlp) return;
  let fired = 0;
  for (const r of results) {
    if (fired >= PREFETCH_N) break;
    if (r.kind !== "direct" || r.song.source !== "youtube") continue;
    prefetch(ytdlp, r.song); // async, diam-diam; gagal = cache dibuang
    fired++;
  }
}

// ytsr sering rate-limited: waktu proses pertama dia dibuang budget, dan retry berikutnya
// kadang balas kosong tanpa error sama sekali. Karena itu bukan satu kali coba — 3 percobaan
// dengan jeda, selama menu masih hidup (TTL 60 detik).
async function progressiveYoutube(query, messageId, client) {
  const pickers = store(client);
  for (let attempt = 1; attempt <= 3; attempt++) {
    const hits = await withBudget(ytsrSearch(query, 6), 3000, `ytsr-retry#${attempt}`);
    if (hits.length) return await mergeYoutube(client, messageId, query, hits);
    if (!pickers.get(messageId)) return; // user sudah pilih / kadaluarsa
    await new Promise((r) => setTimeout(r, 1000));
  }
  console.warn(`[picker] youtube tetap kosong untuk "${query}" — user pakai hasil mirror`);
}

async function mergeYoutube(client, messageId, query, hits) {
  const state = store(client).get(messageId);
  if (!state) return; // user sudah pilih / kadaluarsa
  const tokens = normalize(query).split(" ").filter(Boolean);
  const fresh = hits.map((song) => ({ song, score: scoreCandidate(song, tokens, 0.6), kind: "direct" }));
  const merged = dedupe([...state.results, ...fresh]).sort((a, b) => b.score - a.score).slice(0, 10);
  if (!merged.some((r) => r.song.source === "youtube")) return; // tidak ada tambahan
  // user mungkin sudah klik saat kita tunggu → jangan timpa pesan yang sudah jadi "Masuk antrian"
  if (store(client).get(messageId) !== state) return;
  state.results = merged;
  await state.message.edit(renderPicker(query, merged)).catch(() => {});
}

async function handlePick(interaction, client) {
  const pickers = store(client);
  const state = pickers.get(interaction.message.id);
  if (!state) {
    return interaction.reply({
      content: "Menu ini sudah kadaluwarsa. Ulangi `/play`.",
      flags: MessageFlags.Ephemeral,
    });
  }

  const action = interaction.customId.slice(PREFIX.length);

  if (action === "cancel") {
    if (interaction.user.id !== state.requester) {
      return interaction.reply({ content: "Cuma yang minta yang bisa batalin.", flags: MessageFlags.Ephemeral });
    }
    pickers.delete(interaction.message.id);
    return interaction.update({ embeds: [embed("Dibatalkan.")], components: [] });
  }

  // index: "play" = nilai dari menu, "rand" = acak, selainnya ("quick") = nomor 1
  const index =
    action === "play" ? Number(interaction.values?.[0])
    : action === "rand" ? Math.floor(Math.random() * state.results.length)
    : 0;
  const picked = state.results[index];
  if (!picked?.song?.url) {
    return interaction.reply({ content: "Pilihan nggak valid. Ulangi `/play`.", flags: MessageFlags.Ephemeral });
  }

  const voiceChannel = interaction.member?.voice?.channel;
  if (!voiceChannel) {
    // jangan hapus menu: user cukup join VC lalu klik lagi
    return interaction.reply({ content: "Masuk voice channel dulu, baru pilih.", flags: MessageFlags.Ephemeral });
  }
  const botVoice = client.distube.voices.get(interaction.guildId);
  if (botVoice?.channel && botVoice.channel.id !== voiceChannel.id) {
    return interaction.reply({
      content: `Bot lagi di ${botVoice.channel.name}. Pindah ke sana atau pakai \`/play\` di channel itu.`,
      flags: MessageFlags.Ephemeral,
    });
  }

  pickers.delete(interaction.message.id); // sekali pakai

  try {
    await interaction.deferUpdate();
    await interaction.editReply({ embeds: [embed(`Menyiapkan **${trunc(picked.song.name, 200)}**...`)], components: [] });
    const song = await resolvePlayable(picked);
    if (!song?.url) throw new Error("tidak nemu sumber yang bisa diputar");
    await warmStream(client, song); // cache prefetch → lewati resolve yt-dlp DisTube
    await client.distube.play(voiceChannel, song, {
      textChannel: interaction.channel,
      member: interaction.member,
    });
    await interaction
      .editReply({ embeds: [embed(`Masuk antrian: [${trunc(song.name, 200)}](${song.url})`)] })
      .catch(() => {});
  } catch (err) {
    console.error("[picker]", err);
    const msg = { embeds: [embed(`Gagal: \`${safeError(err, 180)}\``)] };
    // kalau deferUpdate sendiri yang gagal, kita belum bisa editReply → pakai reply biasa
    if (interaction.deferred || interaction.replied) await interaction.editReply(msg).catch(() => {});
    else await interaction.reply({ ...msg, flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}

// Tombol kontrol /nowplaying + /pause + /resume + /skip. Semuanya dulu tidak punya handler
// sama sekali → tombol mati. Satu fungsi ini menghidupkan semuanya.
async function handleControl(interaction, client) {
  const queue = client.distube.getQueue(interaction.guildId);
  if (!queue) {
    return interaction.reply({ content: "Belum ada antrian lagu.", flags: MessageFlags.Ephemeral });
  }

  const { customId } = interaction;
  let text;
  if (customId === "np_skip" || customId === "skip_again") {
    const song = await queue.skip().catch(() => null);
    text = song ? `Skip. Sekarang: [${trunc(song.name, 150)}](${song.url})` : "Skip. Antrian habis.";
  } else if (customId === "np_pause" || customId === "toggle_pause") {
    // DisTube v5 tidak punya togglePause() — cuma pause()/resume()
    if (queue.paused) queue.resume();
    else queue.pause();
    text = queue.paused ? "Dijeda." : "Dilanjutkan.";
  } else if (customId === "np_autoplay") {
    const map = client.distubeAutoplay || (client.distubeAutoplay = new Map());
    const on = !map.get(interaction.guildId);
    map.set(interaction.guildId, on);
    queue.autoplay = on;
    text = `Autoplay ${on ? "aktif" : "mati"}.`;
  } else {
    return interaction.reply({ content: "Tombol tidak dikenal.", flags: MessageFlags.Ephemeral });
  }
  await interaction.reply({ content: text, flags: MessageFlags.Ephemeral });
}

module.exports = {
  renderPicker,
  storePicker,
  prefetchTop,
  progressiveYoutube,
  handlePick,
  handleControl,
  resolvePlayable,
  warmStream,
  PICKER_TTL,
  PREFIX,
  formatDur,
};