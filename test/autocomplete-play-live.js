// Ukur jalur lengkap "pilih saran autocomplete → lagu siap diputar", live.
// `node test/autocomplete-play-live.js "imagine john lennon"`
const { autocompleteSearch, renderChoices, parseChoice } = require("../autocomplete");
const { resolvePlayable } = require("../picker");

const query = process.argv[2] || "imagine john lennon";
const client = { autoPicks: new Map() };

(async () => {
  const t0 = Date.now();
  const res = await autocompleteSearch(query, {}, { limit: 25 });
  const tSearch = Date.now() - t0;

  const choices = renderChoices(res, client);
  if (!choices.length) throw new Error("tidak ada saran");
  console.log(`[ac] saran muncul: ${tSearch}ms — ${choices.length} opsi`);
  console.log(`[ac] opsi #1: ${choices[0].name}`);

  const picked = parseChoice(choices[0].value, client);
  console.log(`[ac] parse → ${picked.song.source}:${picked.song.id} (kind=${picked.kind})`);

  const t1 = Date.now();
  const song = await resolvePlayable(picked);
  const tResolve = Date.now() - t1;
  console.log(`[ac] resolvePlayable (${picked.kind}): ${tResolve}ms → ${song?.source}:${song?.id}`);
  console.log(`[ac] TOTAL saran→siap: ${tSearch + tResolve}ms`);
})().catch((e) => {
  console.error("[ac] GAGAL:", e.message);
  process.exitCode = 1;
});
