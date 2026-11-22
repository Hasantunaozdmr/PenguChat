// 📡 Telefondan yayın: aynı anda Twitch + Kick. Kamera + mikrofon görüntüsü RTMP / RTMPS ile gönderilir.
// - Bağlantı koparsa yayın "Bitir"e basılana kadar kendiliğinden tekrar bağlanır.
// - Bitrate çok düşerse yayına "Bitrate düşük, lütfen bekleyiniz" yazısı gider, düzelince kameraya döner.
// - 🤳 Dual cam: ön ve arka kamera aynı anda (ikinci kamera sürüklenebilir bir kutuda; telefon desteklemiyorsa uyarı çıkar).
// - 🖼️ Ekran öğeleri: PenguLive logosu, kendi resimlerin ve donate bar linklerin yayına eklenir; sürükle, büyüt / küçült, aç / kapat.
//   Donate sayfasının abone / bağış sesleri de yayına karışır (🔊 / 🔇).
// Yayın anahtarları ve donate linkleri sadece bu telefonda saklanır; sadece Twitch'e / Kick'e / donate sitesine gider.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, FlatList, Image, Linking, Modal, PanResponder, PermissionsAndroid, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { PLATFORMS, isInternalUrl } from './links';
import { PICK_USER_JS } from './injected';
const { describe: evDescribe, ICON: EV_ICON } = require('./events');

const HAS_LIVE = Platform.OS === 'android' || Platform.OS === 'ios';
const live = HAS_LIVE ? require('../modules/pengu-live/src') : null;
const PenguLiveView = live?.PenguLiveView || null;
const keepAwake = HAS_LIVE ? require('expo-keep-awake') : null;
const SO = HAS_LIVE ? require('expo-screen-orientation') : null;

const KEY_STORE = 'penguchat:liveKeys';
const CHAT_STORE = 'penguchat:liveChat';
const SET_STORE = 'penguchat:liveSettings';
const OV_STORE = 'penguchat:liveOverlays';
// Yer ve boyut: görüntünün yüzdesi (x, y = sol üst köşe, w = genişlik)
const CAM_OV = { id: 'cam', type: 'cam', name: '🤳 İkinci kamera', on: false, x: 66, y: 60, w: 30, rot: 0, mirror: false };
const DEFAULT_OV = [{ id: 'logo', type: 'logo', name: '🐧 PenguLive logosu', on: true, x: 84, y: 3, w: 13 }, CAM_OV];
const SHAPE = { bar: { label: 'Bar (geniş)', aspect: 0.25, w: 40 }, box: { label: 'Kutu (uyarı)', aspect: 0.75, w: 30 } };
const ovAspect = (o, camAspect) => (o.type === 'logo' ? 1 : o.type === 'cam' ? camAspect || 0.5625 : o.type === 'web' ? (SHAPE[o.shape] || SHAPE.bar).aspect : o.aspect || 1);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// ⭐ Pro'ya özel: Twitch + Kick aynı anda, logo kaldırma, kendi resim / donate bar, dual cam, 1080p
export const PRO_TEXT = 'Bu özellik PenguLive Pro\'da: Twitch + Kick aynı anda yayın, Restream ve Özel RTMP ile yayın, logoyu kaldırma, kendi logo / resim, donate bar ve uyarılar, dual cam ve 1080p.\n\nPro için uygulamanın yöneticisiyle iletişime geç.';
const proAlert = () => Alert.alert('⭐ PenguLive Pro', PRO_TEXT);
const TWITCH_INGEST = 'rtmp://live.twitch.tv/app/';
const RESTREAM_INGEST = 'rtmp://live.restream.io/live';
// Tek çıkışlı yollar: Restream (Twitch / Kick'e kendisi dağıtır) ya da özel RTMP (PC'deki OBS, kendi sunucun…)
const VIA = { restream: 'Restream', custom: '🖥️ Özel RTMP' };
// Gerçek platform logoları
const LOGO = { twitch: require('../assets/logo-twitch.png'), kick: require('../assets/logo-kick.png'), restream: require('../assets/logo-restream.png') };
const Logo = ({ k, size = 16, style }) => <Image source={LOGO[k]} style={[{ width: size, height: size, borderRadius: size / 4 }, style]} />;
const QUALITY = { low: 'Düşük (480p)', mid: 'Orta (720p)', high: 'Yüksek (1080p)' };
const LABEL = { twitch: 'Twitch', kick: 'Kick' };
// ✏️ Başlık / kategori: Twitch'in ve Kick'in kendi "yayın bilgisi" sayfaları (uygulamadaki girişle açılır)
const EDIT_URL = { twitch: 'https://dashboard.twitch.tv/stream-manager', kick: 'https://kick.com/dashboard/stream' };
const STATE = { idle: 'kapalı', connecting: 'bağlanıyor…', live: 'CANLI', reconnecting: 'tekrar bağlanıyor…', error: 'hata' };

const fmtTime = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(x).padStart(2, '0');
};
const mbps = (b) => (b > 0 ? (b / 1e6).toFixed(1) + ' Mbps' : '—');
// Kick "Stream URL" + "Stream Key" → tek adres
const joinUrl = (url, key) => (url && key ? url.replace(/\/+$/, '') + '/' + key : '');

export default function LiveScreen({ C, onClose, userAgent, unlocked = true, chatChannels = {}, liveChat, viewers = {} }) {
  const ref = useRef(null);
  // iPhone: yayın ekranı tam ekran açılır; üstteki saat / çentik ve alttaki çizgiyle çakışmasın
  const safe = useSafeAreaInsets();
  const ins = Platform.OS === 'ios' ? safe : { top: 0, bottom: 0, left: 0, right: 0 };
  const [keys, setKeys] = useState({ twitch: '', kickUrl: '', kick: '', useTwitch: true, useKick: true, via: '', restreamUrl: RESTREAM_INGEST, restreamKey: '', customUrl: '', customKey: '', customFor: 'kick', restreamFor: 'both' });
  const [quality, setQuality] = useState('mid');
  const [kbps, setKbps] = useState(0); // elle bitrate (0 = kaliteye göre)
  const [kbpsText, setKbpsText] = useState('');
  const [muted, setMuted] = useState(false);
  const [micToast, setMicToast] = useState(null);
  const levelSink = useRef(null);
  // 💬 Chat mesajları burada saklanır: chat paneli kapanıp açılınca (⚙️, 🖼️, dönme) mesajlar kaybolmasın
  const chatStore = useRef({ list: [], seen: new Set() });
  const [ownViewers, setOwnViewers] = useState({}); // 🎙️ ses dalgası (yeniden çizim yok, doğrudan animasyon)
  const micTimer = useRef(null);
  const toggleMic = () => {
    const m = !muted;
    setMuted(m);
    ref.current?.setMuted(m);
    setMicToast(m ? { t: '🔇 Mikrofon kapatıldı', bg: 'rgba(220,38,38,.92)' } : { t: '🎤 Mikrofon açıldı', bg: 'rgba(22,163,74,.92)' });
    clearTimeout(micTimer.current);
    micTimer.current = setTimeout(() => setMicToast(null), 1500);
  };
  useEffect(() => () => clearTimeout(micTimer.current), []);
  // 📱 Ekran yönü tuşu: telefonda otomatik döndürme kapalı olsa bile yan / dik çevirir
  const [rot, setRot] = useState('auto');
  const showToast = (t) => {
    setMicToast({ t, bg: 'rgba(0,0,0,.8)' });
    clearTimeout(micTimer.current);
    micTimer.current = setTimeout(() => setMicToast(null), 1500);
  };
  const setRotation = async (next) => {
    setRot(next);
    showToast(next === 'land' ? '📱 Yan ekran (basılı tut: otomatik)' : next === 'port' ? '📱 Dik ekran (basılı tut: otomatik)' : '📱 Otomatik döndürme');
    try {
      if (!SO) return;
      if (next === 'auto') await SO.unlockAsync();
      else await SO.lockAsync(next === 'land' ? SO.OrientationLock.LANDSCAPE : SO.OrientationLock.PORTRAIT_UP);
    } catch {}
  };
  useEffect(() => () => { SO?.unlockAsync().catch(() => {}); }, []); // yayın ekranı kapanınca serbest bırak
  const [running, setRunning] = useState(false); // yayıncı "Yayına başla"ya bastı
  const [status, setStatus] = useState({ twitch: 'idle', kick: 'idle' });
  const [stats, setStats] = useState({ twitch: 0, kick: 0, lowMode: false });
  const [error, setError] = useState('');
  const [setup, setSetup] = useState(false);
  const [edit, setEdit] = useState(null); // null | 'twitch' | 'kick'
  const [editWeb, setEditWeb] = useState(false); // yedek: platformun kendi sayfası
  const [startedAt, setStartedAt] = useState(0);
  const [overlays, setOverlays] = useState(DEFAULT_OV);
  const [ovLoaded, setOvLoaded] = useState(false);
  const [layoutMode, setLayoutMode] = useState(false); // 🖼️ ekran öğelerini düzenleme
  const [sel, setSel] = useState('logo');
  const [addWeb, setAddWeb] = useState(null); // null | { url, shape }
  const [box, setBox] = useState({ w: 0, h: 0 });
  // 💬 Ekran yarı görüntü yarı chat (sadece yayıncının ekranında; yayına gitmez)
  const [chatOn, setChatOn] = useState(false);
  useEffect(() => {
    AsyncStorage.getItem(CHAT_STORE).then((v) => v === '1' && setChatOn(true)).catch(() => {});
  }, []);
  const toggleChat = () => {
    const v = !chatOn;
    setChatOn(v);
    AsyncStorage.setItem(CHAT_STORE, v ? '1' : '0').catch(() => {});
  };
  const [, tick] = useState(0);

  useEffect(() => {
    AsyncStorage.getItem(OV_STORE).then((v) => {
      try {
        const list = JSON.parse(v || 'null');
        if (Array.isArray(list) && list.length) setOverlays(list.some((o) => o.id === 'cam') ? list.map((o) => (o.id === 'cam' ? { ...o, on: false } : o)) : [...list, CAM_OV]);
      } catch {}
      setOvLoaded(true);
    }).catch(() => setOvLoaded(true));
    AsyncStorage.multiGet([KEY_STORE, SET_STORE]).then((r) => {
      try { const k = JSON.parse(r[0][1] || '{}'); setKeys((o) => ({ ...o, ...k })); if (!k.twitch && !k.kick && !k.restreamKey && !k.customUrl) setSetup(true); } catch { setSetup(true); }
      try {
        const st = JSON.parse(r[1][1] || '{}');
        if (QUALITY[st.quality]) setQuality(st.quality);
        if (st.kbps > 0) { setKbps(st.kbps); setKbpsText(String(st.kbps)); }
      } catch {}
    });
    // Kamera + mikrofon izni
    if (Platform.OS === 'android') {
      PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.CAMERA, PermissionsAndroid.PERMISSIONS.RECORD_AUDIO]).then((res) => {
        if (Object.values(res).some((v) => v !== PermissionsAndroid.RESULTS.GRANTED)) setError('Kamera ve mikrofon izni gerekli. Telefon Ayarları → Uygulamalar → PenguLive → İzinler.');
      });
    } else if (Platform.OS === 'ios') {
      live?.requestPermissions?.().then((ok) => {
        if (!ok) setError('Kamera ve mikrofon izni gerekli. iPhone Ayarlar → PenguLive → Kamera / Mikrofon.');
      }).catch(() => {});
    }
  }, []);
  useEffect(() => {
    if (!running) return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [running]);
  // Yayın sürerken ekran kapanmasın
  useEffect(() => {
    if (!keepAwake) return;
    if (running) keepAwake.activateKeepAwakeAsync('pengu-live').catch(() => {});
    else keepAwake.deactivateKeepAwake('pengu-live');
    return () => keepAwake.deactivateKeepAwake('pengu-live');
  }, [running]);

  // Ekran öğeleri: değişince kısa bir süre sonra kaydet (sürüklerken her harekette değil)
  useEffect(() => {
    if (!ovLoaded) return;
    const t = setTimeout(() => AsyncStorage.setItem(OV_STORE, JSON.stringify(overlays)).catch(() => {}), 500);
    return () => clearTimeout(t);
  }, [overlays, ovLoaded]);
  const ovJson = useMemo(() => JSON.stringify(overlays
    .map((o) => (unlocked ? o : o.type === 'logo' ? { ...o, on: true } : { ...o, on: false })) // Pro değilse sadece logo
    .map(({ id, type, on, x, y, w, src, shape, sound, rot, mirror }) => ({ id, type, on, x, y, w, src: src || '', shape: shape || 'bar', sound: sound !== false, rot: rot || 0, mirror: !!mirror }))), [overlays, unlocked]);

  // Önizlemede görüntünün kapladığı alan (yan tutunca 16:9, dik tutunca 9:16; kalanı siyah)
  const portrait = box.h > box.w;
  const A = portrait ? 9 / 16 : 16 / 9;
  const rect = (() => {
    let w = box.w, h = box.w / A;
    if (h > box.h) { h = box.h; w = box.h * A; }
    return { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h };
  })();
  const hPct = (o) => clamp(o.w * ovAspect(o, stats.camAspect) * A, 1, 100);
  const camOv = overlays.find((o) => o.id === 'cam');
  const toggleCam = () => { if (!unlocked) return proAlert(); if (camOv) { updOv('cam', { on: !camOv.on }); if (!camOv.on) setSel('cam'); } };
  const updOv = (id, patch) => setOverlays((list) => list.map((o) => (o.id === id ? { ...o, ...patch } : o)));
  const resize = (id, d) =>
    setOverlays((list) => list.map((o) => {
      if (o.id !== id) return o;
      const w = clamp(o.w + d, 4, 100);
      const n = { ...o, w };
      return { ...n, x: clamp(o.x, 0, 100 - w), y: clamp(o.y, 0, 100 - hPct(n)) };
    }));
  const removeOv = (o) =>
    Alert.alert('Kaldır', `"${o.name}" yayından kaldırılsın mı?`, [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Kaldır', style: 'destructive', onPress: () => {
        setOverlays((list) => list.filter((x) => x.id !== o.id));
        if (o.type === 'image' && o.src) live?.deleteImage(o.src).catch(() => {});
        setSel('logo');
      } },
    ]);
  const pickImage = async () => {
    if (!unlocked) return proAlert();
    try {
      const ImagePicker = require('expo-image-picker');
      const r = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], quality: 1 });
      if (r.canceled || !r.assets?.[0]) return;
      const a = r.assets[0];
      const src = live ? await live.importImage(a.uri) : a.uri;
      const n = overlays.filter((o) => o.type === 'image').length + 1;
      const o = { id: 'img' + Date.now(), type: 'image', name: '🖼️ Resim ' + n, on: true, x: 3, y: 3, w: 18, src, aspect: a.width && a.height ? a.height / a.width : 1 };
      setOverlays((list) => [...list, o]);
      setSel(o.id);
    } catch (e) {
      setError('Resim eklenemedi: ' + String(e?.message || e));
    }
  };
  const saveWeb = () => {
    const url = (addWeb?.url || '').trim();
    if (!/^https:\/\/[^\s]+$/i.test(url)) { setError('Donate linki https:// ile başlamalı (sitenin "OBS / tarayıcı kaynağı" linki).'); return; }
    const sh = SHAPE[addWeb.shape] ? addWeb.shape : 'bar';
    const n = overlays.filter((o) => o.type === 'web').length + 1;
    const o = { id: 'web' + Date.now(), type: 'web', name: '💰 Donate ' + n, on: true, x: 3, y: sh === 'bar' ? 84 : 55, w: SHAPE[sh].w, src: url, shape: sh };
    setOverlays((list) => [...list, o]);
    setSel(o.id);
    setAddWeb(null);
    setError('');
  };
  const selOv = overlays.find((o) => o.id === sel);
  const panelTop = !!selOv && selOv.on && selOv.y + hPct(selOv) / 2 > 50;

  const saveKeys = (k) => { setKeys(k); AsyncStorage.setItem(KEY_STORE, JSON.stringify(k)).catch(() => {}); };
  const saveQuality = (q, k = kbps) => { setQuality(q); setKbps(k); AsyncStorage.setItem(SET_STORE, JSON.stringify({ quality: q, kbps: k })).catch(() => {}); };
  const applyKbps = () => {
    const v = Math.round(Number(kbpsText));
    if (!kbpsText.trim()) return saveQuality(quality, 0);
    if (!(v >= 300 && v <= 20000)) { setError('Bitrate 300 ile 20000 kbps arasında olmalı (örn: 4500).'); return; }
    setError('');
    saveQuality(quality, v);
  };

  const targets = () => {
    if (keys.via === 'restream') return [joinUrl((keys.restreamUrl || RESTREAM_INGEST).trim(), (keys.restreamKey || '').trim()), ''];
    if (keys.via === 'custom') {
      const u = (keys.customUrl || '').trim(), k = (keys.customKey || '').trim();
      return [/^rtmps?:\/\//i.test(u) ? (k ? joinUrl(u, k) : u) : '', ''];
    }
    return [
      keys.useTwitch && keys.twitch.trim() ? TWITCH_INGEST + keys.twitch.trim() : '',
      keys.useKick ? joinUrl(keys.kickUrl.trim(), keys.kick.trim()) : '',
    ];
  };
  const start = async (only) => {
    if (keys.via && !unlocked) return proAlert(); // Restream / Özel RTMP Pro'da
    let t = targets();
    if (!t[0] && !t[1]) { setSetup(true); return; }
    if (only === 'twitch') t = [t[0], ''];
    if (only === 'kick') t = ['', t[1]];
    // Pro değilse aynı anda iki platform yok: hangisine başlasın?
    if (!unlocked && t[0] && t[1]) {
      Alert.alert('⭐ Twitch + Kick aynı anda Pro\'da', 'Şimdilik tek platforma yayın açabilirsin. Hangisi?', [
        { text: 'Twitch', onPress: () => start('twitch') },
        { text: 'Kick', onPress: () => start('kick') },
        { text: 'Vazgeç', style: 'cancel' },
      ]);
      return;
    }
    setError('');
    try {
      await ref.current?.start(t);
      setRunning(true);
      setStartedAt(Date.now());
    } catch (e) {
      setError('Başlatılamadı: ' + String(e?.message || e));
    }
  };
  const stop = async () => {
    try { await ref.current?.stop(); } catch {}
    setRunning(false);
    setStatus({ twitch: 'idle', kick: 'idle' });
  };
  const askStop = () =>
    Alert.alert('Yayını bitir', 'Yayın kapatılsın mı?', [
      { text: 'Vazgeç', style: 'cancel' },
      { text: 'Bitir', style: 'destructive', onPress: stop },
    ]);
  const close = () => {
    if (running) {
      Alert.alert('Yayın sürüyor', 'Ekrandan çıkarsan yayın biter. Bitirilsin mi?', [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Yayını bitir', style: 'destructive', onPress: async () => { await stop(); onClose(); } },
      ]);
    } else onClose();
  };

  // 🔋 Şarj / ısı uyarısı: dakikada bir birkaç saniye görünür, sonra kaybolur (ekranı sürekli kaplamasın)
  const pw = stats.power || {};
  const powerMsgs = [];
  if (pw.battery > 0 && pw.battery <= 20 && !pw.charging) powerMsgs.push(`🔋 Şarj %${Math.round(pw.battery)}: telefon yavaşlar, şarja tak`);
  if (pw.save) powerMsgs.push('🔋 Pil tasarrufu açık: kapatırsan görüntü daha akıcı olur');
  if (pw.thermal >= 2) powerMsgs.push(pw.thermal >= 3 ? '🌡️ Telefon çok ısındı: kare hızı 20\'ye düşürüldü' : '🌡️ Telefon ısındı: kare hızı 24\'e sabitlendi');
  else if (pw.thermal === 1) powerMsgs.push('🌡️ Telefon ısınmaya başladı: kılıfı çıkar, güneşte bırakma');
  const powerMsg = powerMsgs.join('  ·  ');
  const powerKey = powerMsg.replace(/%\d+/, '%'); // şarj yüzdesi her düştüğünde yeniden göstermesin
  const [powerShow, setPowerShow] = useState(false);
  useEffect(() => {
    if (!powerKey) return setPowerShow(false);
    let hide;
    const show = () => {
      setPowerShow(true);
      clearTimeout(hide);
      hide = setTimeout(() => setPowerShow(false), 6000);
    };
    show();
    const every = setInterval(show, 60 * 1000);
    return () => {
      clearInterval(every);
      clearTimeout(hide);
    };
  }, [powerKey]);

  const pill = { borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, overflow: 'hidden' };
  const btn = (bg) => ({ paddingHorizontal: 12, minWidth: 46, height: 46, borderRadius: 23, justifyContent: 'center', alignItems: 'center', backgroundColor: bg });
  const txt = { color: '#fff', fontWeight: '700', fontSize: 15 };
  const sbtn = (bg) => ({ paddingHorizontal: 12, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', backgroundColor: bg });
  const stxt = { color: '#fff', fontWeight: '700', fontSize: 14 };
  // Ekrandaki durum yazıları: Restream / özel RTMP'de tek çıkış (1. yuva) kullanılır
  const platforms = keys.via ? ['twitch'] : ['twitch', 'kick'].filter((p) => (p === 'twitch' ? keys.useTwitch && keys.twitch : keys.useKick && keys.kick && keys.kickUrl));
  const RS_FOR = { both: 'Twitch + Kick', twitch: 'Twitch', kick: 'Kick' };
  const outLabel = (p) =>
    keys.via === 'custom' ? `${VIA.custom} → ${LABEL[keys.customFor || 'kick']}` : keys.via === 'restream' ? `${VIA.restream} → ${RS_FOR[keys.restreamFor || 'both']}` : LABEL[p];
  // Durum yazısının başındaki logolar
  const outLogos = (p) =>
    keys.via === 'custom' ? [keys.customFor || 'kick'] : keys.via === 'restream' ? ['restream'] : [p];
  // 💬 Chat'i gösterilecek platformlar: yayının gittiği yerler (kanal: girişli hesap ya da chat ekranındaki kanal)
  const chatPlats = (() => {
    const want = keys.via === 'custom' ? [keys.customFor || 'kick'] : keys.via === 'restream' ? ((keys.restreamFor || 'both') === 'both' ? ['twitch', 'kick'] : [keys.restreamFor]) : platforms.length ? platforms : ['twitch', 'kick'];
    return want.filter((p) => chatChannels[p]);
  })();
  const split = chatOn && !layoutMode;
  const wide = box.w > box.h;
  // Bölünmüş ekranda üst yazılar ve alt tuşlar sadece görüntü yarısında kalsın (chat'in üstüne binmesin)
  const chatW = split && wide ? Math.round(box.w * 0.4) : 0;
  const chatH = split && !wide ? Math.round(box.h / 2) : 0;
  // ✏️ Başlık / Kategori hangi platformla açılsın
  const editFirst = () =>
    keys.via === 'custom' ? keys.customFor || 'kick' : keys.via === 'restream' ? (keys.restreamFor === 'kick' ? 'kick' : 'twitch') : keys.useTwitch || !keys.useKick ? 'twitch' : 'kick';
  const anyLive = platforms.some((p) => status[p] === 'live');

  return (
    <Modal animationType="slide" onRequestClose={close} supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}>
      <View style={{ flex: 1, backgroundColor: '#000' }} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        <View style={{ flex: 1, flexDirection: wide ? 'row' : 'column' }}>
        <View style={{ flex: split && wide ? 3 : 1, minHeight: 80, minWidth: 80 }}>
        {PenguLiveView ? (
          <PenguLiveView
            ref={ref}
            style={{ flex: 1 }}
            overlays={ovJson}
            quality={!unlocked && quality === 'high' ? 'mid' : quality}
            bitrateKbps={kbps}
            onStatus={(e) => {
              const { platform, state, message } = e.nativeEvent;
              setStatus((s) => ({ ...s, [platform]: state }));
              if (state === 'error' && message) setError(`${keys.via ? VIA[keys.via] : LABEL[platform]}: ${message}`);
            }}
            onStats={(e) => setStats(e.nativeEvent)}
            onLevel={(e) => levelSink.current?.(e.nativeEvent?.v || 0)}
            onNotice={(e) => {
              const m = String(e.nativeEvent?.message || '');
              if (m) setError(m);
              if (/kamera/i.test(m)) updOv('cam', { on: false }); // ikinci kamera açılamadıysa kapat
            }}
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff' }}>Yayın sadece telefonda.</Text></View>
        )}
        </View>
        {split && (
          <ChatPanel
            store={chatStore}
            onViewers={(p, n) => setOwnViewers((v) => (v[p] === n ? v : { ...v, [p]: n }))}
            liveChat={liveChat}
            plats={chatPlats}
            channels={chatChannels}
            userAgent={userAgent}
            // Oranla (sabit piksel değil): dönerken eski ölçü kalsa bile kamera alanı hiç sıfıra inmesin
            style={wide ? { flex: 2, paddingTop: ins.top, paddingRight: ins.right, paddingBottom: ins.bottom } : { flex: 1, paddingBottom: ins.bottom, paddingLeft: ins.left, paddingRight: ins.right }}
          />
        )}
        </View>

        {/* 🖼️ Düzenleme: her öğenin kutusu; sürükleyerek taşı */}
        {layoutMode && box.w > 0 && overlays.filter((o) => o.on).map((o) => (
          <DragBox key={o.id} o={o} rect={rect} hp={hPct(o)} selected={sel === o.id} onSelect={setSel} onMove={updOv} />
        ))}

        {/* Üst: süre + her platformun durumu ve bitrate'i */}
        {!layoutMode && (
        <View style={{ position: 'absolute', top: ins.top + 10, left: ins.left + 12, right: ins.right + 12 + chatW, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[pill, { color: '#fff', fontWeight: '700', backgroundColor: running && anyLive ? '#dc2626' : 'rgba(0,0,0,.6)' }]}>
              {running ? (anyLive ? `● CANLI ${fmtTime(Math.floor((Date.now() - startedAt) / 1000))}` : 'Bağlanıyor…') : 'Yayında değil'}
            </Text>
            <Text style={[pill, { color: '#fff', backgroundColor: 'rgba(0,0,0,.6)' }]}>{QUALITY[quality]}{kbps ? ` · ${kbps} kbps` : ''}</Text>
            {/* 👁 İzleyici sayısı (Twitch / Kick) */}
            {chatPlats.some((p) => (ownViewers[p] ?? viewers[p]) != null) && (
              <View style={[pill, { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: 'rgba(0,0,0,.6)' }]}>
                <Text style={{ color: '#fff' }}>👁</Text>
                {chatPlats.filter((p) => (ownViewers[p] ?? viewers[p]) != null).map((p) => (
                  <View key={p} style={{ flexDirection: 'row', alignItems: 'center', gap: 3 }}>
                    <Logo k={p} size={14} />
                    <Text style={{ color: '#fff', fontWeight: '700' }}>{ownViewers[p] ?? viewers[p]}</Text>
                  </View>
                ))}
              </View>
            )}
            <View style={{ flex: 1 }} />
            <Pressable onPress={close} hitSlop={10} style={{ backgroundColor: 'rgba(0,0,0,.6)', borderRadius: 18, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 18 }}>✕</Text>
            </Pressable>
          </View>
          {running && (
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {platforms.map((p) => (
                <View key={p} style={[pill, { flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: status[p] === 'live' ? (keys.via ? '#0e7490' : p === 'twitch' ? '#9146ff' : '#16a34a') : 'rgba(0,0,0,.6)' }]}>
                  {outLogos(p).map((l) => <Logo key={l} k={l} />)}
                  <Text style={{ color: '#fff' }}>{outLabel(p)} · {STATE[status[p]] || status[p]} · 📶 {mbps(stats[p])}</Text>
                </View>
              ))}
            </View>
          )}
          {/* 🔇 Mikrofon kapalıyken hep görünür */}
          {muted && (
            <Pressable onPress={toggleMic}>
              <Text style={[pill, { color: '#fff', backgroundColor: '#dc2626', fontWeight: '700' }]}>🔇 Mikrofon KAPALI — izleyiciler sesini duymuyor (açmak için dokun)</Text>
            </Pressable>
          )}
          {/* 🔋 Şarj / ısı uyarısı (uygulama bu durumda kare hızını kendiliğinden sabitler); dokununca hemen kapanır */}
          {powerShow && !!powerMsg && (
            <Pressable onPress={() => setPowerShow(false)}>
              <Text style={[pill, { color: '#111', backgroundColor: '#fdba74' }]}>{powerMsg}</Text>
            </Pressable>
          )}
          {running && !stats.lowMode && stats.current > 0 && stats.target > 0 && stats.current < stats.target * 0.9 && (
            <Text style={[pill, { color: '#111', backgroundColor: '#fde68a' }]}>📉 İnternet yetişmiyor: görüntü kalitesi {mbps(stats.current)}'e düşürüldü (takılmasın diye). Bağlantı rahatlayınca kendiliğinden geri çıkar.</Text>
          )}
          {running && stats.lowMode && (
            <Text style={[pill, { color: '#111', backgroundColor: '#fbbf24', fontWeight: '700' }]}>⚠️ Bitrate düşük — izleyiciler "Bitrate düşük, lütfen bekleyiniz" yazısını görüyor (bağlantı düzelince kameraya döner)</Text>
          )}
          {!!error && (
            <Pressable onPress={() => setError('')} style={{ backgroundColor: 'rgba(220,38,38,.92)', borderRadius: 10, padding: 10 }}>
              <Text style={{ color: '#fff' }}>{error}</Text>
            </Pressable>
          )}
        </View>
        )}

        {/* 🖼️ Ekran öğeleri paneli: seçili öğe alttaysa panel üste geçer (öğeyi kapatmasın) */}
        {layoutMode && (
          <View style={[{ position: 'absolute', left: ins.left + 8, right: ins.right + 8, backgroundColor: 'rgba(0,0,0,.8)', borderRadius: 12, padding: 6, gap: 6 }, panelTop ? { top: ins.top + 8 } : { bottom: ins.bottom + 8 }]}>
            {!!error && (
              <Pressable onPress={() => setError('')} style={{ backgroundColor: 'rgba(220,38,38,.92)', borderRadius: 8, padding: 8 }}>
                <Text style={{ color: '#fff' }}>{error}</Text>
              </Pressable>
            )}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 6 }} keyboardShouldPersistTaps="handled">
              {overlays.map((o) => (
                <Pressable key={o.id} onPress={() => setSel(o.id)} style={{ paddingHorizontal: 10, height: 32, borderRadius: 16, justifyContent: 'center', borderWidth: 1, borderColor: sel === o.id ? '#fbbf24' : 'rgba(255,255,255,.3)', backgroundColor: sel === o.id ? 'rgba(251,191,36,.2)' : 'transparent', opacity: o.on ? 1 : 0.55 }}>
                  <Text style={{ color: '#fff', fontWeight: '600' }}>{o.name}{o.on ? '' : ' (kapalı)'}</Text>
                </Pressable>
              ))}
            </ScrollView>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} style={{ flex: 1 }} contentContainerStyle={{ gap: 6, alignItems: 'center' }}>
                {selOv && (
                  <>
                    <Pressable style={sbtn(selOv.on ? 'rgba(255,255,255,.15)' : '#16a34a')} onPress={() => (!unlocked && selOv.type === 'logo' ? proAlert() : updOv(selOv.id, { on: !selOv.on }))}>
                      <Text style={stxt}>{selOv.on ? '🙈 Gizle' : '👁️ Göster'}</Text>
                    </Pressable>
                    <Pressable style={sbtn('rgba(255,255,255,.15)')} onPress={() => resize(selOv.id, -2)} disabled={!selOv.on}><Text style={stxt}>➖ Küçült</Text></Pressable>
                    <Pressable style={sbtn('rgba(255,255,255,.15)')} onPress={() => resize(selOv.id, 2)} disabled={!selOv.on}><Text style={stxt}>➕ Büyüt</Text></Pressable>
                    {selOv.type === 'cam' && selOv.on && (
                      <>
                        {Platform.OS === 'android' && <Pressable style={sbtn('rgba(255,255,255,.15)')} onPress={() => updOv('cam', { rot: ((selOv.rot || 0) + 1) % 4 })}><Text style={stxt}>↻ Döndür</Text></Pressable>}
                        <Pressable style={sbtn(selOv.mirror ? '#0e8f8a' : 'rgba(255,255,255,.15)')} onPress={() => updOv('cam', { mirror: !selOv.mirror })}><Text style={stxt}>⇋ Ayna</Text></Pressable>
                      </>
                    )}
                    {selOv.type === 'web' && (
                      <Pressable style={sbtn(selOv.sound === false ? 'rgba(220,38,38,.85)' : 'rgba(255,255,255,.15)')} onPress={() => updOv(selOv.id, { sound: selOv.sound === false })}>
                        <Text style={stxt}>{selOv.sound === false ? '🔇 Ses kapalı' : '🔊 Ses açık'}</Text>
                      </Pressable>
                    )}
                    {selOv.type !== 'logo' && selOv.type !== 'cam' && (
                      <Pressable style={sbtn('rgba(220,38,38,.85)')} onPress={() => removeOv(selOv)}><Text style={stxt}>🗑️</Text></Pressable>
                    )}
                    <View style={{ width: 1, height: 24, backgroundColor: 'rgba(255,255,255,.3)' }} />
                  </>
                )}
                <Pressable style={sbtn('#f59e0b')} onPress={() => (unlocked ? setAddWeb({ url: '', shape: 'bar' }) : proAlert())}><Text style={stxt}>＋ Donate bar</Text></Pressable>
                <Pressable style={sbtn('#0e8f8a')} onPress={pickImage}><Text style={stxt}>＋ Resim / logo</Text></Pressable>
              </ScrollView>
              <Pressable style={sbtn('#9146ff')} onPress={() => { setLayoutMode(false); setError(''); }}><Text style={stxt}>Bitti</Text></Pressable>
            </View>
            {portrait && <Text style={{ color: 'rgba(255,255,255,.7)', fontSize: 11 }}>Kutuyu parmağınla sürükleyerek taşı. Burada gördüğün gibi yayına gider{running ? ' (şu an yayındasın)' : ''}.</Text>}
          </View>
        )}

        {/* 🎤 Mikrofon açıldı / kapandı: ortada kısa yazı */}
        {!!micToast && (
          <View pointerEvents="none" style={{ position: 'absolute', top: 0, bottom: chatH, left: 0, right: chatW, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 22, fontWeight: '800', backgroundColor: micToast.bg, paddingHorizontal: 18, paddingVertical: 10, borderRadius: 14, overflow: 'hidden' }}>
              {micToast.t}
            </Text>
          </View>
        )}

        {/* Alt tuşlar */}
        {!layoutMode && (
        <View style={{ position: 'absolute', bottom: Math.max(18, ins.bottom + 6) + chatH, left: ins.left + 8, right: ins.right + 8 + chatW, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
          <Pressable style={btn('rgba(0,0,0,.6)')} onPress={() => ref.current?.switchCamera()}>
            <Text style={txt}>🔄</Text>
          </Pressable>
          <Pressable style={btn(muted ? '#dc2626' : 'rgba(0,0,0,.6)')} onPress={toggleMic}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <Text style={txt}>{muted ? '🔇' : '🎤'}</Text>
              <MicWave sink={levelSink} muted={muted} />
            </View>
          </Pressable>
          <Pressable style={btn(chatOn ? '#9146ff' : 'rgba(0,0,0,.6)')} onPress={toggleChat}>
            <Text style={txt}>💬</Text>
          </Pressable>
          {running ? (
            <Pressable style={[btn('#dc2626'), { paddingHorizontal: 22 }]} onPress={askStop}><Text style={txt}>■ Bitir</Text></Pressable>
          ) : (
            <Pressable style={[btn('#9146ff'), { paddingHorizontal: 22 }]} onPress={() => start()}><Text style={txt}>● Yayına başla</Text></Pressable>
          )}
          <Pressable style={btn('rgba(0,0,0,.6)')} onPress={() => { setEditWeb(false); setEdit(editFirst()); }}>
            <Text style={txt}>✏️</Text>
          </Pressable>
          <Pressable style={btn(camOv?.on ? '#0e8f8a' : 'rgba(0,0,0,.6)')} onPress={toggleCam}>
            <Text style={txt}>🤳</Text>
          </Pressable>
          <Pressable style={btn('rgba(0,0,0,.6)')} onPress={() => { setError(''); setLayoutMode(true); }}>
            <Text style={txt}>🖼️</Text>
          </Pressable>
          <Pressable
            style={btn(rot === 'auto' ? 'rgba(0,0,0,.6)' : '#0e8f8a')}
            onPress={() => setRotation(portrait ? 'land' : 'port')} // her dokunuşta çevirir
            onLongPress={() => setRotation('auto')} // basılı tut: otomatik döndürmeye dön
            delayLongPress={600}
            accessibilityLabel="Ekranı döndür"
          >
            <Text style={txt}>{rot === 'auto' ? '📱↻' : rot === 'land' ? '📱⇆' : '📱⇅'}</Text>
          </Pressable>
          <Pressable style={btn('rgba(0,0,0,.6)')} onPress={() => setSetup(true)}>
            <Text style={txt}>⚙️</Text>
          </Pressable>
        </View>
        )}

        {/* ＋ Donate bar: linki gir */}
        {addWeb && (
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,.7)', justifyContent: 'center', padding: 14 }}>
            <ScrollView contentContainerStyle={{ backgroundColor: C.panel, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14, gap: 8 }} keyboardShouldPersistTaps="handled">
              <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>💰 Donate bar ekle</Text>
              <Text style={{ color: C.muted, fontSize: 12 }}>Bağış sitendeki (Bagış Al, Jetonbank, Streamlabs, StreamElements…) bağış hedefi / uyarı için verilen "OBS" ya da "tarayıcı kaynağı" linkini yapıştır. Twitch ve Kick yayınının ikisinde de görünür.</Text>
              <Field C={C} value={addWeb.url} onChange={(v) => setAddWeb({ ...addWeb, url: v.trim() })} placeholder="https://…" secure />
              <Text style={{ color: C.muted, fontSize: 11 }}>Bu link gizli anahtar gibidir: sadece bu telefonda saklanır, kimseyle paylaşma.</Text>
              <Text style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>Şekil</Text>
              <View style={{ flexDirection: 'row', gap: 6 }}>
                {Object.entries(SHAPE).map(([k, v]) => (
                  <Pressable key={k} onPress={() => setAddWeb({ ...addWeb, shape: k })} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: addWeb.shape === k ? '#9146ff' : C.border, backgroundColor: addWeb.shape === k ? '#9146ff' : C.input }}>
                    <Text style={{ color: addWeb.shape === k ? '#fff' : C.text, fontWeight: '600' }}>{v.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={{ color: C.muted, fontSize: 11 }}>Abone / bağış uyarılarının sesleri de yayına gider (mikrofon sesinin üstüne). İstersen 🔊 tuşuyla kapatabilirsin. Sesleri telefondan duymazsın, sadece izleyiciler duyar.</Text>
              <View style={{ flexDirection: 'row', gap: 8, justifyContent: 'flex-end', marginTop: 6 }}>
                <Pressable onPress={() => setAddWeb(null)} style={{ paddingHorizontal: 18, height: 40, borderRadius: 8, borderWidth: 1, borderColor: C.border, justifyContent: 'center' }}>
                  <Text style={{ color: C.text, fontWeight: '700' }}>Vazgeç</Text>
                </Pressable>
                <Pressable onPress={saveWeb} style={{ paddingHorizontal: 18, height: 40, borderRadius: 8, backgroundColor: '#9146ff', justifyContent: 'center' }}>
                  <Text style={{ color: '#fff', fontWeight: '700' }}>Ekle</Text>
                </Pressable>
              </View>
              {!!error && <Text style={{ color: '#dc2626' }}>{error}</Text>}
            </ScrollView>
          </View>
        )}

        {/* ✏️ Başlık / kategori: sade pencere (yayın anahtarı ekranı gibi) */}
        {edit && !editWeb && (
          <InfoSheet C={C} ins={ins} platform={edit} setPlatform={setEdit} userAgent={userAgent} onClose={() => setEdit(null)} onWeb={() => setEditWeb(true)} />
        )}

        {/* ✏️ Yedek: platformun kendi sayfası */}
        {edit && editWeb && (
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: C.panel, paddingTop: ins.top, paddingBottom: ins.bottom, paddingLeft: ins.left, paddingRight: ins.right }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, padding: 8, borderBottomWidth: 1, borderBottomColor: C.border }}>
              <Text style={{ color: C.text, fontWeight: '700', fontSize: 15, marginRight: 4 }}>✏️ Başlık / Kategori</Text>
              {['twitch', 'kick'].map((p) => (
                <Pressable key={p} onPress={() => setEdit(p)} style={{ paddingHorizontal: 12, height: 34, borderRadius: 8, justifyContent: 'center', borderWidth: 1, borderColor: edit === p ? (p === 'twitch' ? '#9146ff' : '#16a34a') : C.border, backgroundColor: edit === p ? (p === 'twitch' ? '#9146ff' : '#16a34a') : C.input }}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Logo k={p} /><Text style={{ color: edit === p ? '#fff' : C.text, fontWeight: '700' }}>{LABEL[p]}</Text></View>
                </Pressable>
              ))}
              <View style={{ flex: 1 }} />
              <Pressable onPress={() => setEdit(null)} hitSlop={10} style={{ paddingHorizontal: 12, height: 34, borderRadius: 8, justifyContent: 'center', backgroundColor: '#9146ff' }}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Bitti</Text>
              </Pressable>
            </View>
            <Text style={{ color: C.muted, fontSize: 12, paddingHorizontal: 10, paddingVertical: 4 }}>
              {edit === 'twitch' ? 'Twitch: "Yayın bilgisini düzenle" ile başlığı ve kategoriyi değiştirip kaydet.' : 'Kick: başlığı ve kategoriyi yazıp kaydet.'} Giriş istenirse uygulamadaki gibi giriş yap.
            </Text>
            <WebView
              key={edit}
              source={{ uri: EDIT_URL[edit] }}
              style={{ flex: 1 }}
              userAgent={userAgent}
              sharedCookiesEnabled
              thirdPartyCookiesEnabled
              domStorageEnabled
              javaScriptEnabled
              setSupportMultipleWindows={false}
              mixedContentMode="never"
              allowFileAccess={false}
              onShouldStartLoadWithRequest={(req) => {
                if (req.isTopFrame === false || isInternalUrl(req.url)) return true;
                // iPhone: sayfanın kendi yönlendirmeleri (giriş, yeniden yükleme) içeride kalsın; sadece dokunulan dış link tarayıcıda açılsın
                if (Platform.OS === 'ios' && req.navigationType && req.navigationType !== 'click') return true;
                Linking.openURL(req.url).catch(() => {});
                return false;
              }}
            />
          </View>
        )}

        {/* Ayarlar: Twitch + Kick anahtarları, kalite */}
        {setup && (
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,.7)', justifyContent: 'center', padding: 14 }}>
            <ScrollView contentContainerStyle={{ backgroundColor: C.panel, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14, gap: 8 }} keyboardShouldPersistTaps="handled">
              <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>📡 Yayın ayarları</Text>
              <Text style={{ color: C.muted, fontSize: 12 }}>Anahtarlar sadece bu telefonda saklanır. Kimseyle paylaşma.</Text>

              <View style={{ opacity: keys.via ? 0.4 : 1, gap: 8 }} pointerEvents={keys.via ? 'none' : 'auto'}>
              <Toggle C={C} on={!keys.via && keys.useTwitch} logo="twitch" label="Twitch'e yayın" onPress={() => saveKeys({ ...keys, useTwitch: !keys.useTwitch })} />
              <Field C={C} value={keys.twitch} onChange={(v) => saveKeys({ ...keys, twitch: v.trim() })} placeholder="Twitch yayın anahtarı (live_…)" secure />
              <Text style={{ color: C.muted, fontSize: 11 }}>Twitch → Creator Dashboard → Ayarlar → Yayın → Birincil yayın anahtarı</Text>

              <Toggle C={C} on={!keys.via && keys.useKick} logo="kick" label="Kick'e yayın" onPress={() => saveKeys({ ...keys, useKick: !keys.useKick })} />
              <Field C={C} value={keys.kickUrl} onChange={(v) => saveKeys({ ...keys, kickUrl: v.trim() })} placeholder="Kick Stream URL (rtmps://…)" />
              <Field C={C} value={keys.kick} onChange={(v) => saveKeys({ ...keys, kick: v.trim() })} placeholder="Kick Stream Key" secure />
              <Text style={{ color: C.muted, fontSize: 11 }}>Kick → Creator Dashboard → Ayarlar → Yayın anahtarı: "Stream URL" ve "Stream Key"</Text>
              </View>

              {/* 🔁 Restream: telefon tek yayın gönderir, Restream Twitch / Kick'e kendisi dağıtır (internet yarıya iner) */}
              <Toggle C={C} on={keys.via === 'restream'} logo="restream" label={`Restream üzerinden (tek yayın)${unlocked ? '' : ' ⭐'}`} onPress={() => (!unlocked && keys.via !== 'restream' ? proAlert() : saveKeys({ ...keys, via: keys.via === 'restream' ? '' : 'restream' }))} />
              {keys.via === 'restream' && (
                <>
                  <Text style={{ color: C.muted, fontSize: 12 }}>Restream yayını nereye dağıtıyor?</Text>
                  <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
                    {[['both', 'Twitch + Kick', '#0e7490', ['twitch', 'kick']], ['kick', 'Kick', '#16a34a', ['kick']], ['twitch', 'Twitch', '#9146ff', ['twitch']]].map(([v, l, col, lg]) => {
                      const on = (keys.restreamFor || 'both') === v;
                      return (
                        <Pressable key={v} onPress={() => saveKeys({ ...keys, restreamFor: v })} style={{ paddingHorizontal: 14, height: 36, borderRadius: 8, justifyContent: 'center', borderWidth: 1, borderColor: on ? col : C.border, backgroundColor: on ? col : C.input }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>{lg.map((x) => <Logo key={x} k={x} />)}<Text style={{ color: on ? '#fff' : C.text, fontWeight: '700' }}>{l}</Text></View>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Field C={C} value={keys.restreamUrl || RESTREAM_INGEST} onChange={(v) => saveKeys({ ...keys, restreamUrl: v.trim() })} placeholder={RESTREAM_INGEST} />
                  <Field C={C} value={keys.restreamKey || ''} onChange={(v) => saveKeys({ ...keys, restreamKey: v.trim() })} placeholder="Restream yayın anahtarı (Stream Key)" secure />
                  <Text style={{ color: C.muted, fontSize: 11 }}>Restream → Kaynak / OBS ayarları → RTMP URL ve Stream Key. Telefon tek yayın gönderir, platformlara Restream dağıtır; internet yarıya iner. Seçtiğin platform ekranda yazar ve ✏️ Başlık / Kategori onu açar. Açıkken yukarıdaki Twitch / Kick kullanılmaz.</Text>
                </>
              )}

              {/* 🖥️ Özel RTMP: PC'deki OBS'e, kendi sunucuna ya da başka bir servise */}
              <Toggle C={C} on={keys.via === 'custom'} label={`🖥️ Özel RTMP (PC / OBS / kendi sunucun)${unlocked ? '' : ' ⭐'}`} onPress={() => (!unlocked && keys.via !== 'custom' ? proAlert() : saveKeys({ ...keys, via: keys.via === 'custom' ? '' : 'custom' }))} />
              {keys.via === 'custom' && (
                <>
                  <Text style={{ color: C.muted, fontSize: 12 }}>Bu yayın hangi platformda açılıyor?</Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {['kick', 'twitch'].map((p) => {
                      const on = (keys.customFor || 'kick') === p;
                      const col = p === 'twitch' ? '#9146ff' : '#16a34a';
                      return (
                        <Pressable key={p} onPress={() => saveKeys({ ...keys, customFor: p })} style={{ paddingHorizontal: 16, height: 36, borderRadius: 8, justifyContent: 'center', borderWidth: 1, borderColor: on ? col : C.border, backgroundColor: on ? col : C.input }}>
                          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Logo k={p} /><Text style={{ color: on ? '#fff' : C.text, fontWeight: '700' }}>{LABEL[p]}</Text></View>
                        </Pressable>
                      );
                    })}
                  </View>
                  <Field C={C} value={keys.customUrl || ''} onChange={(v) => saveKeys({ ...keys, customUrl: v.trim() })} placeholder="rtmp://… ya da rtmps://… adresi" />
                  <Field C={C} value={keys.customKey || ''} onChange={(v) => saveKeys({ ...keys, customKey: v.trim() })} placeholder="Anahtar (varsa)" secure />
                  <Text style={{ color: C.muted, fontSize: 11 }}>PC'deki yayın programının (OBS vb.) ya da sunucunun verdiği RTMP adresi. Anahtar adresin içindeyse anahtar kutusunu boş bırak. Seçtiğin platform ekranda yazar ve ✏️ Başlık / Kategori onu açar. Açıkken yukarıdaki Twitch / Kick kutuları kullanılmaz.</Text>
                </>
              )}

              <Text style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>Kalite (iki platforma birden gider; yayın sırasında değişmez)</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {Object.entries(QUALITY).map(([k, v]) => (
                  <Pressable key={k} onPress={() => (running ? (k !== quality && Alert.alert('Yayın sırasında değişmez', 'Çözünürlük (480p / 720p / 1080p) yayın açıkken değiştirilemez, değişirse yayın kopar. ■ Bitir → kaliteyi seç → ● Yayına başla.\n\nYayın sırasında aşağıdaki bitrate değiştirilebilir.')) : !unlocked && k === 'high' ? proAlert() : saveQuality(k))} style={{ opacity: running && quality !== k ? 0.4 : 1, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: quality === k ? '#9146ff' : C.border, backgroundColor: quality === k ? '#9146ff' : C.input }}>
                    <Text style={{ color: quality === k ? '#fff' : C.text, fontWeight: '600' }}>{v}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>Bitrate (kbps) — boş bırakırsan kaliteye göre: 480p 1500, 720p 3000, 1080p 6000</Text>
              <View style={{ flexDirection: 'row', gap: 6, alignItems: 'center' }}>
                <TextInput
                  value={kbpsText}
                  onChangeText={(v) => setKbpsText(v.replace(/[^0-9]/g, '').slice(0, 5))}
                  onEndEditing={applyKbps}
                  onSubmitEditing={applyKbps}
                  placeholder="örn: 4500"
                  placeholderTextColor={C.ph}
                  keyboardType="number-pad"
                  style={{ flex: 1, height: 42, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.input, color: C.text, paddingHorizontal: 10 }}
                />
                <Text style={{ color: C.text, fontWeight: '600' }}>kbps</Text>
              </View>
              <Text style={{ color: C.muted, fontSize: 11 }}>İki platforma birden gittiği için internetin yükleme hızı bunun en az 2,5 katı olmalı (ör. 3000 kbps için 7,5 Mbps). İnternet yetmezse uygulama bitrate'i kendiliğinden düşürür. Yayın sırasında da değiştirilebilir.</Text>
              <Text style={{ color: C.muted, fontSize: 11 }}>Öneri: çift yayında Orta (720p) + 2500–3500 kbps. 1080p telefonu ısıtıp kare hızını düşürebilir.</Text>
              <Pressable onPress={() => { applyKbps(); setSetup(false); }} style={{ alignSelf: 'flex-end', paddingHorizontal: 18, height: 40, borderRadius: 8, backgroundColor: '#9146ff', justifyContent: 'center', marginTop: 6 }}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Tamam</Text>
              </Pressable>
            </ScrollView>
          </View>
        )}
      </View>
    </Modal>
  );
}

// 🎙️ Ses dalgası: yayına giden sesin seviyesi (yeşil çubuklar oynuyorsa ses gidiyor).
// Seviye saniyede 8 kez gelir; çubuklar ekranı yeniden çizmeden, doğrudan animasyonla oynar.
const WAVE_N = 5;
function MicWave({ sink, muted }) {
  const vals = useRef([...Array(WAVE_N)].map(() => new Animated.Value(0.15))).current;
  const hist = useRef(Array(WAVE_N).fill(0));
  useEffect(() => {
    sink.current = (v) => {
      hist.current = [...hist.current.slice(1), v];
      hist.current.forEach((x, i) => Animated.timing(vals[i], { toValue: Math.max(0.15, x), duration: 110, useNativeDriver: true }).start());
    };
    return () => {
      sink.current = null;
    };
  }, [sink, vals]);
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, height: 22 }}>
      {vals.map((v, i) => (
        <Animated.View key={i} style={{ width: 3, height: 22, borderRadius: 2, backgroundColor: muted ? '#9ca3af' : '#22c55e', transform: [{ scaleY: v }] }} />
      ))}
    </View>
  );
}

// 💬 Yayın ekranındaki chat: görünmez Twitch / Kick chat sayfalarından mesajlar ve etkinlikler.
// Sadece yayıncının ekranında görünür, yayına gitmez.
const CHAT_MAX = 150;
// Rozetler (Twitch / Kick): yayıncı, mod, vip, abone…
const BADGE = { broadcaster: '🎥', moderator: '🗡️', vip: '💎', subscriber: '⭐', founder: '🏅', og: '👑', verified: '✔️', partner: '✔️', staff: '🛠️', sub_gifter: '🎁' };
const HIDDEN_WV = { position: 'absolute', left: 0, top: 0, right: 0, bottom: 0, opacity: 0, flex: 0, zIndex: -1, pointerEvents: 'none' };
const TINY_WV = { position: 'absolute', left: 0, top: 0, width: 1, height: 1, opacity: 0, flex: 0 };
function ChatPanel({ plats, channels, userAgent, style, liveChat, store, onViewers }) {
  // Mesajlar üstteki ekranda saklanır: panel kapanıp açılınca kaybolmaz
  const [list, setListState] = useState(() => store?.current.list || []);
  const setList = (fn) =>
    setListState((l) => {
      const n = fn(l);
      if (store) store.current.list = n;
      return n;
    });
  const [size, setSize] = useState(15);
  const [evOnly, setEvOnly] = useState(false);
  const seen = useRef(store?.current.seen || new Set());
  const add = (m) => {
    if (seen.current.has(m.id)) return;
    seen.current.add(m.id);
    if (seen.current.size > 600) {
      seen.current = new Set([...seen.current].slice(-300));
      if (store) store.current.seen = seen.current;
    }
    setList((l) => [m, ...l].slice(0, CHAT_MAX));
  };
  // 🗑️ Silinen mesaj / TO / ban: mesaj yerinde kalır ama "silindi" diye görünür
  const del = (d) => {
    const u = String(d.user || '').toLowerCase();
    const tag = d.ban === 'to' ? '⏱️ zaman aşımı' : d.ban === 'ban' ? '🚫 banlandı' : '🗑️ silindi';
    setList((l) =>
      l.map((m) =>
        m.kind === 'msg' && m.p === d.p && !m.del && (d.all || (d.id && m.id === d.id) || (u && String(m.user).toLowerCase() === u)) ? { ...m, del: d.all ? '🧹 chat temizlendi' : tag } : m,
      ),
    );
  };
  const onMsg = (data, from) => {
    if (typeof data !== 'string') return;
    try {
      if (data.startsWith('__PENGU_MSG__')) {
        const m = JSON.parse(data.slice(13));
        if (m && m.p) gotFrom.current[m.p] = true;
        if (m && m.text) add({ ...m, kind: 'msg' });
      } else if (data.startsWith('__PENGU_DEL__')) {
        const d = JSON.parse(data.slice(13));
        if (d && d.p) del(d);
      } else if (data.startsWith('__PENGU_VIEW__')) {
        const v = JSON.parse(data.slice(14));
        if (from && v && v.n !== -1) onViewers?.(from, v.n);
      } else if (data.startsWith('__PENGU_EVENT__')) {
        const e = JSON.parse(data.slice(15));
        if (e && e.id) add({ id: 'ev:' + e.id, p: e.p, kind: 'ev', user: e.user || '', text: `${EV_ICON[e.type] || '•'} ${evDescribe(e)}` });
      }
    } catch {}
  };
  // ⚡ Uygulamada aynı kanalın chat'i zaten açıksa onu kullan (ikinci sayfa açma: daha az internet ve pil)
  // Uygulamanın chat'inden 60 sn'de hiç mesaj gelmeyen platform için kendi sayfamızı aç (yedek)
  const [forceOwn, setForceOwn] = useState([]);
  const gotFrom = useRef({});
  const shared = plats.filter((p) => !forceOwn.includes(p) && liveChat?.current?.open(p) && liveChat.current.open(p) === String(channels[p]).toLowerCase());
  const own = plats.filter((p) => !shared.includes(p));
  const onMsgRef = useRef(onMsg);
  onMsgRef.current = onMsg;
  const sharedKey = shared.join(',');
  useEffect(() => {
    if (!sharedKey) return;
    const t = setTimeout(() => {
      const silent = sharedKey.split(',').filter((p) => !gotFrom.current[p]);
      if (silent.length) setForceOwn((f) => [...new Set([...f, ...silent])]);
    }, 60000);
    return () => clearTimeout(t);
  }, [sharedKey]);
  useEffect(() => {
    const lc = liveChat?.current;
    if (!lc) return;
    const ks = sharedKey ? sharedKey.split(',') : [];
    ks.forEach((k) => lc.start(k, (d) => onMsgRef.current(d)));
    return () => ks.forEach((k) => lc.stop(k));
  }, [sharedKey, liveChat]);
  // ⚡ Görünmez chat sayfalarını 1,5 sn sonra aç: 💬 açılınca kamera görüntüsü takılmasın
  const [ready, setReady] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setReady(true), 1500);
    return () => clearTimeout(t);
  }, []);
  // 👁 Kendi açtığımız chat sayfalarından izleyici sayısını 30 saniyede bir sor
  const wvs = useRef({});
  const ownKey = own.join(',');
  useEffect(() => {
    if (!ready || !ownKey) return;
    const ask = () =>
      ownKey.split(',').forEach((p) => wvs.current[p]?.injectJavaScript(`window.__penguViewers && window.__penguViewers(${JSON.stringify(String(channels[p]).toLowerCase())}); true;`));
    const t0 = setTimeout(ask, 6000);
    const t = setInterval(ask, 30000);
    return () => { clearTimeout(t0); clearInterval(t); };
  }, [ready, ownKey]); // eslint-disable-line react-hooks/exhaustive-deps
  const shown = evOnly ? list.filter((m) => m.kind === 'ev') : list;
  const cleanColor = (c) => (/^#[0-9a-f]{6}$/i.test(c || '') ? c : null);
  return (
    <View style={[{ backgroundColor: '#0e0e10' }, style]}>
      {ready && own.map((p) => (
        <WebView
          key={p + channels[p]}
          ref={(w) => (wvs.current[p] = w)}
          source={{ uri: PLATFORMS[p].chatUrl(String(channels[p]).toLowerCase()) }}
          style={HIDDEN_WV}
          containerStyle={HIDDEN_WV} // görünmez: panelin arkasında, panel boyutunda (Kick chat'i ekranda görünmeyen küçük sayfada bağlanmıyor)
          userAgent={userAgent}
          sharedCookiesEnabled
          thirdPartyCookiesEnabled
          domStorageEnabled
          javaScriptEnabled
          injectedJavaScriptBeforeContentLoaded={'window.__penguChatOn = 1; true;'}
          injectedJavaScript={'window.__penguChatOn = 1;\n' + PICK_USER_JS + '\ntrue;'}
          onMessage={(e) => onMsg(e.nativeEvent.data, p)}
          onShouldStartLoadWithRequest={(req) => req.isTopFrame === false || isInternalUrl(req.url)}
        />
      ))}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 10, paddingVertical: 6, borderBottomWidth: 1, borderBottomColor: '#26262c' }}>
        <Text style={{ color: '#fff', fontWeight: '700' }}>💬</Text>
        {plats.map((p) => <Logo key={p} k={p} />)}
        <Text style={{ color: '#aaa', fontSize: 12, flex: 1 }} numberOfLines={1}>
          {plats.map((p) => channels[p]).join(' · ')}
        </Text>
        <Pressable onPress={() => setEvOnly(!evOnly)} hitSlop={6} style={{ paddingHorizontal: 8, height: 26, borderRadius: 6, justifyContent: 'center', backgroundColor: evOnly ? '#f59e0b' : '#26262c' }}>
          <Text style={{ color: '#fff', fontSize: 12, fontWeight: '700' }}>Sadece etkinlik</Text>
        </Pressable>
        <Pressable onPress={() => setSize((v) => Math.max(11, v - 1))} hitSlop={6} style={{ paddingHorizontal: 8, height: 26, borderRadius: 6, justifyContent: 'center', backgroundColor: '#26262c' }}>
          <Text style={{ color: '#fff', fontSize: 12 }}>A–</Text>
        </Pressable>
        <Pressable onPress={() => setSize((v) => Math.min(22, v + 1))} hitSlop={6} style={{ paddingHorizontal: 8, height: 26, borderRadius: 6, justifyContent: 'center', backgroundColor: '#26262c' }}>
          <Text style={{ color: '#fff', fontSize: 12 }}>A+</Text>
        </Pressable>
      </View>
      {!plats.length ? (
        <Text style={{ color: '#aaa', padding: 14 }}>Chat için önce Twitch / Kick hesabına giriş yap ya da chat ekranında kanalını aç.</Text>
      ) : (
        <FlatList
          inverted
          data={shown}
          keyExtractor={(m) => m.id}
          contentContainerStyle={{ paddingHorizontal: 10, paddingVertical: 6 }}
          ListEmptyComponent={<Text style={{ color: '#777', paddingVertical: 10, transform: [{ scaleY: -1 }] }}>{evOnly ? 'Henüz etkinlik yok' : 'Mesajlar burada görünecek…'}</Text>}
          renderItem={({ item: m }) => (
            <View style={[{ flexDirection: 'row', gap: 6, paddingVertical: 3 }, m.kind === 'ev' && { backgroundColor: 'rgba(245,158,11,.22)', borderRadius: 6, paddingHorizontal: 6, marginVertical: 2 }]}>
              <Logo k={m.p} size={Math.round(size * 1.1)} style={{ marginTop: 2 }} />
              <Text style={{ color: '#efeff1', fontSize: size, flex: 1, lineHeight: Math.round(size * 1.35) }}>
                {m.kind === 'msg' ? (
                  <>
                    {(m.b || []).map((b) => (BADGE[b] ? <Text key={b}>{BADGE[b]} </Text> : null))}
                    <Text style={{ fontWeight: '700', color: cleanColor(m.color) || (m.p === 'twitch' ? '#bf94ff' : '#53fc18') }}>{m.user}</Text>
                    {'  '}
                    {m.del ? (
                      <Text style={{ color: '#888', fontStyle: 'italic' }}>
                        <Text style={{ textDecorationLine: 'line-through' }}>{m.text}</Text> ({m.del})
                      </Text>
                    ) : Array.isArray(m.parts) ? (
                      m.parts.map((x, i) =>
                        x.e && /^https:\/\/(static-cdn\.jtvnw\.net|files\.kick\.com)\//.test(x.e) ? (
                          <Image key={i} source={{ uri: x.e }} style={{ width: Math.round(size * 1.6), height: Math.round(size * 1.6) }} accessibilityLabel={x.n} />
                        ) : (
                          <Text key={i}>{x.t ?? x.n ?? ''}</Text>
                        ),
                      )
                    ) : (
                      m.text
                    )}
                  </>
                ) : (
                  <>
                    <Text style={{ fontWeight: '700' }}>{m.user}</Text> {m.text}
                  </>
                )}
              </Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

// ✏️ Başlık / kategori penceresi. Kaydetme, platformun kendi sitesinin kullandığı yolla, telefondaki
// girişle yapılır (görünmez bir Twitch / Kick sayfasının içinden). Giriş bilgisi telefondan çıkmaz.
const INFO_URL = { twitch: 'https://www.twitch.tv/robots.txt', kick: 'https://kick.com/robots.txt' };
const INFO_JS = `(function(){
if (window.__penguInfo) return;
function ck(n){var m=document.cookie.match(new RegExp('(?:^|; )'+n+'=([^;]*)'));return m?decodeURIComponent(m[1]):'';}
function send(o){window.ReactNativeWebView.postMessage(JSON.stringify(o));}
var TW=/twitch\.tv$/.test(location.hostname);
async function gql(q,v){var t=ck('auth-token'); if(!t) throw new Error('login');
  var r=await fetch('https://gql.twitch.tv/gql',{method:'POST',headers:{'Client-Id':'kimne78kx3ncx6brgo4mv6wki5h1ko',Authorization:'OAuth '+t},body:JSON.stringify({query:q,variables:v||{}})});
  if(r.status===401) throw new Error('login');
  var j=await r.json(); if(j.errors&&j.errors.length) throw new Error(j.errors[0].message||'Twitch hatası'); return j.data||{};}
async function kk(path,method,body){var t=ck('session_token'); if(!t) throw new Error('login');
  var h={Accept:'application/json',Authorization:'Bearer '+t}; var x=ck('XSRF-TOKEN'); if(x) h['X-XSRF-TOKEN']=x; if(body) h['Content-Type']='application/json';
  var r=await fetch(path,{method:method||'GET',credentials:'include',headers:h,body:body?JSON.stringify(body):undefined});
  if(r.status===401) throw new Error('login'); if(!r.ok) throw new Error('Kick kabul etmedi ('+r.status+')');
  var tx=await r.text(); return tx?JSON.parse(tx):{};}
var me=null;
async function twMe(){ if(me) return me; var d=await gql('query{currentUser{id login}}'); if(!d.currentUser) throw new Error('login'); me=d.currentUser; return me; }
async function kkMe(){ if(me) return me; var u=await kk('/api/v1/user'); if(!u||!u.username) throw new Error('login'); me={slug:String(u.username).toLowerCase().replace(/_/g,'-')}; return me; }
var ops={
  get: async function(){
    if(TW){ var u=await twMe(); var d=await gql('query($id:ID!){user(id:$id){broadcastSettings{title game{id displayName}}}}',{id:u.id}); var b=(d.user&&d.user.broadcastSettings)||{}; return {title:b.title||'',cat:b.game?{id:b.game.id,name:b.game.displayName}:null}; }
    var s=await kkMe(); var i=await kk('/api/v2/channels/'+s.slug+'/stream-info'); return {title:i.stream_title||'',cat:i.category?{id:i.category.id,name:i.category.name}:null}; },
  search: async function(a){
    if(TW){ var d=await gql('query($q:String!){searchCategories(query:$q,first:8){edges{node{id displayName}}}}',{q:a.q}); return ((d.searchCategories&&d.searchCategories.edges)||[]).map(function(e){return {id:e.node.id,name:e.node.displayName};}); }
    var r=await fetch('https://search.kick.com/collections/subcategory_index/documents/search?q='+encodeURIComponent(a.q)+'&query_by=name',{headers:{Accept:'application/json','X-Typesense-Api-Key':'nXIMW0iEN6sMujFYjFuhdrSwVow3pDQu'}});
    var j=await r.json(); return (j.hits||[]).slice(0,8).map(function(h){return {id:h.document.id,name:h.document.name};}); },
  save: async function(a){
    if(TW){ var u=await twMe(); var inp={userID:u.id,status:a.title}; if(a.cat){inp.categoryID=String(a.cat.id); inp.game=a.cat.name;}
      var d=await gql('mutation($input:UpdateBroadcastSettingsInput!){updateBroadcastSettings(input:$input){error}}',{input:inp});
      var e=d.updateBroadcastSettings&&d.updateBroadcastSettings.error; if(e) throw new Error(String(e)); return true; }
    var s=await kkMe(); var body={stream_title:a.title}; if(a.cat) body.category_id=Number(a.cat.id);
    await kk('/api/v2/channels/'+s.slug+'/stream-info','PATCH',body); return true; }
};
window.__penguInfo=function(id,op,a){ ops[op](a||{}).then(function(r){send({id:id,ok:true,data:r});},function(e){send({id:id,ok:false,err:String((e&&e.message)||e)});}); };
send({ready:true});
})(); true;`;

function InfoSheet({ C, ins, platform, setPlatform, userAgent, onClose, onWeb }) {
  const view = useRef(null);
  const ready = useRef(false);
  const queue = useRef([]);
  const pend = useRef({});
  const [title, setTitle] = useState('');
  const [cat, setCat] = useState(null);
  const [q, setQ] = useState('');
  const [hits, setHits] = useState([]);
  const [busy, setBusy] = useState(true);
  const [msg, setMsg] = useState(null); // { t, ok }

  const call = (op, a) =>
    new Promise((res, rej) => {
      const id = String(Date.now()) + Math.random().toString(36).slice(2, 7);
      pend.current[id] = { res, rej };
      const run = () => view.current?.injectJavaScript(`window.__penguInfo && window.__penguInfo(${JSON.stringify(id)}, ${JSON.stringify(op)}, ${JSON.stringify(a || {})}); true;`);
      if (ready.current) run();
      else queue.current.push(run);
      setTimeout(() => {
        if (pend.current[id]) {
          delete pend.current[id];
          rej(new Error('Cevap gelmedi, internetini kontrol et'));
        }
      }, 15000);
    });
  const errText = (e) =>
    e.message === 'login' ? `${LABEL[platform]}'e giriş yapılmamış. Önce chat ekranında ${LABEL[platform]} hesabına giriş yap.` : e.message;

  // Platform değişince sayfa baştan yüklenir, mevcut başlık / kategori okunur
  useEffect(() => {
    ready.current = false;
    queue.current = [];
    setTitle('');
    setCat(null);
    setQ('');
    setHits([]);
    setMsg(null);
    setBusy(true);
    call('get')
      .then((d) => {
        setTitle(d.title || '');
        setCat(d.cat || null);
      })
      .catch((e) => setMsg({ t: errText(e), ok: false }))
      .finally(() => setBusy(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [platform]);

  // Kategori arama (yazmayı bırakınca)
  useEffect(() => {
    const text = q.trim();
    if (text.length < 2) return setHits([]);
    const t = setTimeout(() => {
      call('search', { q: text }).then(setHits).catch(() => setHits([]));
    }, 350);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, platform]);

  const save = async () => {
    if (!title.trim()) return setMsg({ t: 'Başlığı yaz.', ok: false });
    setBusy(true);
    setMsg(null);
    try {
      await call('save', { title: title.trim(), cat });
      setMsg({ t: `✓ ${LABEL[platform]}'te kaydedildi`, ok: true });
    } catch (e) {
      setMsg({ t: errText(e), ok: false });
    } finally {
      setBusy(false);
    }
  };

  const color = platform === 'twitch' ? '#9146ff' : '#16a34a';
  const input = { backgroundColor: C.input, borderWidth: 1, borderColor: C.border, borderRadius: 8, color: C.text, paddingHorizontal: 10, paddingVertical: 8, fontSize: 15 };
  return (
    <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,.7)', justifyContent: 'center', padding: 14, paddingTop: ins.top + 14, paddingBottom: ins.bottom + 14, paddingLeft: ins.left + 14, paddingRight: ins.right + 14 }}>
      <WebView
        key={platform}
        ref={view}
        source={{ uri: INFO_URL[platform] }}
        style={TINY_WV}
          containerStyle={TINY_WV} // görünmez sayfa yer kaplamasın (sarmalayıcısı da)
        userAgent={userAgent}
        sharedCookiesEnabled
        thirdPartyCookiesEnabled
        domStorageEnabled
        javaScriptEnabled
        injectedJavaScript={INFO_JS}
        onLoadEnd={() => view.current?.injectJavaScript(INFO_JS)} // yedek: düz metin sayfasında betik çalışmadıysa
        onMessage={(e) => {
          let m;
          try { m = JSON.parse(e.nativeEvent.data); } catch { return; }
          if (m.ready) {
            ready.current = true;
            queue.current.splice(0).forEach((f) => f());
            return;
          }
          const p = pend.current[m.id];
          if (!p) return;
          delete pend.current[m.id];
          m.ok ? p.res(m.data) : p.rej(new Error(m.err || 'hata'));
        }}
      />
      <ScrollView contentContainerStyle={{ backgroundColor: C.panel, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14, gap: 8 }} keyboardShouldPersistTaps="handled">
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <Text style={{ color: C.text, fontSize: 16, fontWeight: '700', flex: 1 }}>✏️ Başlık / Kategori</Text>
          {['twitch', 'kick'].map((p) => (
            <Pressable key={p} onPress={() => setPlatform(p)} style={{ paddingHorizontal: 12, height: 32, borderRadius: 8, justifyContent: 'center', borderWidth: 1, borderColor: platform === p ? (p === 'twitch' ? '#9146ff' : '#16a34a') : C.border, backgroundColor: platform === p ? (p === 'twitch' ? '#9146ff' : '#16a34a') : C.input }}>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}><Logo k={p} /><Text style={{ color: platform === p ? '#fff' : C.text, fontWeight: '700' }}>{LABEL[p]}</Text></View>
            </Pressable>
          ))}
        </View>

        <Text style={{ color: C.muted, fontSize: 13 }}>Başlık</Text>
        <TextInput style={input} value={title} onChangeText={setTitle} placeholder="Yayın başlığı" placeholderTextColor={C.muted} maxLength={140} editable={!busy} />

        <Text style={{ color: C.muted, fontSize: 13 }}>Kategori</Text>
        {cat ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: C.text, fontSize: 15, fontWeight: '700', flex: 1 }}>🎮 {cat.name}</Text>
            <Pressable onPress={() => setCat(null)} hitSlop={8} style={{ paddingHorizontal: 10, height: 30, borderRadius: 8, justifyContent: 'center', borderWidth: 1, borderColor: C.border }}>
              <Text style={{ color: C.text }}>Değiştir</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <TextInput style={input} value={q} onChangeText={setQ} placeholder="Kategori ara (örn: Just Chatting)" placeholderTextColor={C.muted} autoCorrect={false} />
            {hits.map((h) => (
              <Pressable key={String(h.id)} onPress={() => { setCat(h); setQ(''); setHits([]); }} style={{ paddingVertical: 8, paddingHorizontal: 10, borderRadius: 8, backgroundColor: C.input }}>
                <Text style={{ color: C.text }}>🎮 {h.name}</Text>
              </Pressable>
            ))}
          </>
        )}

        {!!msg && <Text style={{ color: msg.ok ? '#16a34a' : '#dc2626' }}>{msg.t}</Text>}
        <View style={{ flexDirection: 'row', gap: 8, marginTop: 4 }}>
          <Pressable onPress={onClose} style={{ flex: 1, height: 42, borderRadius: 10, justifyContent: 'center', alignItems: 'center', borderWidth: 1, borderColor: C.border }}>
            <Text style={{ color: C.text, fontWeight: '700' }}>Kapat</Text>
          </Pressable>
          <Pressable onPress={save} disabled={busy} style={{ flex: 2, height: 42, borderRadius: 10, justifyContent: 'center', alignItems: 'center', backgroundColor: color, opacity: busy ? 0.6 : 1 }}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>{busy ? 'Bekle…' : `${LABEL[platform]}'te kaydet`}</Text>
          </Pressable>
        </View>
        <Pressable onPress={onWeb} hitSlop={8} style={{ alignSelf: 'center', paddingVertical: 6 }}>
          <Text style={{ color: C.muted, fontSize: 12, textDecorationLine: 'underline' }}>Olmazsa: 🌐 sitenin kendi sayfasından düzenle</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

// 🖼️ Sürüklenebilir kutu (bir ekran öğesinin yayındaki yeri)
function DragBox({ o, rect, hp, selected, onSelect, onMove }) {
  const cb = useRef(null);
  cb.current = { o, rect, hp, onSelect, onMove };
  const start = useRef({ x: 0, y: 0 });
  const pr = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        const c = cb.current;
        start.current = { x: c.o.x, y: c.o.y };
        c.onSelect(c.o.id);
      },
      onPanResponderMove: (_, g) => {
        const c = cb.current;
        if (!c.rect.w || !c.rect.h) return;
        c.onMove(c.o.id, {
          x: clamp(start.current.x + (g.dx / c.rect.w) * 100, 0, 100 - c.o.w),
          y: clamp(start.current.y + (g.dy / c.rect.h) * 100, 0, 100 - c.hp),
        });
      },
    })
  ).current;
  return (
    <View
      {...pr.panHandlers}
      style={{
        position: 'absolute',
        left: rect.x + (o.x / 100) * rect.w,
        top: rect.y + (o.y / 100) * rect.h,
        width: (o.w / 100) * rect.w,
        height: (hp / 100) * rect.h,
        borderWidth: 2,
        borderStyle: 'dashed',
        borderColor: selected ? '#fbbf24' : 'rgba(255,255,255,.85)',
        backgroundColor: selected ? 'rgba(251,191,36,.12)' : 'rgba(255,255,255,.05)',
      }}
    />
  );
}

function Field({ C, value, onChange, placeholder, secure }) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      placeholder={placeholder}
      placeholderTextColor={C.ph}
      secureTextEntry={!!secure}
      autoCapitalize="none"
      autoCorrect={false}
      style={{ height: 42, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.input, color: C.text, paddingHorizontal: 10 }}
    />
  );
}

function Toggle({ C, on, label, logo, onPress }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
      <View style={{ width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: on ? '#9146ff' : C.border, backgroundColor: on ? '#9146ff' : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {on && <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>✓</Text>}
      </View>
      {!!logo && <Logo k={logo} size={20} />}
      <Text style={{ color: C.text, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}
