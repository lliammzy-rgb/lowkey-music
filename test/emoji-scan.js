// Pemindai emoji: pastikan TIDAK ADA emoji yang lolos ke kode atau dokumentasi.
// `node test/emoji-scan.js` — exit 1 kalau ketemu (dipakai sebagai gerbang di CI/lokal).
//
// Kenapa: emoji di output bot tampil beda-beda antar klien (sebagian jadi kotak "tofu"),
// jadi seluruh teks bot ditulis tanpa emoji. Tes ini mengunci aturan itu supaya tidak
// diam-diam masuk lagi lewat edit berikutnya.
//
// `test/` sengaja dilewati: emoji di console.log (✅/❌) itu output terminal, bukan output bot.
const fs = require("fs");
const path = require("path");

const ROOT = path.join(__dirname, "..");
const SKIP = new Set(["node_modules", ".git", "test"]);
const EXT = /\.(js|md)$/;

// Rentang EMOJI saja. Sengaja TIDAK memuat:
//  - U+2000-U+206F (• — … ‒ " "): tipografi, tampil normal di Discord, bukan emoji.
//  - U+2190-U+21FF (→ ← ↔): panah, sering dipakai di komentar.
//  - U+2500-U+25FF (█ ░ ─ ▪): blok & geometri; dipakai volume bar.
// Yang DImuat: pictograph/emoticon/dingbat/simbol berwarna + variation selector.
const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{20E3}\u{1F1E6}-\u{1F1FF}\u{2300}-\u{23FF}]/u;

function walk(dir, out = []) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (EXT.test(e.name)) out.push(p);
  }
  return out;
}

let hits = 0;
for (const file of walk(ROOT)) {
  const rel = path.relative(ROOT, file);
  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    if (!EMOJI.test(line)) return;
    hits++;
    // tandai apakah di kode atau di komentar — supaya perbaikannya jelas
    const noComment = line.replace(/\/\/.*$/, "").replace(/\/\*[\s\S]*?\*\//g, "");
    const where = EMOJI.test(noComment) ? "KODE    " : "komentar";
    console.log(`${where} ${rel}:${i + 1}  ${line.trim().slice(0, 90)}`);
  });
}

if (hits) {
  console.error(`\nGAGAL: ${hits} baris masih mengandung emoji. Bot harus bebas emoji.`);
  process.exitCode = 1;
} else {
  console.log("emoji-scan: bersih, 0 emoji di kode & dokumentasi.");
}
