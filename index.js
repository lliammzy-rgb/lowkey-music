require("dotenv").config();
const { Client, GatewayIntentBits, Collection } = require("discord.js");
const DisTube = require("distube");
const { SpotifyPlugin } = require("@distube/spotify");
const { SoundCloudPlugin } = require("@distube/soundcloud");
const { DeezerPlugin } = require("@distube/deezer");
const { DirectLinkPlugin } = require("@distube/direct-link");
const { YtDlpPlugin } = require("@distube/yt-dlp");
const { YtSearchPlugin } = require("./ytsearch");
const { registerEvents } = require("./events");
const commands = require("./commands");

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates, GatewayIntentBits.GuildMessages, GatewayIntentBits.MessageContent],
});

client.commands = new Collection();
for (const cmd of commands) client.commands.set(cmd.data.name, cmd);

const spotifyPlugin = new SpotifyPlugin({
  api: {
    clientId: process.env.SPOTIFY_ID,
    clientSecret: process.env.SPOTIFY_SECRET,
  },
});
const soundcloudPlugin = new SoundCloudPlugin();
const deezerPlugin = new DeezerPlugin();
// youtube via yt-dlp: ytdl-core mati (parser decipher gagal, lihat distubejs/ytdl-core#144)
const ytDlpPlugin = new YtDlpPlugin({ update: true });
// fallback search lagu Spotify/Deezer → mirror YouTube (bukan SoundCloud preview 30 dtk)
const ytSearchPlugin = new YtSearchPlugin({ update: false });

const distube = new DisTube.default(client, {
  // yt-dlp WAJIB plugin terakhir: validate() selalu true jadi menangkap semua URL
  // ytSearchPlugin duluan: search fallback YouTube dicoba sebelum SoundCloud
  plugins: [ytSearchPlugin, soundcloudPlugin, deezerPlugin, new DirectLinkPlugin(), spotifyPlugin, ytDlpPlugin],
  emitNewSongOnly: true,
  ffmpeg: { path: require("ffmpeg-static") },
});
client.distube = distube;
client.plugins = { spotify: spotifyPlugin, ytdlp: ytDlpPlugin, soundcloud: soundcloudPlugin, deezer: deezerPlugin };

registerEvents(client);

client.login(process.env.DISCORD_TOKEN);
