// Probe: latency + jumlah hasil per mesin, untuk menyetel budget autocomplete.
const { ytsrSearch, itunesSearch } = require("../engines");

const queries = process.argv.slice(2);
if (!queries.length) queries.push("ima", "imagine john l", "imagine john lennon", "queen bohemian");

(async () => {
  for (const q of queries) {
    const out = {};
    await Promise.all([
      (async () => {
        const t = Date.now();
        try {
          out.yt = `${(await ytsrSearch(q, 12)).length} hasil / ${Date.now() - t}ms`;
        } catch (e) {
          out.yt = `ERROR ${e.message.slice(0, 40)} / ${Date.now() - t}ms`;
        }
      })(),
      (async () => {
        const t = Date.now();
        try {
          out.it = `${(await itunesSearch(q, 12)).length} hasil / ${Date.now() - t}ms`;
        } catch (e) {
          out.it = `ERROR ${e.message.slice(0, 40)} / ${Date.now() - t}ms`;
        }
      })(),
    ]);
    console.log(`"${q}"\n   ytsr  : ${out.yt}\n   itunes: ${out.it}`);
  }
})();
// Tanpa process.exit(): biarkan handle undici menutup sendiri.
