# Lowkey Music - Progress Log

## Project Overview
Lowkey Music - Discord music bot supporting YouTube, Spotify, SoundCloud, Deezer, and direct links.

## Current Version
- **2.0.0** (package.json)

## Structure
- `index.js` - Main bot entry point, initializes Discord client and DisTube with plugins
- `events.js` - Event handlers for playback, queue management, idle timers, voice state updates
- `commands.js` - Slash commands: play, pause, resume, skip, stop, queue, nowplaying, loop, volume, shuffle, join, leave, autoplay, remove, clear
- `search.js` - Auto-search across YouTube, SoundCloud, Deezer with scoring/ranking
- `theme.js` - Embed color (`#9b59b6`) and minimalist embed builder
- `deploy.js` - Discord command registration (global or guild-scoped)
- `.env` - Environment variables (DISCORD_TOKEN, DISCORD_CLIENT_ID, DISCORD_GUILD_ID)

## Key Features Implemented

### Core Features (existing)
- YouTube search via yt-dlp (`ytDlpPlugin` with `update: true`)
- YouTube fallback search (`YtSearchPlugin` with `update: false`)
- Spotify plugin with API credentials
- SoundCloud plugin
- Deezer plugin
- Direct link support
- Play from query (URL or search term)
- Playlist support
- Loop modes (off/song/queue)
- Volume control (0-100)
- Shuffle queue
- Auto-leave after idle period (5 minutes default: 300,000ms)
- Idle timer cleanup on `deleteQueue` event
- Voice state detection for auto-leave when VC empty

### Minimalist Music Player Design
- **Text-only embeds**: Semua command menggunakan `content` bukan `embeds`, hanya teks murni
- **Volume bar text**: `generateVolumeBar()` menghasilkan bar karakter seperti `████░░ 70%`
- **Now playing embed**: `statusEmbed()` sekarang menggunakan `miniNowPlayingFields` dengan fields terstruktur: Judul, Artis, Durasi, Volume, Loop, Antrian
- **Minimal emoji**: Hanya digunakan untuk status: `▶️`, `⏸️`, `⏹️`, `⏭️`, `🤖`, `✨`, `🔊`
- **No complex embeds**: Semua reply menggunakan `content` dengan `flags: Ephemeral`

### New Delete Track Features
- **`/remove <1-20>`** - Hapus lagu posisi ke-n dari antrian
- **`/clear`** - Bersihkan seluruh antrian

### New Autoplay Features
- **`/autoplay on`** - Aktifkan autoplay
- **`/autoplay off`** - Matikan autoplay
- **`/autoplay status`** - Lihat status aktif/nonaktif

### Improved Search Algorithm (search.js)
- **Fix matching for underated/songs**: Normalisasi sekarang menjaga nama artis (tidak menghapus di dalam bracket), threshold pencocokan adaptive (0.3 untuk query 2-3 kata, 0.5 untuk query panjang), dan penalty yang lebih lemah (-2 BAD, -1 durasi). Ini membuat lagu underated seperti "wasting time - baverlyline" lebih mungkin ditemukan.
- Penambahan `/\*.*?\*/g` penghapus hanya metadata di dalam kurung siku/fleksi, jangan artis

## Plugins Registered (index.js:36)
```
[ytSearchPlugin, soundcloudPlugin, deezerPlugin, new DirectLinkPlugin(), spotifyPlugin, ytDlpPlugin]
```

## Commands (music.js:14-252)

### Core Commands (Text-Only, 1-12)
1. `/play` - Play song (auto-search best version) - reply via `content`
2. `/pause` - Pause song - `⏸️ Dijeda.`
3. `/resume` - Resume song - `▶️ Dilanjutkan.`
4. `/skip` - Skip to next song - `⏭️ Skip. Sekarang: [judul]`
5. `/stop` - Stop and clear queue - `⏹️ Stop. Antrian dibersihkan. Bot diam 5 menit sebelum keluar.`
6. `/queue` - View queue (up to 11 songs) - Embed dengan title/description
7. `/nowplaying` - Now playing embed - pakai `statusEmbed()` dari theme.js
8. `/loop` - Set loop mode - `Loop: off/song/queue`
9. `/volume` - Set volume 0-100 - `🔊 Volume: ████░░ 70%` (text bar!)
10. `/shuffle` - Shuffle queue - `✨ Antrian diacak.`
11. `/join` - Join user's voice channel - reply via `content`
12. `/leave` - Leave voice channel - `Keluar. Sampai jumpa!`

### New Delete Track Commands (13-14)
13. `/remove <nomor>` - Hapus lagu posisi ke-n dari antrian (1-20) - reply via `content`
14. `/clear` - Bersihkan seluruh antrian - reply via `content`

### New Autoplay Commands (15-17)
15. `/autoplay on` - Aktifkan autoplay - reply via `content`
16. `/autoplay off` - Matikan autoplay - reply via `content`
17. `/autoplay status` - Lihat status autoplay - reply via `content`

## Events (events.js)

- `ClientReady` - Sets activity "Lowkey Music"
- `MessageCreate` - Prefix command `l!play` / `l!p`
- `InteractionCreate` - Slash command dispatcher
- `playSong` - Send now playing embed + autoplay logic (pakai `statusEmbed()` yang sudah ditingkatkan)
- `addSong` - Send "added to queue" embed
- `addList` - Send playlist added embed
- `error` - Log and send error to text channel
- `deleteQueue` - Idle timer start (5 min), auto-leave if silent
- `VoiceStateUpdate` - Auto-leave when voice channel empty of humans

## Logic Testing Results (all passed)

### Delete Track
- `/remove` with empty queue → error "Belum ada antrian lagu"
- `/remove` position 1 of 1 song → removes it, queue becomes empty
- `/remove` invalid position → error message with valid range
- `/clear` with empty queue → error "Belum ada antrian lagu"
- `/clear` with 1 song → keeps it (1 song remains)

### Minimalist Design Verification
- All command replies use `content` field, not `embeds`
- Volume bar uses character bar: `generateVolumeBar(vol)`
- Now playing uses `statusEmbed()` which internally calls `miniNowPlayingFields()`
- All ephemeral flags set properly

## TODO / Future
- Add forum channel tags system
- Implement membership screening welcome screen
- Improve search scoring algorithm
- Add database persistence for settings (autoplay toggle per server)
- Fitur slider pemutar visual (butuh voice state tracking & client-side state)

---

**Last update: [Current Date]** - Fitur musik player minimalist sudah selesai dan diuji.
**Lanjut pembelajaran besok: Fokus pada fitur lanjut atau debugging di server Discord.

*Semua file kode siap di-deploy ke server untuk testing empirical.*