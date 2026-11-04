// Twitch / Kick link ve adres yardımcıları (masaüstü sürümüyle aynı mantık)

export const PLATFORMS = {
  twitch: {
    label: 'Twitch',
    color: '#9146ff',
    chatUrl: (c) => `https://www.twitch.tv/popout/${encodeURIComponent(c)}/chat?popout=`,
    loginUrl: () => 'https://www.twitch.tv/login',
  },
  kick: {
    label: 'Kick',
    color: '#53fc18',
    chatUrl: (c) => `https://kick.com/popout/${encodeURIComponent(c)}/chat`,
    loginUrl: () => 'https://kick.com/',
  },
};

export function cleanChannel(v) {
  return (v || '')
    .trim()
    .replace(/^@/, '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .toLowerCase();
}

export function hasLink(text) {
  return /(twitch\.tv|kick\.com)\/[A-Za-z0-9_-]/i.test(text || '');
}

// Metindeki Twitch/Kick linklerinden { twitch: 'kanal', kick: 'kanal' } çıkarır.
// Link yoksa düz kanal adı iki platforma birden uygulanır.
export function parseTargets(text) {
  const found = {};
  const re = /(?:https?:\/\/)?(?:www\.|m\.)?(twitch\.tv|kick\.com)\/(?:popout\/)?([A-Za-z0-9_-]+)/gi;
  let m;
  while ((m = re.exec(text || ''))) {
    const p = m[1].toLowerCase().startsWith('twitch') ? 'twitch' : 'kick';
    found[p] = m[2].toLowerCase();
  }
  if (!Object.keys(found).length) {
    const name = cleanChannel(text);
    if (name) {
      found.twitch = name;
      found.kick = name;
    }
  }
  return found;
}

// Uygulama içinde açılmasına izin verilen adresler (giriş sayfaları, Cloudflare kontrolü vb.)
const INTERNAL_HOSTS = [
  'twitch.tv',
  'kick.com',
  'challenges.cloudflare.com',
  'accounts.google.com',
  'appleid.apple.com',
];

export function isInternalUrl(url) {
  if (!/^https?:/i.test(url || '')) return true; // about:blank, data:, blob: vb.
  const m = url.match(/^https?:\/\/([^/?#:]+)/i);
  if (!m) return true;
  const host = m[1].toLowerCase();
  return INTERNAL_HOSTS.some((h) => host === h || host.endsWith('.' + h));
}
