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

  // === Autoplay: when song finishes, add related song if enabled ===
  client.distube.on("finish", (queue) => {
    const autoplay = client.distubeAutoplay?.get(queue.guildId);
    if (!autoplay) return;
    try {
      // Cari lagu terkait (versi terbaik dari lagu yang tadi selesai)
      const related = queue.songs.length > 0 ? queue.songs[queue.songs.length - 1] : null;
      if (!related) return;
      // Gunakan distube.search untuk cari versi terbaik (YouTube)
      const songs = client.distube.search(related.url || related.name, false);
      if (!songs || !songs.length) return;
      const song = songs[0];
      client.distube.play(queue.guild, song, {
        textChannel: queue.textChannel,
        member: queue.voiceChannel?.members?.me ?? null,
      });
      queue.textChannel
        .send({
          embeds: [
            new EmbedBuilder()
              .setColor(color)
              .setDescription(
                `🤖 Autoplay: menambahkan lagu terkait [${song.name}](${song.url})`,
              ),
          ],
        })
        .catch(() => {});
    } catch (err) {
      console.error("Autoplay error:", err);
    }
  });

  client.distube.on("playSong", (queue, song) => {
    queue.textChannel?.send({ embeds: [statusEmbed(queue, song)] }).catch(() => {});
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

  client.distube.on("error", (error, queue) => {
    console.error(error);
    queue?.textChannel?.send({ content: `Error: \`${error.message?.slice(0, 200) ?? error}\`` }).catch(() => {});
  });

  client.distube.on("deleteQueue", (queue) => {
    client.distube.voices.leave(queue.id);
  });
}

module.exports = { registerEvents };