const { app, BrowserWindow, ipcMain, shell, session, net } = require('electron');
const path = require('path');

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
    const host = new URL(url).hostname;
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
    backgroundColor: '#0e0e10',
    title: 'Dual Chat — Twitch + Kick',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      webviewTag: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'index.html'));
}

// Webview'ler (chat panelleri) için güvenlik + pencere açma davranışı
app.on('web-contents-created', (_e, contents) => {
  if (contents.getType() === 'webview') {
    contents.setUserAgent(CHROME_UA);

    contents.setWindowOpenHandler(({ url }) => {
      if (isInternal(url)) {
        // Giriş / kullanıcı kartı gibi pencereler aynı oturumla uygulama içinde açılır
        return {
          action: 'allow',
          overrideBrowserWindowOptions: {
            width: 520,
            height: 720,
            autoHideMenuBar: true,
            backgroundColor: '#0e0e10',
            webPreferences: { partition: PARTITION },
          },
        };
      }
      shell.openExternal(url);
      return { action: 'deny' };
    });
  }
});

// Webview'lerin güvenli ayarlarla oluşturulmasını garanti et
app.on('web-contents-created', (_e, contents) => {
  contents.on('will-attach-webview', (_ev, webPreferences, params) => {
    delete webPreferences.preload;
    webPreferences.nodeIntegration = false;
    webPreferences.contextIsolation = true;
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

ipcMain.handle('logout-all', async () => {
  await session.fromPartition(PARTITION).clearStorageData();
});

// ---------- Güncelleme ----------
const RELEASE_BASE = 'https://github.com/Hasantunaozdmr/Canzade-ToastyStat/releases/latest/download';
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

ipcMain.handle('update-check', () => checkForUpdates());
ipcMain.handle('update-status', () => updateState);
ipcMain.handle('update-install', () => {
  if (updateState.state === 'ready' && autoUpdater) {
    autoUpdater.quitAndInstall(true, true);
  } else if (updateState.state === 'portable-available') {
    shell.openExternal(`${RELEASE_BASE}/DualChat-Portable.exe`);
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
