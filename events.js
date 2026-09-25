const { EmbedBuilder, Events } = require("discord.js");
const { color, statusEmbed } = require("./theme");

function registerEvents(client) {
  // Initialize autoplay Map on client
  client.distubeAutoplay = client.distubeAutoplay || new Map();

  client.once(Events.ClientReady, (c) => {
    console.log(`Bot online sebagai ${c.user.tag}`);
    c.user.setActivity("Lowkey Music", { type: 4 });
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction, client.distube);
    } catch (err) {
      console.error(err);
      const msg = { content: "Ada error, coba lagi.", flags: 1 << 6 };
      if (interaction.deferred || interaction.replied) await interaction.followUp(msg);
      else await interaction.reply(msg);
    }
  });

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

    // Lagu yang "diminta" bot = hasil autoplay → embed beda dari request user
    const isAutoplay = queue.autoplay && song.member?.id === client.user.id;
    const embed = isAutoplay
      ? new EmbedBuilder()
          .setColor(color)
          .setDescription(`🤖 **Autoplay**: [${song.name}](${song.url}) \`${song.formattedDuration}\``)
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
            .setDescription("🤖 Autoplay aktif, tapi tidak menemukan lagu terkait. Coba `/play` lagu lain."),
        ],
      })
      .catch(() => {});
  });

  client.distube.on("error", (error, queue) => {
    console.error(error);
    queue?.textChannel?.send({ content: `Error: \`${error.message?.slice(0, 200) ?? error}\`` }).catch(() => {});
  });

  client.distube.on("deleteQueue", (queue) => {
    client.distube.voices.leave(queue.id);
  });
}

module.exports = { registerEvents };