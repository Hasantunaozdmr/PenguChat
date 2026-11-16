// 📡 Telefondan yayın: aynı anda Twitch + Kick. Kamera + mikrofon görüntüsü RTMP / RTMPS ile gönderilir.
// - Bağlantı koparsa yayın "Bitir"e basılana kadar kendiliğinden tekrar bağlanır.
// - Bitrate çok düşerse yayına "Bitrate düşük, lütfen bekleyiniz" yazısı gider, düzelince kameraya döner.
// - 🖼️ Ekran öğeleri: PenguLive logosu, kendi resimlerin ve donate bar linklerin yayına eklenir; sürükle, büyüt / küçült, aç / kapat.
//   Donate sayfasının abone / bağış sesleri de yayına karışır (🔊 / 🔇).
// Yayın anahtarları ve donate linkleri sadece bu telefonda saklanır; sadece Twitch'e / Kick'e / donate sitesine gider.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Linking, Modal, PanResponder, PermissionsAndroid, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { WebView } from 'react-native-webview';
import { isInternalUrl } from './links';

const live = Platform.OS === 'android' ? require('../modules/pengu-live/src') : null;
const PenguLiveView = live?.PenguLiveView || null;
const keepAwake = Platform.OS === 'android' ? require('expo-keep-awake') : null;

const KEY_STORE = 'penguchat:liveKeys';
const SET_STORE = 'penguchat:liveSettings';
const OV_STORE = 'penguchat:liveOverlays';
// Yer ve boyut: görüntünün yüzdesi (x, y = sol üst köşe, w = genişlik)
const DEFAULT_OV = [{ id: 'logo', type: 'logo', name: '🐧 PenguLive logosu', on: true, x: 84, y: 3, w: 13 }];
const SHAPE = { bar: { label: 'Bar (geniş)', aspect: 0.25, w: 40 }, box: { label: 'Kutu (uyarı)', aspect: 0.75, w: 30 } };
const ovAspect = (o) => (o.type === 'logo' ? 1 : o.type === 'web' ? (SHAPE[o.shape] || SHAPE.bar).aspect : o.aspect || 1);
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const TWITCH_INGEST = 'rtmp://live.twitch.tv/app/';
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

export default function LiveScreen({ C, onClose, userAgent }) {
  const ref = useRef(null);
  const [keys, setKeys] = useState({ twitch: '', kickUrl: '', kick: '', useTwitch: true, useKick: true });
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
      try { const list = JSON.parse(v || 'null'); if (Array.isArray(list) && list.length) setOverlays(list); } catch {}
      setOvLoaded(true);
    }).catch(() => setOvLoaded(true));
    AsyncStorage.multiGet([KEY_STORE, SET_STORE]).then((r) => {
      try { const k = JSON.parse(r[0][1] || '{}'); setKeys((o) => ({ ...o, ...k })); if (!k.twitch && !k.kick) setSetup(true); } catch { setSetup(true); }
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
  const ovJson = useMemo(() => JSON.stringify(overlays.map(({ id, type, on, x, y, w, src, shape, sound }) => ({ id, type, on, x, y, w, src: src || '', shape: shape || 'bar', sound: sound !== false }))), [overlays]);

  // Önizlemede görüntünün kapladığı alan (yan tutunca 16:9, dik tutunca 9:16; kalanı siyah)
  const portrait = box.h > box.w;
  const A = portrait ? 9 / 16 : 16 / 9;
  const rect = (() => {
    let w = box.w, h = box.w / A;
    if (h > box.h) { h = box.h; w = box.h * A; }
    return { x: (box.w - w) / 2, y: (box.h - h) / 2, w, h };
  })();
  const hPct = (o) => clamp(o.w * ovAspect(o) * A, 1, 100);
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

  const targets = () => [
    keys.useTwitch && keys.twitch.trim() ? TWITCH_INGEST + keys.twitch.trim() : '',
    keys.useKick ? joinUrl(keys.kickUrl.trim(), keys.kick.trim()) : '',
  ];
  const start = async () => {
    const t = targets();
    if (!t[0] && !t[1]) { setSetup(true); return; }
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
    Alert.alert('Yayını bitir', 'Twitch ve Kick yayını kapatılsın mı?', [
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

  const pill = { borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, overflow: 'hidden' };
  const btn = (bg) => ({ paddingHorizontal: 14, height: 46, borderRadius: 23, justifyContent: 'center', alignItems: 'center', backgroundColor: bg });
  const txt = { color: '#fff', fontWeight: '700', fontSize: 15 };
  const sbtn = (bg) => ({ paddingHorizontal: 12, height: 36, borderRadius: 18, justifyContent: 'center', alignItems: 'center', backgroundColor: bg });
  const stxt = { color: '#fff', fontWeight: '700', fontSize: 14 };
  const platforms = ['twitch', 'kick'].filter((p) => (p === 'twitch' ? keys.useTwitch && keys.twitch : keys.useKick && keys.kick && keys.kickUrl));
  const anyLive = platforms.some((p) => status[p] === 'live');

  return (
    <Modal animationType="slide" onRequestClose={close} supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}>
      <View style={{ flex: 1, backgroundColor: '#000' }} onLayout={(e) => setBox({ w: e.nativeEvent.layout.width, h: e.nativeEvent.layout.height })}>
        {PenguLiveView ? (
          <PenguLiveView
            ref={ref}
            style={{ flex: 1 }}
            overlays={ovJson}
            quality={quality}
            bitrateKbps={kbps}
            onStatus={(e) => {
              const { platform, state, message } = e.nativeEvent;
              setStatus((s) => ({ ...s, [platform]: state }));
              if (state === 'error' && message) setError(`${LABEL[platform]}: ${message}`);
            }}
            onStats={(e) => setStats(e.nativeEvent)}
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff' }}>Yayın sadece Android'de.</Text></View>
        )}

        {/* 🖼️ Düzenleme: her öğenin kutusu; sürükleyerek taşı */}
        {layoutMode && box.w > 0 && overlays.filter((o) => o.on).map((o) => (
          <DragBox key={o.id} o={o} rect={rect} hp={hPct(o)} selected={sel === o.id} onSelect={setSel} onMove={updOv} />
        ))}

        {/* Üst: süre + her platformun durumu ve bitrate'i */}
        {!layoutMode && (
        <View style={{ position: 'absolute', top: 12, left: 12, right: 12, gap: 6 }}>
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
                <Text key={p} style={[pill, { color: '#fff', backgroundColor: status[p] === 'live' ? (p === 'twitch' ? '#9146ff' : '#16a34a') : 'rgba(0,0,0,.6)' }]}>
                  {LABEL[p]} · {STATE[status[p]] || status[p]} · 📶 {mbps(stats[p])}
                </Text>
              ))}
            </View>
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
          <View style={[{ position: 'absolute', left: 8, right: 8, backgroundColor: 'rgba(0,0,0,.8)', borderRadius: 12, padding: 6, gap: 6 }, panelTop ? { top: 8 } : { bottom: 8 }]}>
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
                    <Pressable style={sbtn(selOv.on ? 'rgba(255,255,255,.15)' : '#16a34a')} onPress={() => updOv(selOv.id, { on: !selOv.on })}>
                      <Text style={stxt}>{selOv.on ? '🙈 Gizle' : '👁️ Göster'}</Text>
                    </Pressable>
                    <Pressable style={sbtn('rgba(255,255,255,.15)')} onPress={() => resize(selOv.id, -2)} disabled={!selOv.on}><Text style={stxt}>➖ Küçült</Text></Pressable>
                    <Pressable style={sbtn('rgba(255,255,255,.15)')} onPress={() => resize(selOv.id, 2)} disabled={!selOv.on}><Text style={stxt}>➕ Büyüt</Text></Pressable>
                    {selOv.type === 'web' && (
                      <Pressable style={sbtn(selOv.sound === false ? 'rgba(220,38,38,.85)' : 'rgba(255,255,255,.15)')} onPress={() => updOv(selOv.id, { sound: selOv.sound === false })}>
                        <Text style={stxt}>{selOv.sound === false ? '🔇 Ses kapalı' : '🔊 Ses açık'}</Text>
                      </Pressable>
                    )}
                    {selOv.type !== 'logo' && (
                      <Pressable style={sbtn('rgba(220,38,38,.85)')} onPress={() => removeOv(selOv)}><Text style={stxt}>🗑️</Text></Pressable>
                    )}
                    <View style={{ width: 1, height: 24, backgroundColor: 'rgba(255,255,255,.3)' }} />
                  </>
                )}
                <Pressable style={sbtn('#f59e0b')} onPress={() => setAddWeb({ url: '', shape: 'bar' })}><Text style={stxt}>＋ Donate bar</Text></Pressable>
                <Pressable style={sbtn('#0e8f8a')} onPress={pickImage}><Text style={stxt}>＋ Resim / logo</Text></Pressable>
              </ScrollView>
              <Pressable style={sbtn('#9146ff')} onPress={() => { setLayoutMode(false); setError(''); }}><Text style={stxt}>Bitti</Text></Pressable>
            </View>
            {portrait && <Text style={{ color: 'rgba(255,255,255,.7)', fontSize: 11 }}>Kutuyu parmağınla sürükleyerek taşı. Burada gördüğün gibi yayına gider{running ? ' (şu an yayındasın)' : ''}.</Text>}
          </View>
        )}

        {/* Alt tuşlar */}
        {!layoutMode && (
        <View style={{ position: 'absolute', bottom: 24, left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
          <Pressable style={btn('rgba(0,0,0,.6)')} onPress={() => ref.current?.switchCamera()}>
            <Text style={txt}>🔄</Text>
          </Pressable>
          <Pressable style={btn(muted ? '#dc2626' : 'rgba(0,0,0,.6)')} onPress={() => { const m = !muted; setMuted(m); ref.current?.setMuted(m); }}>
            <Text style={txt}>{muted ? '🔇' : '🎤'}</Text>
          </Pressable>
          {running ? (
            <Pressable style={[btn('#dc2626'), { paddingHorizontal: 22 }]} onPress={askStop}><Text style={txt}>■ Bitir</Text></Pressable>
          ) : (
            <Pressable style={[btn('#9146ff'), { paddingHorizontal: 22 }]} onPress={start}><Text style={txt}>● Yayına başla</Text></Pressable>
          )}
          <Pressable style={btn('rgba(0,0,0,.6)')} onPress={() => setEdit(keys.useTwitch || !keys.useKick ? 'twitch' : 'kick')}>
            <Text style={txt}>✏️</Text>
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

        {/* ✏️ Başlık / kategori: platformun kendi sayfası */}
        {edit && (
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: C.panel }}>
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

              <Toggle C={C} on={keys.useTwitch} label="Twitch'e yayın" onPress={() => saveKeys({ ...keys, useTwitch: !keys.useTwitch })} />
              <Field C={C} value={keys.twitch} onChange={(v) => saveKeys({ ...keys, twitch: v.trim() })} placeholder="Twitch yayın anahtarı (live_…)" secure />
              <Text style={{ color: C.muted, fontSize: 11 }}>Twitch → Creator Dashboard → Ayarlar → Yayın → Birincil yayın anahtarı</Text>

              <Toggle C={C} on={keys.useKick} label="Kick'e yayın" onPress={() => saveKeys({ ...keys, useKick: !keys.useKick })} />
              <Field C={C} value={keys.kickUrl} onChange={(v) => saveKeys({ ...keys, kickUrl: v.trim() })} placeholder="Kick Stream URL (rtmps://…)" />
              <Field C={C} value={keys.kick} onChange={(v) => saveKeys({ ...keys, kick: v.trim() })} placeholder="Kick Stream Key" secure />
              <Text style={{ color: C.muted, fontSize: 11 }}>Kick → Creator Dashboard → Ayarlar → Yayın anahtarı: "Stream URL" ve "Stream Key"</Text>

              <Text style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>Kalite (iki platforma birden gider; yayın sırasında değişmez)</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {Object.entries(QUALITY).map(([k, v]) => (
                  <Pressable key={k} disabled={running} onPress={() => saveQuality(k)} style={{ opacity: running && quality !== k ? 0.4 : 1, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: quality === k ? '#9146ff' : C.border, backgroundColor: quality === k ? '#9146ff' : C.input }}>
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
              <Text style={{ color: C.muted, fontSize: 11 }}>İki platforma birden gittiği için internetin yükleme hızı bunun en az 2,5 katı olmalı. Yayın sırasında da değiştirilebilir.</Text>
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
