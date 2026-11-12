import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, SafeAreaView } from 'react-native-safe-area-context';
import { WebView } from 'react-native-webview';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Clipboard from 'expo-clipboard';
import Constants from 'expo-constants';
import { PLATFORMS, cleanChannel, hasLink, isInternalUrl, parseTargets } from './src/links';
import { FIT_POPUPS_JS, PICK_USER_JS } from './src/injected';
import ReportModal, { countNew, hasMineNews, loadAdmin, storeAdmin } from './src/ReportModal';
import { OWNER_ACCOUNTS, logError, logModAction, reportRpc, sendPing } from './src/report';
import { measureDelay } from './src/delay';

// Cihaz: işletim sistemi + model (giriş yapmayan kullanıcıyı istatistikte tanımak için). Örn: "android 14 · SM-A546B"
const DEVICE = (() => {
  const c = Platform.constants || {};
  const model = Platform.OS === 'android' ? String(c.Model || '').trim() : Platform.OS === 'ios' ? String(c.interfaceIdiom === 'pad' ? 'iPad' : 'iPhone') : '';
  return `${Platform.OS} ${Platform.Version}${model ? ' · ' + model : ''}`.slice(0, 30);
})();

const STORE_KEY = 'dualchat:settings';
const RELEASE_BASE = 'https://github.com/Hasantunaozdmr/PenguChat/releases/latest/download';
const APP_VERSION = Constants.expoConfig?.version || '0.0.0';

function isNewer(a, b) {
  const pa = String(a).split('.').map(Number);
  const pb = String(b).split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) > (pb[i] || 0);
  }
  return false;
}

// En son sürümü Releases sayfasındaki latest.yml'den okur
async function fetchLatestVersion() {
  const res = await fetch(`${RELEASE_BASE}/latest.yml?t=${Date.now()}`);
  if (!res.ok) return null;
  const text = await res.text();
  return (text.match(/^version:\s*['"]?([\d.]+)/m) || [])[1] || null;
}
const KEYS = ['twitch', 'kick'];

const DEFAULTS = {
  twitch: '',
  kick: '',
  layout: 'split', // split = iki chat aynı ekranda, tabs = sekmeli
  tab: 'twitch',
  zoom: { twitch: 1, kick: 1 },
  timeoutSecs: 0,
};

// Chat sayfalarının telefonda mobil siteye yönlenmemesi için masaüstü tarayıcı kimliği.
// (Kendi motoruyla uyumlu olsun diye iOS'ta Safari, Android'de Chrome.)
// Android'de Chrome sürümü telefonun gerçek WebView sürümünden alınır: sabit eski bir sürüm yazmak
// Twitch / Kick'in bot korumasına takılıyor ("çok fazla giriş denemesi", "veri yüklenemedi").
const desktopChromeUa = (ver) => `Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${ver} Safari/537.36`;
let USER_AGENT =
  Platform.OS === 'ios'
    ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
    : desktopChromeUa('130.0.0.0');
// Telefonun WebView kimliğini okuyan görünmez sayfa
const UA_PROBE_HTML = '<html><body><script>window.ReactNativeWebView.postMessage(navigator.userAgent)</script></body></html>';

// Masaüstü sayfası telefon ekranına sığsın (aksi halde yazılar minicik görünür)
const VIEWPORT_JS = `
(function () {
  function fix() {
    var m = document.querySelector('meta[name=viewport]');
    if (!m) { m = document.createElement('meta'); m.name = 'viewport'; (document.head || document.documentElement).appendChild(m); }
    m.content = 'width=device-width, initial-scale=1, maximum-scale=1';
  }
  fix();
  document.addEventListener('DOMContentLoaded', fix);
})();
true;
`;
const zoomJs = (z) =>
  `document.documentElement.style.zoom = '${z}'; true;`;

export default function App() {
  return (
    <SafeAreaProvider>
      <StatusBar style="light" />
      <SafeAreaView style={styles.root} edges={['top', 'bottom', 'left', 'right']}>
        <PenguChat />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function PenguChat() {
  const [s, setS] = useState(DEFAULTS);
  const [ready, setReady] = useState(false);
  // Android: chat'ler, telefonun gerçek Chrome sürümü öğrenildikten sonra açılır (en fazla 2,5 sn beklenir)
  const [uaReady, setUaReady] = useState(Platform.OS !== 'android');
  useEffect(() => {
    if (uaReady) return;
    const t = setTimeout(() => setUaReady(true), 2500);
    return () => clearTimeout(t);
  }, [uaReady]);
  const uaProbe = !uaReady && (
    <View style={{ width: 1, height: 1, position: 'absolute', opacity: 0 }} pointerEvents="none">
      <WebView
        source={{ html: UA_PROBE_HTML }}
        onMessage={(e) => {
          const m = String(e.nativeEvent.data || '').match(/Chrome\/(\d+\.\d+\.\d+\.\d+)/);
          if (m) USER_AGENT = desktopChromeUa(m[1]);
          setUaReady(true);
        }}
      />
    </View>
  );
  const [link, setLink] = useState('');
  const [hint, setHint] = useState(null);
  const hintTimer = useRef(null);
  // Her panelin o an açık adresi (chat veya giriş sayfası)
  const [urls, setUrls] = useState({ twitch: null, kick: null });
  const views = useRef({ twitch: null, kick: null });

  const { width, height } = useWindowDimensions();
  const landscape = width > height;

  // ---- Güncelleme kontrolü (Android: yeni APK indirilir) ----
  const [newVersion, setNewVersion] = useState(null);
  const [reportMode, setReportMode] = useState(null); // null | 'report' | 'inbox'
  const [admin, setAdmin] = useState(''); // yönetici şifresi (yalnızca senin cihazında dolu)
  const [newReports, setNewReports] = useState(0);
  const [mineNews, setMineNews] = useState(false); // gönderdiğim soruna cevap geldi mi
  useEffect(() => {
    const check = () => hasMineNews().then(setMineNews);
    const first = setTimeout(check, 4000);
    const t = setInterval(check, 5 * 60 * 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);
  const [ownerOn, setOwnerOn] = useState({ twitch: false, kick: false }); // sahibin hesabıyla girilmiş mi
  const [accounts, setAccounts] = useState({ twitch: '', kick: '' }); // giriş yapılmış hesap adları
  // Uygulama içi yetkiler (📥 → 👥 Yetkiler'den verilir; giriş yapılan Twitch/Kick adına göre)
  const [roles, setRoles] = useState({ modlog: false, reports: false, stats: false });
  const anyRole = roles.modlog || roles.reports || roles.stats;
  // Bakım modu: açıkken uygulama herkese kapalı; yönetici (şifre ya da kendi hesabı) kullanmaya devam eder
  // ---- Otomatik hata kaydı ----
  const reportErrorRef = useRef(null);
  reportErrorRef.current = (kind, detail) =>
    logError({
      p_platform: DEVICE,
      p_version: APP_VERSION,
      p_account: [accounts.twitch && 'Twitch: ' + accounts.twitch, accounts.kick && 'Kick: ' + accounts.kick].filter(Boolean).join(' · '),
      p_kind: kind,
      p_detail: detail,
    });
  const reportError = (kind, detail) => reportErrorRef.current(kind, detail);
  useEffect(() => {
    const EU = global.ErrorUtils;
    if (!EU || !EU.setGlobalHandler) return;
    const prev = EU.getGlobalHandler && EU.getGlobalHandler();
    EU.setGlobalHandler((err, fatal) => {
      reportErrorRef.current(fatal ? 'uygulama-coktu' : 'uygulama', String((err && (err.stack || err.message)) || err).slice(0, 400));
      prev && prev(err, fatal);
    });
  }, []);
  // ---- 📢 Duyuru ----
  const [ann, setAnn] = useState({ text: '', at: '', seen: '' });
  useEffect(() => {
    AsyncStorage.getItem('penguchat:annSeen').then((v) => v && setAnn((a) => ({ ...a, seen: v }))).catch(() => {});
  }, []);
  const [maint, setMaint] = useState({ maintenance: false, message: '', eta: '' });
  useEffect(() => {
    const check = () =>
      reportRpc('app_status', {})
        .then((r) => {
          if (!r) return;
          setMaint({ maintenance: !!r.maintenance, message: r.message || '', eta: r.eta || '' });
          setAnn((a) => ({ ...a, text: r.announcement || '', at: r.announcement_at || '' }));
        })
        .catch(() => {}); // sunucuya ulaşılamazsa son bilinen durum kalır
    check();
    const t = setInterval(check, 30 * 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (!accounts.twitch && !accounts.kick) return setRoles({ modlog: false, reports: false, stats: false });
    reportRpc('my_roles', { p_twitch: accounts.twitch, p_kick: accounts.kick })
      .then((r) => r && setRoles({ modlog: !!r.modlog, reports: !!r.reports, stats: !!r.stats }))
      .catch(() => {});
  }, [accounts.twitch, accounts.kick]);
  const [viewers, setViewers] = useState({ twitch: undefined, kick: undefined }); // yayın izleyici sayısı (null = kapalı)
  const [cats, setCats] = useState({ twitch: '', kick: '' }); // yayının şu anki kategorisi (oyun / Just Chatting)
  useEffect(() => {
    loadAdmin().then(setAdmin);
  }, []);
  useEffect(() => {
    if (!admin) return setNewReports(0);
    const check = () => countNew(admin).then(setNewReports);
    check();
    const t = setInterval(check, 5 * 60 * 1000);
    return () => clearInterval(t);
  }, [admin]);
  const changeAdmin = (v) => {
    storeAdmin(v);
    setAdmin(v);
  };
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    const check = () =>
      fetchLatestVersion()
        .then((v) => v && isNewer(v, APP_VERSION) && setNewVersion(v))
        .catch(() => {});
    check();
    const t = setInterval(check, 30 * 60 * 1000);
    return () => clearInterval(t);
  }, []);

  // ---- Ayarları yükle / kaydet ----
  useEffect(() => {
    AsyncStorage.getItem(STORE_KEY)
      .then((raw) => {
        const saved = raw ? JSON.parse(raw) : {};
        // Timeout süresi her açılışta 0'dan başlar (süreyi mod kendisi yazar)
        const next = { ...DEFAULTS, ...saved, timeoutSecs: 0, zoom: { ...DEFAULTS.zoom, ...(saved.zoom || {}) } };
        setS(next);
        setUrls({
          twitch: next.twitch ? PLATFORMS.twitch.chatUrl(next.twitch) : null,
          kick: next.kick ? PLATFORMS.kick.chatUrl(next.kick) : null,
        });
      })
      .catch(() => {})
      .finally(() => setReady(true));
  }, []);

  const update = useCallback((patch) => {
    setS((prev) => {
      const next = typeof patch === 'function' ? patch(prev) : { ...prev, ...patch };
      AsyncStorage.setItem(STORE_KEY, JSON.stringify(next)).catch(() => {});
      return next;
    });
  }, []);

  const showHint = (text, ok = true) => {
    setHint({ text, ok });
    clearTimeout(hintTimer.current);
    hintTimer.current = setTimeout(() => setHint(null), 3000);
  };

  // ---- Link çubuğu ----
  const applyText = (text) => {
    const targets = parseTargets(text);
    const keys = Object.keys(targets);
    if (!keys.length) {
      showHint('Link anlaşılamadı', false);
      return;
    }
    update((prev) => {
      const next = { ...prev };
      keys.forEach((k) => (next[k] = targets[k]));
      if (prev.layout === 'tabs' && keys.length === 1) next.tab = keys[0];
      return next;
    });
    const nextUrls = { ...urls };
    keys.forEach((k) => {
      const url = PLATFORMS[k].chatUrl(targets[k]);
      // Aynı kanal tekrar yapıştırıldıysa sadece yenile
      if (urls[k] === url) views.current[k]?.reload();
      nextUrls[k] = url;
    });
    setUrls(nextUrls);
    showHint(keys.map((k) => `${PLATFORMS[k].label}: ${targets[k]}`).join(' · ') + ' açıldı');
    setLink('');
  };

  const onChangeLink = (text) => {
    setLink(text);
    // Link yapıştırılınca Enter'a basmadan otomatik aç
    if (hasLink(text) && text.length - link.length > 3) applyText(text);
  };

  const pasteFromClipboard = async () => {
    const text = await Clipboard.getStringAsync().catch(() => '');
    if (!text) return showHint('Panoda link yok', false);
    applyText(text);
  };

  // ---- Panel işlemleri ----
  const paneAction = (k, act) => {
    const wv = views.current[k];
    if (act === 'chat') {
      if (!s[k]) return;
      const url = PLATFORMS[k].chatUrl(s[k]);
      if (urls[k] === url) wv?.reload();
      else setUrls((p) => ({ ...p, [k]: url }));
    } else if (act === 'zoom-in' || act === 'zoom-out') {
      const z = Math.round(Math.min(2, Math.max(0.6, s.zoom[k] + (act === 'zoom-in' ? 0.1 : -0.1))) * 10) / 10;
      update((prev) => ({ ...prev, zoom: { ...prev.zoom, [k]: z } }));
      wv?.injectJavaScript(zoomJs(z));
      showHint(`${PLATFORMS[k].label} yazı boyutu %${Math.round(z * 100)}`);
    }
  };

  // ---- Hızlı ceza çubuğu ----
  // Chat'te bir ada dokununca kullanıcı seçilir, ⏱ / ⛔ ile komut o chat'e yazılıp gönderilir
  const [mod, setMod] = useState({ open: false, user: '', twitch: false, kick: false });
  const [secsText, setSecsText] = useState(null);
  // ---- Kişinin sicili: bu uygulamadan kaç timeout / ban yemiş ----
  const [record, setRecord] = useState(null);
  const recTimer = useRef(null);
  const recFor = useRef('');
  const loadRecord = (name) => {
    const user = cleanChannel(name || '');
    recFor.current = user;
    if (!user) return setRecord(null);
    reportRpc('target_record', { p_target: user })
      .then((r) => recFor.current === user && setRecord(r || null))
      .catch(() => setRecord(null));
  };
  const pending = useRef({});

  // ---- İzleyici / mod modu ----
  // 'pending' (bakılıyor), 'mod', 'viewer' (normal izleyici), 'unknown' (anlaşılamadı)
  const [modStatus, setModStatus] = useState({ twitch: 'pending', kick: 'pending' });
  const canMod = (k) => !!s[k] && (modStatus[k] === 'mod' || modStatus[k] === 'unknown');
  const anyModAccess = canMod('twitch') || canMod('kick');

  // ---- ⏱ Yayın gecikmesi (sadece modlara) ----
  const [delay, setDelay] = useState({ twitch: null, kick: null });
  const kickPb = useRef({ slug: null, url: null, at: 0, asked: 0 });
  const delayCtx = useRef(null);
  delayCtx.current = { twitch: canMod('twitch') ? s.twitch : null, kick: canMod('kick') ? s.kick : null };
  useEffect(() => {
    let stop = false;
    let timer = null;
    const loop = async () => {
      const c = delayCtx.current;
      if (c.twitch || c.kick) {
        // Kick yayın adresi 4 dk geçerli; sayfanın içinden istenir (cevap __PENGU_KPB__ ile gelir)
        const kp = kickPb.current;
        if (c.kick && (kp.slug !== c.kick || Date.now() - kp.at > 4 * 60 * 1000) && Date.now() - kp.asked > 10000) {
          kp.asked = Date.now();
          if (kp.slug !== c.kick) Object.assign(kp, { slug: c.kick, url: null, at: 0 });
          views.current.kick?.injectJavaScript(`window.__penguKickPlayback && window.__penguKickPlayback(${JSON.stringify(c.kick)}); true;`);
        }
        try {
          const r = await measureDelay({ twitch: c.twitch, kick: c.kick, kickPlaybackUrl: kp.slug === c.kick ? kp.url : null });
          if (!stop) setDelay(r);
        } catch {}
      } else if (!stop) setDelay({ twitch: null, kick: null });
      if (!stop) timer = setTimeout(loop, 900 + Math.random() * 700);
    };
    loop();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, []);
  // Masaüstündeki gibi: tek etiket, 10 sn'de bir Twitch / Kick arasında değişir, dokununca diğerine geçer
  const [delayShow, setDelayShow] = useState('twitch');
  const flipDelay = useCallback(() => {
    setDelayShow((cur) => {
      const other = cur === 'twitch' ? 'kick' : 'twitch';
      return delayCtx.current[other] ? other : delayCtx.current[cur] ? cur : other;
    });
  }, []);
  useEffect(() => {
    const t = setInterval(flipDelay, 10000);
    return () => clearInterval(t);
  }, [flipDelay]);
  const delayPill = (() => {
    const k = delayCtx.current[delayShow] ? delayShow : delayCtx.current.twitch ? 'twitch' : delayCtx.current.kick ? 'kick' : null;
    const d = k && delay[k];
    if (!d) return null;
    const label = PLATFORMS[k].label;
    const waitingKick = d.err && k === 'kick' && !kickPb.current.url && Date.now() - kickPb.current.asked < 8000;
    if (d.err && !waitingKick) return { text: `⏱ ${label} kapalı / ölçülemedi`, kind: 'muted' };
    if (waitingKick || d.n < 4) return { text: `⏱ ${label} ölçülüyor…`, kind: 'muted' };
    const secs = Math.max(0, Math.round(d.lag / 1000));
    return { text: `⏱ ${label} gecikmesi: ${secs} sn`, kind: secs >= 10 ? 'warn' : 'ok' };
  })();

  const checkMod = (k) => {
    if (!s[k]) return;
    views.current[k]?.injectJavaScript(
      `window.__penguModStatus ? window.__penguModStatus(${JSON.stringify(s[k])}) : window.ReactNativeWebView.postMessage('__PENGU_MOD__{"status":"unknown"}'); true;`
    );
  };
  // Kanal değişince yetkiyi yeniden sor
  useEffect(() => {
    setModStatus((m) => ({ ...m, twitch: 'pending' }));
  }, [urls.twitch]);
  useEffect(() => {
    setModStatus((m) => ({ ...m, kick: 'pending' }));
  }, [urls.kick]);
  // Sonradan modluk verilirse / alınırsa en geç 1 dakikada fark et
  const checkModRef = useRef(checkMod);
  checkModRef.current = checkMod;
  useEffect(() => {
    const t = setInterval(() => KEYS.forEach((k) => checkModRef.current(k)), 60 * 1000);
    return () => clearInterval(t);
  }, []);

  // ---- Yayının izleyici sayısı (herkese açık) ----
  const askViewers = (k) => {
    if (!s[k]) return;
    views.current[k]?.injectJavaScript(`window.__penguViewers && window.__penguViewers(${JSON.stringify(s[k])}); true;`);
  };
  const askViewersRef = useRef(askViewers);
  askViewersRef.current = askViewers;
  useEffect(() => {
    const t = setInterval(() => KEYS.forEach((k) => askViewersRef.current(k)), 30 * 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    setViewers((v) => ({ ...v, twitch: undefined }));
  }, [urls.twitch]);
  useEffect(() => {
    setViewers((v) => ({ ...v, kick: undefined }));
  }, [urls.kick]);

  // ---- Kullanım bilgisi (yalnızca yöneticinin istatistik ekranı için) ----
  const pingRef = useRef(null);
  pingRef.current = () =>
    sendPing({
      p_platform: DEVICE,
      p_version: APP_VERSION,
      p_mod: modStatus.twitch === 'mod' || modStatus.kick === 'mod',
      p_twitch: accounts.twitch,
      p_kick: accounts.kick,
    });
  useEffect(() => {
    const first = setTimeout(() => pingRef.current(), 15 * 1000);
    const t = setInterval(() => pingRef.current(), 5 * 60 * 1000);
    return () => {
      clearTimeout(first);
      clearInterval(t);
    };
  }, []);

  const onWebMessage = (k, data) => {
    if (typeof data !== 'string') return;
    if (data.startsWith('__PENGU_KPB__')) {
      try {
        const { url } = JSON.parse(data.slice(13));
        Object.assign(kickPb.current, { url: url || null, at: url ? Date.now() : 0 });
      } catch {}
      return;
    }
    if (data.startsWith('__PENGU_VIEW__')) {
      try {
        const { n, cat } = JSON.parse(data.slice(14));
        if (n !== -1) {
          setViewers((v) => ({ ...v, [k]: n }));
          setCats((c) => ({ ...c, [k]: n == null ? '' : String(cat || '').slice(0, 40) }));
        }
      } catch {}
      return;
    }
    if (data.startsWith('__PENGU_MOD__')) {
      try {
        const { status, me } = JSON.parse(data.slice(13));
        const isOwner = OWNER_ACCOUNTS[k].includes(String(me || '').toLowerCase());
        setOwnerOn((o) => (o[k] === isOwner ? o : { ...o, [k]: isOwner }));
        const name = String(me || '').slice(0, 40);
        setAccounts((a) => (a[k] === name ? a : { ...a, [k]: name }));
        setModStatus((m) => ({ ...m, [k]: ['mod', 'viewer', 'unknown'].includes(status) ? status : 'unknown' }));
      } catch {}
    } else if (data.startsWith('__PENGU_PICK__')) {
      if (!anyModAccess) return; // izleyici modunda dokunma bir şey yapmaz
      try {
        const { name, restream } = JSON.parse(data.slice(14));
        const p = restream ? 'twitch' : k; // Restream mesajının sahibi Twitch'te
        setMod({ open: true, user: name, twitch: p === 'twitch' && canMod('twitch'), kick: p === 'kick' && canMod('kick'), msgFrom: k });
        loadRecord(name);
      } catch {}
    } else if (data.startsWith('__PENGU_DEL__')) {
      try {
        const r = JSON.parse(data.slice(13));
        pending.current[r.id]?.(r);
        delete pending.current[r.id];
      } catch {}
    } else if (data.startsWith('__PENGU_SENT__')) {
      try {
        const r = JSON.parse(data.slice(14));
        pending.current[r.id]?.(r);
        delete pending.current[r.id];
      } catch {}
    }
  };

  const sendCommand = (k, cmd) =>
    new Promise((resolve) => {
      const wv = views.current[k];
      if (!wv || !s[k]) return resolve({ ok: false, err: 'chat açık değil' });
      const id = `${k}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
      pending.current[id] = resolve;
      setTimeout(() => {
        if (pending.current[id]) {
          delete pending.current[id];
          resolve({ ok: false, err: 'yanıt yok' });
        }
      }, 5000);
      wv.injectJavaScript(
        `window.__penguSendCommand ? window.__penguSendCommand(${JSON.stringify(cmd)}, ${JSON.stringify(id)}) : window.ReactNativeWebView.postMessage('__PENGU_SENT__' + JSON.stringify({ id: ${JSON.stringify(id)}, ok: false, err: 'sayfa hazır değil' })); true;`
      );
    });

  const buildCommand = (k, action, user, secs) => {
    if (action === 'ban') return `/ban ${user}`;
    // Twitch saniye, Kick dakika ister
    if (k === 'twitch') return `/timeout ${user} ${secs}`;
    return `/timeout ${user} ${Math.max(1, Math.ceil(secs / 60))}`;
  };

  const runPunish = async (action, user, list, secs) => {
    const results = [];
    for (const k of list) {
      const r = await sendCommand(k, buildCommand(k, action, user, secs));
      logModAction({
        p_mod_twitch: accounts.twitch,
        p_mod_kick: accounts.kick,
        p_platform: k,
        p_action: action,
        p_target: user,
        p_secs: action === 'timeout' ? secs : null,
        p_ok: !!r.ok,
      });
      if (!r.ok) reportError('komut-gitmedi', `${PLATFORMS[k].label} ${action}: ${r.err}`);
      results.push(`${PLATFORMS[k].label} ${r.ok ? '✓' : '✗ ' + r.err}`);
    }
    showHint(`${user} ${action === 'ban' ? 'ban' : 'timeout'}: ${results.join(' · ')}`, !results.some((x) => x.includes('✗')));
    setTimeout(() => loadRecord(user), 1500);
  };

  // ---- Cezayı geri al (mod log'dan) ----
  const undoAction = (x) =>
    new Promise((resolve) => {
      const k = x.platform;
      const name = PLATFORMS[k].label;
      if (!views.current[k] || !s[k]) {
        Alert.alert('Geri al', `Geri almak için önce ${name} chat'ini aç (ceza atılan kanalı).`);
        return resolve(false);
      }
      if (!canMod(k)) {
        Alert.alert('Geri al', `${name} kanalında mod değilsin, ceza kaldırılamaz.`);
        return resolve(false);
      }
      Alert.alert('Geri al', `${x.target} için ${x.action === 'ban' ? 'ban' : 'timeout'} ${name}'te kaldırılsın mı?`, [
        { text: 'Vazgeç', style: 'cancel', onPress: () => resolve(false) },
        {
          text: 'Kaldır',
          onPress: async () => {
            // Twitch: /untimeout ya da /unban; Kick: /unban ikisini de kaldırır
            const cmd = k === 'twitch' && x.action === 'timeout' ? `/untimeout ${x.target}` : `/unban ${x.target}`;
            const r = await sendCommand(k, cmd);
            logModAction({ p_mod_twitch: accounts.twitch, p_mod_kick: accounts.kick, p_platform: k, p_action: x.action === 'ban' ? 'unban' : 'untimeout', p_target: x.target, p_secs: null, p_ok: !!r.ok });
            if (!r.ok) {
              reportError('geri-al', `${name}: ${r.err}`);
              Alert.alert('Geri alınamadı', r.err);
            }
            resolve(!!r.ok);
          },
        },
      ]);
    });

  // 🗑 Adına dokunulan mesajı, dokunulduğu chat'te siler
  const deleteMsg = () => {
    const k = mod.msgFrom;
    const user = cleanChannel(mod.user);
    if (!k || !user) return showHint("Önce chat'te silinecek mesajın sahibinin adına dokun.", false);
    if (!canMod(k)) return showHint(`${PLATFORMS[k].label} kanalında mod değilsin.`, false);
    const wv = views.current[k];
    if (!wv || !s[k]) return showHint(`${PLATFORMS[k].label} chat'i açık değil.`, false);
    const id = `del-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
    new Promise((resolve) => {
      pending.current[id] = resolve;
      setTimeout(() => {
        if (pending.current[id]) {
          delete pending.current[id];
          resolve({ ok: false, err: 'yanıt yok' });
        }
      }, 8000);
      wv.injectJavaScript(
        `window.__penguDeleteMsg ? window.__penguDeleteMsg(${JSON.stringify(id)}) : window.ReactNativeWebView.postMessage('__PENGU_DEL__' + JSON.stringify({ id: ${JSON.stringify(id)}, ok: false, err: 'sayfa hazır değil' })); true;`
      );
    }).then((r) => {
      if (r.ok) setMod((m) => ({ ...m, msgFrom: null }));
      else reportErrorRef.current?.('mesaj-silinemedi', `${PLATFORMS[k].label}: ${r.err}`);
      logModAction({ p_mod_twitch: accounts.twitch, p_mod_kick: accounts.kick, p_platform: k, p_action: 'delete', p_target: user, p_secs: null, p_ok: !!r.ok });
      showHint(r.ok ? `🗑 ${user} mesajı silindi (${PLATFORMS[k].label}).` : `🗑 Silinemedi: ${r.err}`, !!r.ok);
    });
  };

  const punish = (action) => {
    const user = cleanChannel(mod.user);
    const list = KEYS.filter((k) => mod[k] && canMod(k));
    if (!user || !list.length) return;
    if (action === 'ban') {
      const names = list.map((k) => PLATFORMS[k].label).join(' + ');
      Alert.alert('Ban', `${user} ${names}'te banlansın mı?`, [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Banla', style: 'destructive', onPress: () => runPunish('ban', user, list) },
      ]);
    } else {
      // Kutuya yazılıp henüz onaylanmamış süreyi de kullan
      const typed = secsText != null ? Math.round(Number(secsText)) : s.timeoutSecs;
      const secs = typed > 0 ? Math.min(1209600, typed) : 0;
      if (secsText != null) {
        update({ timeoutSecs: secs });
        setSecsText(null);
      }
      if (!secs) return showHint('Önce süreyi yaz (saniye).', false);
      runPunish('timeout', user, list, secs);
    }
  };

  const horizontal = landscape; // yatay telefon = yan yana, dikey = alt alta

  if (!ready || !uaReady) return <View style={styles.root}>{uaProbe}</View>;

  const tabs = s.layout === 'tabs';

  return (
    <View style={styles.root}>
      {/* ---- Üst çubuk ---- */}
      <View style={styles.bar}>
        <View style={styles.linkBox}>
          <View style={[styles.dot, { backgroundColor: PLATFORMS.twitch.color }]} />
          <View style={[styles.dot, { backgroundColor: PLATFORMS.kick.color, marginLeft: -3 }]} />
          <TextInput
            style={styles.linkInput}
            value={link}
            onChangeText={onChangeLink}
            onSubmitEditing={() => link.trim() && applyText(link)}
            placeholder="Twitch / Kick linki ya da kanal adı"
            placeholderTextColor="#a9e3de"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
          />
          <Pressable style={styles.pasteBtn} onPress={pasteFromClipboard} accessibilityLabel="Yapıştır">
            <Text style={styles.pasteText}>📋</Text>
          </Pressable>
        </View>
      </View>
      {/* ---- Yazılı düğme sırası: bütün işlevler görünür (gizli menü yok) ---- */}
      <View style={styles.actBar}>
        {anyModAccess && (
          <Act
            label="👤 Mod"
            on={mod.open}
            onPress={() => setMod((m) => ({ ...m, open: !m.open }))}
          />
        )}
        <Act
          label="🐞 Sorun bildir"
          dot={mineNews}
          onPress={() => {
            KEYS.forEach((k) => checkModRef.current(k)); // hesap adlarını tazele
            setReportMode('report');
          }}
          onLongPress={() => setReportMode('inbox')}
        />
        {(!!admin || ownerOn.twitch || ownerOn.kick || anyRole) && (
          <Act
            label="⚙️ Yönetim"
            count={newReports}
            onPress={() => {
              setNewReports(0);
              setReportMode('inbox');
            }}
          />
        )}
        <Act label={tabs ? '▤ Alt alta' : '⇆ Sekmeli'} onPress={() => update({ layout: tabs ? 'split' : 'tabs' })} />
        {anyModAccess && delayPill && (
          <Pressable
            onPress={flipDelay}
            style={[styles.delayPill, delayPill.kind === 'ok' && { borderColor: PLATFORMS.kick.color }, delayPill.kind === 'warn' && { borderColor: '#ffb84d' }]}
            accessibilityLabel="Yayın gecikmesi"
          >
            <Text style={[styles.delayText, delayPill.kind === 'warn' && { color: '#ffe2b0' }, delayPill.kind === 'muted' && { color: C.muted, fontWeight: '400' }]} numberOfLines={1}>
              {delayPill.text}
            </Text>
          </Pressable>
        )}
      </View>
      {maint.maintenance && !(admin || ownerOn.twitch || ownerOn.kick) && (
        <View style={styles.maint}>
          <Text style={{ fontSize: 64 }}>🛠️</Text>
          <Text style={styles.maintTitle}>Bakımdayız</Text>
          <Text style={styles.maintMsg}>{maint.message ? 'Sebep: ' + maint.message : 'PengusChat kısa bir süre bakımda. Birazdan kendiliğinden açılacak.'}</Text>
          {!!maint.eta && <Text style={[styles.maintMsg, { fontWeight: '700', fontSize: 17 }]}>⏰ Tahmini açılış: {maint.eta}</Text>}
          <Text style={styles.maintSmall}>Her 30 saniyede bir kontrol ediliyor…</Text>
        </View>
      )}
      {reportMode && <ReportModal accounts={accounts} roles={roles} onUndo={undoAction} annNow={ann} mode={reportMode} onClose={() => setReportMode(null)} appVersion={APP_VERSION} admin={admin} onAdminChange={changeAdmin} startTab={mineNews ? 'mine' : 'new'} onMineSeen={() => setMineNews(false)} />}
      {!!ann.text && ann.seen !== ann.at && (
        <View style={styles.annBar}>
          <Text style={styles.annText}>📢 {ann.text}</Text>
          <Pressable
            hitSlop={10}
            onPress={() => {
              AsyncStorage.setItem('penguchat:annSeen', ann.at).catch(() => {});
              setAnn((a) => ({ ...a, seen: a.at }));
            }}
          >
            <Text style={styles.updateClose}>✕</Text>
          </Pressable>
        </View>
      )}
      {newVersion && (
        <Pressable style={styles.updateBar} onPress={() => Linking.openURL(`${RELEASE_BASE}/PenguChat.apk`)}>
          <Text style={styles.updateText}>⬆ Yeni sürüm var · Güncellemek için dokun</Text>
          <Pressable hitSlop={10} onPress={() => setNewVersion(null)}>
            <Text style={styles.updateClose}>✕</Text>
          </Pressable>
        </Pressable>
      )}
      {mod.open && anyModAccess && (
        <View style={styles.modBar}>
          <View style={styles.modRow}>
            <TextInput
              style={[styles.modInput, { flex: 1 }]}
              value={mod.user}
              onChangeText={(t) => {
                setMod((m) => ({
                  ...m,
                  user: t,
                  ...(!m.twitch && !m.kick ? { twitch: canMod('twitch'), kick: canMod('kick') } : {}),
                }));
                clearTimeout(recTimer.current);
                recTimer.current = setTimeout(() => loadRecord(t), 600);
              }}
              placeholder="Chat'te bir ada dokun"
              placeholderTextColor="#a9e3de"
              autoCapitalize="none"
              autoCorrect={false}
            />
            {KEYS.map((k) => (
              <Pressable
                key={k}
                style={[styles.chip, { borderColor: PLATFORMS[k].color }, mod[k] && { backgroundColor: PLATFORMS[k].color }, !canMod(k) && styles.disabled]}
                disabled={!canMod(k)}
                onPress={() => setMod((m) => ({ ...m, [k]: !m[k] }))}
              >
                <Text style={[styles.chipText, mod[k] && k === 'kick' && { color: '#062f2d' }]}>{PLATFORMS[k].label}</Text>
              </Pressable>
            ))}
          </View>
          {!!record && !!mod.user && (
            <Text style={[styles.modUnit, { marginLeft: 0, fontWeight: '700', color: record.timeouts || record.bans ? '#ffb84d' : C.muted }]}>
              {Number(record.timeouts) || Number(record.bans)
                ? `📋 Sicil: ${[record.timeouts ? record.timeouts + ' timeout' : '', record.bans ? record.bans + ' ban' : ''].filter(Boolean).join(' · ')}`
                : '📋 Temiz sicil'}
            </Text>
          )}
          <View style={styles.modRow}>
            <Pressable style={[styles.modBtn, !(mod.user && (mod.twitch || mod.kick)) && styles.disabled]} onPress={() => punish('timeout')}>
              <Text style={styles.modBtnText}>⏱ Timeout</Text>
            </Pressable>
            <TextInput
              style={[styles.modInput, { width: 84 }]}
              value={secsText ?? String(s.timeoutSecs)}
              onChangeText={setSecsText}
              onEndEditing={() => {
                const v = Math.round(Number(secsText));
                if (secsText != null) update({ timeoutSecs: v > 0 ? Math.min(1209600, v) : 0 });
                setSecsText(null);
              }}
              keyboardType="number-pad"
            />
            <Text style={styles.modUnit}>sn</Text>
            <View style={{ flex: 1 }} />
            <Pressable style={[styles.modBtn, styles.banBtn, !(mod.user && (mod.twitch || mod.kick)) && styles.disabled]} onPress={() => punish('ban')}>
              <Text style={styles.modBtnText}>⛔ Ban</Text>
            </Pressable>
          </View>
          <Pressable style={[styles.modBtn, { alignSelf: 'flex-start' }, !mod.msgFrom && styles.disabled]} onPress={deleteMsg}>
            <Text style={styles.modBtnText}>🗑 Mesajı sil</Text>
          </Pressable>
        </View>
      )}
      {hint && (
        <Text style={[styles.hint, { color: hint.ok ? PLATFORMS.kick.color : '#ff6b6b' }]} numberOfLines={1}>
          {hint.text}
        </Text>
      )}

      {/* ---- Sekmeler ---- */}
      {tabs && (
        <View style={styles.tabBar}>
          {KEYS.map((k) => (
            <Pressable
              key={k}
              style={[styles.tab, s.tab === k && { borderBottomColor: PLATFORMS[k].color }]}
              onPress={() => update({ tab: k })}
            >
              <Text style={[styles.tabText, s.tab === k && styles.tabTextActive]}>
                {PLATFORMS[k].label}
                {s[k] ? ` · ${s[k]}` : ''}
                {viewerText(viewers[k])}
              </Text>
            </Pressable>
          ))}
        </View>
      )}

      {/* ---- Paneller ---- */}
      <View
        style={[styles.panes, { flexDirection: horizontal ? 'row' : 'column' }]}
      >
        {KEYS.map((k, i) => {
          const visible = !tabs || s.tab === k;
          return [
            i === 1 && !tabs ? (
              <View key="divider" style={[styles.divider, horizontal ? styles.dividerH : styles.dividerV]} />
            ) : null,
            <View key={k} style={[styles.pane, !visible && styles.hidden]}>
              {!tabs && (
                <PaneHeader k={k} channel={s[k]} viewers={viewers[k]} cat={cats[k]} onAction={paneAction} />
              )}
              {tabs && <PaneToolbar k={k} cat={s[k] && viewers[k] != null ? cats[k] : ''} onAction={paneAction} />}
              <View style={styles.paneBody}>
                {urls[k] ? (
                  <ChatView
                    k={k}
                    url={urls[k]}
                    zoom={s.zoom[k]}
                    onMessage={(data) => onWebMessage(k, data)}
                    onFail={(d) => reportError('chat-acilmadi', `${d} (${s[k]})`)}
                    onLoaded={() => {
                      // Telefonda chat sadece okunur: mesaj kutusu gizlenir (komutlar yine çalışır)
                      views.current[k]?.injectJavaScript('window.__penguReadOnly && window.__penguReadOnly(); true;');
                      setTimeout(() => checkModRef.current(k), 2500);
                      setTimeout(() => askViewersRef.current(k), 3000);
                    }}
                    onRef={(r) => {
                      views.current[k] = r;
                    }}
                  />
                ) : (
                  <View style={styles.placeholder}>
                    <Text style={styles.placeholderText}>
                      {PLATFORMS[k].label} için yukarıya yayın linkini yapıştır.
                    </Text>
                  </View>
                )}
              </View>
            </View>,
          ];
        })}
      </View>
    </View>
  );
}

function Act({ label, on, dot, count, onPress, onLongPress }) {
  return (
    <Pressable
      style={[styles.act, on && styles.iconBtnActive]}
      onPress={onPress}
      onLongPress={onLongPress}
      delayLongPress={1500}
      accessibilityLabel={label.replace(/^\S+\s/, '')}
    >
      <Text style={styles.actText}>{label}</Text>
      {count > 0 && (
        <View style={styles.badge}>
          <Text style={styles.badgeText}>{count > 9 ? '9+' : count}</Text>
        </View>
      )}
      {!!dot && <View style={[styles.badge, { minWidth: 12, height: 12, top: -3, right: -3 }]} />}
    </Pressable>
  );
}

function viewerText(n) {
  if (n === undefined) return '';
  if (n === null) return ' · kapalı';
  return ` · 👁 ${n.toLocaleString('tr-TR')}`;
}

function PaneHeader({ k, channel, viewers, cat, onAction }) {
  return (
    <View style={[styles.paneHead, { borderBottomColor: PLATFORMS[k].color }]}>
      <View style={[styles.dot, { backgroundColor: PLATFORMS[k].color }]} />
      <Text style={styles.paneTitle}>{PLATFORMS[k].label}</Text>
      <View style={{ flexShrink: 1 }}>
        <Text style={styles.paneChan} numberOfLines={1}>
          {channel ? `· ${channel}` : ''}
          {channel ? viewerText(viewers) : ''}
        </Text>
        {/* Kategori ayrı satırda: tam sığsın, kesilmesin */}
        {!!(channel && cat && viewers != null) && <Text style={styles.paneCat}>🎮 {cat}</Text>}
      </View>
      <View style={{ flex: 1 }} />
      <PaneButtons k={k} onAction={onAction} />
    </View>
  );
}

function PaneToolbar({ k, cat, onAction }) {
  return (
    <View style={[styles.paneHead, { borderBottomColor: PLATFORMS[k].color, justifyContent: 'flex-end' }]}>
      <Text style={[styles.paneCat, { flex: 1 }]}>{cat ? `🎮 ${cat}` : ''}</Text>
      <PaneButtons k={k} onAction={onAction} />
    </View>
  );
}

function PaneButtons({ k, onAction }) {
  const btn = (act, label) => (
    <Pressable key={act} style={styles.mini} onPress={() => onAction(k, act)} hitSlop={4}>
      <Text style={styles.miniText}>{label}</Text>
    </Pressable>
  );
  return (
    <View style={styles.row}>
      {btn('chat', '⟳')}
      {btn('zoom-out', 'A−')}
      {btn('zoom-in', 'A+')}
    </View>
  );
}

function ChatView({ k, url, zoom, onRef, onMessage, onLoaded, onFail }) {
  const inner = useRef(null);
  const setRef = useCallback(
    (r) => {
      inner.current = r;
      onRef(r);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );
  const onShouldStart = (req) => {
    // iOS: alt çerçeveler (reklam, emote vb.) serbest
    if (req.isTopFrame === false) return true;
    if (isInternalUrl(req.url)) return true;
    // Chat'teki dış linkler telefonun tarayıcısında açılır
    Linking.openURL(req.url).catch(() => {});
    return false;
  };

  return (
    <WebView
      ref={setRef}
      source={{ uri: url }}
      style={styles.webview}
      containerStyle={styles.webview}
      userAgent={USER_AGENT}
      injectedJavaScriptBeforeContentLoaded={VIEWPORT_JS}
      injectedJavaScript={zoomJs(zoom) + FIT_POPUPS_JS + PICK_USER_JS + '\ntrue;'}
      onMessage={(e) => onMessage(e.nativeEvent.data)}
      onLoadEnd={() => onLoaded?.()}
      onShouldStartLoadWithRequest={onShouldStart}
      // Girişlerin kalıcı olması için
      sharedCookiesEnabled
      thirdPartyCookiesEnabled
      domStorageEnabled
      javaScriptEnabled
      // Açılır pencereler (giriş vb.) aynı panelde açılsın
      setSupportMultipleWindows={false}
      // 🔒 Şifresiz içerik ve telefon dosyalarına erişim kapalı
      mixedContentMode="never"
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      javaScriptCanOpenWindowsAutomatically
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction
      allowsBackForwardNavigationGestures
      pullToRefreshEnabled={false}
      overScrollMode="never"
      // Arka planda sistem WebView'i kapatırsa paneli yeniden yükle
      onContentProcessDidTerminate={() => inner.current?.reload()}
      onRenderProcessGone={() => inner.current?.reload()}
      onError={(e) => onFail?.(`${PLATFORMS[k].label}: ${e.nativeEvent?.description || e.nativeEvent?.code || 'yüklenemedi'}`)}
      onHttpError={(e) => {
        if (e.nativeEvent.statusCode === 404) {
          Alert.alert(PLATFORMS[k].label, 'Kanal bulunamadı. Linki kontrol et.');
        }
      }}
    />
  );
}

const C = {
  // Turkuaz tema
  bg: '#0a6b67',
  panel: '#0e8f8a',
  panel2: '#0b7c77',
  input: '#075a56',
  border: '#23bdb5',
  text: '#ffffff',
  muted: '#c9f3ef',
};

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg },
  row: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  hidden: { display: 'none' },

  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 8,
    paddingVertical: 6,
    backgroundColor: C.panel,
    borderBottomWidth: 1,
    borderBottomColor: C.border,
  },
  linkBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 38,
    paddingLeft: 10,
    backgroundColor: C.input,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    overflow: 'hidden',
  },
  linkInput: { flex: 1, minWidth: 0, color: C.text, fontSize: 14, paddingVertical: 0 },
  pasteBtn: {
    flexShrink: 0,
    height: '100%',
    paddingHorizontal: 12,
    justifyContent: 'center',
    backgroundColor: PLATFORMS.twitch.color,
  },
  pasteText: { color: '#fff', fontWeight: '700', fontSize: 17 },
  iconBtn: {
    width: 38,
    height: 38,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.panel2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconText: { color: C.text, fontSize: 18 },
  iconBtnActive: { backgroundColor: C.border },
  annBar: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 12, paddingVertical: 8, backgroundColor: '#2563eb' },
  annText: { flex: 1, color: '#fff', fontWeight: '700', fontSize: 13 },
  maint: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 200,
    elevation: 20,
    backgroundColor: '#0a6b67',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  maintTitle: { color: C.text, fontSize: 30, fontWeight: '800', marginTop: 8 },
  maintMsg: { color: C.text, fontSize: 16, textAlign: 'center', marginTop: 10 },
  maintSmall: { color: C.muted, fontSize: 12, marginTop: 14 },
  // Sığmazsa alt satıra geçer; hiçbir düğme ekran dışında kalmaz
  delayPill: { alignSelf: 'center', height: 30, paddingHorizontal: 10, borderRadius: 13, borderWidth: 1, borderColor: C.border, backgroundColor: C.input, justifyContent: 'center' },
  delayText: { color: C.text, fontSize: 12, fontWeight: '600' },
  actBar: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 8, paddingVertical: 6, backgroundColor: C.panel2, borderBottomWidth: 1, borderBottomColor: C.border },
  act: { height: 32, paddingHorizontal: 10, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.panel, justifyContent: 'center' },
  actText: { color: C.text, fontSize: 13, fontWeight: '600' },
  menuBackdrop: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 50 },
  menu: {
    position: 'absolute',
    top: 52,
    right: 8,
    minWidth: 220,
    backgroundColor: C.panel2,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 10,
    paddingVertical: 4,
    elevation: 8,
    shadowColor: '#000',
    shadowOpacity: 0.4,
    shadowRadius: 12,
  },
  menuItem: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingHorizontal: 14, paddingVertical: 12 },
  menuIcon: { fontSize: 18, width: 24, textAlign: 'center', color: C.text },
  menuLabel: { flex: 1, color: C.text, fontSize: 15 },
  menuFoot: { color: C.muted, fontSize: 11, paddingHorizontal: 14, paddingTop: 6, paddingBottom: 8 },
  badge: {
    position: 'absolute',
    top: -5,
    right: -5,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: '#e0463d',
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  modBar: { backgroundColor: C.panel2, paddingHorizontal: 8, paddingVertical: 6, gap: 6, borderBottomWidth: 1, borderBottomColor: C.border },
  modRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  modInput: {
    height: 34,
    paddingHorizontal: 10,
    paddingVertical: 0,
    color: C.text,
    fontWeight: '600',
    backgroundColor: C.input,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 6,
  },
  chip: { height: 34, paddingHorizontal: 10, justifyContent: 'center', borderRadius: 6, borderWidth: 1 },
  chipText: { color: C.text, fontWeight: '600', fontSize: 13 },
  modBtn: { height: 34, paddingHorizontal: 14, justifyContent: 'center', borderRadius: 6, backgroundColor: C.border },
  banBtn: { backgroundColor: '#b3261e' },
  modBtnText: { color: '#fff', fontWeight: '700' },
  modUnit: { color: C.muted, fontSize: 12 },
  disabled: { opacity: 0.45 },
  updateBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 12,
    paddingVertical: 9,
    backgroundColor: '#1f8f3a',
  },
  updateText: { color: '#fff', fontWeight: '700', flex: 1 },
  updateClose: { color: '#fff', fontSize: 16, paddingLeft: 12 },
  hint: { paddingHorizontal: 10, paddingVertical: 3, fontSize: 12, backgroundColor: C.panel },
  dot: { width: 8, height: 8, borderRadius: 4 },

  tabBar: { flexDirection: 'row', backgroundColor: C.panel2 },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderBottomWidth: 3,
    borderBottomColor: 'transparent',
  },
  tabText: { color: C.muted, fontWeight: '600' },
  tabTextActive: { color: C.text },

  panes: { flex: 1 },
  pane: { flex: 1, backgroundColor: C.panel, overflow: 'hidden' },
  paneHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 36,
    paddingHorizontal: 8,
    backgroundColor: C.panel2,
    borderBottomWidth: 2,
  },
  paneTitle: { color: C.text, fontWeight: '700' },
  paneChan: { color: C.muted, flexShrink: 1 },
  paneCat: { color: C.text, fontSize: 12, fontWeight: '600' },
  mini: {
    paddingHorizontal: 9,
    height: 26,
    justifyContent: 'center',
    borderRadius: 5,
    borderWidth: 1,
    borderColor: C.border,
    backgroundColor: C.panel,
  },
  miniText: { color: C.text, fontSize: 12 },
  paneBody: { flex: 1 },
  webview: { flex: 1, backgroundColor: C.panel },
  placeholder: { flex: 1, alignItems: 'center', justifyContent: 'center', padding: 24 },
  placeholderText: { color: C.muted, textAlign: 'center' },

  divider: { backgroundColor: C.border },
  dividerV: { height: 2 },
  dividerH: { width: 2 },
});
