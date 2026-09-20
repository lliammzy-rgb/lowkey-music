const spotifyUrlInfo = require('spotify-url-info');
const fetch = require('node-fetch').default;

async function parseSpotifyAndSearchDeezer(query) {
  try {
    const spotify = spotifyUrlInfo(fetch);

    let title, artist;

    if (/open\.spotify\.com/.test(query)) {
      const data = await spotify.getData(query);
      title = data.name || data.title;
      artist = (data.artists?.map((a) => a.name).join(', ') || data.subtitle || '').trim();
    } else {
      title = query.trim();
      artist = '';
    }

    if (!title) throw new Error('Tidak bisa mengekstrak judul dari query.');

    const searchQuery = `${title} ${artist}`.trim();
    const res = await fetch(`https://api.deezer.com/search?q=${encodeURIComponent(searchQuery)}`);
    const json = await res.json();

    if (!json.data || json.data.length === 0) {
      throw new Error('Lagu tidak ditemukan di Deezer.');
    }

    const track = json.data[0];
    return {
      title: track.title,
      artist: track.artist.name,
      previewUrl: track.preview,
      deezerLink: track.url,
    };
  } catch (err) {
    throw new Error(`Error parse Spotify/Deezer: ${err.message}`);
  }
}

module.exports = { parseSpotifyAndSearchDeezer };