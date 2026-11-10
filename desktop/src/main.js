const { app, BrowserWindow, ipcMain, shell, session, net, webContents } = require('electron');

// 🔒 Uygulamanın iç komutlarını (ipc) sadece uygulamanın kendi sayfası çağırabilsin; chat sayfaları
// (Twitch / Kick) ya da başka bir pencere çağıramaz.
{
  const handle = ipcMain.handle.bind(ipcMain);
  ipcMain.handle = (channel, fn) =>
    handle(channel, (e, ...args) => {
      const url = (e.senderFrame && e.senderFrame.url) || '';
      if (!url.startsWith('file://') || !mainWindow || e.sender !== mainWindow.webContents) throw new Error('izinsiz');
      return fn(e, ...args);
    });
}
const path = require('path');
const fs = require('fs');

const FIT_POPUPS_JS = fs.readFileSync(path.join(__dirname, 'fit-popups.js'), 'utf8');
const PICK_USER_JS = fs.readFileSync(path.join(__dirname, 'pick-user.js'), 'utf8');

// Twitch / Kick bazen "Electron" içeren tarayıcıları engelleyebiliyor,
// bu yüzden normal bir Chrome kimliği kullanıyoruz.
const CHROME_UA = `Mozilla/5.0 (${
  process.platform === 'darwin'
    ? 'Macintosh; Intel Mac OS X 10_15_7'
    : process.platform === 'win32'
      ? 'Windows NT 10.0; Win64; x64'
      : 'X11; Linux x86_64'
}) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${process.versions.chrome} Safari/537.36`;
app.userAgentFallback = CHROME_UA;

// Uygulamanın adı "Dual Chat"ten "PenguChat"e değişti: girişler ve ayarlar
// kaybolmasın diye eski veri klasörünü kullanmaya devam et.
app.setPath('userData', path.join(app.getPath('appData'), 'Dual Chat'));

// Giriş yapılan oturumlar (Twitch + Kick) bu partition'da kalıcı olarak saklanır.
const PARTITION = 'persist:dualchat';

// Uygulama içinde açılmasına izin verilen alan adları (giriş pencereleri vb.)
const INTERNAL_HOSTS = [
  'twitch.tv',
  'kick.com',
  'id.twitch.tv',
  'passport.twitch.tv',
  'accounts.google.com',
  'appleid.apple.com',
  'challenges.cloudflare.com',
];

function isInternal(url) {
  try {
    const u = new URL(url);
    if (u.protocol !== 'https:') return false; // şifresiz bağlantıda giriş yapılmasın
    const host = u.hostname;
    return INTERNAL_HOSTS.some((h) => host === h || host.endsWith('.' + h));
  } catch {
    return false;
  }
}

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 800,
    minWidth: 480,
    minHeight: 360,
    backgroundColor: '#0a6b67',
    title: 'PengusChat — Twitch + Kick',
    icon: path.join(__dirname, 'icon.png'),
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true, // 🔒 sayfa bilgisayara doğrudan erişemez
      webviewTag: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

// Webview'ler (chat panelleri) için güvenlik + pencere açma davranışı
app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() === 'webview') {
    contents.setUserAgent(CHROME_UA);
    // Kullanıcı kartı gibi pencereler dar panelde taşmasın
    contents.on('dom-ready', () => {
      contents.executeJavaScript(FIT_POPUPS_JS).catch(() => {});
      contents.executeJavaScript(PICK_USER_JS).catch(() => {});
    });

    guardNavigation(contents);
    contents.setWindowOpenHandler(({ url }) => {
      if (isInternal(url)) {
        // Giriş / kullanıcı kartı gibi pencereler aynı oturumla uygulama içinde açılır
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 520,
            height: 720,
            autoHideMenuBar: true,
            backgroundColor: '#0a6b67',
            webPreferences: { partition: PARTITION },
          },
        };
      }
      shell.openExternal(url);
      return { action: 'deny' };
    });
  }
});

// 🔒 Hesap güvenliği: chat panelleri ve giriş pencereleri (adres çubuğu yok) sadece Twitch / Kick /
// giriş sayfalarını açabilir. Başka bir siteye gidilmek istenirse uygulamada değil tarayıcıda açılır;
// böylece uygulamanın içinde sahte bir "giriş yap" sayfası gösterilemez.
function guardNavigation(contents) {
  const block = (e, url) => {
    if (isInternal(url) || /^(about:blank|data:|blob:)/.test(url)) return;
    e.preventDefault();
    if (/^https?:/.test(url)) shell.openExternal(url);
  };
  contents.on('will-navigate', block);
  contents.on('will-redirect', (e, url, _inPlace, isMainFrame) => { if (isMainFrame) block(e, url); });
}
app.on('web-contents-created', (_e, contents) => {
  // Uygulama içi giriş pencereleri (webview'den açılan) de aynı korumayı alsın
  if (contents.getType() === 'window' && contents.session === session.fromPartition(PARTITION)) guardNavigation(contents);
});
app.whenReady().then(() => {
  // Chat sayfaları kamera / mikrofon / konum / bildirim isteyemesin
  session.fromPartition(PARTITION).setPermissionRequestHandler((_wc, permission, cb) => cb(permission === 'clipboard-sanitized-write'));
});

// Webview'lerin güvenli ayarlarla oluşturulmasını garanti et
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (_ev, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
    webPreferences.sandbox = true;
    webPreferences.webSecurity = true;
    params.partition = PARTITION;
  });
});

ipcMain.handle('set-always-on-top', (_e, value) => {
  if (!mainWindow) return false;
  mainWindow.setAlwaysOnTop(!!value, 'floating');
  return mainWindow.isAlwaysOnTop();
});

ipcMain.handle('set-opacity', (_e, value) => {
  if (!mainWindow) return;
  const v = Math.min(1, Math.max(0.3, Number(value) || 1));
  mainWindow.setOpacity(v);
});

ipcMain.handle('open-external', (_e, url) => {
  if (typeof url === 'string' && /^https:\/\//.test(url)) shell.openExternal(url);
});

// Pencere içi kutulara (sorun bildir vb.) klavye odağını geri ver: Windows'ta bir chat paneli
// odaktayken açılan kutulara yazılamayabiliyor.
ipcMain.handle('focus-host', () => {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  // Windows'ta odak bazen chat panelinde (webview) takılı kalıyor: pencereyi ve ana sayfayı yeniden odakla
  if (!mainWindow.isFocused()) mainWindow.focus();
  mainWindow.webContents.focus();
});

// Chat paneline tıklanınca klavyeyi gerçekten o panele ver. Windows'ta kutu seçili görünüp
// yazılanlar gitmeyebiliyor (özellikle bir pencere açılıp kapandıktan sonra).
let lastGuestFocus = 0;
ipcMain.handle('focus-guest', (_e, id) => {
  if (Date.now() - lastGuestFocus < 300) return; // odak olayları birbirini tetiklemesin
  lastGuestFocus = Date.now();
  const wc = webContents.fromId(id);
  if (!wc || wc.isDestroyed() || !mainWindow || wc.hostWebContents !== mainWindow.webContents) return;
  if (!mainWindow.isFocused()) mainWindow.focus();
  wc.focus();
});

ipcMain.handle('logout-all', async () => {
  await session.fromPartition(PARTITION).clearStorageData();
});

// ---------- Güncelleme ----------
const RELEASE_BASE = 'https://github.com/Hasantunaozdmr/PenguChat/releases/latest/download';
const IS_PORTABLE = !!process.env.PORTABLE_EXECUTABLE_DIR;
let updateState = { state: 'idle', current: app.getVersion() };

function sendUpdate(patch) {
  updateState = { ...updateState, ...patch };
  if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('update-status', updateState);
}

function newer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

let autoUpdater = null;
function setupAutoUpdater() {
  if (IS_PORTABLE || !app.isPackaged) return;
  try {
    ({ autoUpdater } = require('electron-updater'));
  } catch {
    return;
  }
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on('checking-for-update', () => sendUpdate({ state: 'checking' }));
  autoUpdater.on('update-available', (i) => sendUpdate({ state: 'downloading', version: i.version, percent: 0 }));
  autoUpdater.on('update-not-available', () => sendUpdate({ state: 'latest' }));
  autoUpdater.on('download-progress', (p) => sendUpdate({ state: 'downloading', percent: Math.round(p.percent) }));
  autoUpdater.on('update-downloaded', (i) => sendUpdate({ state: 'ready', version: i.version }));
  autoUpdater.on('error', (e) => sendUpdate({ state: 'error', message: String(e?.message || e) }));
}

async function checkForUpdates() {
  if (!app.isPackaged) return sendUpdate({ state: 'latest' });
  if (autoUpdater) {
    if (updateState.state === 'downloading' || updateState.state === 'ready') return;
    return autoUpdater.checkForUpdates().catch((e) => sendUpdate({ state: 'error', message: String(e?.message || e) }));
  }
  // Kurulumsuz (portable) sürüm kendini değiştiremez: yeni sürüm varsa indirme linki gösterilir
  try {
    sendUpdate({ state: 'checking' });
    const res = await net.fetch(`${RELEASE_BASE}/latest.yml`, { cache: 'no-store' });
    const text = await res.text();
    const version = (text.match(/^version:\s*['"]?([\d.]+)/m) || [])[1];
    if (version && newer(version, app.getVersion())) sendUpdate({ state: 'portable-available', version });
    else sendUpdate({ state: 'latest' });
  } catch (e) {
    sendUpdate({ state: 'error', message: String(e?.message || e) });
  }
}

// ---------- Yayın gecikmesi ölçümü ----------
// Her iki platformun canlı HLS listesindeki en son parçanın çekim zamanı (PROGRAM-DATE-TIME)
// karşılaştırılır. Bilgisayar saati iki tarafı aynı etkilediği için fark saatten bağımsızdır.
const TWITCH_CLIENT_ID = 'kimne78kx3ncx6brgo4mv6wki5h1ko'; // twitch.tv sitesinin herkese açık istemci kimliği

async function fetchText(url, opts) {
  const res = await net.fetch(url, { cache: 'no-store', ...opts });
  if (!res.ok) throw new Error('HTTP ' + res.status);
  return res.text();
}

// Ana listeden ilk (en yüksek) kalitenin medya listesini bulur
function firstVariant(master, base) {
  const lines = master.split('\n').map((l) => l.trim());
  const i = lines.findIndex((l) => l.startsWith('#EXT-X-STREAM-INF'));
  if (i < 0) return null;
  const uri = lines.slice(i + 1).find((l) => l && !l.startsWith('#'));
  return uri ? new URL(uri, base).toString() : null;
}

// Medya listesindeki son tam parçanın bitiş zamanı (ms)
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
      pdt += dur; // PDT her parçada yazmıyorsa sonrakini tahmin et
    }
  }
  return edge;
}

// ---- Saat düzeltmesi ----
// Ölçüm "şimdi − parçanın saati"dir; bilgisayar saati birkaç sn kaymışsa sonuç da kayar
// (geri kalan saat 0 sn gösterir). Bu yüzden saat Supabase sunucusundan alınır ve fark düzeltilir.
let clockOffset = 0; // sunucu saati − bilgisayar saati (ms)
let clockSource = 'bilgisayar';
let clockNext = 0;
async function syncClock() {
  if (Date.now() < clockNext) return;
  clockNext = Date.now() + 10 * 60 * 1000; // 10 dk'da bir yenile
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
    tries.sort((a, b) => a.rtt - b.rtt); // en hızlı cevap en doğrusu
    clockOffset = tries[0].off;
    clockSource = 'sunucu';
    return;
  }
  // Yedek: sunucunun cevabındaki "Date" başlığı (1 sn hassasiyet)
  try {
    const t0 = Date.now();
    const res = await net.fetch(`${REPORT_API.url}/rest/v1/`, { method: 'HEAD', cache: 'no-store', headers: { apikey: REPORT_API.key } });
    const t1 = Date.now();
    const d = Date.parse(res.headers.get('date') || '');
    if (!d) throw new Error('tarih yok');
    clockOffset = d + 500 - (t0 + t1) / 2;
    clockSource = 'sunucu (yaklaşık)';
  } catch {
    clockNext = Date.now() + 60 * 1000; // internet yoksa 1 dk sonra yine dene
  }
}
const trueNow = () => Date.now() + clockOffset;

// Her platform için: medya listesinin adresi (birkaç dakika geçerli) ve son ölçümler
const SAMPLE_WINDOW_MS = 20000;
const delayState = {
  twitch: { key: null, mediaUrl: null, mediaAt: 0, samples: [] },
  kick: { key: null, mediaUrl: null, mediaAt: 0, samples: [] },
};

async function resolveMediaUrl(masterUrl) {
  const master = await fetchText(masterUrl);
  if (master.includes('#EXTINF')) return masterUrl;
  const mediaUrl = firstVariant(master, masterUrl);
  if (!mediaUrl) throw new Error('liste yok');
  return mediaUrl;
}

// Canlı ucun ne kadar geride olduğunu (ms) ölçer ve son 20 sn'nin en küçüğünü döner.
// Liste 2 sn'lik parçalarla güncellendiği için tek ölçüm 0-2 sn zıplar; en küçük değer
// "parça tam yayınlandığı an"a denk gelir ve iki platform için de aynı anlamı taşır.
async function sampleLag(p, key, getMasterUrl) {
  const st = delayState[p];
  if (st.key !== key) Object.assign(st, { key, mediaUrl: null, mediaAt: 0, samples: [] });
  if (!st.mediaUrl || Date.now() - st.mediaAt > 4 * 60 * 1000) {
    st.mediaUrl = await resolveMediaUrl(await getMasterUrl());
    st.mediaAt = Date.now();
  }
  let media;
  try {
    media = await fetchText(st.mediaUrl);
  } catch (e) {
    st.mediaUrl = null; // adres süresi dolmuş olabilir, sonraki ölçümde yenile
    throw e;
  }
  const edge = liveEdgeTime(media);
  if (!edge) throw new Error('zaman bilgisi yok');
  const now = Date.now();
  st.samples.push({ t: now, lag: trueNow() - edge });
  st.samples = st.samples.filter((x) => now - x.t <= SAMPLE_WINDOW_MS);
  return { lag: Math.min(...st.samples.map((x) => x.lag)), n: st.samples.length };
}

async function twitchMasterUrl(channel) {
  const body = {
    operationName: 'PlaybackAccessToken_Template',
    query:
      'query PlaybackAccessToken_Template($login: String!, $isLive: Boolean!, $vodID: ID!, $isVod: Boolean!, $playerType: String!) {  streamPlaybackAccessToken(channelName: $login, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isLive) {    value    signature   __typename  }  videoPlaybackAccessToken(id: $vodID, params: {platform: "web", playerBackend: "mediaplayer", playerType: $playerType}) @include(if: $isVod) {    value    signature   __typename  }}',
    variables: { isLive: true, login: channel, isVod: false, vodID: '', playerType: 'site' },
  };
  const res = await net.fetch('https://gql.twitch.tv/gql', {
    method: 'POST',
    headers: { 'Client-ID': TWITCH_CLIENT_ID, 'Content-Type': 'text/plain;charset=UTF-8' },
    body: JSON.stringify(body),
  });
  const json = await res.json();
  const tok = json?.data?.streamPlaybackAccessToken;
  if (!tok) throw new Error('token yok');
  const q = new URLSearchParams({
    sig: tok.signature,
    token: tok.value,
    allow_source: 'true',
    fast_bread: 'true',
    p: String(Math.floor(Math.random() * 1e6)),
  });
  return `https://usher.ttvnw.net/api/channel/hls/${encodeURIComponent(channel)}.m3u8?${q}`;
}

ipcMain.handle('measure-delay', async (_e, { twitch, kick, kickPlaybackUrl }) => {
  await syncClock().catch(() => {});
  const out = { twitch: null, kick: null, n: { twitch: 0, kick: 0 }, errors: {}, clock: { offset: clockOffset, source: clockSource } };
  await Promise.all([
    (async () => {
      try {
        if (!twitch) throw new Error('kanal yok');
        const r = await sampleLag('twitch', twitch, () => twitchMasterUrl(twitch));
        out.twitch = r.lag;
        out.n.twitch = r.n;
      } catch (e) {
        delayState.twitch.samples = [];
        out.errors.twitch = String(e.message || e);
      }
    })(),
    (async () => {
      try {
        if (!kickPlaybackUrl) throw new Error('yayın kapalı');
        const r = await sampleLag('kick', kick, async () => kickPlaybackUrl);
        out.kick = r.lag;
        out.n.kick = r.n;
      } catch (e) {
        delayState.kick.samples = [];
        out.errors.kick = String(e.message || e);
      }
    })(),
  ]);
  return out;
});

// ---------- Sorun bildir ----------
// Supabase projesi. Anahtar herkese açık "anon" anahtarı; gelen sorunlar
// yalnızca yönetici şifresiyle okunabilir (şifre sunucuda kontrol edilir).
const REPORT_API = {
  url: process.env.PENGU_REPORT_URL || 'https://squocugdzebbfovvibmq.supabase.co',
  key: process.env.PENGU_REPORT_KEY || 'sb_publishable_vn8KFF_4jSrzvIa9jPNUIw_YC4dtKjq',
};

async function reportRpc(fn, args) {
  if (!/^https?:\/\//.test(REPORT_API.url)) throw new Error('Sorun bildirme henüz ayarlanmadı');
  const res = await net.fetch(`${REPORT_API.url}/rest/v1/rpc/${fn}`, {
    method: 'POST',
    headers: {
      apikey: REPORT_API.key,
      Authorization: `Bearer ${REPORT_API.key}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(args),
  });
  const text = await res.text();
  if (!res.ok) {
    if (/yetkisiz/.test(text)) throw new Error('Şifre yanlış');
    throw new Error(`Sunucu hatası (${res.status})`);
  }
  return text ? JSON.parse(text) : null;
}

function reportHandler(fn) {
  return async (...a) => {
    try {
      return { ok: true, data: await fn(...a) };
    } catch (e) {
      return { ok: false, error: String((e && e.message) || e) };
    }
  };
}

// Cihaz: Windows 10 / 11 + sürüm (istatistikte görünür). Windows 11'in iç sürümü de 10.0 başlar; 22000 ve sonrası 11'dir.
function deviceName() {
  const v = process.getSystemVersion ? process.getSystemVersion() : '';
  if (process.platform !== 'win32') return `${process.platform} ${v}`.trim().slice(0, 30);
  const build = Number(v.split('.')[2]) || 0;
  return `windows · Windows ${build >= 22000 ? 11 : 10} (${build})`.slice(0, 30);
}

ipcMain.handle('report-send', reportHandler(async (_e, { message, contact, token }) => {
  const args = {
    p_message: String(message || '').slice(0, 2000),
    p_contact: String(contact || '').slice(0, 100),
    p_version: app.getVersion(),
    p_platform: deviceName(),
  };
  try {
    return await reportRpc('submit_report', { ...args, p_token: String(token || '') });
  } catch (e) {
    // Sunucu eski kurulumdaysa (durum takibi yok) tokensız gönder
    if (/\(404\)/.test(String(e.message))) return reportRpc('submit_report', args);
    throw e;
  }
}));
ipcMain.handle('report-mine', reportHandler((_e, token) => reportRpc('my_reports', { p_token: String(token || '') })));
ipcMain.handle('report-set-status', reportHandler((_e, { password, id, status, note }) =>
  reportRpc('set_report_status', { p_password: String(password || ''), p_id: Number(id), p_status: String(status), p_note: String(note || '').slice(0, 1000) })));
ipcMain.handle('report-log', reportHandler((_e, password) => reportRpc('get_log', { p_password: String(password || '') })));
ipcMain.handle('report-stats', reportHandler((_e, password) => reportRpc('get_stats', { p_password: String(password || '') })));
// Yetki sistemi: yalnızca bu fonksiyonlar çağrılabilir
const ROLE_FNS = ['app_status', 'set_maintenance', 'set_announcement', 'target_record', 'log_error', 'get_errors', 'clear_errors', 'my_roles', 'list_roles', 'set_role', 'role_mod_log', 'role_reports', 'role_set_status', 'role_stats'];
ipcMain.handle('rpc', reportHandler((_e, { fn, args }) => {
  if (!ROLE_FNS.includes(fn)) throw new Error('izin yok');
  return reportRpc(fn, args || {});
}));
ipcMain.handle('report-modlog', reportHandler((_e, password) => reportRpc('get_mod_log', { p_password: String(password || '') })));
ipcMain.handle('mod-action', reportHandler((_e, a) =>
  reportRpc('log_mod_action', {
    p_client: String(a.client || ''),
    p_mod_twitch: String(a.twitch || '').slice(0, 40),
    p_mod_kick: String(a.kick || '').slice(0, 40),
    p_platform: String(a.platform),
    p_action: String(a.action),
    p_target: String(a.target || '').slice(0, 40),
    p_secs: a.secs ? Number(a.secs) : null,
    p_ok: !!a.ok,
  })));
ipcMain.handle('ping', reportHandler((_e, { id, mod, twitch, kick }) =>
  reportRpc('ping', {
    p_id: String(id || ''),
    p_platform: deviceName(),
    p_version: app.getVersion(),
    p_mod: !!mod,
    p_twitch: String(twitch || '').slice(0, 40),
    p_kick: String(kick || '').slice(0, 40),
  })));
ipcMain.handle('report-is-admin', reportHandler((_e, password) => reportRpc('is_admin', { p_password: String(password || '') })));
ipcMain.handle('report-list', reportHandler((_e, password) => reportRpc('get_reports', { p_password: String(password || '') })));
ipcMain.handle('report-delete', reportHandler((_e, { password, id }) =>
  reportRpc('delete_report', { p_password: String(password || ''), p_id: Number(id) })));

// Sonuç (autoUpdater'ın döndürdüğü nesne) pencereye gönderilemiyor: sadece başlat, durum ayrıca bildirilir
ipcMain.handle('update-check', () => {
  Promise.resolve().then(checkForUpdates).catch(() => {});
});
ipcMain.handle('update-status', () => updateState);
ipcMain.handle('update-install', () => {
  if (updateState.state === 'ready' && autoUpdater) {
    autoUpdater.quitAndInstall(true, true);
  } else if (updateState.state === 'portable-available') {
    shell.openExternal(`${RELEASE_BASE}/PenguChat-Setup.exe`);
  }
});

app.whenReady().then(() => {
  createWindow();
  setupAutoUpdater();
  mainWindow.webContents.once('did-finish-load', () => {
    setTimeout(checkForUpdates, 3000);
  });
  setInterval(checkForUpdates, 30 * 60 * 1000);
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});
