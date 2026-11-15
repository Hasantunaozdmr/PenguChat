// 📡 Telefondan yayın: aynı anda Twitch + Kick. Kamera + mikrofon görüntüsü RTMP / RTMPS ile gönderilir.
// - Bağlantı koparsa yayın "Bitir"e basılana kadar kendiliğinden tekrar bağlanır.
// - Bitrate çok düşerse yayına "Bitrate düşük, lütfen bekleyiniz" yazısı gider, düzelince kameraya döner.
// Yayın anahtarları sadece bu telefonda saklanır; sadece Twitch'e / Kick'e gönderilir.
import { useEffect, useRef, useState } from 'react';
import { Alert, Modal, PermissionsAndroid, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

const PenguLiveView = Platform.OS === 'android' ? require('../modules/pengu-live/src').PenguLiveView : null;
const keepAwake = Platform.OS === 'android' ? require('expo-keep-awake') : null;

const KEY_STORE = 'penguchat:liveKeys';
const SET_STORE = 'penguchat:liveSettings';
const TWITCH_INGEST = 'rtmp://live.twitch.tv/app/';
const QUALITY = { low: 'Düşük (480p)', mid: 'Orta (720p)', high: 'Yüksek (1080p)' };
const LABEL = { twitch: 'Twitch', kick: 'Kick' };
const STATE = { idle: 'kapalı', connecting: 'bağlanıyor…', live: 'CANLI', reconnecting: 'tekrar bağlanıyor…', error: 'hata' };

const fmtTime = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(x).padStart(2, '0');
};
const mbps = (b) => (b > 0 ? (b / 1e6).toFixed(1) + ' Mbps' : '—');
// Kick "Stream URL" + "Stream Key" → tek adres
const joinUrl = (url, key) => (url && key ? url.replace(/\/+$/, '') + '/' + key : '');

export default function LiveScreen({ C, onClose }) {
  const ref = useRef(null);
  const [keys, setKeys] = useState({ twitch: '', kickUrl: '', kick: '', useTwitch: true, useKick: true });
  const [quality, setQuality] = useState('mid');
  const [muted, setMuted] = useState(false);
  const [running, setRunning] = useState(false); // yayıncı "Yayına başla"ya bastı
  const [status, setStatus] = useState({ twitch: 'idle', kick: 'idle' });
  const [stats, setStats] = useState({ twitch: 0, kick: 0, lowMode: false });
  const [error, setError] = useState('');
  const [setup, setSetup] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [, tick] = useState(0);

  useEffect(() => {
    AsyncStorage.multiGet([KEY_STORE, SET_STORE]).then((r) => {
      try { const k = JSON.parse(r[0][1] || '{}'); setKeys((o) => ({ ...o, ...k })); if (!k.twitch && !k.kick) setSetup(true); } catch { setSetup(true); }
      try { const st = JSON.parse(r[1][1] || '{}'); if (QUALITY[st.quality]) setQuality(st.quality); } catch {}
    });
    // Kamera + mikrofon izni
    if (Platform.OS === 'android') {
      PermissionsAndroid.requestMultiple([PermissionsAndroid.PERMISSIONS.CAMERA, PermissionsAndroid.PERMISSIONS.RECORD_AUDIO]).then((res) => {
        if (Object.values(res).some((v) => v !== PermissionsAndroid.RESULTS.GRANTED)) setError('Kamera ve mikrofon izni gerekli. Telefon Ayarları → Uygulamalar → PengusChat → İzinler.');
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

  const saveKeys = (k) => { setKeys(k); AsyncStorage.setItem(KEY_STORE, JSON.stringify(k)).catch(() => {}); };
  const saveQuality = (q) => { setQuality(q); AsyncStorage.setItem(SET_STORE, JSON.stringify({ quality: q })).catch(() => {}); };

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
  const platforms = ['twitch', 'kick'].filter((p) => (p === 'twitch' ? keys.useTwitch && keys.twitch : keys.useKick && keys.kick && keys.kickUrl));
  const anyLive = platforms.some((p) => status[p] === 'live');

  return (
    <Modal animationType="slide" onRequestClose={close} supportedOrientations={['portrait', 'landscape', 'landscape-left', 'landscape-right']}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {PenguLiveView ? (
          <PenguLiveView
            ref={ref}
            style={{ flex: 1 }}
            quality={quality}
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

        {/* Üst: süre + her platformun durumu ve bitrate'i */}
        <View style={{ position: 'absolute', top: 12, left: 12, right: 12, gap: 6 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
            <Text style={[pill, { color: '#fff', fontWeight: '700', backgroundColor: running && anyLive ? '#dc2626' : 'rgba(0,0,0,.6)' }]}>
              {running ? (anyLive ? `● CANLI ${fmtTime(Math.floor((Date.now() - startedAt) / 1000))}` : 'Bağlanıyor…') : 'Yayında değil'}
            </Text>
            <Text style={[pill, { color: '#fff', backgroundColor: 'rgba(0,0,0,.6)' }]}>{QUALITY[quality]}</Text>
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

        {/* Alt tuşlar */}
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
          <Pressable style={btn('rgba(0,0,0,.6)')} disabled={running} onPress={() => setSetup(true)}>
            <Text style={[txt, running && { opacity: 0.4 }]}>⚙️</Text>
          </Pressable>
        </View>

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

              <Text style={{ color: C.muted, fontSize: 12, marginTop: 4 }}>Kalite (iki platforma birden gider; internetin yetmezse düşür)</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {Object.entries(QUALITY).map(([k, v]) => (
                  <Pressable key={k} onPress={() => saveQuality(k)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: quality === k ? '#9146ff' : C.border, backgroundColor: quality === k ? '#9146ff' : C.input }}>
                    <Text style={{ color: quality === k ? '#fff' : C.text, fontWeight: '600' }}>{v}</Text>
                  </Pressable>
                ))}
              </View>
              <Pressable onPress={() => setSetup(false)} style={{ alignSelf: 'flex-end', paddingHorizontal: 18, height: 40, borderRadius: 8, backgroundColor: '#9146ff', justifyContent: 'center', marginTop: 6 }}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Tamam</Text>
              </Pressable>
            </ScrollView>
          </View>
        )}
      </View>
    </Modal>
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
