# Lowkey Music 🎧

Discord music bot — YouTube, Spotify, SoundCloud, Deezer, direct link. Built with [DisTube v5](https://distube.js.org) + discord.js v14.

Fitur unggulan: **autoplay native** (lagu terkait dari artis/genre yang sama), parsing link Spotify tanpa API premium, pencarian multi-sumber dengan scoring.

## Commands

| Command | Deskripsi |
|---|---|
| `/play <query>` | Putar lagu — judul, link YouTube, link Spotify, atau URL audio langsung |
| `/pause` / `/resume` | Jeda / lanjutkan |
| `/skip` | Skip lagu sekarang |
| `/stop` | Stop + bersihkan antrian |
| `/queue` | Lihat antrian |
| `/nowplaying` | Lagu yang sedang diputar (+ tombol skip/pause/autoplay) |
| `/loop <off\|song\|queue>` | Mode loop |
| `/volume <0-100>` | Atur volume |
| `/shuffle` | Acak antrian |
| `/remove <nomor>` | Hapus lagu dari antrian |
| `/clear` | Bersihkan antrian (lagu yang jalan tetap dipertahankan) |
| `/autoplay <on\|off\|status>` | Lagu terkait otomatis setelah antrian habis |
| `/join` / `/leave` | Bot masuk / keluar voice channel |

## Setup

```bash
npm install          # postinstall otomatis menambal @distube/yt-dlp (lihat catatan)
npm run deploy       # sekali saja — register slash commands
npm start
```

### Environment (`.env`)

```ini
DISCORD_TOKEN=bot_token
DISCORD_CLIENT_ID=app_id
DISCORD_GUILD_ID=guild_id        # opsional; kalau ada → guild commands (instan), kalau tidak → global (menyebar ~1 jam)
SPOTIFY_ID=...                   # opsional; tanpa ini link Spotify tetap jalan (fallback cari judul via YouTube)
SPOTIFY_SECRET=...
```

### Persyaratan

- Node.js >= 18
- FFmpeg **tidak perlu diinstal** — pakai `ffmpeg-static`
- yt-dlp **tidak perlu diinstal** — dibundel `@distube/yt-dlp` (binary diunduh otomatis)

## Arsitektur singkat

```
index.js            boot discord.js + DisTube, urutan plugin
events.js           event DisTube (playSong, addSong, noRelated, dll) + autoplay
commands/music.js   semua slash command
ytsearch.js         YtSearchPlugin: search YouTube + getRelatedSongs (mesin autoplay)
search.js           scoring multi-sumber (YouTube/SoundCloud/Deezer) → 1 hasil terbaik
spotify.js          parse & resolve link Spotify (tanpa API premium)
deezer.js           modul Deezer public API (opsional, tidak dipakai flow saat ini)
theme.js            format embed, durasi, volume bar
scripts/patch-ytdlp.js  patch kompatibilitas yt-dlp (dijalankan via postinstall)
test/               autoplay-check.js (unit) + autoplay-live.js (harness live)
```

### Urutan plugin (penting!)

```js
[ytSearchPlugin, soundcloudPlugin, deezerPlugin, DirectLinkPlugin, spotifyPlugin, ytDlpPlugin]
```

- `ytDlpPlugin` **wajib terakhir** — `validate()`-nya selalu `true`, menangkap semua URL.
- `ytSearchPlugin` **pertama** — fallback pencarian YouTube dicoba sebelum SoundCloud (hindari preview 30 detik).

### Cara kerja autoplay

Memakai autoplay **native DisTube** (`queue.autoplay` + `_addRelatedSong`), bukan handler `finish` custom:

1. `/autoplay on` → set Map per-guild + `queue.autoplay` live.
2. Setiap lagu selesai dan antrian kosong, DisTube memanggil `plugin.getRelatedSongs(song)`.
3. Bawaan `@distube/yt-dlp` mengembalikan `[]` (penyebab autoplay lama selalu mati + bot keluar voice) → di-override di `index.js`:

```js
YtDlpPlugin.prototype.getRelatedSongs = getRelatedSongs;
```

4. `getRelatedSongs` mencari YouTube `"${artist} audio"` (lagu sezaman sesamanya), fallback `"${title} ${artist}"`, buang live/durasi >20 mnt, dedup URL.
5. Lagu hasil autoplay tampil dengan embed `🤖 Autoplay: ...` (pembeda dari request user).

## Testing

```bash
node test/autoplay-check.js   # 5 assertion unit (offline, tanpa Discord)
node test/autoplay-live.js    # harness live: butuh .env, bot TIDAK boleh jalan ganda
```

`autoplay-live.js` menggabungkan bot ke voice channel, memutar video pendek, lalu memverifikasi lagu related otomatis diputar. Hentikan `npm start` dulu sebelum menjalankannya.

## Catatan yt-dlp

`@distube/yt-dlp` melakukan `JSON.parse` pada output yt-dlp, tapi binary terbaru yt-dlp mencetak warning *Deprecated Feature* ke stdout → parse pecah. `scripts/patch-ytdlp.js` (via `postinstall`) menambalnya. Kalau upgrade `@distube/yt-dlp`, jalankan ulang:

```bash
node scripts/patch-ytdlp.js
```

## Deploy ke VPS

```bash
git clone https://github.com/lliammzy-rgb/lowkey-music.git
cd lowkey-music
npm install
# isi .env
npm run deploy      # sekali saja
pm2 start index.js --name lowkey-music && pm2 save
```

Update:

```bash
git pull && npm install && pm2 restart lowkey-music
```
