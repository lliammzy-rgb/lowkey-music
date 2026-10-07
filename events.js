const { EmbedBuilder, Events, ChannelType } = require("discord.js");
const { color, statusEmbed, safeError } = require("./theme");
const { handlePick, handleControl, PREFIX: PICK_PREFIX } = require("./picker");

function registerEvents(client) {
  // Initialize autoplay Map on client
  client.distubeAutoplay = client.distubeAutoplay || new Map();
  // messageId → state picker (/play). Dibuat di sini supaya picker.js tidak perlu init.
  client.pickers = client.pickers || new Map();

  // discord.js v14 bikin Client dengan captureRejections:true. Artinya rejection dari
  // listener async DIUBAH jadi emit('error') di Client. Kalau tidak ada listener 'error',
  // Node langsung mematikan proses. Tanpa baris ini, satu interaksi kadaluarsa
  // (DiscordAPIError 10062) cukup untuk menjatuhkan seluruh bot.
  client.on(Events.Error, (err) => {
    console.error("[client error]", err?.code ?? "", err?.message ?? err);
  });

  client.once(Events.ClientReady, (c) => {
    console.log(`Bot online sebagai ${c.user.tag}`);
    c.user.setActivity("Lowkey Music", { type: 4 });
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    // Autocomplete (/play saat user masih mengetik). WAJIB di paling atas: interaksi ini
    // bukan chat input command, jadi tanpa cabang ini Discord tidak dapat balasan dan
    // dropdown user menggantung sampai error. Deadline-nya cuma 3 detik.
    if (interaction.isAutocomplete?.()) {
      const command = client.commands.get(interaction.commandName);
      if (!command?.autocomplete) return interaction.respond([]).catch(() => {});
      try {
        return await command.autocomplete(interaction, client);
      } catch (err) {
        console.error("[autocomplete]", err);
        // gagal pun harus tetap dijawab, kalau tidak dropdown menggantung
        return interaction.respond([]).catch(() => {});
      }
    }

    // Komponen (select menu + tombol). Tanpa baris ini SEMUA tombol mati: tidak ada yang
    // menangkap isStringSelectMenu()/isButton(), jadi Discord diam-diam menjatuhkan.
    if (interaction.isStringSelectMenu?.() || interaction.isButton?.()) {
      try {
        if (interaction.customId.startsWith(PICK_PREFIX)) return await handlePick(interaction, client);
        return await handleControl(interaction, client);
      } catch (err) {
        console.error("[component]", err);
        const m = { content: "Ada error di tombol. Coba lagi.", flags: 1 << 6 };
        if (interaction.deferred || interaction.replied) await interaction.followUp(m).catch(() => {});
        else await interaction.reply(m).catch(() => {});
      }
      return;
    }

    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction, client.distube);
    } catch (err) {
      console.error(err);
      // .catch() WAJIB di sini. Kalau interaksi sudah kadaluarsa (10062), reply/followUp
      // ini gagal juga — dan tanpa .catch() rejection-nya naik ke emit('error') → bot mati.
      // Ini persis jalur yang dulu mematikan proses.
      const msg = { content: "Ada error, coba lagi.", flags: 1 << 6 };
      if (interaction.deferred || interaction.replied) await interaction.followUp(msg).catch(() => {});
      else await interaction.reply(msg).catch(() => {});
    }
  });

  // Status di bawah nama voice channel: "Judul - Artis"
  // Endpoint resmi: PUT /channels/{id}/voice-status (belum ada wrapper di discord.js 14)
  // Butuh permission SET_VOICE_CHANNEL_STATUS di role bot
  function setVoiceStatus(queue, text) {
    const ch = queue.voice?.channel;
    if (!ch || ch.type !== ChannelType.GuildVoice) return;
    fetch(`https://discord.com/api/v10/channels/${ch.id}/voice-status`, {
      method: "PUT",
      headers: {
        Authorization: `Bot ${process.env.DISCORD_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: text }),
    }).catch(() => {});
  }

  // === Autoplay ===
  // Pakai autoplay NATIVE DisTube (queue.autoplay + _addRelatedSong). Tidak ada handler
  // "finish" sendiri: kalau queue.autoplay true, DisTube tidak emit finish dan tidak
  // membuang queue — lagu terkait otomatis ditambah & diputar.
  //
  // Urutan penting:
  //  - playSong: sinkronkan flag native dengan preferensi user SEBELUM lagu ini selesai.
  //  - playSong: lagu yang diminta bot sendiri (member == bot) = lagu autoplay → embed beda.
  client.distube.on("playSong", (queue, song) => {
    // PENTING: Queue DisTube v5 TIDAK punya `.guildId` — id queue = guild id (`.id`)
    queue.autoplay = Boolean(client.distubeAutoplay?.get(queue.id));

    setVoiceStatus(queue, `${song.name} - ${song.uploader?.name ?? "unknown"}`);

    // Lagu yang "diminta" bot = hasil autoplay → embed beda dari request user
    const isAutoplay = queue.autoplay && song.member?.id === client.user.id;
    const embed = isAutoplay
      ? new EmbedBuilder()
          .setColor(color)
          .setDescription(`**Autoplay**: [${song.name}](${song.url}) \`${song.formattedDuration}\``)
      : statusEmbed(queue, song);
    queue.textChannel?.send({ embeds: [embed] }).catch(() => {});
  });

  client.distube.on("addSong", (queue, song) => {
    queue.textChannel
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(color)
            .setDescription(`Ditambahkan: [${song.name}](${song.url}) \`${song.formattedDuration}\` ke antrian.`),
        ],
      })
      .catch(() => {});
  });

  client.distube.on("addList", (queue, playlist) => {
    queue.textChannel
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(color)
            .setDescription(`Playlist \`${playlist.name}\` ditambahkan (${playlist.songs.length} lagu) ke antrian.`),
        ],
      })
      .catch(() => {});
  });

  // Autoplay aktif tapi tidak ada lagu terkait yang ketemu → beri tahu, jangan crash.
  client.distube.on("noRelated", (queue) => {
    queue.textChannel
      ?.send({
        embeds: [
          new EmbedBuilder()
            .setColor(color)
            .setDescription("Autoplay aktif, tapi tidak menemukan lagu terkait. Coba `/play` lagu lain."),
        ],
      })
      .catch(() => {});
  });

  client.distube.on("error", (error, queue) => {
    console.error(error);
    queue?.textChannel?.send({ content: `Error: \`${safeError(error)}\`` }).catch(() => {});
  });

  client.distube.on("deleteQueue", (queue) => {
    setVoiceStatus(queue, ""); // hapus status saat tidak ada lagu
    client.distube.voices.leave(queue.id);
  });
}

module.exports = { registerEvents };