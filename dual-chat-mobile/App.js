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
import { PLATFORMS, hasLink, isInternalUrl, parseTargets } from './src/links';
import { FIT_POPUPS_JS } from './src/fitPopups';

const STORE_KEY = 'dualchat:settings';
const RELEASE_BASE = 'https://github.com/Hasantunaozdmr/Canzade-ToastyStat/releases/latest/download';
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
        <DualChat />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function DualChat() {
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
        const next = { ...DEFAULTS, ...saved, zoom: { ...DEFAULTS.zoom, ...(saved.zoom || {}) } };
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
    } else if (act === 'login') {
      setUrls((p) => ({ ...p, [k]: PLATFORMS[k].loginUrl() }));
      showHint(`${PLATFORMS[k].label}: giriş yap, sonra ⟳ ile chat'e dön`);
    } else if (act === 'zoom-in' || act === 'zoom-out') {
      const z = Math.round(Math.min(2, Math.max(0.6, s.zoom[k] + (act === 'zoom-in' ? 0.1 : -0.1))) * 10) / 10;
      update((prev) => ({ ...prev, zoom: { ...prev.zoom, [k]: z } }));
      wv?.injectJavaScript(zoomJs(z));
      showHint(`${PLATFORMS[k].label} yazı boyutu %${Math.round(z * 100)}`);
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
            placeholderTextColor="#7a7a85"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
          />
          <Pressable style={styles.pasteBtn} onPress={pasteFromClipboard}>
            <Text style={styles.pasteText}>Yapıştır</Text>
          </Pressable>
        </View>
        <Pressable
          style={styles.iconBtn}
          onPress={() => update({ layout: tabs ? 'split' : 'tabs' })}
          accessibilityLabel="Görünümü değiştir"
        >
          <Text style={styles.iconText}>{tabs ? '▤' : '⇆'}</Text>
        </Pressable>
      </View>
      {newVersion && (
        <Pressable style={styles.updateBar} onPress={() => Linking.openURL(`${RELEASE_BASE}/DualChat.apk`)}>
          <Text style={styles.updateText}>⬆ Yeni sürüm var (v{newVersion}) · Güncellemek için dokun</Text>
          <Pressable hitSlop={10} onPress={() => setNewVersion(null)}>
            <Text style={styles.updateClose}>✕</Text>
          </Pressable>
        </Pressable>
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
                <PaneHeader k={k} channel={s[k]} onAction={paneAction} />
              )}
              {tabs && <PaneToolbar k={k} onAction={paneAction} />}
              <View style={styles.paneBody}>
                {urls[k] ? (
                  <ChatView
                    k={k}
                    url={urls[k]}
                    zoom={s.zoom[k]}
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

function PaneHeader({ k, channel, onAction }) {
  return (
    <View style={[styles.paneHead, { borderBottomColor: PLATFORMS[k].color }]}>
      <View style={[styles.dot, { backgroundColor: PLATFORMS[k].color }]} />
      <Text style={styles.paneTitle}>{PLATFORMS[k].label}</Text>
      <Text style={styles.paneChan} numberOfLines={1}>
        {channel ? `· ${channel}` : ''}
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
      {btn('login', 'Giriş')}
      {btn('chat', '⟳')}
      {btn('zoom-out', 'A−')}
      {btn('zoom-in', 'A+')}
    </View>
  );
}

function ChatView({ k, url, zoom, onRef }) {
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
      injectedJavaScript={zoomJs(zoom) + FIT_POPUPS_JS}
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
  bg: '#0e0e10',
  panel: '#18181b',
  panel2: '#1f1f23',
  border: '#2a2a2e',
  text: '#efeff1',
  muted: '#adadb8',
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
    backgroundColor: C.bg,
    borderWidth: 1,
    borderColor: C.border,
    borderRadius: 8,
    overflow: 'hidden',
  },
  linkInput: { flex: 1, color: C.text, fontSize: 14, paddingVertical: 0 },
  pasteBtn: {
    height: '100%',
    paddingHorizontal: 12,
    justifyContent: 'center',
    backgroundColor: PLATFORMS.twitch.color,
  },
  pasteText: { color: '#fff', fontWeight: '700', fontSize: 13 },
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
