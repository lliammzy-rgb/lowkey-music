// Saran saat user MASIH mengetik di option query `/play` (Discord autocomplete).
//
// Bedanya dengan picker: picker dipakai setelah user menekan enter; ini sebelum. Jadi user
// bisa langsung memilih lagu yang benar tanpa menunggu enter + render menu.
//
// Kenapa iTunes + Deezer, dan BUKAN ytsr — ini keputusan berbasis pengukuran, bukan selera:
//
//  - ytsr terukur 1.7-12 detik dan sering balas "Unsupported YouTube Search response"
//    (rate limit). Discord memberi deadline 3 detik dan autocomplete TIDAK bisa di-defer,
//    jadi ytsr praktis selalu kalah budget: hasilnya bukan cuma lambat, tapi YouTube tidak
//    pernah ikut muncul sama sekali — sementara kita tetap membayar ~1.8 detik tunggu.
//  - MusicBrainz juga ditolak walau terlihat menjanjikan: 704-4130ms, dan lebih buruk lagi
//    tidak punya data popularitas sehingga cover/tribute naik ke #1 ("Imagine" → Joe
//    Bennett, "Bohemian Rhapsody" → "...And Be Done With It"). Saran yang salah lebih
//    buruk daripada tidak ada saran.
//  - JioSaavn & Audius tidak terjangkau dari jaringan ini (fetch failed di semua percobaan).
//  - iTunes (169ms-2.3s) dan Deezer (378-2486ms) dua-duanya stabil dan relevan. Dijalankan
//    PARALEL, jadi wall-clock = yang paling lambat, bukan jumlah keduanya.
//
// Konsekuensi yang diterima: semua saran di sini bertanda "mirror" — saat dipilih, lagunya
// dicari padanannya di YouTube (sama seperti memilih baris mirror di picker). YouTube tetap
// bisa dipilih langsung lewat picker kalau user menekan enter tanpa memilih saran.
//
// Batas keras lain dari Discord yang membentuk desain file ini:
//  - maks 25 saran, `name` ≤ 100 char.
//  - `value` cuma string ≤ 100 char → objek Song tidak muat dikirim. Jadi dipakai token
//    pendek ke store in-memory, DITAMBAH judul sebagai cadangan kalau token kadaluarsa.
const crypto = require("crypto");
const { itunesSearch, deezerSearch, withBudget, DIRECT_SOURCES, SOURCE_META } = require("./engines");
const { normalize, scoreCandidate, dedupe } = require("./search");

const AUTO_TTL = 5 * 60_000; // entri cache & token dianggap valid 5 menit
const AUTO_BUDGET = 1800; // < 3 detik Discord, sisakan margin untuk jitter jaringan
const MIN_CHARS = 3; // di bawah ini balas kosong: hemat request
const TOKEN_PREFIX = "ac_";
const MAX_CACHE = 200;
const MAX_STORE = 500;

const trunc = (s, n) => {
  const str = String(s ?? "");
  return str.length > n ? `${str.slice(0, n - 1)}…` : str;
};

const queryCache = new Map(); // query ternormalisasi → { at, candidates }
const inflight = new Map(); // query ternormalisasi → Promise (cegah request dobel)

// Untuk autocomplete, versi-versi dari lagu yang sama — "Imagine", "Imagine (Remastered)",
// "Imagine (Take 1)", "Imagine (Demo)" — adalah noise: memilih salah satunya memutar lagu
// yang sama persis, tapi daftar 25 slot jadi penuh oleh satu lagu. Picker tetap menampilkan
// tiap versi karena di sana user memang sedang memilih versi; autocomplete hanya jalan
// pintas "pokoknya lagu ini", jadi cukup satu wakil (yang skornya tertinggi).
const VERSION_PAREN = /\s*[([]\s*(?:remaster|remastered|version|mix|edit|take|demo|live|deluxe|edition|anniversary|mono|stereo|acoustic|instrumental)[^)\]]*[)\]]/gi;
const VERSION_DASH = /\s+[-–—]\s+.*\b(?:remaster|remastered|version|mix|edit|take|demo|live|deluxe|edition|anniversary|mono|stereo)\b.*$/i;

// PENTING: penanda versi dibuang dari judul MENTAH dulu, baru di-normalize.
// normalize() membuang semua tanda kurung, jadi kalau urutannya dibalik, "(Take 1)"
// sudah jadi "take 1" dan regex yang mencari tanda kurung tidak pernah cocok.
function versionKey(song) {
  const title = normalize(
    String(song.name || "")
      .replace(VERSION_PAREN, " ")
      .replace(VERSION_DASH, " "),
  );
  return `${title}|${normalize(song.uploader?.name || "")}`;
}

// Seberapa cocok nama artis dengan query yang DIKETIK. Bedanya dengan `key.includes(artist)`:
// token terakhir boleh baru SEBAGIAN (user masih mengetik). Contoh nyata: saat user baru
// sampai "imagine john l", artis "John Lennon" belum utuh di query, tapi jelas itu yang
// dimaksud — tanpa ini, cover berjudul "Imagine (John Lennon)" menang karena judulnya
// kebetulan memuat lebih banyak kata query.
function artistMatchRatio(tokens, artist) {
  const artistTokens = artist.split(" ").filter(Boolean);
  if (!artistTokens.length) return 0;
  let hit = 0;
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const isLast = i === tokens.length - 1;
    if (artistTokens.includes(t)) hit++;
    else if (isLast && artistTokens.some((a) => a.startsWith(t))) hit++;
  }
  return hit / tokens.length;
}

// candidates sudah terurut skor menurun → wakil pertama = skor tertinggi.
function collapseVersions(candidates) {
  const seen = new Map();
  for (const c of candidates) {
    const key = versionKey(c.song);
    if (!key || key === "|") continue;
    if (!seen.has(key)) seen.set(key, c);
  }
  return [...seen.values()];
}

// Cari untuk saran autocomplete.
async function autocompleteSearch(query, plugins, { limit = 25 } = {}) {
  const focused = String(query || "").trim();
  if (focused.length < MIN_CHARS) return [];

  const key = normalize(focused);
  const cached = queryCache.get(key);
  if (cached && Date.now() - cached.at < AUTO_TTL) return cached.candidates.slice(0, limit);

  // Ketikan cepat bisa memicu dua panggilan untuk query yang sama sebelum yang pertama
  // selesai. Satukan supaya tidak ada pekerjaan dobel.
  const pending = inflight.get(key);
  if (pending) return (await pending).slice(0, limit);

  const run = (async () => {
    const tokens = key.split(" ").filter(Boolean);
    // Paralel: wall-clock = yang paling lambat, bukan jumlah keduanya.
    const [apple, deezer] = await Promise.all([
      withBudget(itunesSearch(focused, 25), AUTO_BUDGET, "auto-itunes"),
      withBudget(deezerSearch(focused, 25), AUTO_BUDGET, "auto-deezer"),
    ]);

    // Peringkat untuk autocomplete butuh logika sendiri, tidak bisa pakai scoreCandidate
    // picker apa adanya. Dua masalah nyata yang harus ditangani:
    //
    //  a. normalize() membuang tanda kurung, jadi "Imagine (John Lennon)" milik Tackie &
    //     G. Ferreila menjadi teks "imagine john lennon" — PERSIS sama dengan query yang
    //     diketik user. Judulnya cocok sempurna, jadi cover ini mengalahkan "Imagine" milik
    //     John Lennon sendiri. Solusinya: nilai kecocokan ARTIS secara terpisah. Artis yang
    //     namanya terkandung dalam query (user mengetik "…john lennon") jauh lebih kuat
    //     petunjuknya daripada judul yang kebetulan memuat kata yang sama.
    //  b. iTunes & Deezer mencari di judul DAN artis, jadi "ima" mengembalikan "Ima Boss"
    //     milik Meek Mill sama banyaknya dengan lagu berjudul "Ima". Bonus awalan judul
    //     hanya masuk akal untuk query SATU kata (user sedang mengeja satu judul). Untuk
    //     query panjang bonus itu justru menyesatkan, seperti kasus (a).
    const singleWord = tokens.length === 1;
    const scored = [...apple, ...deezer]
      .map((song) => {
        const base = scoreCandidate(song, tokens, 0.15);
        const title = normalize(song.name || "");
        const artist = normalize(song.uploader?.name || "");
        const titleTokens = new Set(title.split(" ").filter(Boolean));

        // Berapa banyak kata query yang benar-benar ada di JUDUL (bukan judul+artis).
        // Ini sinyal paling jujur untuk "apakah ini lagunya", dan menutup celah yang tidak
        // ditutup base score: base mencampur judul & artis, jadi artis yang kebetulan
        // bernama sama dengan lagu bisa menang. Contoh nyata: query "bohemian rhapsody"
        // mengembalikan "Don't Stop Me Now" oleh artis bernama "Bohemian Rhapsody" —
        // judulnya sama sekali tidak memuat kata query, jadi wajar diberi nol.
        const titleOverlap = tokens.filter((t) => titleTokens.has(t)).length;
        const titleCoverage = tokens.length ? titleOverlap / tokens.length : 0;

        // artis muncul di query yang diketik → sinyal kuat. Dua bentuk:
        //  - utuh ("…john lennon") → +4, sinyal terkuat
        //  - token terakhir baru sebagian ("…john l") → diberi kredit proporsional, supaya
        //    cover berjudul "Imagine (John Lennon)" tidak menang cuma karena user belum
        //    selesai mengetik nama artisnya.
        // Artis yang namanya = SELURUH query tetap dikecualikan (lihat kasus #5h).
        const artistIsWholeQuery = artist === key && tokens.length > 1;
        const artistWhole = !artistIsWholeQuery && artist.length >= 3 && key.includes(artist);
        const artistBonus = artistIsWholeQuery ? 0 : artistWhole ? 4 : artistMatchRatio(tokens, artist) * 4;
        const titleBonus = singleWord ? (title.startsWith(key) ? 3 : title.includes(key) ? 1 : 0) : 0;

        return {
          song,
          // Cakupan JUDUL dihitung untuk query >1 kata, tapi bobotnya rendah (2): ini cuma
          // penentu saat artis seri. Kalau bobotnya besar, cover yang judulnya kebetulan
          // memuat semua kata query selalu menang — persis bug yang mau ditutup.
          score: base + artistBonus + titleBonus + (singleWord ? 0 : titleCoverage * 2),
          kind: DIRECT_SOURCES.has(song.source) ? "direct" : "mirror",
        };
      })
      .sort((a, b) => b.score - a.score);

    // dedupe dipakai bersama picker: satu lagu dari beberapa sumber = satu baris.
    // collapseVersions menyusul: buang versi lain dari lagu yang sudah ada di daftar.
    const ranked = collapseVersions(dedupe(scored));

    if (queryCache.size >= MAX_CACHE) queryCache.clear();
    queryCache.set(key, { at: Date.now(), candidates: ranked });
    return ranked;
  })().finally(() => inflight.delete(key));

  inflight.set(key, run);
  return (await run).slice(0, limit);
}

// Store token → { song, kind, at }. Ditaruh di client supaya hidup selama proses bot.
const pickStore = (client) => client.autoPicks || (client.autoPicks = new Map());

// Song → string untuk `value` autocomplete (≤ 100 char).
// Format: "<token>|<judul - artis>" — judulnya ikut dikirim supaya token yang hilang
// masih bisa dipakai untuk mencari ulang, bukan jadi query sampah.
//
// Token = hash(source+id), BUKAN counter acak. Discord memanggil render berulang untuk
// query yang sama (tiap ketikan), dan token yang selalu baru akan menumpuk di store tanpa
// batas. Dengan hash, lagu yang sama selalu dapat token yang sama → entri lama ditimpa.
function encodeChoice(song, client) {
  const store = pickStore(client);
  const token =
    TOKEN_PREFIX + crypto.createHash("sha1").update(`${song.source}:${song.id}`).digest("hex").slice(0, 10);
  store.set(token, {
    song,
    kind: DIRECT_SOURCES.has(song.source) ? "direct" : "mirror",
    at: Date.now(),
  });
  if (store.size > MAX_STORE) {
    // buang yang kadaluarsa dulu; kalau masih penuh, buang yang paling tua.
    const now = Date.now();
    for (const [k, v] of store) if (now - v.at > AUTO_TTL) store.delete(k);
    if (store.size > MAX_STORE) {
      const oldest = [...store.entries()].sort((a, b) => a[1].at - b[1].at);
      for (const [k] of oldest.slice(0, store.size - MAX_STORE)) store.delete(k);
    }
  }
  const title = `${song.name} ${song.uploader?.name || ""}`.trim();
  return `${token}|${trunc(title, 85)}`.slice(0, 100);
}

// Kebalikan encodeChoice. Hasil:
//   { song, kind } → user memilih saran, lagunya sudah pasti
//   { query }      → token kadaluarsa (mis. bot restart), judulnya masih ada → cari ulang
//   null           → user mengetik sendiri, bukan pilihan saran
function parseChoice(value, client) {
  if (typeof value !== "string" || !value.startsWith(TOKEN_PREFIX)) return null;
  const sep = value.indexOf("|");
  if (sep < 0) return null;
  const hit = pickStore(client).get(value.slice(0, sep));
  if (hit && Date.now() - hit.at < AUTO_TTL) return hit;
  const title = value.slice(sep + 1).trim();
  return title ? { query: title } : null;
}

// Baris dropdown. Format "Judul — Artis [Sumber]", dipotong 100 char (batas Discord).
// Tanpa emoji: sebagian klien tidak punya glyph-nya dan hasilnya jadi kotak.
function renderChoices(candidates, client) {
  return candidates.slice(0, 25).map((c) => {
    const s = c.song;
    const label = (SOURCE_META[s.source] || {}).label || s.source;
    return {
      name: trunc(`${s.name || "Tanpa judul"} — ${s.uploader?.name || "?"} [${label}]`, 100),
      value: encodeChoice(s, client),
    };
  });
}

module.exports = {
  autocompleteSearch,
  encodeChoice,
  parseChoice,
  renderChoices,
  AUTO_TTL,
  MIN_CHARS,
  TOKEN_PREFIX,
  // Hanya untuk tes: state modul ini global (cache + inflight), jadi tes butuh cara
  // mengembalikannya ke kondisi bersih supaya hasilnya deterministik.
  _reset() {
    queryCache.clear();
    inflight.clear();
  },
};
