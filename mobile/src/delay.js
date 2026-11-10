// Yayın gecikmesi ölçümü (telefon). Masaüstündeki ile aynı yöntem:
// canlı HLS listesindeki son parçanın çekim zamanı (PROGRAM-DATE-TIME) ile şimdiki zaman farkı.
// "Şimdi" bilgisayar/telefon saatinden değil Supabase sunucusunun saatinden alınır.
import { reportRpc } from './report';

const TWITCH_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko';
const WINDOW_MS = 20000;

async function fetchText(url) {
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

// ---- Saat düzeltmesi ----
let clockOffset = 0;
let clockNext = 0;
async function syncClock() {
  if (Date.now() < clockNext) return;
  clockNext = Date.now() + 10 * 60 * 1000;
  const tries = [];
  for (let i = 0; i < 3; i++) {
    try {
      const t0 = Date.now();
      const ms = Number(await reportRpc('server_time', {}));
      const t1 = Date.now();
      if (ms > 0) tries.push({ rtt: t1 - t0, off: ms - (t0 + t1) / 2 });
    } catch {
      break;
    }
  }
  if (tries.length) {
    tries.sort((a, b) => a.rtt - b.rtt);
    clockOffset = tries[0].off;
  } else {
    clockNext = Date.now() + 60 * 1000; // internet yoksa 1 dk sonra yine dene
  }
}
const trueNow = () => Date.now() + clockOffset;

function firstVariant(master, base) {
  const lines = master.split('\n').map((l) => l.trim());
  const i = lines.findIndex((l) => l.startsWith('#EXT-X-STREAM-INF'));
  if (i < 0) return null;
  const uri = lines.slice(i + 1).find((l) => l && !l.startsWith('#'));
  if (!uri) return null;
  if (/^https?:/.test(uri)) return uri;
  return base.replace(/[^/?]*(\?.*)?$/, '') + uri;
}

function liveEdgeTime(media) {
  let pdt = null;
  let dur = 0;
  let edge = null;
  for (const raw of media.split('\n')) {
    const l = raw.trim();
    if (l.startsWith('#EXT-X-PROGRAM-DATE-TIME:')) pdt = Date.parse(l.slice(25));
    else if (l.startsWith('#EXTINF:')) dur = parseFloat(l.slice(8)) * 1000 || 0;
    else if (l && !l.startsWith('#') && pdt != null) {
      edge = pdt + dur;
      pdt += dur;
    }
  }
  return edge;
}

async function twitchMasterUrl(channel) {
  const res = await fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Client-ID': TWITCH_CLIENT_ID, 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify({
      query:
        'query($login: String!) { streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: "site"}) { value signature } }',
      variables: { login: channel },
    }),
  });
  const json = await res.json();
  const tok = json?.data?.streamPlaybackAccessToken;
  if (!tok) throw new Error('yayın kapalı');
  const q = `sig=${encodeURIComponent(tok.signature)}&token=${encodeURIComponent(tok.value)}&allow_source=true&fast_bread=true&p=${Math.floor(Math.random() * 1e6)}`;
  return `https://usher.ttvnw.net/api/channel/hls/${encodeURIComponent(channel)}.m3u8?${q}`;
}

const state = {
  twitch: { key: null, mediaUrl: null, mediaAt: 0, samples: [] },
  kick: { key: null, mediaUrl: null, mediaAt: 0, samples: [] },
};

async function sample(p, key, getMasterUrl) {
  const st = state[p];
  if (st.key !== key) Object.assign(st, { key, mediaUrl: null, mediaAt: 0, samples: [] });
  if (!st.mediaUrl || Date.now() - st.mediaAt > 4 * 60 * 1000) {
    const masterUrl = await getMasterUrl();
    const master = await fetchText(masterUrl);
    st.mediaUrl = master.includes('#EXTINF') ? masterUrl : firstVariant(master, masterUrl);
    if (!st.mediaUrl) throw new Error('liste yok');
    st.mediaAt = Date.now();
  }
  let media;
  try {
    media = await fetchText(st.mediaUrl);
  } catch (e) {
    st.mediaUrl = null;
    throw e;
  }
  const edge = liveEdgeTime(media);
  if (!edge) throw new Error('zaman bilgisi yok');
  const now = Date.now();
  st.samples.push({ t: now, lag: trueNow() - edge });
  st.samples = st.samples.filter((x) => now - x.t <= WINDOW_MS);
  return { lag: Math.min(...st.samples.map((x) => x.lag)), n: st.samples.length };
}

// Dönüş: { twitch: { lag, n } | { err }, kick: ... }  (kanal yoksa null)
export async function measureDelay({ twitch, kick, kickPlaybackUrl }) {
  await syncClock().catch(() => {});
  const one = async (p, key, get) => {
    if (!key) return null;
    try {
      return await sample(p, key, get);
    } catch (e) {
      state[p].samples = [];
      return { err: String(e?.message || e) };
    }
  };
  const [t, k] = await Promise.all([
    one('twitch', twitch, () => twitchMasterUrl(twitch)),
    one('kick', kick, async () => {
      if (!kickPlaybackUrl) throw new Error('yayın kapalı');
      return kickPlaybackUrl;
    }),
  ]);
  return { twitch: t, kick: k };
}
