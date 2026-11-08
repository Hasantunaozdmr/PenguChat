import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reportRpc } from './report';

const ADMIN_KEY = 'penguchat:admin';
const SEEN_KEY = 'penguchat:seenReport';
const C = { panel2: '#0b7c77', input: '#075a56', border: '#23bdb5', text: '#ffffff', muted: '#c9f3ef', ok: '#53fc18', err: '#ff6b6b', accent: '#9146ff' };

function fmtDate(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return '';
  const p = (n) => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)}.${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

// Yönetici şifresi ve "son görülen sorun" telefonda saklanır; App bunları kullanarak 📥 tuşunu gösterir.
export async function loadAdmin() {
  try {
    return (await AsyncStorage.getItem(ADMIN_KEY)) || '';
  } catch {
    return '';
  }
}
export function storeAdmin(v) {
  (v ? AsyncStorage.setItem(ADMIN_KEY, v) : AsyncStorage.removeItem(ADMIN_KEY)).catch(() => {});
}
async function getSeen() {
  try {
    return Number(await AsyncStorage.getItem(SEEN_KEY)) || 0;
  } catch {
    return 0;
  }
}
async function markSeen(list) {
  const max = Math.max(await getSeen(), ...list.map((x) => Number(x.id) || 0));
  AsyncStorage.setItem(SEEN_KEY, String(max)).catch(() => {});
}
export async function countNew(password) {
  if (!password) return 0;
  try {
    const list = (await reportRpc('get_reports', { p_password: password })) || [];
    const seen = await getSeen();
    return list.filter((x) => Number(x.id) > seen).length;
  } catch {
    return 0;
  }
}

// Bu cihazın gizli kimliği: kişi kendi gönderdiği sorunların durumunu görebilsin diye.
const TOKEN_KEY = 'penguchat:reporterToken';
const MINE_SEEN_KEY = 'penguchat:mineSeen';
async function myToken(create) {
  let t = '';
  try {
    t = (await AsyncStorage.getItem(TOKEN_KEY)) || '';
  } catch {}
  if (!t && create) {
    const hex = () => Math.random().toString(16).slice(2).padEnd(13, '0');
    t = (Date.now().toString(16) + hex() + hex() + hex()).slice(0, 48);
    AsyncStorage.setItem(TOKEN_KEY, t).catch(() => {});
  }
  return t;
}
async function getMineSeen() {
  try {
    return JSON.parse((await AsyncStorage.getItem(MINE_SEEN_KEY)) || '{}');
  } catch {
    return {};
  }
}
const isNews = (x, seen) => x.status !== 'bekliyor' && seen[x.id] !== x.updated_at;
// Gönderdiğim sorunlardan birine cevap / durum değişikliği geldi mi?
export async function hasMineNews() {
  const t = await myToken(false);
  if (!t) return false;
  try {
    const list = (await reportRpc('my_reports', { p_token: t })) || [];
    const seen = await getMineSeen();
    return list.some((x) => isNews(x, seen));
  } catch {
    return false;
  }
}

// Durumlar sadece ileri gider: çözülen / reddedilen kilitlenir
const NEXT = {
  bekliyor: ['onaylandi', 'reddedildi'],
  onaylandi: ['cozuldu'],
  cozuldu: [],
  reddedildi: [],
};

// Yönetici düğmelerinin yazısı
const ACTION = { onaylandi: '➡️ Sıraya al', cozuldu: '✅ Çözüldü', reddedildi: '❌ Reddet' };

export const STATUS = {
  bekliyor: { label: '📨 Gönderildi', color: '#6b7280' },
  onaylandi: { label: '📋 Sırada', color: '#2563eb' },
  cozuldu: { label: '✅ Çözüldü', color: '#1f8f3a' },
  reddedildi: { label: '❌ Reddedildi', color: '#b3261e' },
};
function Status({ st }) {
  const v = STATUS[st] || STATUS.bekliyor;
  return (
    <View style={[s.st, { backgroundColor: v.color }]}>
      <Text style={s.stText}>{v.label}</Text>
    </View>
  );
}

// mode: 'report' (herkes) | 'inbox' (yalnızca yönetici)
export default function ReportModal({ accounts, mode, onClose, appVersion, admin, onAdminChange, startTab, onMineSeen }) {
  return (
    <Modal visible={!!mode} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.wrap} onPress={onClose}>
        <Pressable style={[s.dlg, (mode === 'inbox' || mode === 'report') && s.tall]} onPress={() => {}}>
          {mode === 'report' && <ReportTabs accounts={accounts} onClose={onClose} appVersion={appVersion} startTab={startTab} onMineSeen={onMineSeen} />}
          {mode === 'inbox' && <Inbox admin={admin} saveAdmin={onAdminChange} onClose={onClose} />}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function Head({ title, onClose, children }) {
  return (
    <View style={s.head}>
      <Text style={s.title}>{title}</Text>
      <View style={{ flex: 1 }} />
      {children}
      <Pressable style={s.mini} onPress={onClose} hitSlop={8}>
        <Text style={s.miniText}>✕</Text>
      </Pressable>
    </View>
  );
}

function ReportTabs({ accounts, onClose, appVersion, startTab, onMineSeen }) {
  const [tab, setTab] = useState(startTab || 'new');
  const T = (k, label) => (
    <Pressable style={[s.tab, tab === k && s.tabOn]} onPress={() => setTab(k)}>
      <Text style={[s.tabText, tab === k && { color: C.text }]}>{label}</Text>
    </Pressable>
  );
  return (
    <>
      <View style={s.head}>
        {T('new', '🐞 Bildir')}
        {T('mine', '📋 Bildirdiklerim')}
        <View style={{ flex: 1 }} />
        <Pressable style={s.mini} onPress={onClose} hitSlop={8}>
          <Text style={s.miniText}>✕</Text>
        </Pressable>
      </View>
      {tab === 'new' ? (
        <ReportForm accounts={accounts} appVersion={appVersion} onSent={() => setTimeout(() => setTab('mine'), 1500)} />
      ) : (
        <Mine onMineSeen={onMineSeen} />
      )}
    </>
  );
}

function Mine({ onMineSeen }) {
  const [list, setList] = useState(null);
  const [seen, setSeen] = useState({});
  const [error, setError] = useState(null);
  useEffect(() => {
    (async () => {
      const t = await myToken(false);
      if (!t) return setList([]);
      try {
        const data = (await reportRpc('my_reports', { p_token: t })) || [];
        setSeen(await getMineSeen());
        setList(data);
        const next = {};
        for (const x of data) next[x.id] = x.updated_at;
        AsyncStorage.setItem(MINE_SEEN_KEY, JSON.stringify(next)).catch(() => {});
        onMineSeen?.();
      } catch (e) {
        setError(e.message);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 6 }}>
      {list === null && !error && <ActivityIndicator color={C.text} style={{ marginTop: 30 }} />}
      {error && <Text style={s.empty}>Yüklenemedi: {error}</Text>}
      {list?.length === 0 && <Text style={s.empty}>Bu telefondan henüz sorun bildirmedin.</Text>}
      {list?.map((x) => (
        <View key={x.id} style={s.rep}>
          <View style={s.repMeta}>
            <Status st={x.status} />
            <Text style={s.repSmall}>{fmtDate(x.created_at)}</Text>
            {isNews(x, seen) && <View style={s.dot} />}
          </View>
          <Text style={s.repMsg} selectable>
            {x.message}
          </Text>
          {x.status === 'reddedildi' && !!x.admin_note && (
            <View style={s.note2}>
              <Text style={s.repSmall}>Red sebebi:</Text>
              <Text style={s.repMsg} selectable>
                {x.admin_note}
              </Text>
            </View>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

function ReportForm({ accounts, appVersion, onSent }) {
  const [message, setMessage] = useState('');
  // Kullanıcı adı elle yazılmaz: giriş yapılan Twitch / Kick hesabından gelir (trollemeyi önler)
  const contact = [accounts?.twitch && 'Twitch: ' + accounts.twitch, accounts?.kick && 'Kick: ' + accounts.kick].filter(Boolean).join(' · ');
  const [hint, setHint] = useState(null);
  const [busy, setBusy] = useState(false);
  const send = async () => {
    if (!message.trim()) return setHint({ text: 'Önce sorunu yaz.', err: true });
    if (!contact) return setHint({ text: "Sorun bildirmek için chat'ten Twitch ya da Kick'e giriş yap.", err: true });
    setBusy(true);
    setHint({ text: 'Gönderiliyor…' });
    try {
      const args = {
        p_message: message.trim().slice(0, 2000),
        p_contact: contact.trim().slice(0, 100),
        p_version: appVersion,
        p_platform: `android ${Platform.Version}`.slice(0, 30),
      };
      try {
        await reportRpc('submit_report', { ...args, p_token: await myToken(true) });
      } catch (e) {
        // Sunucu eski kurulumdaysa (durum takibi yok) tokensız gönder
        if (!/\(404\)/.test(e.message)) throw e;
        await reportRpc('submit_report', args);
      }
      setMessage('');
      setHint({ text: 'Gönderildi! Durumunu "Bildirdiklerim"den takip edebilirsin 🐧', ok: true });
      onSent();
    } catch (e) {
      setHint({ text: 'Gönderilemedi: ' + e.message, err: true });
    }
    setBusy(false);
  };
  return (
    <>
      <Text style={s.note}>Ne oldu? Ne yaparken oldu? Ne kadar ayrıntı yazarsan o kadar çabuk düzeltilir.</Text>
      <TextInput
        style={[s.input, s.area]}
        value={message}
        onChangeText={setMessage}
        placeholder="Örn: Kick chat'i açılmıyor, siyah ekran kalıyor…"
        placeholderTextColor="#a9e3de"
        multiline
        maxLength={2000}
        textAlignVertical="top"
      />
      <View style={[s.input, { opacity: 0.85 }]}>
        <Text style={{ color: contact ? C.text : C.err, fontSize: 14 }}>{contact || 'Giriş yapılmamış'}</Text>
      </View>
      <View style={s.head}>
        <Text style={[s.hint, hint?.ok && { color: C.ok }, hint?.err && { color: C.err }]} numberOfLines={2}>
          {hint?.text || ''}
        </Text>
        <Pressable style={[s.primary, busy && { opacity: 0.5 }]} disabled={busy} onPress={send}>
          <Text style={s.primaryText}>Gönder</Text>
        </Pressable>
      </View>
    </>
  );
}

function Inbox({ admin, saveAdmin, onClose }) {
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [pw, setPw] = useState('');
  const [loginErr, setLoginErr] = useState(null);

  const load = async (password = admin) => {
    setList(null);
    setError(null);
    try {
      const data = (await reportRpc('get_reports', { p_password: password })) || [];
      setList(data);
      markSeen(data);
    } catch (e) {
      if (e.message === 'Şifre yanlış') {
        saveAdmin('');
        setLoginErr('Şifre değişmiş, yeniden gir.');
      } else setError(e.message);
    }
  };
  useEffect(() => {
    if (admin) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const login = async () => {
    if (!pw) return;
    try {
      const ok = await reportRpc('is_admin', { p_password: pw });
      if (ok !== true) return setLoginErr('Şifre yanlış');
      saveAdmin(pw);
      setLoginErr(null);
      load(pw);
    } catch (e) {
      setLoginErr(e.message);
    }
  };

  const del = (id) =>
    Alert.alert('Silinsin mi?', 'Bu sorun silinecek.', [
      { text: 'Vazgeç', style: 'cancel' },
      {
        text: 'Sil',
        style: 'destructive',
        onPress: async () => {
          try {
            await reportRpc('delete_report', { p_password: admin, p_id: Number(id) });
            load();
          } catch (e) {
            Alert.alert('Silinemedi', e.message);
          }
        },
      },
    ]);

  if (!admin) {
    return (
      <>
        <Head title="📥 Gelen sorunlar" onClose={onClose} />
        <Text style={s.note}>Yönetici şifresini gir.</Text>
        <TextInput style={s.input} value={pw} onChangeText={setPw} placeholder="Şifre" placeholderTextColor="#a9e3de" secureTextEntry autoCapitalize="none" onSubmitEditing={login} />
        <View style={s.head}>
          <Text style={[s.hint, { color: C.err }]}>{loginErr || ''}</Text>
          <Pressable style={s.primary} onPress={login}>
            <Text style={s.primaryText}>Giriş</Text>
          </Pressable>
        </View>
      </>
    );
  }

  return (
    <>
      <Head title={`📥 Gelen sorunlar${list?.length ? ` (${list.length})` : ''}`} onClose={onClose}>
        <Pressable style={s.mini} onPress={() => load()} hitSlop={6}>
          <Text style={s.miniText}>⟳</Text>
        </Pressable>
        <Pressable style={s.mini} onPress={() => saveAdmin('')} hitSlop={6}>
          <Text style={s.miniText}>Çıkış</Text>
        </Pressable>
      </Head>
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 6 }}>
        {list === null && !error && <ActivityIndicator color={C.text} style={{ marginTop: 30 }} />}
        {error && <Text style={s.empty}>Yüklenemedi: {error}</Text>}
        {list?.length === 0 && <Text style={s.empty}>Henüz gelen sorun yok 🎉</Text>}
        {list?.map((x) => (
          <AdminItem key={x.id} x={x} admin={admin} onDelete={() => del(x.id)} onSaved={() => load()} />
        ))}
      </ScrollView>
    </>
  );
}

function AdminItem({ x, admin, onDelete, onSaved }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [hint, setHint] = useState(null);
  const next = NEXT[x.status] || NEXT.bekliyor;
  const save = async (st, reason) => {
    setHint('Kaydediliyor…');
    try {
      await reportRpc('set_report_status', { p_password: admin, p_id: Number(x.id), p_status: st, p_note: reason || '' });
      setRejecting(false);
      setHint(null);
      onSaved();
    } catch (e) {
      setHint('Kaydedilemedi: ' + e.message);
    }
  };
  return (
    <View style={s.rep}>
      <View style={s.repMeta}>
        <Status st={x.status} />
        <Text style={s.repName}>{x.contact || 'İsimsiz'}</Text>
        <View style={{ flex: 1 }} />
        <Pressable onPress={onDelete} hitSlop={8}>
          <Text>🗑</Text>
        </Pressable>
      </View>
      <Text style={s.repSmall}>
        {fmtDate(x.created_at)} · {x.platform || ''} · v{x.app_version || '?'}
      </Text>
      <Text style={s.repMsg} selectable>
        {x.message}
      </Text>
      {x.status === 'reddedildi' && !!x.admin_note && (
        <View style={s.note2}>
          <Text style={s.repSmall}>Red sebebi:</Text>
          <Text style={s.repMsg}>{x.admin_note}</Text>
        </View>
      )}
      <View style={[s.repMeta, { flexWrap: 'wrap', marginTop: 6 }]}>
        {next.map((st) => (
          <Pressable
            key={st}
            style={s.mini}
            onPress={() => {
              setHint(null);
              if (st === 'reddedildi') setRejecting(true);
              else save(st); // tek dokunuş
            }}
          >
            <Text style={s.miniText}>{ACTION[st]}</Text>
          </Pressable>
        ))}
        {!next.length && <Text style={s.repSmall}>🔒 Kesinleşti</Text>}
        {!rejecting && !!hint && <Text style={[s.repSmall, { color: C.err }]}>{hint}</Text>}
      </View>
      {rejecting && (
        <View style={{ gap: 6, marginTop: 6 }}>
          <TextInput
            style={[s.input, { height: 70 }]}
            value={note}
            onChangeText={setNote}
            placeholder="Red sebebi — örn: Bu sorun uygulamayla değil, internetinle ilgili."
            placeholderTextColor="#a9e3de"
            multiline
            maxLength={1000}
            textAlignVertical="top"
            autoFocus
          />
          <View style={s.head}>
            <Text style={[s.hint, { color: C.err }]}>{hint || ''}</Text>
            <Pressable style={s.mini} onPress={() => setRejecting(false)}>
              <Text style={s.miniText}>Vazgeç</Text>
            </Pressable>
            <Pressable
              style={[s.mini, { backgroundColor: '#b3261e', borderColor: '#e0463d' }]}
              onPress={() => (note.trim() ? save('reddedildi', note.trim().slice(0, 1000)) : setHint('Red sebebini yaz.'))}
            >
              <Text style={s.miniText}>Reddet</Text>
            </Pressable>
          </View>
        </View>
      )}
    </View>
  );
}

const s = StyleSheet.create({
  tab: { paddingHorizontal: 10, height: 32, justifyContent: 'center', borderRadius: 7, borderWidth: 1, borderColor: 'transparent' },
  tabOn: { backgroundColor: C.input, borderColor: C.border },
  tabText: { color: C.muted, fontWeight: '700', fontSize: 14 },
  st: { borderRadius: 10, paddingHorizontal: 8, paddingVertical: 1 },
  stText: { color: '#fff', fontSize: 11, fontWeight: '700' },
  dot: { width: 9, height: 9, borderRadius: 5, backgroundColor: '#e0463d' },
  note2: { marginTop: 6, padding: 8, borderLeftWidth: 3, borderLeftColor: C.border, backgroundColor: 'rgba(0,0,0,0.15)', borderRadius: 4 },
  wrap: { flex: 1, backgroundColor: 'rgba(0,0,0,0.55)', justifyContent: 'center', padding: 16 },
  dlg: { backgroundColor: C.panel2, borderWidth: 1, borderColor: C.border, borderRadius: 12, padding: 12, gap: 8 },
  tall: { height: '85%' },
  head: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  title: { color: C.text, fontWeight: '700', fontSize: 16 },
  note: { color: C.muted, fontSize: 13 },
  input: { backgroundColor: C.input, borderWidth: 1, borderColor: C.border, borderRadius: 8, color: C.text, paddingHorizontal: 10, paddingVertical: 8, fontSize: 14 },
  area: { height: 130 },
  hint: { flex: 1, color: C.muted, fontSize: 13 },
  primary: { backgroundColor: C.accent, borderRadius: 8, paddingHorizontal: 18, height: 38, justifyContent: 'center' },
  primaryText: { color: '#fff', fontWeight: '700' },
  mini: { borderWidth: 1, borderColor: C.border, borderRadius: 6, paddingHorizontal: 8, height: 28, justifyContent: 'center' },
  miniText: { color: C.text, fontSize: 13 },
  empty: { color: C.muted, textAlign: 'center', marginTop: 30 },
  rep: { backgroundColor: C.input, borderWidth: 1, borderColor: C.border, borderRadius: 8, padding: 10, gap: 2 },
  repMeta: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  repName: { color: C.text, fontWeight: '700' },
  repSmall: { color: C.muted, fontSize: 11 },
  repMsg: { color: C.text, marginTop: 4, fontSize: 14 },
});
