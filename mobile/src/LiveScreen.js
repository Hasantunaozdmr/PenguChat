// 📡 Telefondan yayın: aynı anda Twitch + Kick. Kamera + mikrofon görüntüsü RTMP / RTMPS ile gönderilir.
// - Bağlantı koparsa yayın "Bitir"e basılana kadar kendiliğinden tekrar bağlanır.
// - Bitrate çok düşerse yayına "Bitrate düşük, lütfen bekleyiniz" yazısı gider, düzelince kameraya döner.
// - 🤳 Dual cam: ön ve arka kamera aynı anda (ikinci kamera sürüklenebilir bir kutuda; telefon desteklemiyorsa uyarı çıkar).
// - 🖼️ Ekran öğeleri: PenguLive logosu, kendi resimlerin ve donate bar linklerin yayına eklenir; sürükle, büyüt / küçült, aç / kapat.
//   Donate sayfasının abone / bağış sesleri de yayına karışır (🔊 / 🔇).
// Yayın anahtarları ve donate linkleri sadece bu telefonda saklanır; sadece Twitch'e / Kick'e / donate sitesine gider.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Modal, PanResponder, PermissionsAndroid, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WebView } from 'react-native-webview';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { isInternalUrl } from './links';

const HAS_LIVE = Platform.OS === 'android' || Platform.OS === 'ios';
const live = HAS_LIVE ? require('../modules/pengu-live/src') : null;
const PenguLiveView = live?.PenguLiveView || null;
const keepAwake = HAS_LIVE ? require('expo-keep-awake') : null;

const KEY_STORE = 'penguchat:liveKeys';
const SET_STORE = 'penguchat:liveSettings';
const OV_STORE = 'penguchat:liveOverlays';
// Yer ve boyut: görüntünün yüzdesi (x, y = sol üst köşe, w = genişlik)
const CAM_OV = { id: 'cam', type: 'cam', name: '🤳 İkinci kamera', on: false, x: 66, y: 60, w: 30, rot: 0, mirror: false };
const DEFAULT_OV = [{ id: 'logo', type: 'logo', name: '🐧 PenguLive logosu', on: true, x: 84, y: 3, w: 13 }, CAM_OV];
const SHAPE = { bar: { label: 'Bar (geniş)', aspect: 0.25, w: 40 }, box: { label: 'Kutu (uyarı)', aspect: 0.75, w: 30 } };
const ovAspect = (o, camAspect) => (o.type === 'logo' ? 1 : o.type === 'cam' ? camAspect || 0.5625 : o.type === 'web' ? (SHAPE[o.shape] || SHAPE.bar).aspect : o.aspect || 1);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
// ⭐ Pro'ya özel: Twitch + Kick aynı anda, logo kaldırma, kendi resim / donate bar, dual cam, 1080p
export const PRO_TEXT = 'Bu özellik PenguLive Pro\'da: Twitch + Kick aynı anda yayın, logoyu kaldırma, kendi logo / resim, donate bar ve uyarılar, dual cam ve 1080p.\n\nPro için uygulamanın yöneticisiyle iletişime geç.';
const proAlert = () => Alert.alert('⭐ PenguLive Pro', PRO_TEXT);
const TWITCH_INGEST = 'rtmp://live.twitch.tv/app/';
const RESTREAM_INGEST = 'rtmp://live.restream.io/live';
// Tek çıkışlı yollar: Restream (Twitch / Kick'e kendisi dağıtır) ya da özel RTMP (PC'deki OBS, kendi sunucun…)
const VIA = { restream: '🔁 Restream', custom: '🖥️ Özel RTMP' };
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

export default function LiveScreen({ C, onClose, userAgent, unlocked = true }) {
  const ref = useRef(null);
  // iPhone: yayın ekranı tam ekran açılır; üstteki saat / çentik ve alttaki çizgiyle çakışmasın
  const safe = useSafeAreaInsets();
  const ins = Platform.OS === 'ios' ? safe : { top: 0, bottom: 0, left: 0, right: 0 };
  const [keys, setKeys] = useState({ twitch: '', kickUrl: '', kick: '', useTwitch: true, useKick: true, via: '', restreamUrl: RESTREAM_INGEST, restreamKey: '', customUrl: '', customKey: '', customFor: 'kick' });
  const [quality, setQuality] = useState('mid');
  const [kbps, setKbps] = useState(0); // elle bitrate (0 = kaliteye göre)
  const [kbpsText, setKbpsText] = useState('');
  const [muted, setMuted] = useState(false);
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
  const outLabel = (p) => (keys.via === 'custom' ? `${VIA.custom} → ${LABEL[keys.customFor || 'kick']}` : keys.via ? VIA[keys.via] : LABEL[p]);
  const anyLive = platforms.some((p) => status[p] === 'live');

  return (
    <Modal animationType="slide" onRequestClose={close} supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}>
      <View style={{ flex: 1, backgroundColor: '#000' }} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
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
            onNotice={(e) => {
              const m = String(e.nativeEvent?.message || '');
              if (m) setError(m);
              if (/kamera/i.test(m)) updOv('cam', { on: false }); // ikinci kamera açılamadıysa kapat
            }}
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff' }}>Yayın sadece telefonda.</Text></View>
        )}

        {/* 🖼️ Düzenleme: her öğenin kutusu; sürükleyerek taşı */}
        {layoutMode && box.w > 0 && overlays.filter((o) => o.on).map((o) => (
          <DragBox key={o.id} o={o} rect={rect} hp={hPct(o)} selected={sel === o.id} onSelect={setSel} onMove={updOv} />
        ))}

        {/* Üst: süre + her platformun durumu ve bitrate'i */}
        {!layoutMode && (
        <View style={{ position: 'absolute', top: ins.top + 10, left: ins.left + 12, right: ins.right + 12, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[pill, { color: '#fff', fontWeight: '700', backgroundColor: running && anyLive ? '#dc2626' : 'rgba(0,0,0,.6)' }]}>
              {running ? (anyLive ? `● CANLI ${fmtTime(Math.floor((Date.now() - startedAt) / 1000))}` : 'Bağlanıyor…') : 'Yayında değil'}
            </Text>
            <Text style={[pill, { color: '#fff', backgroundColor: 'rgba(0,0,0,.6)' }]}>{QUALITY[quality]}{kbps ? ` · ${kbps} kbps` : ''}</Text>
            <View style={{ flex: 1 }} />
            <Pressable onPress={close} hitSlop={10} style={{ backgroundColor: 'rgba(0,0,0,.6)', borderRadius: 18, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
              <Text style={{ color: '#fff', fontSize: 18 }}>✕</Text>
            </Pressable>
          </View>
          {running && (
            <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
              {platforms.map((p) => (
                <Text key={p} style={[pill, { color: '#fff', backgroundColor: status[p] === 'live' ? (keys.via ? '#0e7490' : p === 'twitch' ? '#9146ff' : '#16a34a') : 'rgba(0,0,0,.6)' }]}>
                  {outLabel(p)} · {STATE[status[p]] || status[p]} · 📶 {mbps(stats[p])}
                </Text>
              ))}
            </View>
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

        {/* Alt tuşlar */}
        {!layoutMode && (
        <View style={{ position: 'absolute', bottom: Math.max(18, ins.bottom + 6), left: ins.left + 8, right: ins.right + 8, flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
          <Pressable style={btn('rgba(0,0,0,.6)')} onPress={() => ref.current?.switchCamera()}>
            <Text style={txt}>🔄</Text>
          </Pressable>
          <Pressable style={btn(muted ? '#dc2626' : 'rgba(0,0,0,.6)')} onPress={() => { const m = !muted; setMuted(m); ref.current?.setMuted(m); }}>
            <Text style={txt}>{muted ? '🔇' : '🎤'}</Text>
          </Pressable>
          {running ? (
            <Pressable style={[btn('#dc2626'), { paddingHorizontal: 22 }]} onPress={askStop}><Text style={txt}>■ Bitir</Text></Pressable>
          ) : (
            <Pressable style={[btn('#9146ff'), { paddingHorizontal: 22 }]} onPress={() => start()}><Text style={txt}>● Yayına başla</Text></Pressable>
          )}
          <Pressable style={btn('rgba(0,0,0,.6)')} onPress={() => { setEditWeb(false); setEdit(keys.via === 'custom' ? keys.customFor || 'kick' : keys.useTwitch || !keys.useKick ? 'twitch' : 'kick'); }}>
            <Text style={txt}>✏️</Text>
          </Pressable>
          <Pressable style={btn(camOv?.on ? '#0e8f8a' : 'rgba(0,0,0,.6)')} onPress={toggleCam}>
            <Text style={txt}>🤳</Text>
          </Pressable>
          <Pressable style={btn('rgba(0,0,0,.6)')} onPress={() => { setError(''); setLayoutMode(true); }}>
            <Text style={txt}>🖼️</Text>
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
                  <Text style={{ color: edit === p ? '#fff' : C.text, fontWeight: '700' }}>{LABEL[p]}</Text>
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
              <Toggle C={C} on={!keys.via && keys.useTwitch} label="Twitch'e yayın" onPress={() => saveKeys({ ...keys, useTwitch: !keys.useTwitch })} />
              <Field C={C} value={keys.twitch} onChange={(v) => saveKeys({ ...keys, twitch: v.trim() })} placeholder="Twitch yayın anahtarı (live_…)" secure />
              <Text style={{ color: C.muted, fontSize: 11 }}>Twitch → Creator Dashboard → Ayarlar → Yayın → Birincil yayın anahtarı</Text>

              <Toggle C={C} on={!keys.via && keys.useKick} label="Kick'e yayın" onPress={() => saveKeys({ ...keys, useKick: !keys.useKick })} />
              <Field C={C} value={keys.kickUrl} onChange={(v) => saveKeys({ ...keys, kickUrl: v.trim() })} placeholder="Kick Stream URL (rtmps://…)" />
              <Field C={C} value={keys.kick} onChange={(v) => saveKeys({ ...keys, kick: v.trim() })} placeholder="Kick Stream Key" secure />
              <Text style={{ color: C.muted, fontSize: 11 }}>Kick → Creator Dashboard → Ayarlar → Yayın anahtarı: "Stream URL" ve "Stream Key"</Text>
              </View>

              {/* 🔁 Restream: telefon tek yayın gönderir, Restream Twitch / Kick'e kendisi dağıtır (internet yarıya iner) */}
              <Toggle C={C} on={keys.via === 'restream'} label="🔁 Restream üzerinden (tek yayın)" onPress={() => saveKeys({ ...keys, via: keys.via === 'restream' ? '' : 'restream' })} />
              {keys.via === 'restream' && (
                <>
                  <Field C={C} value={keys.restreamUrl || RESTREAM_INGEST} onChange={(v) => saveKeys({ ...keys, restreamUrl: v.trim() })} placeholder={RESTREAM_INGEST} />
                  <Field C={C} value={keys.restreamKey || ''} onChange={(v) => saveKeys({ ...keys, restreamKey: v.trim() })} placeholder="Restream yayın anahtarı (Stream Key)" secure />
                  <Text style={{ color: C.muted, fontSize: 11 }}>Restream → Kaynak / OBS ayarları → RTMP URL ve Stream Key. Telefon tek yayın gönderir, Twitch ve Kick'e Restream dağıtır; internet yarıya iner. Açıkken yukarıdaki Twitch / Kick kullanılmaz.</Text>
                </>
              )}

              {/* 🖥️ Özel RTMP: PC'deki OBS'e, kendi sunucuna ya da başka bir servise */}
              <Toggle C={C} on={keys.via === 'custom'} label="🖥️ Özel RTMP (PC / OBS / kendi sunucun)" onPress={() => saveKeys({ ...keys, via: keys.via === 'custom' ? '' : 'custom' })} />
              {keys.via === 'custom' && (
                <>
                  <Text style={{ color: C.muted, fontSize: 12 }}>Bu yayın hangi platformda açılıyor?</Text>
                  <View style={{ flexDirection: 'row', gap: 6 }}>
                    {['kick', 'twitch'].map((p) => {
                      const on = (keys.customFor || 'kick') === p;
                      const col = p === 'twitch' ? '#9146ff' : '#16a34a';
                      return (
                        <Pressable key={p} onPress={() => saveKeys({ ...keys, customFor: p })} style={{ paddingHorizontal: 16, height: 36, borderRadius: 8, justifyContent: 'center', borderWidth: 1, borderColor: on ? col : C.border, backgroundColor: on ? col : C.input }}>
                          <Text style={{ color: on ? '#fff' : C.text, fontWeight: '700' }}>{LABEL[p]}</Text>
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
                  <Pressable key={k} disabled={running} onPress={() => (!unlocked && k === 'high' ? proAlert() : saveQuality(k))} style={{ opacity: running && quality !== k ? 0.4 : 1, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: quality === k ? '#9146ff' : C.border, backgroundColor: quality === k ? '#9146ff' : C.input }}>
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
        style={{ width: 1, height: 1, opacity: 0, position: 'absolute' }}
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
              <Text style={{ color: platform === p ? '#fff' : C.text, fontWeight: '700' }}>{LABEL[p]}</Text>
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

function Toggle({ C, on, label, onPress }) {
  return (
    <Pressable onPress={onPress} style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 6 }}>
      <View style={{ width: 22, height: 22, borderRadius: 5, borderWidth: 2, borderColor: on ? '#9146ff' : C.border, backgroundColor: on ? '#9146ff' : 'transparent', alignItems: 'center', justifyContent: 'center' }}>
        {on && <Text style={{ color: '#fff', fontSize: 13, fontWeight: '700' }}>✓</Text>}
      </View>
      <Text style={{ color: C.text, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  );
}
