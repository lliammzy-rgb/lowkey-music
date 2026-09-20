const { EmbedBuilder } = require("discord.js");

const color = "#9b59b6";
const brand = "Lowkey Music";

// Minimalist volume bar generator
// Returns text bar like "████░░ 70%" based on percentage 0-100
function generateVolumeBar(percent) {
  const filled = Math.round((percent * 10) / 100);
  const empty = 10 - filled;
  const fullChar = "█";
  const emptyChar = "░";
  return `${fullChar.repeat(filled)}${emptyChar.repeat(empty)} ${percent}%`;
}

// Minimalist now playing embed fields
// Returns object with color, title, and fields array for EmbedBuilder
function miniNowPlayingFields(queue, song) {
  const formatDuration = (duration) =>
    duration
      ? `${Math.floor(duration / 60)}:${Number(duration % 60).toFixed(2)}`
      : "0:00";

  const progress = song.duration
    ? `${formatDuration(song.duration)} / ${formatDuration(queue.songs[0]?.duration)}`
    : "Live";

  const volumeBar = generateVolumeBar(queue.volume);

  return {
    color,
    title: "Now Playing",
    fields: [
      { name: "Judul", value: song.name ?? "-", inline: true },
      { name: "Requester", value: song.user?.toString() ?? "-", inline: true },
      { name: "Durasi", value: progress, inline: true },
      { name: "Volume", value: volumeBar, inline: true },
      {
        name: "Loop",
        value:
          queue.repeatMode === 1
            ? "Song"
            : queue.repeatMode === 2
              ? "Queue"
              : "off",
        inline: true,
      },
      {
        name: "Antrian",
        value: `${queue.songs.length - 1} lagu tersisa`,
        inline: true,
      },
    ],
  };
}

// Enhanced statusEmbed - now uses minimalist fields
function statusEmbed(queue, song) {
  const fields = miniNowPlayingFields(queue, song);

  return new EmbedBuilder()
    .setColor(fields.color)
    .setTitle(fields.title)
    .setDescription(`[${song.name}](${song.url})`)
    .addFields(
      ...fields.fields.map((f) => ({
        name: f.name,
        value: f.value,
        inline: f.inline,
      })),
    );
}

// Export all functions
module.exports = {
  color,
  brand,
  statusEmbed,
  generateVolumeBar,
  miniNowPlayingFields,
};
