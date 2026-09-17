# Lowkey Music — Panduan (Bahasa Indonesia)

Bot musik Discord, 100% gratis. Sumber: **YouTube**, **Spotify**, **SoundCloud**, **Deezer**, dan **link langsung** (mp3/mp4).

---

## 1. Persiapan

- [Node.js](https://nodejs.org) versi 18+ (download LTS)
- Akun Discord
- Akun [Spotify](https://spotify.com) (gratis, untuk developer app)
- [FFmpeg](https://www.gyan.dev/ffmpeg/builds/) ter-install (Windows: extract, tambahkan folder `bin` ke PATH, atau `choco install ffmpeg`)

## 2. Buat Bot di Discord Developer Portal

1. Buka **https://discord.com/developers/applications**
2. **New Application** → kasih nama (misal: `Lowkey Music`) → **Create**
3. Tab **Bot**:
   - Klik **Reset Token** → copy token. ⚠️ **Jangan dibagikan ke siapa pun!**
4. Tab **General Information**: copy **Application ID** (ini `DISCORD_CLIENT_ID`)
5. Undang bot:
   - Tab **Installation** (atau **OAuth2 → URL Generator**)
   - Scope: `bot` dan `applications.commands`
   - Permissions: `Send Messages`, `Embed Links`, `Connect`, `Speak`
   - Buka URL yang terbentuk → pilih server → **Authorize**

## 3. Buat Aplikasi Spotify (gratis)

Spotify tidak bisa di-stream langsung — bot mencari lagu yang sama di YouTube lalu memutarnya.

1. Buka **https://developer.spotify.com/dashboard** → login → **Create app**
2. Isi:
   - **App name:** `Lowkey Music`
   - **Redirect URIs:** `https://example.com` (tidak dipakai)
   - **API/SDKs:** Web API
3. **Settings**: copy **Client ID** → `SPOTIFY_ID`, klik **View client secret** → copy → `SPOTIFY_SECRET`

## 4. Isi File .env

```env
DISCORD_TOKEN=token_bot_dari_langkah_2
DISCORD_CLIENT_ID=application_id_dari_langkah_2
DISCORD_GUILD_ID=id_server_kamu_opsional
```

> `DISCORD_GUILD_ID` diisi → command muncul **instan** hanya di server itu (untuk test).
> Kosongkan → command **global**, muncul di semua server tapi butuh ±1 jam.

Cara ambil Guild ID: Discord **Settings → Advanced → Developer Mode** ON, klik kanan server → **Copy Server ID**.

## 5. Test di PC

```bash
# sekali saja: daftarkan slash command
npm run deploy

# jalankan bot
npm start
```

Muncul `Bot online sebagai NamaBot` — sukses! Masuk voice channel, ketik `/play detik last child`.

## 6. Deploy ke Wispbyte

1. Zip semua file project **kecuali folder `node_modules`**
2. Panel Wispbyte → buat server baru:
   - Tipe: **Node.js**, versi **18+** (misal 20/22)
   - Upload zip
3. Menu **Variables**, tambahkan:

   | Variable            | Value                 |
   | ------------------- | --------------------- |
   | `DISCORD_TOKEN`     | token bot kamu        |
   | `DISCORD_CLIENT_ID` | application ID        |
   | `SPOTIFY_ID`        | client ID Spotify     |
   | `SPOTIFY_SECRET`    | client secret Spotify |

4. **Startup file:** `index.js`, **Start command:** `node index.js`
5. Klik **Start** — console harus muncul `Bot online sebagai ...`

> Image Node.js di Pterodactyl umumnya sudah menyertakan ffmpeg. Kalau error "ffmpeg not found", hubungi support Wispbyte.

## 7. Daftar Perintah

| Command                  | Fungsi                                                                                                                                                                                                                                                        |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `/play <link/judul>`     | **Judul:** bot otomatis mencari di YouTube, Deezer, dan SoundCloud lalu memutar versi terbaik (judul paling mirip, bukan cover/live/remix, durasi wajar, prioritas audio YouTube). **Link:** langsung diputar (YouTube, Spotify, SoundCloud, Deezer, mp3/mp4) |
| `/pause`                 | Jeda lagu                                                                                                                                                                                                                                                     |
| `/resume`                | Lanjutkan lagu                                                                                                                                                                                                                                                |
| `/skip`                  | Skip ke lagu berikutnya                                                                                                                                                                                                                                       |
| `/stop`                  | Stop dan bersihkan antrian                                                                                                                                                                                                                                    |
| `/queue`                 | Lihat antrian                                                                                                                                                                                                                                                 |
| `/nowplaying`            | Lihat lagu yang sedang diputar                                                                                                                                                                                                                                |
| `/loop <off/song/queue>` | Set mode loop                                                                                                                                                                                                                                                 |
| `/volume <0-100>`        | Set volume                                                                                                                                                                                                                                                    |
| `/shuffle`               | Acak antrian                                                                                                                                                                                                                                                  |
| `/join`                  | Bot masuk voice channel kamu                                                                                                                                                                                                                                  |
| `/leave`                 | Bot keluar dari voice channel                                                                                                                                                                                                                                 |

Perilaku otomatis: bot keluar sendiri saat antrian selesai, di-stop, atau voice channel kosong dari pendengar.

**Command teks alternatif:** `l!play <judul/link>` atau singkat `l!p <judul/link>` — sama persis dengan `/play` (untuk testing/pengguna cepat; prefix `l!` biar tidak bentrok dengan bot lain seperti `m!play`). Voice otomatis: VC kamu → VC bot → VC yang paling banyak orangnya.

## 8. Masalah Umum & Solusi

**Command `/play` tidak muncul**
→ Jalankan `npm run deploy`. Kalau global (tanpa Guild ID), tunggu ±1 jam.

**Link Spotify error**
→ Link Spotify (track/album/playlist) dibaca langsung dari halaman publik Spotify — tidak butuh API dan tidak butuh Premium. Kalau lagu dibatasi region, bot otomatis cari judul yang sama di sumber lain (YouTube/Deezer/SoundCloud).

**Bot disconnect sendiri**
→ Normal — voice channel kosong dari pendengar atau antrian selesai.

**Suara putus-putus / lag**
→ Turunkan volume. Di hosting RAM kecil, hindari playlist super panjang.

**Bot crash / restart terus**
→ Lihat console log, cari baris error. Kalau `Cannot find module`, pastikan `npm install` jalan di panel.

---

**Q: Semua benar-benar gratis?**
A: Ya. discord.js, DisTube, semua plugin, API Spotify, dan hosting Wispbyte gratis untuk bot kecil.

**Q: Kenapa lagu Spotify diputar lewat YouTube?**
A: Spotify tidak mengizinkan streaming langsung ke bot (DMCA). Cara standar semua bot musik: ambil metadata lagu Spotify → cari di YouTube → stream dari YouTube. Suara sama persis.

Selamat menikmati Lowkey Music! 🎵
