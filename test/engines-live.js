// Probe live mesin pencari: `node test/engines-live.js`
// Butuh internet. Bukan unit test — cuma verifikasi bentuk data + latency nyata.
const { itunesSearch, tidalSearch, ytsrSearch, withBudget } = require("../engines");

const QUERY = "imagine john lennon";

const ms = async (label, fn) => {
  const t = Date.now();
  try {
    const r = await fn();
    console.log(`\n=== ${label} — ${Date.now() - t}ms — ${r.length} hasil ===`);
    for (const s of r.slice(0, 3)) {
      console.log(
        JSON.stringify({
          id: s.id,
          name: (s.name || "").slice(0, 60),
          artist: s.uploader?.name,
          dur: s.duration,
          thumb: (s.thumbnail || "").slice(0, 55),
          url: s.url,
        }),
      );
    }
    return r;
  } catch (e) {
    console.log(`\n=== ${label} — GAGAL setelah ${Date.now() - t}ms: ${e.message} ===`);
    return [];
  }
};

(async () => {
  await ms("itunes", () => itunesSearch(QUERY, 6));
  await ms("tidal", () => tidalSearch(QUERY, 6));
  // ytsr flaky — coba 3x biar kelihatan tingkat keberhasilannya
  for (let i = 1; i <= 3; i++) await ms(`ytsr #${i}`, () => ytsrSearch(QUERY, 6));
  await ms("ytsr via budget 900ms", () => withBudget(ytsrSearch(QUERY, 6), 900, "ytsr"));
  process.exit(0);
})();
