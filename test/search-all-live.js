// Probe live searchAll + renderPicker: `node test/search-all-live.js`
// Butuh internet. Cek urutan rank & dedupe lintas sumber dengan data asli.
const { searchAll, dedupe, normalize, scoreCandidate } = require("../search");
const { renderPicker, formatDur } = require("../picker");

const QUERY = process.argv[2] || "imagine john lennon";

(async () => {
  for (let run = 1; run <= 2; run++) {
    const t = Date.now();
    const { results, ytOk } = await searchAll(QUERY, {}, { budget: 900, limit: 10 });
    console.log(`\n===== run ${run}: ${results.length} hasil dalam ${Date.now() - t}ms (ytOk=${ytOk}) =====`);
    results.forEach((r, i) => {
      console.log(
        `${String(i + 1).padStart(2)}. [${r.kind === "direct" ? "langsung" : "mirror "}] ${r.song.source.padEnd(11)} ` +
          `score=${r.score.toFixed(2).padStart(6)} ${formatDur(r.song.duration).padStart(5)}  ` +
          `${(r.song.name || "").slice(0, 52)} — ${r.song.uploader?.name || "?"}`,
      );
    });
    const keys = results.map((r) => normalize(`${r.song.name} ${r.song.uploader?.name || ""}`));
    console.log(`duplikat tersisa: ${keys.length - new Set(keys).size}`);
    if (run === 2) {
      const view = renderPicker(QUERY, results, Date.now() - t);
      console.log(`\nembed chars: ${view.embeds[0].data.description.length}/4096, baris komponen: ${view.components.length}`);
      console.log(`opsi menu: ${view.components[0].components[0].options.length}`);
      console.log("\n--- preview embed ---\n" + view.embeds[0].data.description);
    }
  }
  process.exit(0);
})();