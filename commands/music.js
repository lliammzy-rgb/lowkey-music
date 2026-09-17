const {
  SlashCommandBuilder,
  EmbedBuilder,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  PermissionFlagsBits,
  MessageFlags,
} = require("discord.js");
const { color, statusEmbed, generateVolumeBar, miniNowPlayingFields } = require("../theme");
const { playFromQuery } = require("../events");

const notInVC = "Kamu harus ada di voice channel dulu.";
const noQueue = "Belum ada antrian lagu.";
const notPlaying = "Belum ada lagu yang diputar.";

const commands = [
  {
    data: new SlashCommandBuilder()
      .setName("play")
      .setDescription("Putar lagu — otomatis cari versi terbaik, atau kasih link")
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
      
      await interaction.deferReply();
      const query = interaction.options.getString("query");
      // link spotify/link lain/auto-search versi terbaik — logika sama dengan !play
      await playFromQuery(interaction.member, voiceChannel, interaction.channel, query, (text) =>
        interaction.editReply(text),
      );
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
      if (mode === "on") {
        interaction.client.distubeAutoplay = interaction.client.distubeAutoplay || new Map();
        interaction.client.distubeAutoplay.set(interaction.guildId, true);
        const embed = new EmbedBuilder()
          .setColor(color)
          .setDescription("🤖 Autoplay diaktifkan. Selanjutnya, setelah lagu selesai, bot akan otomatis mencari lagu terkait dan menambahkannya ke antrian.");
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setEmoji("🤖").setStyle(ButtonStyle.Primary).setCustomId("autoplay_toggle"),
          );
        await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
      } else if (mode === "off") {
        if (interaction.client.distubeAutoplay) {
          interaction.client.distubeAutoplay.set(interaction.guildId, false);
        } else {
          interaction.client.distubeAutoplay = new Map();
          interaction.client.distubeAutoplay.set(interaction.guildId, false);
        }
        const embed = new EmbedBuilder()
          .setColor(color)
          .setDescription("🤖 Autoplay dimatikan.");
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setEmoji("🤖").setStyle(ButtonStyle.Secondary).setCustomId("autoplay_toggle"),
          );
        await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
      } else if (mode === "status") {
        const isOn = interaction.client.distubeAutoplay && interaction.client.distubeAutoplay.get(interaction.guildId);
        const embed = new EmbedBuilder()
          .setColor(color)
          .setDescription(`Autoplay: ${isOn ? "Aktif" : "Nonaktif"}`);
        const row = new ActionRowBuilder()
          .addComponents(
            new ButtonBuilder().setEmoji("🤖").setStyle(isOn ? ButtonStyle.Primary : ButtonStyle.Secondary).setCustomId("autoplay_toggle"),
          );
        await interaction.reply({ embeds: [embed], components: [row], flags: MessageFlags.Ephemeral });
      }
    },
  },
];

module.exports = commands;
