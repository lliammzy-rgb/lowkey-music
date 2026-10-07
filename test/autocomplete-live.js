// Probe live autocomplete: ukur latency nyata iTunes + Deezer untuk saran.
// `node test/autocomplete-live.js "imagine john lennon"` — butuh internet, tanpa Discord.
const { autocompleteSearch, renderChoices, parseChoice } = require("../autocomplete");

const query = process.argv[2] || "imagine john lennon";
const client = { autoPicks: new Map() };

(async () => {
  // Simulasi ketikan bertambah huruf demi huruf: "ima" → "imagi" → "imagine john"
  const steps = [query.slice(0, 3), query.slice(0, Math.max(5, query.length - 5)), query].filter(
    (s, i, a) => s.length >= 3 && a.indexOf(s) === i,
  );

  for (const step of steps) {
    const t = Date.now();
    const res = await autocompleteSearch(step, {}, { limit: 25 });
    const ms = Date.now() - t;
    const choices = renderChoices(res, client);
    const back = choices[0] ? parseChoice(choices[0].value, client) : null;
    const sources = [...new Set(res.map((c) => c.song.source))].join("+") || "-";
    console.log(
      `[ac] "${step}" → ${ms}ms — ${res.length} saran [${sources}]${ms <= 2500 ? "" : "  LEWAT 3 DETIK"}` +
        (back?.song ? ` — pilih#1 = ${back.song.source}:${back.song.id}` : ""),
    );
    for (const c of choices.slice(0, 5)) console.log(`     ${c.name}`);
    if (choices.length > 5) console.log(`     ... +${choices.length - 5} lagi`);
  }

  // Panggilan ulang query identik → harus dari cache (instan)
  const t = Date.now();
  await autocompleteSearch(query, {}, { limit: 25 });
  console.log(`[ac] ulang query sama → ${Date.now() - t}ms (harus ~0, dari cache)`);
})().catch((e) => {
  console.error("[ac] GAGAL:", e.message);
  process.exitCode = 1;
});
// Sengaja TANPA process.exit(): undici (fetch) menyimpan handle keep-alive, dan
// mematikan proses paksa saat handle itu masih menutup membuat libuv crash di Windows.
