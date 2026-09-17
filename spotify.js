const { Song, Playlist } = require("distube");

// parse open.spotify.com/(intl-xx/)?(track|album|playlist)/<id>
const SPOTIFY_URL = /(?:^|\W)open\.spotify\.com\/(?:intl-[a-z]{2}\/)?(track|album|playlist)\/([A-Za-z0-9]+)/;

function parseSpotifyUrl(url) {
  const [, type, id] = url.match(SPOTIFY_URL) ?? [];
  return type && id ? { type, id } : null;
}

async function fetchEntity(type, id) {
  const res = await fetch(`https://open.spotify.com/embed/${type}/${id}`);
  const html = await res.text();
  const match = html.match(/<script id="__NEXT_DATA__" type="application\/json">(.+?)<\/script>/);
  if (!match) throw new Error("Halaman Spotify tidak bisa dibaca.");
  const data = JSON.parse(match[1])?.props?.pageProps?.state?.data;
  const entity = data?.entity;
  if (!entity?.type) throw new Error("Lagu/playlist Spotify tidak tersedia (dibatasi region atau private).");
  return entity;
}

function toSong(entity, plugin) {
  const artists = entity.artists?.map((a) => a.name).join(", ") || entity.subtitle;
  return new Song(
    {
      plugin,
      source: "spotify",
      playFromSource: false,
      id: entity.id,
      url: `https://open.spotify.com/track/${entity.id}`,
      name: entity.title,
      uploader: { name: artists },
      thumbnail: entity.visualIdentity?.image?.slice(-1)?.[0]?.url,
      duration: (entity.duration || 0) / 1000,
    },
    {},
  );
}

async function resolve(url, plugin) {
  const parsed = parseSpotifyUrl(url);
  if (!parsed) throw new Error("Bukan link Spotify yang valid.");
  const entity = await fetchEntity(parsed.type, parsed.id);

  if (parsed.type === "track") return toSong(entity, plugin);

  const songs = (entity.trackList || [])
    .filter((t) => t.uri?.startsWith("spotify:track:"))
    .map((t) =>
      new Song(
        {
          plugin,
          source: "spotify",
          playFromSource: false,
          id: t.uri.split(":")[2],
          url: `https://open.spotify.com/track/${t.uri.split(":")[2]}`,
          name: t.title,
          uploader: { name: t.subtitle },
          duration: (t.duration || 0) / 1000,
        },
        {},
      ),
    );
  if (!songs.length) throw new Error("Playlist/album kosong atau tidak tersedia.");

  return new Playlist(
    {
      plugin,
      source: "spotify",
      url,
      name: entity.name || entity.title,
      thumbnail: entity.visualIdentity?.image?.slice(-1)?.[0]?.url,
      songs,
    },
    {},
  );
}

module.exports = { resolve, parseSpotifyUrl };
