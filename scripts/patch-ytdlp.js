// scripts/patch-ytdlp.js
// Patch @distube/yt-dlp supaya JSON.parse tahan terhadap yt-dlp deprecation
// warnings ("Deprecated Feature: ... --no-call-home") yang ke stdout.
// Idempotent: bisa dijalankan berkali-kali, skip kalau sudah ke-patch.

const fs = require('fs');
const path = require('path');

const MARKER = '/*patched:ytdlp-json*/';

// Pola asli (fresh install @distube/yt-dlp@2.0.1) di kedua build CJS & ESM
const ORIGINAL = 'if (code === 0) resolve(JSON.parse(output));';

const PATCHED =
  'if (code === 0) {\n' +
  '        ' + MARKER + '\n' +
  '        let jsonOutput = output;\n' +
  '        const jsonStart = output.search(/^\\s*[\\[{]/m);\n' +
  '        if (jsonStart > 0) jsonOutput = output.substring(jsonStart);\n' +
  '        try {\n' +
  '          resolve(JSON.parse(jsonOutput));\n' +
  '        } catch (err) {\n' +
  '          reject(new Error(`Failed to parse yt-dlp output: ${err.message}\\n${output.slice(0, 300)}`));\n' +
  '        }\n' +
  '      }';

const targets = [
  path.join(__dirname, '..', 'node_modules', '@distube', 'yt-dlp', 'dist', 'index.js'),
  path.join(__dirname, '..', 'node_modules', '@distube', 'yt-dlp', 'dist', 'index.mjs'),
];

let anyChange = false;
for (const file of targets) {
  if (!fs.existsSync(file)) {
    console.log(`[patch-ytdlp] skip (not found): ${path.basename(file)}`);
    continue;
  }
  let content = fs.readFileSync(file, 'utf8');

  if (content.includes(MARKER)) {
    console.log(`[patch-ytdlp] already patched: ${path.basename(file)}`);
    continue;
  }

  // Normalisasi varian lokal yang pernah diedit manual (punya logika jsonStart)
  if (content.includes('const jsonStart =')) {
    content = content.replace(MARKER, ''); // tidak ada, biarkan
    // Tandai saja supaya tidak diproses ulang nanti
    fs.writeFileSync(file, content.replace(/^(\s*let jsonOutput = output;)/m, `      ${MARKER}\n$1`));
    console.log(`[patch-ytdlp] marked existing manual patch: ${path.basename(file)}`);
    anyChange = true;
    continue;
  }

  if (content.includes(ORIGINAL)) {
    content = content.replace(ORIGINAL, PATCHED);
    fs.writeFileSync(file, content);
    console.log(`[patch-ytdlp] patched: ${path.basename(file)}`);
    anyChange = true;
  } else {
    console.log(`[patch-ytdlp] pattern not found in ${path.basename(file)} - mungkin versi berbeda, cek manual`);
  }
}

if (!anyChange) console.log('[patch-ytdlp] tidak ada perubahan (semua sudah ke-patch)');
process.exit(0);
