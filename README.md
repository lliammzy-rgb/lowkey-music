# Lowkey Music

Discord music bot — YouTube, Spotify, SoundCloud, Deezer, Apple Music, Tidal, direct link. Built with [DisTube v5](https://distube.js.org) + discord.js v14.

Fitur unggulan: **picker pencarian multi-sumber** (5 mesin paralel + pilih lagu dari daftar), **autocomplete saat mengetik**, **autoplay native** (lagu terkait dari artis/genre yang sama), parsing link Spotify tanpa API premium.

> Tanpa emoji di seluruh output bot. Tanda sumber/tipe ditulis sebagai teks (`[langsung]`, `[mirror]`, `[Deezer]`) supaya tampil sama di semua klien.

## Commands

| Command | Deskripsi |
|---|---|
| `/play <query>` | Putar lagu — link YouTube/Spotify/URL audio langsung tetap langsung jalan; judul biasa tampil menu pilih |
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

### Autocomplete saat mengetik

Begitu kamu mulai mengetik di option `query` `/play` (minimal 3 huruf), Discord menampilkan saran lagu langsung di bawah kolom input — persis seperti bot Hade. Memilih salah satu saran **melewati picker sepenuhnya**: `/play` langsung memutar lagu itu.

Batas 3 detik dari Discord membentuk desainnya:

- Saran dibangun dari **dua mesin tercepat saja**: iTunes (~200ms–2.3s) + Deezer (~400ms–2.5s), dijalankan **paralel**. ytsr ditolak untuk autocomplete: terukur 1.7–12 detik dan sering balas `Unsupported YouTube Search response`, jadi praktis selalu kalah budget sementara kita tetap membayar tunggunya. Kalau kamu tetap menekan enter tanpa memilih, pencarian 5 sumber penuh + picker tetap jalan seperti biasa — autocomplete hanya jalan pintas, bukan pengganti.
- `value` tiap saran adalah token pendek (hash `source:id`) + judul. Judulnya ikut dikirim supaya kalau bot restart di antara mengetik dan memilih, lagunya masih bisa dicari ulang — bukan jadi query sampah.
- Lagu yang sama dari Apple & Deezer digabung jadi **satu saran** (dedupe lintas sumber), dan versi-versi lain dari lagu yang sama (`Remastered`, `Take 1`, `Live`) diringkas jadi satu wakil — 25 slot dropdown tidak habis untuk satu lagu.
- Karena autocomplete dipanggil ulang tiap ketikan, hasil query identik dilayani dari cache, dan ketikan cepat digabung (inflight) supaya jaringan tidak ditembak berkali-kali.

### Menu pilih hasil pencarian

`/play <judul>` (tanpa link) tidak langsung memutar hasil teratas, tapi menampilkan daftar berisi 10 opsi dari 5 sumber: **YouTube, SoundCloud, Deezer, Apple Music, Tidal**. Ada tombol `Main #1`, `Acak`, `Batal`, dan kadaluarsa sendiri 60 detik.

Baris bertanda `[langsung]` bisa langsung diputar; `[mirror]` berarti metadata dari sumber itu lalu di-mirror ke YouTube.

## Latensi

Angka terukur (live, `test/live-e2e.js`):

| Tahap | Waktu |
|---|---|
| 5 mesin paralel → picker tampil | **~800–900ms** |
| Ketik 3 huruf → saran autocomplete muncul | **~300–900ms** (iTunes + Deezer paralel) |
| Pilih saran → audio bunyi | **~1.2–2.3s** (tanpa searchAll sama sekali) |
| `getStreamURL` yt-dlp sebelum prefetch | 3.1–5.8s |
| `getStreamURL` sesudah prefetch (klik rank 1-3) | **0ms** |
| Klik → audio bunyi (bot belum di VC) | **~1.2–2.3s** |
| Klik → masuk antrian (bot sudah di VC) | **0ms** |

Bagaimana bisa secepat itu padahal yt-dlp butuh 3-6 detik per URL:

1. `searchAll` tidak memakai yt-dlp sama sekali — 5 mesin HTTP (`engines.js`) jalan paralel, masing-masing dipatok budget (`withBudget`, YouTube 900ms, SoundCloud 600ms). Yang lambat dibuang, picker tetap tampil.
2. Selama user membaca menu (2-5 detik), `prefetchTop` sudah menyelesaikan `getStreamURL` untuk rank 1-3 di latar belakang.
3. Waktu diklik, `warmStream` mengisi `song.stream.url` dari cache, dan `DisTube.attachStreamInfo` melakukan short-circuit pertama — `if (song.stream.url) return;` — sehingga tidak ada yt-dlp yang di-spawn ulang. Objek `Song` juga dilewatkan langsung, jadi `resolve()` tidak jalan.
4. Kalau YouTube kena rate limit, picker tetap tampil dari sumber lain, lalu `progressiveYoutube` mencoba ulang 3 kali dan menyisipkan hasil YouTube ke menu yang sama.

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
TIDAL_TOKEN=...                  # opsional; ada token web publik bawaan, ganti hanya kalau Tidal balas 401
```

> Permission bot di voice channel: butuh `Connect` + `Speak`. Kalau sebuah VC memberi *deny* `Connect` untuk `@everyone`, bot tidak akan bisa masuk ke situ — cek dengan Discord → Edit Channel → Permissions.

### Persyaratan

- Node.js >= 18
- FFmpeg **tidak perlu diinstal** — pakai `ffmpeg-static`
- yt-dlp **tidak perlu diinstal** — dibundel `@distube/yt-dlp` (binary diunduh otomatis)

## Arsitektur singkat

```
index.js            boot discord.js + DisTube, urutan plugin, patch getStreamURL
events.js           event DisTube (playSong, addSong, noRelated, dll) + autoplay + router komponen
commands/music.js   semua slash command (showPicker untuk /play query polos)
picker.js           menu pilih: render, state per pesan, handler tombol, progressive retry
autocomplete.js     saran saat mengetik: iTunes+Deezer paralel, dedupe lintas sumber, token → Song
engines.js          5 mesin cari paralel: ytsr, Deezer, SoundCloud, iTunes, Tidal (+ withBudget)
prefetch.js         cache getStreamURL yt-dlp (TTL 2 menit) + prefetch latar belakang
ytsearch.js         YtSearchPlugin: search YouTube + getRelatedSongs (mesin autoplay)
search.js           scoring multi-sumber, dedupe lintas sumber, searchAll (fan-out)
spotify.js          parse & resolve link Spotify (tanpa API premium)
deezer.js           modul Deezer public API (opsional, tidak dipakai flow saat ini)
theme.js            format embed, durasi, volume bar
scripts/patch-ytdlp.js  patch kompatibilitas yt-dlp (dijalankan via postinstall)
test/               autocomplete-check.js, crash-check.js, picker-check.js, cache-check.js, autoplay-check.js (unit, offline)
                    engines-live.js, search-all-live.js, live-e2e.js (harness live), emoji-scan.js (pemeliharaan)
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
5. Lagu hasil autoplay tampil dengan embed `Autoplay: ...` (pembeda dari request user).

## Testing

```bash
# offline, tanpa Discord & tanpa internet
node test/autocomplete-check.js  # saran saat mengetik (iTunes+Deezer), dedupe lintas sumber, token → Song, jalur pintas
node test/crash-check.js     # 6 assertion: jalur error yang dulu mematikan bot + retry pencarian
node test/picker-check.js    # 19 assertion: dedupe, picker UI (bebas emoji), handler tombol, /play
node test/cache-check.js     # 4 assertion: cache query yt-dlp
node test/autoplay-check.js  # 5 assertion: mesin autoplay

# pemeliharaan
node test/emoji-scan.js      # pastikan tidak ada emoji yang lolos masuk lagi ke kode

# live, butuh internet (+ .env untuk yang e2e)
node test/engines-live.js        # bentuk data + latency tiap mesin cari
node test/search-all-live.js     # urutan rank hasil searchAll + preview embed
node test/live-e2e.js            # boot bot beneran: kirim picker ke Discord, ukur prefetch, play audio
```

`live-e2e.js` menggabungkan bot ke voice channel, memutar lagu, lalu membersihkannya. Bot `npm start` **tidak boleh** jalan ganda saat itu. Channel targetnya bisa di-override lewat `LIVE_TEXT_CHANNEL` / `LIVE_VOICE_CHANNEL`.

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
