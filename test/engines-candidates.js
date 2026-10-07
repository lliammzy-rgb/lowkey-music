// Probe kandidat mesin pencari: latency, bentuk data, dan apakah diblokir dari jaringan ini.
// `node test/engines-candidates.js "imagine john lennon"`
const q = process.argv[2] || "imagine john lennon";

async function timed(name, fn) {
  const t = Date.now();
  try {
    const info = await fn();
    return { name, ms: Date.now() - t, ok: true, info };
  } catch (e) {
    return { name, ms: Date.now() - t, ok: false, info: `${e.name}: ${e.message.slice(0, 70)}` };
  }
}

const jsonFetch = async (url, headers = {}, ms = 6000) => {
  const res = await fetch(url, { headers, signal: AbortSignal.timeout(ms) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
};

const UA = { "User-Agent": "lowkey-music/1.0 ( https://github.com/lliammzy-rgb/lowkey-music )" };

(async () => {
  const out = await Promise.all([
    timed("itunes", async () => {
      const d = await jsonFetch(`https://itunes.apple.com/search?term=${encodeURIComponent(q)}&media=music&entity=song&limit=25`);
      const r = d.results?.[0];
      return `${(d.results || []).length} hasil; #1: ${r?.trackName} — ${r?.artistName}`;
    }),
    timed("deezer", async () => {
      const d = await jsonFetch(`https://api.deezer.com/search?q=${encodeURIComponent(q)}&limit=25`);
      const r = d.data?.[0];
      return `${(d.data || []).length} hasil; #1: ${r?.title} — ${r?.artist?.name}`;
    }),
    timed("musicbrainz", async () => {
      const d = await jsonFetch(
        `https://musicbrainz.org/ws/2/recording?query=${encodeURIComponent(q)}&fmt=json&limit=25`,
        UA,
      );
      const r = d.recordings?.[0];
      return `${(d.recordings || []).length} hasil; #1: ${r?.title} — ${r?.["artist-credit"]?.[0]?.name}`;
    }),
    timed("saavn", async () => {
      const d = await jsonFetch(`https://saavn.dev/api/search/songs?query=${encodeURIComponent(q)}&limit=25`);
      const list = d.data?.results || [];
      const r = list[0];
      return `${list.length} hasil; #1: ${r?.name} — ${r?.artists?.primary?.[0]?.name}`;
    }),
    timed("audius", async () => {
      const hosts = await jsonFetch("https://api.audius.co");
      const host = hosts.data[0];
      const d = await jsonFetch(`https://${host}/v1/tracks/search?query=${encodeURIComponent(q)}&app_name=lowkey-music`);
      const r = d.data?.[0];
      return `${(d.data || []).length} hasil; #1: ${r?.title} — ${r?.user?.name}`;
    }),
  ]);
  for (const r of out) console.log(`${r.ok ? "OK  " : "FAIL"} ${r.name.padEnd(12)} ${String(r.ms).padStart(6)}ms  ${r.info}`);
})();
