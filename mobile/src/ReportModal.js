import { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { reportRpc } from './report';

const ADMIN_KEY = 'penguchat:admin';
const SEEN_KEY = 'penguchat:seenReport';
const C = { panel2: '#f7f7f7', input: '#e8e8e8', border: '#cccccc', text: '#111827', muted: '#5b6472', ph: '#8a93a0', ok: '#16a34a', err: '#dc2626', accent: '#9146ff' };

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
export default function ReportModal({ accounts, roles, onUndo, annNow, mode, onClose, appVersion, admin, onAdminChange, startTab, onMineSeen }) {
  return (
    <Modal visible={!!mode} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={s.wrap} onPress={onClose}>
        <Pressable style={[s.dlg, s.tall]} onPress={() => {}}>
          {mode === 'report' && <ReportTabs accounts={accounts} onClose={onClose} appVersion={appVersion} startTab={startTab} onMineSeen={onMineSeen} />}
          {mode === 'inbox' && <Inbox admin={admin} saveAdmin={onAdminChange} onClose={onClose} roles={roles} accounts={accounts} onUndo={onUndo} annNow={annNow} />}
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
        p_platform: `${Platform.OS} ${Platform.Version}`.slice(0, 30),
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
        placeholderTextColor={C.ph}
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

function Inbox({ admin, saveAdmin, onClose, roles, accounts, onUndo, annNow }) {
  const anyRole = !!(roles && (roles.modlog || roles.reports || roles.stats));
  const roleArgs = { p_twitch: accounts?.twitch || '', p_kick: accounts?.kick || '' };
  // Hangi sekmeyi kim görür: yönetici hepsini, yetkili kişi kendine verilenleri
  const allowed = (t) => !!admin || !!{ reports: roles?.reports, mod: roles?.modlog, stats: roles?.stats }[t];
  // Önce menü (yan menünün telefondaki hali) açılır; bir bölüme dokununca o bölüm gelir
  const [tab, setTab] = useState(null); // null (menü) | reports | log | mod | stats | roles | ann | maint | errors
  const [list, setList] = useState(null);
  const [error, setError] = useState(null);
  const [pw, setPw] = useState('');
  const [loginErr, setLoginErr] = useState(null);

  const load = async (password = admin, which = tab, quiet = false) => {
    if (!quiet) setList(null);
    setError(null);
    try {
      const fn = password
        ? { reports: 'get_reports', log: 'get_log', mod: 'get_mod_log', stats: 'get_stats', roles: 'list_roles', maint: 'app_status', ann: 'app_status', errors: 'get_errors' }[which]
        : { reports: 'role_reports', mod: 'role_mod_log', stats: 'role_stats' }[which];
      const data = await reportRpc(fn, which === 'maint' || which === 'ann' ? {} : password ? { p_password: password } : roleArgs);
      setList(which === 'stats' || which === 'maint' || which === 'ann' ? data || {} : data || []);
      if (which === 'reports' && password) markSeen(data || []);
    } catch (e) {
      if (e.message === 'Şifre yanlış' && !password) setError('Bu bölüm için yetkin yok.');
      else if (e.message === 'Şifre yanlış') {
        saveAdmin('');
        setLoginErr('Şifre değişmiş, yeniden gir.');
      } else setError(e.message);
    }
  };
  // İstatistik açıkken her 1 dakikada bir sessizce yenilensin
  useEffect(() => {
    if (tab !== 'stats') return;
    const t = setInterval(() => load(admin, 'stats', true), 60 * 1000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, admin]);
  useEffect(() => {
    // Menüden seçilince yüklenir
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

  if (!admin && !anyRole) {
    return (
      <>
        <Head title="📥 Gelen sorunlar" onClose={onClose} />
        <Text style={s.note}>Yönetici şifresini gir.</Text>
        <TextInput style={s.input} value={pw} onChangeText={setPw} placeholder="Şifre" placeholderTextColor={C.ph} secureTextEntry autoCapitalize="none" onSubmitEditing={login} />
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
      <View style={s.head}>
        {tab ? (
          <Pressable style={s.mini} onPress={() => setTab(null)} hitSlop={8}>
            <Text style={s.miniText}>‹ Geri</Text>
          </Pressable>
        ) : null}
        <Text style={[s.title, { flex: 1 }]} numberOfLines={1}>
          {tab ? SECTIONS.find(([k]) => k === tab)?.[1] : '⚙️ Yönetim'}
        </Text>
        {!!tab && (
          <Pressable style={s.mini} onPress={() => load()} hitSlop={6}>
            <Text style={s.miniText}>⟳</Text>
          </Pressable>
        )}
        {!!admin && !tab && (
          <Pressable style={s.mini} onPress={() => saveAdmin('')} hitSlop={6}>
            <Text style={s.miniText}>Çıkış</Text>
          </Pressable>
        )}
        <Pressable style={s.mini} onPress={onClose} hitSlop={8}>
          <Text style={s.miniText}>✕</Text>
        </Pressable>
      </View>
      {!tab && (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 8 }}>
          {SECTIONS.filter(([k]) => allowed(k)).map(([k, label, desc]) => (
            <Pressable
              key={k}
              style={s.menuBtn}
              onPress={() => {
                setTab(k);
                load(admin, k);
              }}
            >
              <Text style={s.menuBtnText}>{label}</Text>
              <Text style={s.repSmall}>{desc}</Text>
            </Pressable>
          ))}
        </ScrollView>
      )}
      {!!tab && (
      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ gap: 6 }}>
        {list === null && !error && <ActivityIndicator color={C.text} style={{ marginTop: 30 }} />}
        {error && (
          <Text style={s.empty}>
            Yüklenemedi: {error}
            {/\(404\)/.test(error) ? " — Supabase'e SQL çalıştırılmamış olabilir." : ''}
          </Text>
        )}
        {tab === 'reports' && list?.length === 0 && <Text style={s.empty}>Henüz gelen sorun yok 🎉</Text>}
        {tab === 'reports' &&
          Array.isArray(list) &&
          list.map((x) => (
            <AdminItem key={x.id} x={x} admin={admin} roleArgs={roleArgs} onDelete={admin ? () => del(x.id) : null} onSaved={() => load()} />
          ))}
        {tab === 'log' && Array.isArray(list) && (list.length ? list.map((x) => <LogRow key={x.id} x={x} />) : <Text style={s.empty}>Henüz kayıt yok.</Text>)}
        {tab === 'mod' &&
          Array.isArray(list) &&
          (list.length ? (
            (() => {
              // Sonradan geri alınmış cezaları bul (liste yeniden eskiye sıralı)
              const after = new Set();
              const undone = new Set();
              for (const x of list) {
                const key = x.platform + '|' + String(x.target).toLowerCase();
                if (x.action === 'untimeout' || x.action === 'unban') after.add(key + '|' + (x.action === 'unban' ? 'ban' : 'timeout'));
                else if (after.has(key + '|' + x.action) || (x.platform === 'kick' && after.has(key + '|ban'))) undone.add(x.id);
              }
              return list.map((x) => (
                <ModRow key={x.id} x={x} undone={undone.has(x.id)} onUndo={onUndo ? async () => (await onUndo(x)) && setTimeout(() => load(), 600) : null} />
              ));
            })()
          ) : (
            <Text style={s.empty}>Henüz mod işlemi yok.</Text>
          ))}
        {tab === 'errors' && Array.isArray(list) && (
          <>
            {list.length > 0 && (
              <Pressable
                style={[s.mini, { alignSelf: 'flex-end' }]}
                onPress={() =>
                  Alert.alert('Temizle', 'Bütün hata kayıtları silinsin mi?', [
                    { text: 'Vazgeç', style: 'cancel' },
                    { text: 'Sil', style: 'destructive', onPress: () => reportRpc('clear_errors', { p_password: admin }).then(() => load()).catch((e) => Alert.alert('Temizlenemedi', e.message)) },
                  ])
                }
              >
                <Text style={s.miniText}>🗑 Hepsini temizle</Text>
              </Pressable>
            )}
            {list.length === 0 && <Text style={s.empty}>Kayıtlı hata yok 🎉</Text>}
            {list.map((x) => (
              <View key={x.id} style={s.rep}>
                <View style={s.repMeta}>
                  <Text style={s.repName}>⚠️ {x.kind}</Text>
                  <View style={{ flex: 1 }} />
                  <Text style={s.repSmall}>{fmtDate(x.at)}</Text>
                </View>
                <Text style={s.repMsg} selectable>
                  {x.detail}
                </Text>
                <Text style={s.repSmall}>
                  {x.account || 'giriş yok'} · {devLabel(x.platform)} · v{x.version || '?'}
                </Text>
              </View>
            ))}
          </>
        )}
        {tab === 'stats' && list && !Array.isArray(list) && <Stats d={list} />}
        {tab === 'roles' && Array.isArray(list) && <Roles list={list} admin={admin} onChanged={() => load()} />}
        {tab === 'ann' && list && !Array.isArray(list) && <Announce d={list} admin={admin} onChanged={() => load()} />}
        {tab === 'maint' && list && !Array.isArray(list) && <Maint d={list} admin={admin} onChanged={() => load()} />}
      </ScrollView>
      )}
    </>
  );
}

// 📢 Duyuru (sadece yönetici)
function Announce({ d, admin, onChanged }) {
  const [text, setText] = useState('');
  const [hint, setHint] = useState(null);
  const save = async (t) => {
    if (t !== '' && !t.trim()) return setHint('Duyuru metnini yaz.');
    try {
      await reportRpc('set_announcement', { p_password: admin, p_text: t });
      setText('');
      setHint(null);
      onChanged();
    } catch (e) {
      setHint('Kaydedilemedi: ' + e.message);
    }
  };
  return (
    <View style={[s.rep, { gap: 10 }]}>
      <Text style={[s.repName, { fontSize: 15 }]}>📢 Duyuru</Text>
      {!!(d.announcement || '').trim() && <Text style={s.note}>Şu an yayında: {d.announcement}</Text>}
      <TextInput
        style={[s.input, { height: 70 }]}
        value={text}
        onChangeText={setText}
        placeholder={d.announcement ? 'Yeni duyuru yaz — eskisinin yerine geçer' : 'Herkesin ekranının üstünde görünecek duyuru'}
        placeholderTextColor={C.ph}
        multiline
        maxLength={300}
        textAlignVertical="top"
      />
      {!!hint && <Text style={[s.hint, { color: C.err }]}>{hint}</Text>}
      <View style={[s.head, { justifyContent: 'flex-end' }]}>
        {!!d.announcement && (
          <Pressable style={s.mini} onPress={() => save('')}>
            <Text style={s.miniText}>Duyuruyu kaldır</Text>
          </Pressable>
        )}
        <Pressable style={s.primary} onPress={() => save(text.trim() ? text : ' ')}>
          <Text style={s.primaryText}>📢 Yayınla</Text>
        </Pressable>
      </View>
      <Text style={s.note}>Duyuru uygulamayı kapatmaz; herkes ✕ ile kapatabilir. Yeni duyuru yayınlayınca yine görünür.</Text>
    </View>
  );
}

// 🛠️ Bakım modu (sadece yönetici)
function Maint({ d, admin, onChanged }) {
  // Bakım kapalıyken kutular boş başlar (eski sebep/saat kalmasın)
  const [msg, setMsg] = useState(d.maintenance ? d.message || '' : '');
  const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
  const [eta, setEta] = useState(d.maintenance && TIME.test(d.eta || '') ? d.eta : '');
  // Sadece saat: rakam dışı silinir, 2 rakamdan sonra ':' kendiliğinden eklenir (örn 2230 → 22:30)
  const onEta = (t) => {
    const d4 = t.replace(/\D/g, '').slice(0, 4);
    setEta(d4.length > 2 ? d4.slice(0, 2) + ':' + d4.slice(2) : d4);
  };
  const [hint, setHint] = useState(null);
  const on = !!d.maintenance;
  const save = async (next) => {
    try {
      await reportRpc('set_maintenance', { p_password: admin, p_on: next, p_message: next ? msg : '', p_eta: next ? eta : '' });
      if (!next) { setMsg(''); setEta(''); }
      onChanged();
    } catch (e) {
      setHint('Kaydedilemedi: ' + e.message);
    }
  };
  return (
    <View style={[s.rep, { gap: 10 }]}>
      <Text style={[s.repName, { fontSize: 15 }]}>{on ? '🛠️ Bakım modu AÇIK — uygulama sadece sende çalışıyor' : '✅ Uygulama herkese açık'}</Text>
      <TextInput
        style={[s.input, { height: 70 }]}
        value={msg}
        onChangeText={setMsg}
        placeholder="Sebep (zorunlu) — örn: Yeni özellik ekleniyor"
        placeholderTextColor={C.ph}
        multiline
        maxLength={300}
        textAlignVertical="top"
      />
      <TextInput
        style={s.input}
        value={eta}
        onChangeText={onEta}
        placeholder="⏰ Tahmini açılış saati (zorunlu) — örn: 22:30"
        placeholderTextColor={C.ph}
        keyboardType="number-pad"
        maxLength={5}
      />
      {!!hint && <Text style={[s.hint, { color: C.err }]}>{hint}</Text>}
      <View style={[s.head, { justifyContent: 'flex-end' }]}>
        {on && (
          <Pressable style={s.mini} onPress={() => (!msg.trim() ? setHint('Sebebi yaz.') : !TIME.test(eta) ? setHint('Tahmini açılış saatini yaz (örn: 22:30).') : save(true))}>
            <Text style={s.miniText}>Bilgiyi güncelle</Text>
          </Pressable>
        )}
        <Pressable
          style={[s.primary, !on && { backgroundColor: '#b3261e' }]}
          onPress={() =>
            on
              ? save(false)
              : !msg.trim()
              ? setHint('Sebebi yaz.')
              : !TIME.test(eta)
              ? setHint('Tahmini açılış saatini yaz (örn: 22:30).')
              : Alert.alert('Bakıma al', 'Uygulama senin dışındaki herkese kapansın mı?', [
                  { text: 'Vazgeç', style: 'cancel' },
                  { text: 'Bakıma al', style: 'destructive', onPress: () => save(true) },
                ])
          }
        >
          <Text style={s.primaryText}>{on ? 'Bakımı kapat' : '🛠️ Bakıma al'}</Text>
        </Pressable>
      </View>
      <Text style={s.note}>Bakımdayken diğer herkeste uygulama "Bakımdayız" ekranıyla kapanır, sen kullanmaya devam edersin. Kapatınca en geç 30 saniyede herkeste açılır.</Text>
    </View>
  );
}

// 👥 Yetkiler (sadece yönetici): Twitch / Kick adına uygulama içi yetki ver
const ROLE_LABEL = { modlog: '🛡️ Mod log', reports: '📥 Sorunlar', stats: '📊 İstatistik' };
function Toggle({ on, label, onPress }) {
  return (
    <Pressable style={[s.mini, on && { backgroundColor: C.accent, borderColor: C.accent }]} onPress={onPress}>
      <Text style={s.miniText}>{label}</Text>
    </Pressable>
  );
}
function Roles({ list, admin, onChanged }) {
  const [platform, setPlatform] = useState('twitch');
  const [name, setName] = useState('');
  const [pick, setPick] = useState({ modlog: false, reports: false, stats: false });
  const [hint, setHint] = useState(null);
  const save = async (p, u, r) => {
    try {
      await reportRpc('set_role', { p_password: admin, p_platform: p, p_username: u, p_modlog: r.modlog, p_reports: r.reports, p_stats: r.stats });
      onChanged();
      return true;
    } catch (e) {
      setHint('Kaydedilemedi: ' + e.message);
      return false;
    }
  };
  const add = async () => {
    const u = name.trim().replace(/^@/, '');
    if (!u) return setHint('Kullanıcı adını yaz.');
    if (!pick.modlog && !pick.reports && !pick.stats) return setHint('En az bir yetki seç.');
    if (await save(platform, u, pick)) {
      setName('');
      setPick({ modlog: false, reports: false, stats: false });
      setHint(null);
    }
  };
  return (
    <>
      <View style={[s.rep, { gap: 8 }]}>
        <View style={s.repMeta}>
          <Toggle on={platform === 'twitch'} label="Twitch" onPress={() => setPlatform('twitch')} />
          <Toggle on={platform === 'kick'} label="Kick" onPress={() => setPlatform('kick')} />
          <TextInput
            style={[s.input, { flex: 1, minWidth: 0, paddingVertical: 4 }]}
            value={name}
            onChangeText={setName}
            placeholder="kullanıcı adı"
            placeholderTextColor={C.ph}
            autoCapitalize="none"
            autoCorrect={false}
          />
        </View>
        <View style={[s.repMeta, { flexWrap: 'wrap' }]}>
          {Object.keys(ROLE_LABEL).map((k) => (
            <Toggle key={k} on={pick[k]} label={ROLE_LABEL[k]} onPress={() => setPick((p) => ({ ...p, [k]: !p[k] }))} />
          ))}
        </View>
        <View style={s.head}>
          <Text style={[s.hint, { color: C.err }]}>{hint || ''}</Text>
          <Pressable style={s.primary} onPress={add}>
            <Text style={s.primaryText}>Yetki ver</Text>
          </Pressable>
        </View>
      </View>
      <Text style={s.note}>Kanal modluğu Twitch / Kick'ten otomatik okunur; buradakiler sadece bu uygulama için. Bütün yetkileri kapatınca kişi silinir.</Text>
      {list.length === 0 && <Text style={s.empty}>Henüz kimseye yetki verilmedi.</Text>}
      {list.map((x) => {
        const cur = { modlog: x.can_modlog, reports: x.can_reports, stats: x.can_stats };
        return (
          <View key={x.platform + x.username} style={s.rep}>
            <Text style={s.repName}>
              {x.platform === 'twitch' ? 'Twitch' : 'Kick'} · {x.username}
            </Text>
            <View style={[s.repMeta, { flexWrap: 'wrap', marginTop: 6 }]}>
              {Object.keys(ROLE_LABEL).map((k) => (
                <Toggle key={k} on={cur[k]} label={ROLE_LABEL[k]} onPress={() => save(x.platform, x.username, { ...cur, [k]: !cur[k] })} />
              ))}
            </View>
          </View>
        );
      })}
    </>
  );
}

const SECTIONS = [
  ['reports', '📥 Sorunlar', 'Gelen sorunlar: sıraya al, çöz, reddet'],
  ['log', '📜 Log', 'Sorunlarla ilgili her şey saatiyle'],
  ['mod', '🛡️ Mod log', 'Uygulamadan atılan timeout / ban, geri alma'],
  ['stats', '📊 İstatistik', 'Kaç kişi kullanıyor, kim mod, hangi sürüm'],
  ['roles', '👥 Yetkiler', 'Kime hangi bölümün açık olacağı'],
  ['ann', '📢 Duyuru', 'Herkesin ekranının üstünde duyuru'],
  ['maint', '🛠️ Bakım', 'Uygulamayı senin dışında herkese kapat'],
  ['errors', '⚠️ Hatalar', 'Uygulamada otomatik yakalanan hatalar'],
];

const LOG_KIND = { gonderildi: '📨 Gönderildi', onaylandi: '📋 Sıraya alındı', cozuldu: '✅ Çözüldü', reddedildi: '❌ Reddedildi', silindi: '🗑 Silindi' };
function LogRow({ x }) {
  return (
    <View style={s.rep}>
      <View style={s.repMeta}>
        <Text style={s.repName}>{LOG_KIND[x.kind] || x.kind}</Text>
        <Text style={s.repSmall}>{fmtDate(x.at)}</Text>
      </View>
      <Text style={s.repSmall}>{x.contact || 'İsimsiz'}</Text>
      <Text style={s.repMsg}>{x.message}</Text>
      {!!x.note && <Text style={s.repSmall}>Sebep: {x.note}</Text>}
    </View>
  );
}
// "android 14 · SM-A546B" → "android · SM-A546B"
function devLabel(pl) {
  const [a, m] = String(pl || '').split(' · ');
  return a.split(' ')[0] + (m ? ' · ' + m : '');
}
function fmtDur(secs) {
  if (!secs) return '';
  if (secs % 86400 === 0) return secs / 86400 + ' gün';
  if (secs % 3600 === 0) return secs / 3600 + ' saat';
  if (secs % 60 === 0) return secs / 60 + ' dk';
  return secs + ' sn';
}
const MOD_KIND = { ban: '⛔ Ban', untimeout: '↩ Timeout kaldırıldı', unban: '↩ Ban kaldırıldı', delete: '🗑 Mesaj silindi' };
function ModRow({ x, undone, onUndo }) {
  const who = x.platform === 'twitch' ? x.mod_twitch : x.mod_kick;
  const canUndo = !!onUndo && (x.action === 'timeout' || x.action === 'ban') && x.ok !== false && !undone;
  return (
    <View style={[s.rep, undone && { opacity: 0.6 }]}>
      <View style={s.repMeta}>
        <Text style={[s.repName, { flexShrink: 1 }]}>
          {MOD_KIND[x.action] || `⏱ Timeout ${fmtDur(x.secs)}`} · {x.target}
        </Text>
        <View style={{ flex: 1 }} />
        <Text style={s.repSmall}>{fmtDate(x.at)}</Text>
      </View>
      <View style={s.repMeta}>
        <Text style={[s.repSmall, { flex: 1 }]}>
          {x.platform === 'twitch' ? 'Twitch' : 'Kick'} · mod: {who || x.mod_twitch || x.mod_kick || '?'}
          {x.ok === false ? ' · ✗ gönderilemedi' : ''}
          {undone ? ' · geri alındı' : ''}
        </Text>
        {canUndo && (
          <Pressable style={s.mini} onPress={onUndo}>
            <Text style={s.miniText}>↩ Geri al</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}
function ago(iso) {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
  if (m < 2) return 'şimdi';
  if (m < 60) return m + ' dk önce';
  if (m < 1440) return Math.round(m / 60) + ' sa önce';
  return Math.round(m / 1440) + ' gün önce';
}
// Aynı telefon uygulamayı silip yeniden kurunca yeni bir kimlik alıyor ve listede iki kez görünüyor.
// Aynı model + aynı (ya da hiç) hesap olan telefon satırlarını tek satırda birleştir (en yenisi kalır)
// ve sayıları buna göre düzelt.
function mergeStats(d) {
  const list = [...(d.list || [])].sort((a, b) => new Date(b.last_seen) - new Date(a.last_seen));
  // Telefon = işletim sistemi + model. Aynı modelde girişsiz (— —) satır, aynı modelin başka bir satırı varsa
  // (girişli ya da daha yeni) gizlenir: bu genelde aynı telefonun silinip yeniden kurulmuş hâlidir.
  const phoneKey = (x) => {
    const pl = String(x.platform || '');
    return /^(android|ios)\b/.test(pl) && pl.includes(' · ') ? pl.split(' ')[0] + '|' + pl.split(' · ')[1] : null;
  };
  const seen = new Set();
  const withAcc = new Set(list.filter((x) => phoneKey(x) && (x.twitch || x.kick)).map(phoneKey));
  const out = [];
  for (const x of list) {
    const k = phoneKey(x);
    if (k) {
      const acc = x.twitch || x.kick;
      const key = k + '|' + (x.twitch || '') + '|' + (x.kick || '');
      if (seen.has(key) || (!acc && withAcc.has(k))) continue;
      seen.add(key);
    }
    out.push(x);
  }
  const removed = list.length - out.length;
  if (!removed) return d;
  const now = Date.now();
  return {
    ...d,
    list: out,
    total: Math.max(0, (Number(d.total) || 0) - removed),
    online: out.filter((x) => now - new Date(x.last_seen) < 10 * 60000).length,
    today: out.filter((x) => now - new Date(x.last_seen) < 24 * 3600000).length,
  };
}
function Stats({ d: raw }) {
  const d = mergeStats(raw || {});
  const tile = (n, label) => (
    <View style={[s.rep, { flexBasis: '31%', flexGrow: 1, alignItems: 'center' }]}>
      <Text style={{ color: C.text, fontSize: 22, fontWeight: '700' }}>{Number(n) || 0}</Text>
      <Text style={s.repSmall}>{label}</Text>
    </View>
  );
  return (
    <>
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
        {tile(d.total, 'Toplam kullanıcı')}
        {tile(d.online, 'Şu an açık')}
        {tile(d.today, 'Son 24 saat')}
        {tile(d.mods, 'Mod (7 gün)')}
        {tile(d.bans, 'Ban')}
        {tile(d.timeouts, 'Timeout')}
      </View>
      {(d.list || []).map((x, i) => {
        const on = Date.now() - new Date(x.last_seen) < 10 * 60000;
        return (
          <View key={i} style={[s.rep, { flexDirection: 'row', alignItems: 'center', gap: 8 }]}>
            <Text style={{ color: on ? C.ok : C.muted }}>{on ? '●' : '○'}</Text>
            <View style={{ flex: 1 }}>
              <Text style={s.repName}>
                {[x.twitch && 'Twitch: ' + x.twitch, x.kick && 'Kick: ' + x.kick].filter(Boolean).join(' · ') || 'Giriş yapılmamış'}
                {x.is_mod ? ' 🛡️' : ''}
              </Text>
              <Text style={s.repSmall}>
                {devLabel(x.platform)} · v{x.version || '?'} · {ago(x.last_seen)}
              </Text>
            </View>
          </View>
        );
      })}
    </>
  );
}

function AdminItem({ x, admin, roleArgs, onDelete, onSaved }) {
  const [rejecting, setRejecting] = useState(false);
  const [note, setNote] = useState('');
  const [hint, setHint] = useState(null);
  const next = NEXT[x.status] || NEXT.bekliyor;
  const save = async (st, reason) => {
    setHint('Kaydediliyor…');
    try {
      if (admin) await reportRpc('set_report_status', { p_password: admin, p_id: Number(x.id), p_status: st, p_note: reason || '' });
      else await reportRpc('role_set_status', { ...roleArgs, p_id: Number(x.id), p_status: st, p_note: reason || '' });
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
        {!!onDelete && (
          <Pressable onPress={onDelete} hitSlop={8}>
            <Text>🗑</Text>
          </Pressable>
        )}
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
            placeholderTextColor={C.ph}
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

let s = makeS();
function makeS() {
  return StyleSheet.create({
  menuBtn: { backgroundColor: C.input, borderWidth: 1, borderColor: C.border, borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, gap: 2 },
  menuBtnText: { color: C.text, fontSize: 16, fontWeight: '700' },
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
}
// 🎨 Renk teması değişince bu pencerenin renkleri de güncellenir
export function applyModalTheme(t) {
  const light = t.text !== '#ffffff';
  Object.assign(C, { panel2: t.panel2, input: t.input, border: t.border, muted: t.muted, text: t.text, ph: t.ph, ok: light ? '#16a34a' : '#53fc18', err: light ? '#dc2626' : '#ff6b6b' });
  s = makeS();
}
