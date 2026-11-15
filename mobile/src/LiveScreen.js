// 📡 Telefondan yayın (1. adım: Twitch). Kamera + mikrofon görüntüsü RTMP ile Twitch'e gönderilir.
// Yayın anahtarı sadece bu telefonda saklanır, hiçbir sunucuya gönderilmez (sadece Twitch'e).
import { useEffect, useRef, useState } from 'react';
import { Alert, Modal, Platform, Pressable, ScrollView, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

// Yerel (native) parçalar sadece Android'de yüklenir
const LiveStreamView = Platform.OS === 'android' ? require('@api.video/react-native-livestream').LiveStreamView : null;
const keepAwake = Platform.OS === 'android' ? require('expo-keep-awake') : null;

const KEY_STORE = 'penguchat:liveKeys';
const SET_STORE = 'penguchat:liveSettings';
const TWITCH_INGEST = 'rtmp://live.twitch.tv/app/';
const QUALITY = {
  low: { label: 'Düşük (480p)', resolution: '480p', bitrate: 1500000 },
  mid: { label: 'Orta (720p)', resolution: '720p', bitrate: 3000000 },
  high: { label: 'Yüksek (1080p)', resolution: '1080p', bitrate: 6000000 },
};

const fmtTime = (s) => {
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60;
  return (h ? h + ':' : '') + String(m).padStart(h ? 2 : 1, '0') + ':' + String(x).padStart(2, '0');
};

export default function LiveScreen({ C, onClose }) {
  const ref = useRef(null);
  const [keys, setKeys] = useState({ twitch: '' });
  const [settings, setSettings] = useState({ quality: 'mid', camera: 'back' });
  const [muted, setMuted] = useState(false);
  const [status, setStatus] = useState('idle'); // idle | connecting | live | error
  const [error, setError] = useState('');
  const [setup, setSetup] = useState(false);
  const [startedAt, setStartedAt] = useState(0);
  const [, tick] = useState(0);

  useEffect(() => {
    AsyncStorage.multiGet([KEY_STORE, SET_STORE]).then((r) => {
      try { const k = JSON.parse(r[0][1] || '{}'); setKeys((o) => ({ ...o, ...k })); if (!k.twitch) setSetup(true); } catch { setSetup(true); }
      try { const st = JSON.parse(r[1][1] || '{}'); setSettings((o) => ({ ...o, ...st })); } catch {}
    });
  }, []);
  useEffect(() => {
    if (status !== 'live') return;
    const t = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(t);
  }, [status]);
  // Yayın sürerken ekran kapanmasın
  useEffect(() => {
    if (!keepAwake) return;
    if (status === 'live' || status === 'connecting') keepAwake.activateKeepAwakeAsync('pengu-live').catch(() => {});
    else keepAwake.deactivateKeepAwake('pengu-live');
    return () => keepAwake.deactivateKeepAwake('pengu-live');
  }, [status]);

  const saveKeys = (k) => { setKeys(k); AsyncStorage.setItem(KEY_STORE, JSON.stringify(k)).catch(() => {}); };
  const saveSettings = (st) => { setSettings(st); AsyncStorage.setItem(SET_STORE, JSON.stringify(st)).catch(() => {}); };

  const start = async () => {
    const key = keys.twitch.trim();
    if (!key) { setSetup(true); return; }
    setError('');
    setStatus('connecting');
    try {
      await ref.current?.startStreaming(key, TWITCH_INGEST);
    } catch (e) {
      setStatus('error');
      setError(String(e?.message || e));
    }
  };
  const stop = () => {
    try { ref.current?.stopStreaming(); } catch {}
    setStatus('idle');
  };
  const close = () => {
    if (status === 'live' || status === 'connecting') {
      Alert.alert('Yayın sürüyor', 'Yayın kapatılsın mı?', [
        { text: 'Vazgeç', style: 'cancel' },
        { text: 'Yayını bitir', style: 'destructive', onPress: () => { stop(); onClose(); } },
      ]);
    } else onClose();
  };

  const q = QUALITY[settings.quality] || QUALITY.mid;
  const live = status === 'live';
  const btn = (bg) => ({ paddingHorizontal: 14, height: 44, borderRadius: 22, justifyContent: 'center', alignItems: 'center', backgroundColor: bg });
  const txt = { color: '#fff', fontWeight: '700', fontSize: 15 };

  return (
    <Modal animationType="slide" onRequestClose={close}>
      <View style={{ flex: 1, backgroundColor: '#000' }}>
        {LiveStreamView ? (
          <LiveStreamView
            ref={ref}
            style={{ flex: 1 }}
            camera={settings.camera}
            isMuted={muted}
            enablePinchedZoom
            video={{ resolution: q.resolution, bitrate: q.bitrate, fps: 30, gopDuration: 2 }}
            audio={{ bitrate: 128000, sampleRate: 44100, isStereo: true }}
            onConnectionSuccess={() => { setStatus('live'); setStartedAt(Date.now()); }}
            onConnectionFailed={(code) => { setStatus('error'); setError('Bağlanılamadı: ' + code + '\nYayın anahtarını ve internetini kontrol et.'); }}
            onDisconnect={() => setStatus((s) => (s === 'live' ? 'error' : 'idle'))}
            onPermissionsDenied={() => { setStatus('error'); setError('Kamera ve mikrofon izni gerekli. Telefon Ayarları → Uygulamalar → PengusChat → İzinler.'); }}
          />
        ) : (
          <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><Text style={{ color: '#fff' }}>Yayın sadece Android'de.</Text></View>
        )}

        {/* Üst şerit: durum + kapat */}
        <View style={{ position: 'absolute', top: 12, left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <View style={{ backgroundColor: live ? '#dc2626' : 'rgba(0,0,0,.55)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5 }}>
            <Text style={{ color: '#fff', fontWeight: '700' }}>
              {live ? `● CANLI ${fmtTime(Math.floor((Date.now() - startedAt) / 1000))}` : status === 'connecting' ? 'Bağlanıyor…' : 'Yayında değil'}
            </Text>
          </View>
          <Text style={{ color: '#fff', backgroundColor: 'rgba(0,0,0,.55)', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 5, overflow: 'hidden' }}>Twitch · {q.label}</Text>
          <View style={{ flex: 1 }} />
          <Pressable onPress={close} hitSlop={10} style={{ backgroundColor: 'rgba(0,0,0,.55)', borderRadius: 18, width: 36, height: 36, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: '#fff', fontSize: 18 }}>✕</Text>
          </Pressable>
        </View>

        {!!error && (
          <View style={{ position: 'absolute', top: 60, left: 12, right: 12, backgroundColor: 'rgba(220,38,38,.92)', borderRadius: 10, padding: 10 }}>
            <Text style={{ color: '#fff' }}>{error}</Text>
          </View>
        )}

        {/* Alt tuşlar */}
        <View style={{ position: 'absolute', bottom: 24, left: 12, right: 12, flexDirection: 'row', alignItems: 'center', gap: 10, justifyContent: 'center' }}>
          <Pressable style={btn('rgba(0,0,0,.6)')} onPress={() => saveSettings({ ...settings, camera: settings.camera === 'back' ? 'front' : 'back' })}>
            <Text style={txt}>🔄</Text>
          </Pressable>
          <Pressable style={btn(muted ? '#dc2626' : 'rgba(0,0,0,.6)')} onPress={() => setMuted((m) => !m)}>
            <Text style={txt}>{muted ? '🔇' : '🎤'}</Text>
          </Pressable>
          {live || status === 'connecting' ? (
            <Pressable style={[btn('#dc2626'), { paddingHorizontal: 22 }]} onPress={stop}><Text style={txt}>■ Bitir</Text></Pressable>
          ) : (
            <Pressable style={[btn('#9146ff'), { paddingHorizontal: 22 }]} onPress={start}><Text style={txt}>● Yayına başla</Text></Pressable>
          )}
          <Pressable style={btn('rgba(0,0,0,.6)')} disabled={live} onPress={() => setSetup(true)}>
            <Text style={[txt, live && { opacity: 0.4 }]}>⚙️</Text>
          </Pressable>
        </View>

        {/* Ayarlar: yayın anahtarı + kalite */}
        {setup && (
          <View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,.7)', justifyContent: 'center', padding: 16 }}>
            <ScrollView contentContainerStyle={{ backgroundColor: C.panel, borderRadius: 12, borderWidth: 1, borderColor: C.border, padding: 14, gap: 10 }}>
              <Text style={{ color: C.text, fontSize: 16, fontWeight: '700' }}>📡 Yayın ayarları</Text>
              <Text style={{ color: C.muted, fontSize: 12 }}>Twitch yayın anahtarı (Twitch → Creator Dashboard → Ayarlar → Yayın → Birincil yayın anahtarı). Sadece bu telefonda saklanır, kimseyle paylaşma.</Text>
              <TextInput
                value={keys.twitch}
                onChangeText={(v) => saveKeys({ ...keys, twitch: v.trim() })}
                placeholder="live_123456789_xxxxxxxx"
                placeholderTextColor={C.ph}
                secureTextEntry
                autoCapitalize="none"
                autoCorrect={false}
                style={{ height: 44, borderRadius: 8, borderWidth: 1, borderColor: C.border, backgroundColor: C.input, color: C.text, paddingHorizontal: 10 }}
              />
              <Text style={{ color: C.muted, fontSize: 12 }}>Kalite (internet zayıfsa düşük seç)</Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {Object.entries(QUALITY).map(([k, v]) => (
                  <Pressable key={k} onPress={() => saveSettings({ ...settings, quality: k })} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8, borderWidth: 1, borderColor: settings.quality === k ? '#9146ff' : C.border, backgroundColor: settings.quality === k ? '#9146ff' : C.input }}>
                    <Text style={{ color: settings.quality === k ? '#fff' : C.text, fontWeight: '600' }}>{v.label}</Text>
                  </Pressable>
                ))}
              </View>
              <Text style={{ color: C.muted, fontSize: 12 }}>Kick yayını bir sonraki adımda eklenecek.</Text>
              <Pressable onPress={() => setSetup(false)} style={{ alignSelf: 'flex-end', paddingHorizontal: 18, height: 40, borderRadius: 8, backgroundColor: '#9146ff', justifyContent: 'center' }}>
                <Text style={{ color: '#fff', fontWeight: '700' }}>Tamam</Text>
              </Pressable>
            </ScrollView>
          </View>
        )}
      </View>
    </Modal>
  );
}
