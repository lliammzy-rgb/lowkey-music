const { EmbedBuilder, Events, MessageFlags } = require("discord.js");
const { color, statusEmbed } = require("./theme");
const { isURL } = require("distube");
const { autoSearch } = require("./search");
const spotify = require("./spotify");

const notInVC = "Kamu harus ada di voice channel dulu.";

const IDLE_LEAVE_MS = Number(process.env.IDLE_LEAVE_MS) || 300_000;
const idleTimers = new Map();
function clearIdleTimer(guildId) {
  clearTimeout(idleTimers.get(guildId));
  idleTimers.delete(guildId);
}

async function playFromQuery(member, voiceChannel, textChannel, query, reply) {
  try {
    // link spotify: resolver embed page (tanpa API)
    if (spotify.parseSpotifyUrl(query)) {
      const songOrList = await spotify.resolve(query, member.client.plugins?.spotify);
      await reply("Diproses...");
      await member.client.distube.play(voiceChannel, songOrList, { textChannel, member });
      return;
    }

    // link lain: langsung
    if (isURL(query)) {
      await reply("Diproses...");
      await member.client.distube.play(voiceChannel, query, { textChannel, member });
      return;
    }

    // judul: auto cari versi terbaik
    const song = await autoSearch(query, member.client.plugins);
    if (!song) {
      await reply(`Lagu **${query}** tidak ditemukan. Coba judul lain.`);
      return;
    }
    await reply("Diproses...");
    await member.client.distube.play(voiceChannel, song, { textChannel, member });
  } catch (err) {
    console.error(err);
    await reply(`Error: \`${err.message?.slice(0, 150) ?? err}\``);
  }
}

function registerEvents(client) {
  client.once(Events.ClientReady, (c) => {
    console.log(`Bot online sebagai ${c.user.tag}`);
    c.user.setActivity("Lowkey Music", { type: 4 });
  });

  // l!play/l!p <judul/link> — prefix khusus biar tidak bentrok bot lain (m!play dll)
  client.on(Events.MessageCreate, async (message) => {
    if (message.author.bot || !message.guild) return;
    const m = message.content.match(/^l!(?:play|p)(?:\s+(.*))?$/i);
    if (!m) return;
    const query = (m[1] || "").trim();
    if (!query) {
      message.reply("Cara pakai: `l!play <judul atau link>` (atau `l!p`)");
      return;
    }
    // Cek: apakah bot sudah di voice channel?
    const botVoice = client.distube.voices.get(message.guildId);
    if (botVoice?.channel) {
      const userVoice = message.member.voice.channel;
      if (!userVoice) {
        return message.reply("Kamu harus ada di voice channel dulu.");
      }
      if (userVoice.id !== botVoice.channel.id) {
        return message.reply("Bot sedang dipakai di voice channel lain. Silakan tunggu atau gabung ke channel bot.");
      }
    }
    // VC penulis → VC Lowkey Music sekarang → VC dengan manusia terbanyak
    const vc =
      message.member.voice.channel ??
      client.distube.voices.get(message.guildId)?.channel ??
      [...message.guild.channels.cache.values()]
        .filter((c) => c.isVoiceBased?.() && [...c.members.values()].some((m) => !m.user.bot))
        .sort((a, b) => b.members.size - a.members.size)[0];
    if (!vc) {
      message.reply("Tidak ada voice channel yang bisa dipakai. Ada orang di VC dulu ya.");
      return;
    }
    await playFromQuery(message.member, vc, message.channel, query, (text) => {
      // no-op callback - reply is handled async
    });
  });

  client.on(Events.InteractionCreate, async (interaction) => {
    if (!interaction.isChatInputCommand()) return;
    const command = client.commands.get(interaction.commandName);
    if (!command) return;
    try {
      await command.execute(interaction, client.distube);
    } catch (err) {
      console.error(err);
      const msg = { content: "Ada error, coba lagi.", flags: MessageFlags.Ephemeral };
      if (interaction.deferred || interaction.replied) await interaction.followUp(msg);
      else await interaction.reply(msg);
    }
  });

  // Simple event handlers - no complex async/catch in message replies
  client.distube.on("playSong", (queue, song) => {
    clearIdleTimer(queue.id);
    queue.textChannel?.send({ embeds: [statusEmbed(queue, song)]);
  });

  client.distube.on("addSong", (queue, song) => {
    queue.textChannel
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(color)
            .setDescription(`Ditambahkan: [${song.name}](${song.url}) \`${song.formattedDuration}\` ke antrian.`),
        ]
      }).catch(function() {});
  });

  client.distube.on("addList", (queue, playlist) => {
    queue.textChannel
      .send({
        embeds: [
          new EmbedBuilder()
            .setColor(color)
            .setDescription(`Playlist \`${playlist.name}\` ditambahkan (${playlist.songs.length} lagu) ke antrian.`),
        ]
      }).catch(function() {});
  );

  client.distube.on("error", (error, queue) => {
    console.error(error);
    queue?.textChannel?.send({ content: `Error: \`${error.message?.slice(0, 200) ?? error}\`` }).catch(function() {});
  });

  // antrian habis / distop: bot diam 5 menit, keluar kalau tidak ada lagu baru
  client.distube.on("deleteQueue", (queue) => {
    const guildId = queue.id;
    clearIdleTimer(guildId);
    const textChannel = queue.textChannel;
    if (textChannel) {
      textChannel.send({
        embeds: [
          new EmbedBuilder()
            .setColor(color)
            .setDescription(
              "Antrian habis. Aku diam dulu — mau lanjut? tambah lagu pakai `l!p <judul/link>`. Kalau 5 menit sepi, aku keluar.",
            )
        }).catch(function() {});
      idleTimers.set(
        guildId,
        setTimeout(() => {
          idleTimers.delete(guildId);
          // ada queue baru (lagu main) saat idle? biarkan — timer sudah dibatalkan playSong
          if (client.distube.getQueue(guildId)) return;
          textChannel.send({ content: "Sepi 5 menit — aku keluar. Panggil `l!p` kalau mau denger lagi." }).catch(function() {});
          client.distube.voices.leave(guildId);
        }, IDLE_LEAVE_MS);
      );
  }

  // kompensasi leaveOnEmpty: voice channel bot kosong dari manusia -> keluar (tidak perlu nunggu idle)
  client.on(Events.VoiceStateUpdate, (oldState, newState) => {
    const guildId = newState.guild.id;
    const voice = client.distube.voices.get(guildId);
    if (!voice?.channel) return;
    const humans = voice.channel.members.filter((m) => !m.user.bot);
    if (!humans.size) {
      clearIdleTimer(guildId);
      client.distube.voices.leave(guildId);
    }
  });
}

module.exports = { registerEvents, playFromQuery };