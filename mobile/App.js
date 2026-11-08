import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Alert,
  Linking,
  Platform,
  Pressable,
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
import { OWNER_ACCOUNTS, STREAMER_ACCOUNTS, logModAction, sendPing } from './src/report';

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
const USER_AGENT =
  Platform.OS === 'ios'
    ? 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15'
    : 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

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
  const [reportMode, setReportMode] = useState(null); // null | 'report' | 'inbox' | 'streamer'
  const [menuOpen, setMenuOpen] = useState(false);
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
  const [streamerOn, setStreamerOn] = useState({ twitch: false, kick: false }); // yayıncı hesabıyla girilmiş mi
  const [viewers, setViewers] = useState({ twitch: undefined, kick: undefined }); // yayın izleyici sayısı (null = kapalı)
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
  const pending = useRef({});

  // ---- İzleyici / mod modu ----
  // 'pending' (bakılıyor), 'mod', 'viewer' (normal izleyici), 'unknown' (anlaşılamadı)
  const [modStatus, setModStatus] = useState({ twitch: 'pending', kick: 'pending' });
  const canMod = (k) => !!s[k] && (modStatus[k] === 'mod' || modStatus[k] === 'unknown');
  const anyModAccess = canMod('twitch') || canMod('kick');
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
      p_platform: `android ${Platform.Version}`.slice(0, 30),
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
    if (data.startsWith('__PENGU_VIEW__')) {
      try {
        const { n } = JSON.parse(data.slice(14));
        if (n !== -1) setViewers((v) => ({ ...v, [k]: n }));
      } catch {}
      return;
    }
    if (data.startsWith('__PENGU_MOD__')) {
      try {
        const { status, me } = JSON.parse(data.slice(13));
        const isOwner = OWNER_ACCOUNTS[k].includes(String(me || '').toLowerCase());
        setOwnerOn((o) => (o[k] === isOwner ? o : { ...o, [k]: isOwner }));
        const name = String(me || '').slice(0, 40);
        const isStreamer = STREAMER_ACCOUNTS[k].includes(name.toLowerCase());
        setStreamerOn((o) => (o[k] === isStreamer ? o : { ...o, [k]: isStreamer }));
        setAccounts((a) => (a[k] === name ? a : { ...a, [k]: name }));
        setModStatus((m) => ({ ...m, [k]: ['mod', 'viewer', 'unknown'].includes(status) ? status : 'unknown' }));
      } catch {}
    } else if (data.startsWith('__PENGU_PICK__')) {
      if (!anyModAccess) return; // izleyici modunda dokunma bir şey yapmaz
      try {
        const { name, restream } = JSON.parse(data.slice(14));
        const p = restream ? 'twitch' : k; // Restream mesajının sahibi Twitch'te
        setMod({ open: true, user: name, twitch: p === 'twitch' && canMod('twitch'), kick: p === 'kick' && canMod('kick') });
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
      results.push(`${PLATFORMS[k].label} ${r.ok ? '✓' : '✗ ' + r.err}`);
    }
    showHint(`${user} ${action === 'ban' ? 'ban' : 'timeout'}: ${results.join(' · ')}`, !results.some((x) => x.includes('✗')));
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

  if (!ready) return <View style={styles.root} />;

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
        {anyModAccess && (
          <Pressable
            style={[styles.iconBtn, mod.open && styles.iconBtnActive]}
            onPress={() => setMod((m) => ({ ...m, open: !m.open }))}
            accessibilityLabel="Hızlı ceza çubuğu"
          >
            <Text style={styles.iconText}>👤</Text>
          </Pressable>
        )}
        <Pressable
          style={[styles.iconBtn, menuOpen && styles.iconBtnActive]}
          onPress={() => setMenuOpen((o) => !o)}
          accessibilityLabel="Menü"
        >
          <Text style={styles.iconText}>⋯</Text>
          {(mineNews || newReports > 0) && <View style={[styles.badge, { minWidth: 12, height: 12, top: -3, right: -3 }]} />}
        </Pressable>
      </View>
      {menuOpen && (
        <Pressable style={styles.menuBackdrop} onPress={() => setMenuOpen(false)}>
          <View style={styles.menu}>
            <MenuItem
              icon="🐞"
              label="Sorun bildir"
              dot={mineNews}
              onPress={() => {
                setMenuOpen(false);
                KEYS.forEach((k) => checkModRef.current(k)); // hesap adlarını tazele
                setReportMode('report');
              }}
              onLongPress={() => {
                setMenuOpen(false);
                setReportMode('inbox');
              }}
            />
            {(!!admin || ownerOn.twitch || ownerOn.kick) && (
              <MenuItem
                icon="📥"
                label="Gelen sorunlar"
                count={newReports}
                onPress={() => {
                  setMenuOpen(false);
                  setNewReports(0);
                  setReportMode('inbox');
                }}
              />
            )}
            {(streamerOn.twitch || streamerOn.kick) && (
              <MenuItem
                icon="🛡️"
                label="Mod log"
                onPress={() => {
                  setMenuOpen(false);
                  setReportMode('streamer');
                }}
              />
            )}
            <MenuItem
              icon={tabs ? '▤' : '⇆'}
              label={tabs ? 'Alt alta görünüm' : 'Sekmeli görünüm'}
              onPress={() => {
                setMenuOpen(false);
                update({ layout: tabs ? 'split' : 'tabs' });
              }}
            />
            <Text style={styles.menuFoot}>PengusChat · Beta</Text>
          </View>
        </Pressable>
      )}
      {reportMode && <ReportModal accounts={accounts} streamerOn={streamerOn} mode={reportMode} onClose={() => setReportMode(null)} appVersion={APP_VERSION} admin={admin} onAdminChange={changeAdmin} startTab={mineNews ? 'mine' : 'new'} onMineSeen={() => setMineNews(false)} />}
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
              onChangeText={(t) =>
                setMod((m) => ({
                  ...m,
                  user: t,
                  ...(!m.twitch && !m.kick ? { twitch: canMod('twitch'), kick: canMod('kick') } : {}),
                }))
              }
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
                <PaneHeader k={k} channel={s[k]} viewers={viewers[k]} onAction={paneAction} />
              )}
              {tabs && <PaneToolbar k={k} onAction={paneAction} />}
              <View style={styles.paneBody}>
                {urls[k] ? (
                  <ChatView
                    k={k}
                    url={urls[k]}
                    zoom={s.zoom[k]}
                    onMessage={(data) => onWebMessage(k, data)}
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

function MenuItem({ icon, label, dot, count, onPress, onLongPress }) {
  return (
    <Pressable style={styles.menuItem} onPress={onPress} onLongPress={onLongPress} delayLongPress={1500} accessibilityLabel={label}>
      <Text style={styles.menuIcon}>{icon}</Text>
      <Text style={styles.menuLabel}>{label}</Text>
      {count > 0 && (
        <View style={[styles.badge, { position: 'relative', top: 0, right: 0 }]}>
          <Text style={styles.badgeText}>{count > 9 ? '9+' : count}</Text>
        </View>
      )}
      {!!dot && <View style={[styles.badge, { position: 'relative', top: 0, right: 0, minWidth: 10, height: 10 }]} />}
    </Pressable>
  );
}

function viewerText(n) {
  if (n === undefined) return '';
  return n === null ? ' · kapalı' : ` · 👁 ${n.toLocaleString('tr-TR')}`;
}

function PaneHeader({ k, channel, viewers, onAction }) {
  return (
    <View style={[styles.paneHead, { borderBottomColor: PLATFORMS[k].color }]}>
      <View style={[styles.dot, { backgroundColor: PLATFORMS[k].color }]} />
      <Text style={styles.paneTitle}>{PLATFORMS[k].label}</Text>
      <Text style={styles.paneChan} numberOfLines={1}>
        {channel ? `· ${channel}` : ''}
        {channel ? viewerText(viewers) : ''}
      </Text>
      <View style={{ flex: 1 }} />
      <PaneButtons k={k} onAction={onAction} />
    </View>
  );
}

function PaneToolbar({ k, onAction }) {
  return (
    <View style={[styles.paneHead, { borderBottomColor: PLATFORMS[k].color, justifyContent: 'flex-end' }]}>
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

function ChatView({ k, url, zoom, onRef, onMessage, onLoaded }) {
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
      javaScriptCanOpenWindowsAutomatically
      allowsInlineMediaPlayback
      mediaPlaybackRequiresUserAction
      allowsBackForwardNavigationGestures
      pullToRefreshEnabled={false}
      overScrollMode="never"
      // Arka planda sistem WebView'i kapatırsa paneli yeniden yükle
      onContentProcessDidTerminate={() => inner.current?.reload()}
      onRenderProcessGone={() => inner.current?.reload()}
      onError={() => {}}
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
