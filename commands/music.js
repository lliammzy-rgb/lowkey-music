const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");
const { color, statusEmbed, generateVolumeBar, miniNowPlayingFields, safeError } = require("../theme");
const spotify = require("../spotify");
const { isURL } = require("distube");
const { searchAll } = require("../search");
const { renderPicker, storePicker, prefetchTop, progressiveYoutube } = require("../picker");

const notInVC = "Kamu harus ada di voice channel dulu.";
const noQueue = "Belum ada antrian lagu.";
const notPlaying = "Belum ada lagu yang diputar.";

// Balasan yang gagal (interaksi kadaluarsa / pesan dihapus) tidak boleh naik ke
// events.js lalu jadi emit('error'). Cukup dicatat.
const safeEdit = (interaction, payload) =>
  interaction.editReply(payload).catch((e) => console.warn(`[reply] ${e?.code ?? e?.message}`));

// Cari lintas sumber lalu tampilkan menu pilih. Dipakai /play dengan query polos.
// `interaction` harus sudah di-reply "Sedang diproses..." sebelum fungsi ini dipanggil,
// dan `voiceChannel` sudah dipastikan ada oleh pemanggil.
async function showPicker(interaction, query, started, voiceChannel) {
  const client = interaction.client;
  let results = [];
  let ytOk = true;
  try {
    ({ results, ytOk } = await searchAll(query, client.plugins, { budget: 900, limit: 10 }));
  } catch (err) {
    console.error("[searchAll]", err);
  }

  // Semua mesin cepat kosong → jalur cadangan yt-dlp (lambat 3.5-15 detik tapi pasti)
  if (!results.length) {
    await safeEdit(interaction, "🔎 Mesin cepat tidak menemukan apa-apa, pakai jalur cadangan (bisa 3-15 detik)...");
    try {
      await client.distube.play(voiceChannel, query, {
        textChannel: interaction.channel,
        member: interaction.member,
      });
      await safeEdit(interaction, "✅ Diputar lewat jalur cadangan.");
    } catch (err) {
      console.error("Play/search error:", err);
      await safeEdit(interaction, `❌ Gagal memutar: ${safeError(err)}`);
    }
    return;
  }

  await safeEdit(interaction, renderPicker(query, results, Date.now() - started));
  const message = await interaction.fetchReply().catch(() => null);
  if (!message) return; // interaksi sudah tidak bisa dipakai — jangan simpan state yatim
  storePicker(client, message, { results, query, requester: interaction.user.id });
  // user masih baca menu (2-5 detik) = waktu gratis buat nge-resolve stream rank 1-3
  prefetchTop(client, results);
  // ytsr sempat gagal → tambahkan hasil YouTube ke menu yang sama saat sudah pulih
  if (!ytOk) progressiveYoutube(query, message.id, client).catch(() => {});
}

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName("play")
      .setDescription("Putar lagu — kasih link, atau judul yang akan tampil sebagai menu pilih")
      .addStringOption((o) =>
        o.setName("query").setDescription("Link atau judul lagu").setRequired(true),
      ),
    async execute(interaction, distube) {
      const voiceChannel = interaction.member.voice.channel;
      if (!voiceChannel) return interaction.reply({ content: notInVC, flags: MessageFlags.Ephemeral });
      
      // Cek: apakah bot sudah di voice channel?
      const botVoice = distube.voices.get(interaction.guildId);
      if (botVoice?.channel) {
        if (voiceChannel.id !== botVoice.channel.id) {
          return interaction.reply({ 
            content: "Bot sedang dipakai di voice channel lain.", 
            flags: MessageFlags.Ephemeral 
          });
        }
      }
      
      // reply langsung (bukan deferReply) → tidak ada spinner "Thinking..." di Discord
      const query = interaction.options.getString("query");
      const started = Date.now();
      await interaction.reply("🎵 Sedang diproses...");

      // 1️⃣ Spotify URL → resolved via Spotify plugin → YouTube audio
      if (spotify.parseSpotifyUrl(query)) {
        try {
          const songOrList = await spotify.resolve(query, distube.plugins?.spotify);
          await distube.play(voiceChannel, songOrList, {
            textChannel: interaction.channel,
            member: interaction.member,
          });
          await interaction.editReply("✅ Diproses dari Spotify...");
          return;
        } catch (err) {
          console.error("Spotify resolve error:", err);
          // Jika gagal, turun ke pencarian YouTube biasa (lanjut ke bawah)
        }
      }

      // 2️⃣ Direct audio URL (mp3/mp4) → DirectLink plugin
      if (isURL(query)) {
        await distube.play(voiceChannel, query, {
          textChannel: interaction.channel,
          member: interaction.member,
        });
        await interaction.editReply("✅ Diproses langsung...");
        return;
      }

      // 3️⃣ Plain query → cari multi-sumber paralel (cepat, tanpa yt-dlp) → tampil picker
      await showPicker(interaction, query, started, voiceChannel);
    },
  },
  {
    data: new SlashCommandBuilder().setName("pause").setDescription("Jeda lagu"),
    async execute(interaction, distube) {
      const queue = distube.getQueue(interaction.guildId);
      if (!queue) return interaction.reply({ content: noQueue, flags: MessageFlags.Ephemeral });
      queue.pause();
      const embed = new EmbedBuilder()
        .setColor(color)
        .setDescription("⏸️ Lagu dijeda.");
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setEmoji(queue.paused ? "▶️" : "⏸️")
            .setStyle(queue.paused ? ButtonStyle.Success : ButtonStyle.Danger)
            .setCustomId("toggle_pause"),
        );
      await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder().setName("resume").setDescription("Lanjutkan lagu"),
    async execute(interaction, distube) {
      const queue = distube.getQueue(interaction.guildId);
      if (!queue) return interaction.reply({ content: noQueue, flags: MessageFlags.Ephemeral });
      queue.resume();
      const embed = new EmbedBuilder()
        .setColor(color)
        .setDescription("▶️ Dilanjutkan.");
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder()
            .setEmoji("⏸️")
            .setStyle(ButtonStyle.Danger)
            .setCustomId("toggle_pause"),
        );
      await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder().setName("skip").setDescription("Skip lagu"),
    async execute(interaction, distube) {
      const queue = distube.getQueue(interaction.guildId);
      if (!queue) return interaction.reply({ content: noQueue, flags: MessageFlags.Ephemeral });
      try {
        const song = await queue.skip();
        const embed = new EmbedBuilder()
          .setColor(color)
          .setDescription(`⏭️ Skip. Sekarang: [${song.name}](${song.url})`);
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setEmoji("⏭️").setStyle(ButtonStyle.Primary).setCustomId("skip_again"),
          );
        await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
      } catch {
        interaction.reply({ content: "Gagal skip, mungkin sudah lagu terakhir.", flags: MessageFlags.Ephemeral });
      }
    },
  },
  {
    data: new SlashCommandBuilder().setName("stop").setDescription("Stop lagu dan bersihkan antrian"),
    async execute(interaction, distube) {
      const queue = distube.getQueue(interaction.guildId);
      if (!queue) return interaction.reply({ content: noQueue, flags: MessageFlags.Ephemeral });
      distube.stop(interaction.guildId);
      interaction.reply({ content: "⏹️ Stop. Antrian dibersihkan. Bot diam 5 menit sebelum keluar.", flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder().setName("queue").setDescription("Lihat antrian lagu"),
    async execute(interaction, distube) {
      const queue = distube.getQueue(interaction.guildId);
      if (!queue) return interaction.reply({ content: noQueue, flags: MessageFlags.Ephemeral });
      const songs = queue.songs
        .slice(0, 11)
        .map((s, i) => `${i === 0 ? "Now" : i}. [${s.name}](${s.url}) \`${s.formattedDuration}\``)
        .join("\n");
      const more = queue.songs.length > 11 ? `\n...dan ${queue.songs.length - 11} lagu lagi` : "";
      interaction.reply({
        embeds: [
          new EmbedBuilder()
            .setColor(color)
            .setTitle("Antrian Lagu")
            .setDescription(`${songs}${more}`),
        ],
      });
    },
  },
  {
    data: new SlashCommandBuilder().setName("nowplaying").setDescription("Lihat lagu yang diputar"),
    async execute(interaction, distube) {
      const queue = distube.getQueue(interaction.guildId);
      if (!queue || !queue.playing) return interaction.reply({ content: notPlaying, flags: MessageFlags.Ephemeral });
      const song = queue.songs[0];
      const embed = new EmbedBuilder()
        .setColor(color)
        .setTitle("Now Playing")
        .setDescription(`[${song.name}](${song.url})\n${song.uploader?.name || ""} • ${song.formattedDuration}`)
        .setFooter({ text: `Volume: ${generateVolumeBar(queue.volume)} | Loop: ${queue.repeatMode === 2 ? "Queue" : queue.repeatMode === 1 ? "Song" : "Off"}` });
      const row = new ActionRowBuilder()
        .addComponents(
          new ButtonBuilder().setEmoji("⏭️").setStyle(ButtonStyle.Primary).setCustomId("np_skip"),
          new ButtonBuilder().setEmoji(queue.paused ? "▶️" : "⏸️").setStyle(queue.paused ? ButtonStyle.Success : ButtonStyle.Danger).setCustomId("np_pause"),
          new ButtonBuilder().setEmoji("🤖").setStyle(ButtonStyle.Secondary).setCustomId("np_autoplay")
        );
      await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("loop")
      .setDescription("Set loop mode")
      .addStringOption((o) =>
        o
          .setName("mode")
          .setDescription("Mode loop")
          .setRequired(true)
          .addChoices(
            { name: "Off", value: "0" },
            { name: "Song", value: "1" },
            { name: "Queue", value: "2" },
          ),
      ),
    async execute(interaction, distube) {
      const queue = distube.getQueue(interaction.guildId);
      if (!queue) return interaction.reply({ content: noQueue, flags: MessageFlags.Ephemeral });
      const mode = Number(interaction.options.getString("mode"));
      queue.setRepeatMode(mode);
      const label = mode === 0 ? "off" : mode === 1 ? "song" : "queue";
      interaction.reply({ content: `Loop: ${label}`, flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("volume")
      .setDescription("Set volume 0-100")
      .addIntegerOption((o) =>
        o.setName("angka").setDescription("0-100").setRequired(true).setMinValue(0).setMaxValue(100),
      ),
    async execute(interaction, distube) {
      const queue = distube.getQueue(interaction.guildId);
      if (!queue) return interaction.reply({ content: noQueue, flags: MessageFlags.Ephemeral });
      const vol = interaction.options.getInteger("angka");
      queue.setVolume(vol);
      interaction.reply({ content: `🔊 Volume: ${generateVolumeBar(vol)}`, flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder().setName("shuffle").setDescription("Acak antrian"),
    async execute(interaction, distube) {
      const queue = distube.getQueue(interaction.guildId);
      if (!queue) return interaction.reply({ content: noQueue, flags: MessageFlags.Ephemeral });
      queue.shuffle();
      interaction.reply({ content: "✨ Antrian diacak.", flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder().setName("join").setDescription("Bot masuk voice channel kamu"),
    async execute(interaction, distube) {
      const voiceChannel = interaction.member.voice.channel;
      if (!voiceChannel) return interaction.reply({ content: notInVC, flags: MessageFlags.Ephemeral });
      
      // Cek: apakah bot sudah di voice channel?
      const botVoice = distube.voices.get(interaction.guildId);
      if (botVoice?.channel) {
        if (voiceChannel.id !== botVoice.channel.id) {
          return interaction.reply({ content: "Bot sudah ada di voice channel lain. Gunakan `/play` di channel yang sama.", flags: MessageFlags.Ephemeral });
        }
        // Jika bot sudah di VC yang sama, berikan info
        return interaction.reply({ content: `Bot sudah di ${botVoice.channel.name}. Gunakan /play untuk memutar lagu.`, flags: MessageFlags.Ephemeral });
      }
      
      distube.voices.join(voiceChannel);
      interaction.reply({ content: `Masuk ${voiceChannel.name}.`, flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder().setName("leave").setDescription("Bot keluar dari voice channel"),
    async execute(interaction, distube) {
      const voice = distube.voices.get(interaction.guildId);
      if (!voice) return interaction.reply({ content: "Aku tidak ada di voice channel.", flags: MessageFlags.Ephemeral });
      voice.leave();
      interaction.reply({ content: "Keluar. Sampai jumpa!", flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("remove")
      .setDescription("Hapus lagu dari antrian berdasarkan nomor")
      .addIntegerOption((o) =>
        o.setName("nomor").setDescription("Posisi lagu di antrian (1-20)").setRequired(true).setMinValue(1).setMaxValue(20),
      ),
    async execute(interaction, distube) {
      const queue = distube.getQueue(interaction.guildId);
      if (!queue) return interaction.reply({ content: "Belum ada antrian lagu.", flags: MessageFlags.Ephemeral });
      const num = interaction.options.getInteger("nomor");
      if (num < 1 || num > queue.songs.length - 1) {
        return interaction.reply({ content: `Posisi tidak valid. Antrian memiliki ${queue.songs.length - 1} lagu.`, flags: MessageFlags.Ephemeral });
      }
      const removed = queue.songs.splice(num, 1)[0];
      interaction.reply({ content: `**${num}**. [${removed.name}](${removed.url})** telah dihapus dari antrian.`, flags: MessageFlags.Ephemeral });
    },
  },
{
    data: new SlashCommandBuilder().setName("clear").setDescription("Bersihkan seluruh antrian"),
    async execute(interaction, distube) {
      const queue = distube.getQueue(interaction.guildId);
      if (!queue) return interaction.reply({ content: "Belum ada antrian lagu.", flags: MessageFlags.Ephemeral });
      queue.songs = [queue.songs[0]]; // keep the current playing song, remove the rest
      // Actually let's clear all songs after the first one
      queue.songs = queue.songs.slice(0, 1);
      interaction.reply({ content: "Antrian dibersihkan. Lagu yang diputar tetap dipertahankan.", flags: MessageFlags.Ephemeral });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("autoplay")
      .setDescription("Aktifkan/matikan autoplay (lagu terkait setelah selesai)")
      .addStringOption((o) =>
        o.setName("mode").setDescription("On/Off/Status").setRequired(true).addChoices(
          { name: "On", value: "on" },
          { name: "Off", value: "off" },
          { name: "Status", value: "status" },
        ),
      ),
    async execute(interaction, distube) {
      const mode = interaction.options.getString("mode");
      const guildId = interaction.guildId;
      interaction.client.distubeAutoplay = interaction.client.distubeAutoplay || new Map();
      const queue = distube.getQueue(guildId);

      if (mode === "on") {
        interaction.client.distubeAutoplay.set(guildId, true);
        if (queue) queue.autoplay = true;
        const embed = new EmbedBuilder()
          .setColor(color)
          .setDescription(
            queue
              ? "🤖 Autoplay **aktif**. Setelah antrian habis, bot memutarkan lagu dari artis/genre yang sama."
              : "🤖 Autoplay **disimpan**. Nyalakan otomatis begitu ada lagu pertama diputar.",
          );
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      if (mode === "off") {
        interaction.client.distubeAutoplay.set(guildId, false);
        if (queue) queue.autoplay = false;
        const embed = new EmbedBuilder().setColor(color).setDescription("🤖 Autoplay **dimatikan**.");
        return interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
      }

      const isOn = Boolean(interaction.client.distubeAutoplay.get(guildId));
      const embed = new EmbedBuilder()
        .setColor(color)
        .setDescription(`Autoplay: **${isOn ? "Aktif" : "Nonaktif"}**${isOn && queue?.autoplay ? " (sedang jalan)" : ""}`);
      await interaction.reply({ embeds: [embed], flags: MessageFlags.Ephemeral });
    },
  },
];

module.exports = commands;