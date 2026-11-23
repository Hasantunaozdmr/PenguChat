// Chat sayfalarına enjekte edilir: bir kullanıcı adına tıklanınca adı uygulamaya bildirir
// (hızlı timeout / ban çubuğu için). Sayfanın kendi davranışını engellemez.
(() => {
  if (window.__penguPick) return;
  window.__penguPick = true;
  const NAME = /^@?([A-Za-z0-9_]{2,25})$/;
  const isTwitch = /(^|\.)twitch\.tv$/.test(location.hostname);

  function send(name, fromRestream) {
    if (!name) return;
    post('__PENGU_PICK__' + JSON.stringify({ name: name.replace(/^@/, '').toLowerCase(), restream: !!fromRestream }));
  }

  // Restream ile Kick'e aktarılan mesajlarda gerçek yazan: "[Twitch: kullanici] mesaj"
  function restreamAuthor(el) {
    // Mesaj satırına kadar yukarı çık (tüm chat'i kapsayacak kadar büyümeden)
    for (let row = el, i = 0; row && i < 15; row = row.parentElement, i++) {
      const text = row.textContent || '';
      if (text.length > 1500) break;
      const m = text.match(/\[\s*Twitch\s*:\s*([^\]\s]+)\s*\]/i);
      if (m && NAME.test(m[1])) return m[1].replace(/^@/, '');
    }
    return null;
  }

  function nameFrom(target) {
    if (!(target instanceof Element)) return null;
    if (target.closest('input, textarea, [contenteditable="true"]')) return null;

    if (isTwitch) {
      const u = target.closest('[data-a-user]');
      if (u) return u.getAttribute('data-a-user');
      const mention = target.closest('.mention-fragment, [data-a-target="chat-message-mention"]');
      if (mention) return (mention.textContent || '').trim();
      return null;
    }

    // Kick: kullanıcı adı, rengi satır içinde verilmiş ya da title'ı olan bir düğme/span
    const el = target.closest('button, span, a');
    if (!el) return null;
    const text = (el.textContent || '').trim().replace(/:$/, '');
    if (!NAME.test(text)) return null;
    const looksLikeName =
      text.startsWith('@') ||
      (el.getAttribute('title') || '').toLowerCase() === text.toLowerCase() ||
      /color/i.test(el.getAttribute('style') || '') ||
      (typeof el.className === 'string' && /user/i.test(el.className));
    if (!looksLikeName) return null;
    if (text.toLowerCase() === 'restream') {
      const real = restreamAuthor(el);
      if (real) return { name: real, restream: true };
    }
    return text;
  }

  function post(msg) {
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(msg);
    else console.log(msg);
  }

  function findInput() {
    const candidates = [
      ...document.querySelectorAll('[data-a-target="chat-input"], #message-input, [data-input="true"], textarea, [contenteditable="true"]'),
    ].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 40 && r.height > 10 && getComputedStyle(el).visibility !== 'hidden';
    });
    // Ekranın en altındaki kutu genelde mesaj kutusudur
    return candidates.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0] || null;
  }

  function focusAndClear(input) {
    input.focus();
    if (input.tagName === 'TEXTAREA') {
      input.select();
    } else {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    document.execCommand('delete');
  }

  const inputText = (el) => (el.tagName === 'TEXTAREA' ? el.value : el.textContent || '').trim();

  function findSendButton() {
    return (
      document.querySelector('[data-a-target="chat-send-button"], #send-message-button, button[aria-label="Send"], button[aria-label="Gönder"]') ||
      [...document.querySelectorAll('button')].find((b) => /^(gönder|send|chat|sohbet)$/i.test((b.textContent || '').trim()))
    );
  }

  // ---- Moderatör mü? ('mod' | 'viewer' | 'unknown') ----
  // Giriş yapmış hesabın bu kanaldaki yetkisi, sitenin kendi kullandığı yolla sorulur.
  const cookie = (name) => {
    const m = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return m ? decodeURIComponent(m[1]) : '';
  };
  // Sayfada mod araçları (ban / timeout düğmeleri) görünüyor mu? Yedek kontrol.
  const hasModUi = () =>
    !!document.querySelector(
      '[data-a-target="chat-mod-view-button"], [data-test-selector="chat-mod-icons"], button[aria-label^="Ban "], button[aria-label^="Timeout "], button[aria-label*="Yasakla"], button[aria-label*="Zaman aşımı"]'
    );

  async function twitchModStatus(login) {
    const token = cookie('auth-token');
    if (!token) return 'viewer'; // giriş yapılmamış
    try {
      const res = await fetch('https://gql.twitch.tv/gql', {
        method: 'POST',
        headers: { 'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko', Authorization: 'OAuth ' + token },
        body: JSON.stringify({
          query: 'query($l: String!) { currentUser { login } user(login: $l) { self { isModerator } } }',
          variables: { l: login },
        }),
      });
      const d = (await res.json()).data;
      if (d && d.currentUser) window.__penguMe = String(d.currentUser.login || '');
      if (d && d.currentUser && d.currentUser.login === login) return 'mod'; // kanal sahibi
      if (d && d.user && d.user.self) return d.user.self.isModerator ? 'mod' : 'viewer';
    } catch {}
    return hasModUi() ? 'mod' : 'unknown';
  }

  async function kickModStatus(slug) {
    const token = cookie('session_token');
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + token;
    // Giriş yapan hesabın kullanıcı adı (📥 tuşu sahibin hesabında kendiliğinden çıksın diye)
    if (token)
      fetch('/api/v1/user', { credentials: 'include', headers })
        .then((r) => (r.ok ? r.json() : null))
        .then((u) => { if (u && u.username) window.__penguMe = String(u.username); })
        .catch(() => {});
    try {
      const res = await fetch('/api/v2/channels/' + encodeURIComponent(slug) + '/me', { credentials: 'include', headers });
      if (res.status === 401 || res.status === 403) return token ? (hasModUi() ? 'mod' : 'unknown') : 'viewer';
      if (res.ok) {
        const j = await res.json();
        if (j && (j.is_moderator || j.is_broadcaster || j.is_super_admin)) return 'mod';
        if (j && 'is_moderator' in j) return 'viewer';
      }
    } catch {}
    return hasModUi() ? 'mod' : 'unknown';
  }

  window.__penguModStatus = async (channel) => {
    const status = isTwitch ? await twitchModStatus(channel) : await kickModStatus(channel);
    if (window.ReactNativeWebView) {
      await new Promise((r) => setTimeout(r, 300)); // Kick kullanıcı adı isteği bitsin
      post('__PENGU_MOD__' + JSON.stringify({ status, me: window.__penguMe || '' }));
    }
    return status;
  };

  // ---- ✏️ Mesaj kutusu aç / kapat ----
  // Kapalıyken mesaj yazma kutusu ekran dışına taşınır, tüm alan mesajlara kalır. Kutu sayfada
  // kaldığı için hızlı timeout / ban komutları çalışmaya devam eder. Giriş yapılmamışsa dokunmaz,
  // böylece chat'teki "Giriş yap" düğmesi görünür kalır.
  // Kick'te (özellikle iPhone'da) oturum çerezi sayfadan okunamayabiliyor: mesaj kutusu var ve
  // "Giriş yap" düğmesi yoksa da giriş yapılmış say
  const loginBtn = () =>
    [...document.querySelectorAll('button, a')].some((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && r.bottom > innerHeight * 0.5 && /^(giriş yap|log ?in|sign ?(up|in)|kaydol)$/i.test((b.textContent || '').trim());
    });
  const loggedIn = () => !!(isTwitch ? cookie('auth-token') : cookie('session_token') || (findInput() && !loginBtn()));
  const HIDE = ['position', 'left', 'top', 'width'];
  let composerShown = true;
  let hiddenBox = null;
  function restoreComposer() {
    if (!hiddenBox) return;
    HIDE.forEach((k) => hiddenBox.style.removeProperty(k));
    hiddenBox.__penguHidden = false;
    hiddenBox = null;
  }
  // Okuma modu (✏️ kapalı): mesajlara daha çok yer kalsın diye Twitch'in sohbet başlığı ve
  // abone hedefi / öne çıkanlar bandı da gizlenir (✏️ açılınca geri gelir)
  const RO_CSS = '.pengu-ro .stream-chat-header,.pengu-ro [class*="community-highlight"],.pengu-ro .pengu-top{display:none!important}';
  function readOnlyLook(on) {
    if (!document.getElementById('pengu-ro-css') && document.head) {
      const st = document.createElement('style');
      st.id = 'pengu-ro-css';
      st.textContent = RO_CSS;
      document.head.appendChild(st);
    }
    document.documentElement.classList.toggle('pengu-ro', on);
    if (on && isTwitch) markTopBars();
  }
  // Twitch: mesaj listesinin üstündeki her şeyi (abone hedefi, öne çıkanlar, sabit mesaj bandı) işaretle;
  // sadece okuma modunda gizlenir
  function markTopBars() {
    const list = document.querySelector('.chat-scrollable-area__message-container, [data-test-selector="chat-scrollable-area__message-container"]');
    if (!list) return;
    let el = list;
    for (let depth = 0; depth < 6 && el.parentElement && el.parentElement !== document.body; depth++) {
      const parent = el.parentElement;
      for (let sib = el.previousElementSibling; sib; sib = sib.previousElementSibling) {
        if (sib.tagName !== 'STYLE' && sib.tagName !== 'SCRIPT') sib.classList.add('pengu-top');
      }
      if (parent.classList.contains('chat-room__content') || parent.classList.contains('chat-room')) break;
      el = parent;
    }
  }
  function applyComposer() {
    readOnlyLook(!composerShown);
    if (composerShown || !loggedIn()) return restoreComposer();
    if (hiddenBox && hiddenBox.isConnected && hiddenBox.__penguHidden) return;
    hiddenBox = null;
    const input = findInput();
    if (!input) return;
    // Mesaj kutusunu ve gönder düğmesini içeren alt şeridi bul.
    // Twitch: kutu + altındaki puan / ayar / "Sohbet" satırı birlikte (.chat-input)
    let box = input;
    const tw = isTwitch && input.closest('.chat-input');
    if (tw && tw.getBoundingClientRect().height < 320) box = tw;
    else
      for (let el = input.parentElement, i = 0; el && el !== document.body && i < 8; el = el.parentElement, i++) {
        const r = el.getBoundingClientRect();
        if (r.height > 220) break;
        box = el;
      }
    box.__penguHidden = true;
    hiddenBox = box;
    box.style.setProperty('position', 'fixed', 'important');
    box.style.setProperty('left', '-10000px', 'important');
    box.style.setProperty('top', '0', 'important');
    box.style.setProperty('width', '600px', 'important');
  }
  let composerTimer = null;
  window.__penguComposer = (show) => {
    composerShown = !!show;
    applyComposer();
    if (!composerTimer) composerTimer = setInterval(applyComposer, 2000); // sayfa yeniden çizerse tekrar uygula
    return composerShown;
  };
  window.__penguReadOnly = () => window.__penguComposer(false);

  // ---- Yayının anlık izleyici sayısı (yayın kapalıysa null) ----
  window.__penguViewers = async (channel) => {
    let n = null;
    window.__penguCat = '';
    try {
      if (isTwitch) {
        const res = await fetch('https://gql.twitch.tv/gql', {
          method: 'POST',
          headers: { 'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko' },
          body: JSON.stringify({ query: 'query($l: String!) { user(login: $l) { stream { viewersCount game { displayName } } } }', variables: { l: channel } }),
        });
        const d = (await res.json()).data;
        const st = d && d.user && d.user.stream;
        n = st ? Number(st.viewersCount) || 0 : null;
        window.__penguCat = (st && st.game && st.game.displayName) || '';
      } else {
        const res = await fetch('/api/v2/channels/' + encodeURIComponent(channel), { credentials: 'include', headers: { Accept: 'application/json' } });
        const j = res.ok ? await res.json() : null;
        n = j && j.livestream ? Number(j.livestream.viewer_count) || 0 : null;
        const cats = (j && j.livestream && j.livestream.categories) || [];
        window.__penguCat = (cats[0] && cats[0].name) || '';
      }
    } catch {
      n = undefined; // ölçülemedi
    }
    if (n == null) window.__penguCat = ''; // yayın kapalı / ölçülemedi: kategori yok
    if (window.ReactNativeWebView) post('__PENGU_VIEW__' + JSON.stringify({ n: n === undefined ? -1 : n, cat: window.__penguCat || '' }));
    return n === undefined ? -1 : n;
  };

  // Masaüstü yardımcıları: kutudaki metin / gönder düğmesine bas
  window.__penguInputText = () => {
    const input = findInput();
    return input ? inputText(input) : '';
  };
  window.__penguClickSend = () => {
    const btn = findSendButton();
    if (!btn || btn.disabled) return false;
    btn.click();
    return true;
  };

  // Masaüstü: kutuyu odaklar, metni uygulama klavye olarak yazar
  // (silmeyi uygulama gerçek düzenleme komutlarıyla yapar; sayfa içi silme Kick'in kutusunu bozuyor)
  window.__penguFocusInput = () => {
    const input = findInput();
    if (!input) return false;
    input.focus();
    return true;
  };

  // Telefon: komutu sayfanın içinden yazar ve gönderir, sonucu uygulamaya bildirir
  window.__penguSendCommand = (cmd, id) => {
    window.__penguOwnUntil = Date.now() + 6000; // uygulamanın kendi işlemi: mod log'a ikinci kez yazılmasın
    const report = (ok, err) => post('__PENGU_SENT__' + JSON.stringify({ id, ok, err: err || null }));
    const input = findInput();
    if (!input) return report(false, 'mesaj kutusu bulunamadı (giriş yapılı mı?)');
    focusAndClear(input);
    if (input.tagName === 'TEXTAREA') {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
      setter.call(input, cmd);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else {
      document.execCommand('insertText', false, cmd);
    }
    const enter = () => {
      const opts = { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true, cancelable: true };
      input.dispatchEvent(new KeyboardEvent('keydown', opts));
      input.dispatchEvent(new KeyboardEvent('keyup', opts));
    };
    // Önce gönder düğmesi (Kick'te komut ipucu kutusu Enter'ı yutuyor), olmazsa Enter
    const steps = [() => window.__penguClickSend(), enter, enter];
    let i = 0;
    const next = () => {
      if (!inputText(input)) return report(true);
      if (i >= steps.length) {
        focusAndClear(input); // yazılan komut kutuda kalıp sonrakine eklenmesin
        return report(false, 'gönderilemedi');
      }
      steps[i++]();
      setTimeout(next, 350);
    };
    setTimeout(next, 150);
  };

  // ---- 🗑 Mesaj silme ----
  // Bir ada tıklanınca o adın bulunduğu mesaj satırı hatırlanır; "Mesajı sil" o mesajı siler.
  let lastLine = null;
  const lineOf = (el) =>
    el.closest('[data-a-target="chat-line-message"], .chat-line__message, [data-chat-entry], [data-index]') ||
    (() => {
      // Bilinen bir işaret yoksa: chat listesinin bir satırı (çok büyümeden yukarı çık)
      let row = el;
      for (let i = 0; row.parentElement && i < 8; i++) {
        if ((row.parentElement.textContent || '').length > 600 || row.parentElement.children.length > 20) break;
        row = row.parentElement;
      }
      return row;
    })();
  // Sitenin kendi (React) verisinden mesaj kimliğini bul
  function fiberMsgId(el) {
    for (let node = el, d = 0; node && d < 4; node = node.firstElementChild, d++) {
      const key = Object.keys(node).find((k) => k.startsWith('__reactFiber$') || k.startsWith('__reactInternalInstance$'));
      for (let f = key && node[key], i = 0; f && i < 40; f = f.return, i++) {
        const pr = f.memoizedProps;
        if (!pr || typeof pr !== 'object') continue;
        for (const v of [pr.message, pr.msg, pr.chatEntry, pr.data, pr.item]) {
          if (v && typeof v === 'object' && typeof v.id === 'string' && v.id.length >= 8) return v.id;
        }
        if (typeof pr.messageId === 'string') return pr.messageId;
        if (typeof pr.messageID === 'string') return pr.messageID;
      }
    }
    return null;
  }
  const channelFromUrl = () => (location.pathname.match(/^\/(?:popout\/)?([^/]+)/) || [])[1] || '';
  async function apiDelete(id) {
    const channel = channelFromUrl();
    if (isTwitch) {
      const token = cookie('auth-token');
      const gql = (query, variables) =>
        fetch('https://gql.twitch.tv/gql', {
          method: 'POST',
          headers: { 'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko', Authorization: 'OAuth ' + token },
          body: JSON.stringify({ query, variables }),
        }).then((r) => r.json());
      const u = await gql('query($l: String!) { user(login: $l) { id } }', { l: channel });
      const cid = u && u.data && u.data.user && u.data.user.id;
      if (!cid) throw new Error('kanal bulunamadı');
      const r = await gql('mutation($i: DeleteChatMessageInput!) { deleteChatMessage(input: $i) { __typename } }', { i: { channelID: cid, messageID: id } });
      if (r.errors || !r.data || !r.data.deleteChatMessage) throw new Error('Twitch silmeyi kabul etmedi');
      return;
    }
    const headers = { Accept: 'application/json', Authorization: 'Bearer ' + cookie('session_token') };
    const x = cookie('XSRF-TOKEN');
    if (x) headers['X-XSRF-TOKEN'] = x;
    const ch = await fetch('/api/v2/channels/' + encodeURIComponent(channel), { credentials: 'include', headers }).then((r) => (r.ok ? r.json() : null));
    const room = ch && ch.chatroom && ch.chatroom.id;
    if (!room) throw new Error('chat odası bulunamadı');
    const res = await fetch('/api/v2/chatrooms/' + room + '/messages/' + encodeURIComponent(id), { method: 'DELETE', credentials: 'include', headers });
    if (!res.ok) throw new Error('Kick silmeyi kabul etmedi (' + res.status + ')');
  }
  // Yedek: sitenin mesajın üstüne gelince çıkan kendi "Sil" düğmesine bas
  async function clickSiteDelete(line) {
    const opts = { bubbles: true };
    for (const t of ['pointerover', 'pointerenter', 'mouseover', 'mouseenter', 'mousemove']) line.dispatchEvent(new MouseEvent(t, opts));
    await new Promise((r) => setTimeout(r, 250));
    const isDel = (b) => /(^|\b)(delete|sil|mesajı sil|remove)/i.test(b.getAttribute('aria-label') || b.getAttribute('title') || b.getAttribute('data-a-target') || b.textContent || '');
    let btn = [...line.querySelectorAll('button, [role="button"]')].find(isDel);
    if (!btn) return false;
    btn.click();
    await new Promise((r) => setTimeout(r, 300));
    // Onay penceresi çıkarsa onu da onayla
    const ok = [...document.querySelectorAll('[role="dialog"] button, [role="alertdialog"] button')].find(isDel);
    if (ok) ok.click();
    return true;
  }
  // Tıklama anında mesajın kimliği, yazanı ve metni de saklanır: site satırı yeniden çizse bile mesaj bulunur
  let lastPick = null;
  const lineText = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 300);
  function rememberLine(line, user) {
    lastLine = line;
    let id = null;
    try { id = (line.getAttribute && line.getAttribute('data-chat-entry')) || fiberMsgId(line); } catch {}
    lastPick = { id, user: String(user || '').toLowerCase(), text: lineText(line) };
  }
  // Satır sayfadan çıktıysa aynı yazan + aynı metinli satırı yeniden bul
  function refindLine() {
    if (lastLine && lastLine.isConnected) return lastLine;
    if (!lastPick) return null;
    const rows = document.querySelectorAll('[data-a-target="chat-line-message"], .chat-line__message, [data-chat-entry], [data-index]');
    for (let i = rows.length - 1; i >= 0; i--) {
      if (lineText(rows[i]) === lastPick.text) return (lastLine = rows[i]);
    }
    return null;
  }
  window.__penguHasMsg = () => !!(lastPick || (lastLine && lastLine.isConnected));
  window.__penguDeleteMsg = async (reqId) => {
    window.__penguOwnUntil = Date.now() + 6000;
    const done = (ok, err) => {
      if (reqId) post('__PENGU_DEL__' + JSON.stringify({ id: reqId, ok, err: err || null }));
      return { ok, err: err || null };
    };
    if (!lastPick) return done(false, 'önce chat\'te silinecek mesajın sahibinin adına tıkla');
    const line = refindLine();
    let err = 'mesaj kimliği bulunamadı';
    let id = lastPick.id;
    if (!id && line) {
      try { id = (line.getAttribute && line.getAttribute('data-chat-entry')) || fiberMsgId(line); } catch {}
    }
    const clear = () => { lastLine = null; lastPick = null; };
    if (id) {
      try {
        await apiDelete(id);
        clear();
        return done(true);
      } catch (e) {
        err = String((e && e.message) || e);
      }
    }
    if (line && (await clickSiteDelete(line))) {
      clear();
      return done(true);
    }
    if (!line && !id) err = 'mesaj artık chat\'te görünmüyor (adına tekrar tıkla)';
    return done(false, err);
  };

  // ---- 🛡️ Sitenin kendi mod tuşlarıyla yapılanlar da mod log'a ----
  // Twitch'in / Kick'in çöp kutusu, ban, timeout tuşları kullanılınca sayfanın sunucuya giden isteği
  // dinlenir; başarılı olursa uygulamaya bildirilir. Uygulamanın kendi tuşlarıyla yapılanlar atlanır
  // (onlar zaten kaydediliyor).
  let lastAuthor = { name: '', at: 0 };
  document.addEventListener(
    'pointerdown',
    (e) => {
      try {
        const line = e.target instanceof Element && e.target.closest('[data-a-target="chat-line-message"], .chat-line__message, [data-chat-entry], [data-index]');
        if (!line) return;
        const u = line.querySelector('[data-a-user]');
        let name = u ? u.getAttribute('data-a-user') : '';
        if (!name) {
          const b = [...line.querySelectorAll('button, span, a')].find((x) => { const t = (x.textContent || '').trim().replace(/:$/, ''); return NAME.test(t) && (/color/i.test(x.getAttribute('style') || '') || (x.getAttribute('title') || '').toLowerCase() === t.toLowerCase()); });
          name = b ? (b.textContent || '').trim().replace(/:$/, '').replace(/^@/, '') : '';
        }
        if (name) lastAuthor = { name: name.toLowerCase(), at: Date.now() };
      } catch {}
    },
    true
  );
  const recentAuthor = () => (Date.now() - lastAuthor.at < 60000 ? lastAuthor.name : '');
  function reportSiteAction(action, target, secs) {
    if (Date.now() < (window.__penguOwnUntil || 0)) return;
    target = String(target || recentAuthor() || '').replace(/^@/, '').toLowerCase().slice(0, 40);
    if (!target) return; // kime yapıldığı bilinmiyorsa kaydetme (yanlış kayıt olmasın)
    post('__PENGU_MODACT__' + JSON.stringify({ action, target, secs: secs || null }));
  }
  function durSecs(v) {
    if (v == null) return null;
    if (typeof v === 'number') return v;
    const m = String(v).match(/^(\d+(?:\.\d+)?)\s*([smhdw]?)/i);
    if (!m) return null;
    return Math.round(Number(m[1]) * ({ s: 1, m: 60, h: 3600, d: 86400, w: 604800 }[(m[2] || 's').toLowerCase()] || 1));
  }
  function inspectTwitch(bodyText) {
    let ops;
    try { ops = JSON.parse(bodyText); } catch { return; }
    for (const op of Array.isArray(ops) ? ops : [ops]) {
      const name = String((op && op.operationName) || '');
      // Sadece gerçek işlemler (mutation): "ban talepleri", "ban durumu" gibi okuma sorguları sayılmaz
      if (op && typeof op.query === 'string' && !/^\s*mutation\b/.test(op.query)) continue;
      if (/request|status|evasion|list|count|setting|log|history|suspicious|restrict/i.test(name)) continue;
      const v = (op && op.variables) || {};
      const inp = v.input || v;
      const target = inp.bannedUserLogin || inp.targetUserLogin || inp.timedOutUserLogin || inp.userLogin || inp.targetLogin || '';
      const hasTarget = typeof target === 'string' && /^[A-Za-z0-9_]{2,25}$/.test(target);
      if (/unban|untimeout/i.test(name)) { if (hasTarget) reportSiteAction(/timeout/i.test(name) ? 'untimeout' : 'unban', target); }
      else if (/timeout/i.test(name)) { if (hasTarget) reportSiteAction('timeout', target, durSecs(inp.duration || inp.expiresIn)); }
      else if (/ban/i.test(name)) {
        if (!hasTarget) continue;
        const secs = durSecs(inp.expiresIn || inp.duration);
        reportSiteAction(secs ? 'timeout' : 'ban', target, secs);
      } else if (/delete.*message|message.*delete/i.test(name) && (inp.messageID || inp.messageId || inp.msgID)) reportSiteAction('delete', '');
    }
  }
  function inspectKick(method, url, bodyText) {
    method = String(method || 'GET').toUpperCase();
    let path = '';
    try { path = new URL(url, location.href).pathname; } catch { return; }
    if (/\/bans\/?$/.test(path) && method === 'POST') {
      let b = {};
      try { b = JSON.parse(bodyText || '{}'); } catch {}
      const permanent = b.permanent === true || b.permanent === 'true' || !b.duration;
      reportSiteAction(permanent ? 'ban' : 'timeout', b.banned_username || b.username || '', permanent ? null : Number(b.duration) * 60);
    } else if (/\/bans\/([^/]+)$/.test(path) && method === 'DELETE') {
      reportSiteAction('unban', decodeURIComponent(path.match(/\/bans\/([^/]+)$/)[1]));
    } else if (/\/messages\/[^/]+$/.test(path) && method === 'DELETE') {
      reportSiteAction('delete', '');
    }
  }
  function inspect(method, url, bodyText, ok) {
    if (!ok) return;
    try {
      if (isTwitch) { if (/gql\.twitch\.tv/.test(url) && typeof bodyText === 'string') inspectTwitch(bodyText); }
      else inspectKick(method, url, bodyText);
    } catch {}
  }
  if (!window.__penguNetHook) {
    window.__penguNetHook = true;
    const origFetch = window.fetch;
    window.fetch = function (input, init) {
      const url = typeof input === 'string' ? input : (input && input.url) || '';
      const method = (init && init.method) || (input && input.method) || 'GET';
      const body = init && typeof init.body === 'string' ? init.body : null;
      const p = origFetch.apply(this, arguments);
      if (/gql\.twitch\.tv|\/bans|\/messages\//.test(url)) p.then((r) => inspect(method, url, body, r && r.ok)).catch(() => {});
      return p;
    };
    const XO = XMLHttpRequest.prototype.open, XS = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { this.__penguReq = { m, u: String(u || '') }; return XO.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function (b) {
      const r = this.__penguReq;
      if (r && /gql\.twitch\.tv|\/bans|\/messages\//.test(r.u)) {
        const body = typeof b === 'string' ? b : null;
        this.addEventListener('loadend', () => inspect(r.m, r.u, body, this.status >= 200 && this.status < 300));
      }
      return XS.apply(this, arguments);
    };
  }

  // ---------- 🔔 Etkinlikler: abone, hediye abone, bit, Kicks, takip, baskın ----------
  // Chat sayfasının kendi canlı bağlantısından (Twitch: IRC, Kick: Pusher) okunur. Sayfaya sonradan
  // eklendiğimiz için bağlantının kendisine değil, sayfa gelen mesajı okurken araya gireriz.
  function evPost(ev) { post('__PENGU_EVENT__' + JSON.stringify(ev)); }
  function ircTags(raw) {
    const t = {};
    for (const kv of raw.split(';')) {
      const i = kv.indexOf('=');
      const k = i < 0 ? kv : kv.slice(0, i);
      const v = i < 0 ? '' : kv.slice(i + 1);
      t[k] = v.replace(/\\(.)/g, (_, c) => ({ s: ' ', ':': ';', '\\': '\\', r: '\r', n: '\n' }[c] ?? c));
    }
    return t;
  }
  const mystery = {}; // toplu hediye abonelikten sonra gelen tek tek "X'e hediye" satırlarını gösterme
  function twitchLine(line) {
    if (line[0] !== '@') return;
    const sp = line.indexOf(' ');
    const tags = ircTags(line.slice(1, sp));
    const rest = line.slice(sp + 1);
    // 🗑️ Silinen mesaj / zaman aşımı / ban: yayın ekranındaki chat'te de silindi görünsün
    const cl = rest.match(/^:\S+ (CLEARCHAT|CLEARMSG) #\S+(?: :([\s\S]*))?$/);
    if (cl) {
      if (!window.__penguChatOn) return;
      if (cl[1] === 'CLEARMSG') delPost({ p: 'twitch', id: 'tw:' + (tags['target-msg-id'] || '') });
      else if (cl[2]) delPost({ p: 'twitch', user: cl[2].trim(), ban: tags['ban-duration'] ? 'to' : 'ban' });
      else delPost({ p: 'twitch', all: true });
      return;
    }
    const m = rest.match(/^:\S+ (USERNOTICE|PRIVMSG) #\S+(?: :([\s\S]*))?$/);
    if (!m) return;
    const user = tags['display-name'] || tags.login || '';
    const text = (m[2] || '').trim();
    const id = 'tw:' + (tags.id || Math.random());
    if (m[1] === 'PRIVMSG') {
      const bits = Number(tags.bits);
      if (bits > 0) evPost({ p: 'twitch', id, type: 'bits', user, amount: bits, msg: text.replace(/\b[A-Za-z]+\d+\b\s*/g, '').trim() });
      // 💬 Yayın ekranındaki chat (sadece orada açılan görünmez sayfada)
      else if (window.__penguChatOn) {
        const t = text.replace(/^\u0001ACTION (.*)\u0001$/, '$1');
        chatPost({ p: 'twitch', id, user, color: tags.color || '', text: t, b: twBadges(tags.badges), parts: twParts(t, tags.emotes) });
      }
      return;
    }
    const kind = tags['msg-id'];
    const plan = tags['msg-param-sub-plan'];
    const tier = plan === 'Prime' ? 'Prime' : plan ? String(Math.round(Number(plan) / 1000) || 1) : '';
    const login = (tags.login || '').toLowerCase();
    if (kind === 'sub' || kind === 'resub') {
      evPost({ p: 'twitch', id, type: 'sub', user, tier, months: Number(tags['msg-param-cumulative-months']) || 1, msg: text });
    } else if (kind === 'submysterygift') {
      const n = Number(tags['msg-param-mass-gift-count']) || 1;
      mystery[login] = { left: n, until: Date.now() + 30000 };
      evPost({ p: 'twitch', id, type: 'giftbomb', user, tier, count: n });
    } else if (kind === 'subgift' || kind === 'anonsubgift') {
      const mg = mystery[login];
      if (mg && mg.left > 0 && Date.now() < mg.until) { mg.left--; return; }
      evPost({ p: 'twitch', id, type: 'gift', user: user || 'Anonim', tier, to: tags['msg-param-recipient-display-name'] || tags['msg-param-recipient-user-name'] || '' });
    } else if (kind === 'giftpaidupgrade' || kind === 'primepaidupgrade' || kind === 'anongiftpaidupgrade') {
      evPost({ p: 'twitch', id, type: 'sub', user, tier: kind === 'primepaidupgrade' ? '1' : tier, months: 0, upgrade: true, msg: text });
    } else if (kind === 'raid') {
      evPost({ p: 'twitch', id, type: 'raid', user: tags['msg-param-displayName'] || user, count: Number(tags['msg-param-viewerCount']) || 0 });
    }
  }
  function chatPost(m) { post('__PENGU_MSG__' + JSON.stringify(m)); }
  function delPost(m) { post('__PENGU_DEL__' + JSON.stringify(m)); }
  // Rozetler: sadece bilinenler (yayıncı, mod, vip, abone…)
  const BADGE_KEEP = ['broadcaster', 'moderator', 'vip', 'subscriber', 'founder', 'og', 'verified', 'partner', 'sub_gifter', 'staff'];
  // 🏅 Gerçek rozet resimleri: Twitch'ten genel + kanalın kendi rozetleri (abone rozetleri dahil), bir kez çekilir
  let twBadgeMap = null, twBadgeLoading = false;
  function loadTwBadges() {
    if (twBadgeMap || twBadgeLoading) return;
    twBadgeLoading = true;
    const login = (location.pathname.match(/^\/(?:popout\/)?([A-Za-z0-9_]+)/) || [])[1] || '';
    fetch('https://gql.twitch.tv/gql', {
      method: 'POST',
      headers: { 'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko' },
      // İki ayrı sorgu: biri hata verirse diğeri yine gelsin
      body: JSON.stringify([
        { query: 'query { badges { setID version imageURL(size: DOUBLE) } }' },
        { query: 'query($l: String!) { user(login: $l) { broadcastBadges { setID version imageURL(size: DOUBLE) } } }', variables: { l: login } },
      ]),
    })
      .then((r) => r.json())
      .then((arr) => {
        const map = {};
        const g = (arr && arr[0] && arr[0].data) || {};
        const c = (arr && arr[1] && arr[1].data) || {};
        (g.badges || []).forEach((b) => b && b.imageURL && (map[b.setID + '/' + b.version] = b.imageURL));
        ((c.user && c.user.broadcastBadges) || []).forEach((b) => b && b.imageURL && (map[b.setID + '/' + b.version] = b.imageURL)); // kanalınki genelin üstüne
        twBadgeMap = map;
      })
      .catch(() => { twBadgeLoading = false; });
  }
  function twBadges(raw) {
    loadTwBadges();
    return String(raw || '').split(',').filter(Boolean).slice(0, 5).map((x) => {
      const n = x.split('/')[0];
      const u = twBadgeMap && twBadgeMap[x];
      return u ? { n, u } : BADGE_KEEP.includes(n) ? { n } : null;
    }).filter(Boolean);
  }
  // Kick: kanalın abone rozetleri (ay sayısına göre); diğer rozetlerin resmi yok, işaretle gösterilir
  let kickSubBadges = null, kickBadgeLoading = false;
  function loadKickBadges() {
    if (kickSubBadges || kickBadgeLoading) return;
    kickBadgeLoading = true;
    const slug = (location.pathname.match(/^\/(?:popout\/)?([A-Za-z0-9_-]+)/) || [])[1] || '';
    fetch('/api/v2/channels/' + encodeURIComponent(slug), { credentials: 'include', headers: { Accept: 'application/json' } })
      .then((r) => r.json())
      .then((j) => {
        kickSubBadges = ((j && j.subscriber_badges) || [])
          .map((b) => ({ m: Number(b.months) || 0, u: (b.badge_image && b.badge_image.src) || '' }))
          .filter((b) => b.u)
          .sort((a, b) => a.m - b.m);
      })
      .catch(() => { kickBadgeLoading = false; });
  }
  function kickBadges(list) {
    loadKickBadges();
    return (Array.isArray(list) ? list : []).slice(0, 5).map((x) => {
      const n = String((x && x.type) || '');
      if (n === 'subscriber' && kickSubBadges && kickSubBadges.length) {
        const months = Number(x.count) || 1;
        let pick = kickSubBadges[0];
        kickSubBadges.forEach((b) => { if (b.m <= months) pick = b; });
        return { n, u: pick.u };
      }
      return BADGE_KEEP.includes(n) ? { n } : null;
    }).filter(Boolean);
  }
  // Twitch emojileri: "25:0-4,12-16/1902:6-10" → metin parçaları + resimler (konumlar harf sırasına göre)
  function twParts(text, emotes) {
    if (!emotes) return null;
    const chars = Array.from(text);
    const at = [];
    String(emotes).split('/').forEach((e) => {
      const [eid, pos] = e.split(':');
      (pos || '').split(',').forEach((r) => { const [a, b] = r.split('-').map(Number); if (b >= a) at.push([a, b, eid]); });
    });
    if (!at.length) return null;
    at.sort((x, y) => x[0] - y[0]);
    const out = [];
    let i = 0;
    at.forEach(([a, b, eid]) => {
      if (a < i) return;
      if (a > i) out.push({ t: chars.slice(i, a).join('') });
      out.push({ e: 'https://static-cdn.jtvnw.net/emoticons/v2/' + eid + '/default/dark/1.0', n: chars.slice(a, b + 1).join('') });
      i = b + 1;
    });
    if (i < chars.length) out.push({ t: chars.slice(i).join('') });
    return out.slice(0, 60);
  }
  // Kick emojileri: [emote:123:isim] → resim
  function kickParts(content) {
    const re = /\[emote:(\d+):([^\]]*)\]/g;
    if (!re.test(content)) return null;
    re.lastIndex = 0;
    const out = [];
    let i = 0, m;
    while ((m = re.exec(content))) {
      if (m.index > i) out.push({ t: content.slice(i, m.index) });
      out.push({ e: 'https://files.kick.com/emotes/' + m[1] + '/fullsize', n: m[2] });
      i = m.index + m[0].length;
    }
    if (i < content.length) out.push({ t: content.slice(i) });
    return out.slice(0, 60);
  }
  function kickFrame(raw) {
    let f; try { f = JSON.parse(raw); } catch { return; }
    const name = String((f && f.event) || '');
    if (!name || name.startsWith('pusher')) return;
    let d = f.data;
    if (typeof d === 'string') { try { d = JSON.parse(d); } catch { return; } }
    if (!d || typeof d !== 'object') return;
    if (/ChatMessageEvent/i.test(name)) {
      if (window.__penguChatOn && d.sender) {
        window.__penguKickGot = Date.now();
        const raw = String(d.content || '');
        const text = raw.replace(/\[emote:\d+:([^\]]+)\]/g, ':$1:');
        const idt = d.sender.identity || {};
        const b = kickBadges(idt.badges);
        chatPost({ p: 'kick', id: 'km:' + (d.id || Math.random()), user: d.sender.username || '', color: idt.color || '', text, b, parts: kickParts(raw) });
      }
      return;
    }
 // 🗑️ Kick: silinen mesaj / ban / chat temizleme
    if (/MessageDeletedEvent/i.test(name)) {
      const mid = (d.message && d.message.id) || d.id;
      if (window.__penguChatOn && mid) delPost({ p: 'kick', id: 'km:' + mid });
      return;
    }
    if (/UserBannedEvent/i.test(name)) {
      const u = (d.user && d.user.username) || d.username;
      if (window.__penguChatOn && u) delPost({ p: 'kick', user: u, ban: d.permanent === false || d.expires_at ? 'to' : 'ban' });
      return;
    }
    if (/ChatroomClearEvent/i.test(name)) {
      if (window.__penguChatOn) delPost({ p: 'kick', all: true });
      return;
    }
    const id = 'kk:' + name + ':' + (d.id || d.gift_transaction_id || d.created_at || '') + ':' + (d.username || d.gifter_username || (d.sender && d.sender.username) || '');
    if (/GiftedSubscriptions/i.test(name)) {
      const to = Array.isArray(d.gifted_usernames) ? d.gifted_usernames : [];
      evPost({ p: 'kick', id, type: to.length > 1 ? 'giftbomb' : 'gift', user: d.gifter_username || 'Anonim', count: to.length || 1, to: to.length === 1 ? to[0] : '' });
    } else if (/Subscription/i.test(name) && !/LuckyUsers/i.test(name)) {
      if (d.username) evPost({ p: 'kick', id, type: 'sub', user: d.username, months: Number(d.months) || 1 });
    } else if (/Kicks|Gift/i.test(name) && d.gift && (d.sender || d.user)) {
      const u = d.sender || d.user;
      evPost({ p: 'kick', id, type: 'kicks', user: u.username || '', amount: Number(d.gift.amount) || 0, gift: d.gift.name || '', msg: d.message || '' });
    } else if (/Follow/i.test(name) && d.username && d.followed !== false) {
      evPost({ p: 'kick', id: 'follow:' + String(d.username).toLowerCase(), type: 'follow', user: d.username });
    } else if (/Host|Raid/i.test(name) && (d.host_username || d.username)) {
      evPost({ p: 'kick', id, type: 'raid', user: d.host_username || d.username, count: Number(d.number_viewers) || 0 });
    }
  }
  // 💬 Kick: chat'i sayfaya bağlı kalmadan doğrudan Kick'in chat sunucusundan (Pusher) dinle.
  // Kick'in yeni sayfası bağlantıyı bizim göremediğimiz yerde açabiliyor; bu yol her durumda çalışır.
  // Sadece yayın ekranındaki chat açıkken (__penguChatOn) bağlanır, kapanınca bağlantı kapanır.
  if (!isTwitch && !window.__penguKickWsTimer) {
    let ws = null, room = 0, loading = false, retry = 0, keyIdx = 0, ok = false;
    const KEYS = ['32cbd69e4b950bf97679', 'eb1d5f283081a78b932c']; // tahmini anahtarlar (sayfadan bulunamazsa)
    const CLUSTERS = ['us2', 'mt1', 'us3', 'eu'];
    // Kick'in kendi sayfasının kullandığı chat sunucusu adresi: önce sayfanın açtığı bağlantılardan,
    // sonra sayfadaki Pusher / Echo nesnesinden; bulunamazsa tahmini anahtarlar denenir
    const pageUrl = () => {
      const u = (window.__penguWsUrls || []).find((x) => /pusher|\/app\/[a-z0-9]{10,}/i.test(x));
      if (u) return { url: u, src: 'sayfa' };
      try {
        const cands = [window.Echo && window.Echo.connector && window.Echo.connector.pusher, window.Pusher && window.Pusher.instances && window.Pusher.instances[0]];
        for (const pz of cands) {
          if (pz && pz.key) {
            const cfg = pz.config || {};
            const host = cfg.wsHost || 'ws-' + (cfg.cluster || 'us2') + '.pusher.com';
            return { url: 'wss://' + host + '/app/' + pz.key + '?protocol=7&client=js&version=8.4.0&flash=false', src: 'pusher' };
          }
        }
      } catch {}
      return null;
    };
    // Durum yazısı: yayın ekranındaki chat'te Kick'in bağlantı durumu görünsün (sorun olursa sebebi anlaşılsın)
    let lastSt = '';
    let domOn = false, failUntil = 0;
    const st = (t, force) => { if ((force || !domOn) && t !== lastSt) { lastSt = t; post('__PENGU_KST__' + t); } };
    const slug = () => ((location.pathname.match(/^\/(?:popout\/)?([A-Za-z0-9_-]+)/) || [])[1] || '').toLowerCase();
    const open = () => {
      if (!room) return;
      ok = false;
      const found = pageUrl();
      const n = KEYS.length * CLUSTERS.length;
      const k = keyIdx % n;
      const url = found ? found.url : 'wss://ws-' + CLUSTERS[Math.floor(k / KEYS.length)] + '.pusher.com/app/' + KEYS[k % KEYS.length] + '?protocol=7&client=js&version=8.4.0&flash=false';
      const hosts = [...new Set((window.__penguWsUrls || []).map((x) => { try { return new URL(x).host; } catch { return ''; } }).filter(Boolean))].slice(0, 3).join(', ');
      st('Kick sunucusuna bağlanıyor… (oda ' + room + ', ' + (found ? 'adres ' + found.src + 'dan' : 'deneme ' + (k + 1) + '/' + n + (hosts ? ' · sayfa: ' + hosts : ' · sayfa bağlantısı görülmedi')) + ')');
      ws = new WebSocket(url);
      ws.onopen = () => {
        ['chatrooms.' + room + '.v2', 'chatroom_' + room].forEach((ch) => ws.send(JSON.stringify({ event: 'pusher:subscribe', data: { auth: '', channel: ch } })));
      };
      ws.onmessage = (e) => {
        const v = e.data;
        if (typeof v !== 'string') return;
        if (v.includes('pusher:connection_established')) { ok = true; retry = 0; st('Kick bağlandı, mesaj bekleniyor'); }
        if (v.includes('subscription_succeeded')) st('Kick chat bağlı ✓');
        if (v.includes('pusher:error')) st('Kick hata: ' + v.slice(0, 120));
        if (v.includes('pusher:ping')) { try { ws.send('{"event":"pusher:pong","data":{}}'); } catch {} return; }
        if (window.__penguChatOn && /ChatMessageEvent|MessageDeletedEvent|UserBannedEvent|ChatroomClearEvent/.test(v)) kickFrame(v);
      };
      ws.onclose = (e) => { ws = null; if (!ok) keyIdx++; st('Kick bağlantısı kapandı (' + (e && e.code) + '), tekrar deneniyor'); }; // bağlanamadıysa diğer anahtarı dene
    };
    // Yedek yol: sunucudan 15 sn'de hiç mesaj gelmezse mesajları Kick'in kendi chat sayfasından oku
    let onSince = 0, domObs = null, domSince = 0;
    const domMsg = (el) => {
      if (!(el instanceof HTMLElement) || el.__penguSeen) return;
      const box = el.closest('[data-index]') || (el.matches('[data-index]') ? el : null);
      if (!box || box.__penguSeen) return;
      box.__penguSeen = true;
      const walker = document.createTreeWalker(box, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
      const nodes = [];
      for (let n = walker.nextNode(); n && nodes.length < 300; n = walker.nextNode()) nodes.push(n);
      // Kullanıcı adı: arkasından ":" gelen ilk kısa yazı
      let ui = -1;
      for (let i = 0; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.nodeType !== 3) continue;
        const t = n.textContent.trim();
        if (!/^[A-Za-z0-9_.-]{2,30}$/.test(t)) continue;
        for (let j = i + 1; j < nodes.length; j++) {
          if (nodes[j].nodeType !== 3) continue;
          const nt = nodes[j].textContent;
          if (!nt.trim()) continue;
          if (nt.trim().startsWith(':')) ui = i;
          break;
        }
        if (ui >= 0) break;
      }
      if (ui < 0) return;
      const user = nodes[ui].textContent.trim();
      const uEl = nodes[ui].parentElement;
      const color = uEl ? getComputedStyle(uEl).color : '';
      const hex = (color.match(/\d+/g) || []).slice(0, 3).map((x) => Number(x).toString(16).padStart(2, '0')).join('');
      const b = [];
      const seenB = new Set();
      // Rozet türünü üzerindeki yazıdan anla (Kick çoğu rozeti çizim olarak gösteriyor, resim değil)
      const kind = (t) => {
        t = String(t || '').toLowerCase();
        return /broadcaster|yayıncı|host/.test(t) ? 'broadcaster' : /moderat/.test(t) ? 'moderator' : /vip/.test(t) ? 'vip' : /\bog\b/.test(t) ? 'og' : /founder|kurucu/.test(t) ? 'founder' : /verified|onaylı/.test(t) ? 'verified' : /gift|hediye/.test(t) ? 'sub_gifter' : /sub|abone/.test(t) ? 'subscriber' : '';
      };
      for (let i = 0; i < ui && b.length < 4; i++) {
        const n = nodes[i];
        if (n.nodeType !== 1) continue;
        if (n.tagName === 'IMG' && /^https:\/\/files\.kick\.com\//.test(n.src)) {
          const k = kind(n.alt || n.title) || 'subscriber';
          if (!seenB.has(k)) { seenB.add(k); b.push({ n: k, u: n.src }); }
          continue;
        }
        const label = n.getAttribute('title') || n.getAttribute('aria-label') || n.getAttribute('alt') || (n.tagName === 'title' ? n.textContent : '');
        const k = kind(label);
        if (k && !seenB.has(k)) { seenB.add(k); b.push({ n: k }); }
      }
      const parts = [];
      let colonSkipped = false;
      for (let i = ui + 1; i < nodes.length; i++) {
        const n = nodes[i];
        if (n.nodeType === 3) {
          let t = n.textContent;
          if (!colonSkipped) { if (!t.trim()) continue; t = t.replace(/^\s*:\s?/, ''); colonSkipped = true; }
          if (t) parts.push({ t });
        } else if (n.tagName === 'IMG' && /^https:\/\/files\.kick\.com\/emotes\//.test(n.src)) {
          parts.push({ e: n.src, n: n.alt || '' });
        }
      }
      const text = parts.map((x) => x.t || (x.n ? ':' + x.n + ':' : '')).join('').trim();
      if (!text) return;
      chatPost({ p: 'kick', id: 'kd:' + (box.getAttribute('data-index') || '') + ':' + user + ':' + text.slice(0, 40), user, color: hex.length === 6 ? '#' + hex : '', text, b, parts: parts.some((x) => x.e) ? parts : null });
    };
    const startDom = () => {
      if (domObs) return;
      st('Kick sunucusundan mesaj gelmedi, Kick sayfasından okunuyor…');
      domOn = true;
      document.querySelectorAll('[data-index]').forEach((el) => (el.__penguSeen = true)); // eskileri atla
      domObs = new MutationObserver((ms) => {
        if (!window.__penguChatOn) return;
        ms.forEach((m) => m.addedNodes.forEach((n) => {
          if (n.nodeType !== 1) return;
          domMsg(n);
          n.querySelectorAll && n.querySelectorAll('[data-index]').forEach(domMsg);
        }));
      });
      domObs.observe(document.body, { childList: true, subtree: true });
      domSince = Date.now();
    };
    window.__penguKickWsTimer = setInterval(() => {
      const on = !!window.__penguChatOn;
      if (!on) { onSince = 0; if (ws) { try { ws.close(); } catch {} ws = null; } if (domObs) { domObs.disconnect(); domObs = null; } return; }
      if (!onSince) onSince = Date.now();
      // Sunucu bağlantısı sonradan çalışırsa sayfadan okumayı bırak (mesajlar çift görünmesin)
      if (domObs && (window.__penguKickGot || 0) > domSince) { domObs.disconnect(); domObs = null; domOn = false; st('Kick chat bağlı ✓', true); }
      if (!domObs && !window.__penguKickGot && Date.now() - onSince > 15000) startDom();
      if (ws) return;
      if (room) { if (++retry % 3 === 1) open(); return; } // koparsa birkaç saniyede bir yeniden bağlan
      if (loading || Date.now() < failUntil) return;
      if (!slug()) { st('Kick: kanal adı bulunamadı (' + location.pathname + ')'); return; }
      loading = true;
      st('Kick kanalı aranıyor: ' + slug());
      fetch('/api/v2/channels/' + encodeURIComponent(slug()), { credentials: 'include', headers: { Accept: 'application/json' } })
        .then((r) => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); })
        .then((j) => { room = (j && j.chatroom && j.chatroom.id) || 0; loading = false; if (room) open(); else st('Kick: chat odası bulunamadı'); })
        .catch((e) => { loading = false; failUntil = Date.now() + 30000; st('Kick kanal bilgisi alınamadı: ' + ((e && e.message) || e)); });
    }, 2000);
  }
  if (!window.__penguEvHook) {
    window.__penguEvHook = true;
    try {
      const desc = Object.getOwnPropertyDescriptor(MessageEvent.prototype, 'data');
      const seen = new WeakSet();
      Object.defineProperty(MessageEvent.prototype, 'data', {
        configurable: true,
        enumerable: desc.enumerable,
        get() {
          const v = desc.get.call(this);
          try {
            const ws = this.target;
            if (typeof v === 'string' && ws instanceof WebSocket && !seen.has(this)) {
              seen.add(this);
              const chat = !!window.__penguChatOn;
              if (isTwitch) { if (/irc-ws\.chat\.twitch\.tv/.test(ws.url) && (v.includes('USERNOTICE') || v.includes('bits=') || (chat && (v.includes('PRIVMSG') || v.includes('CLEARCHAT') || v.includes('CLEARMSG'))))) v.split('\r\n').forEach(twitchLine); }
              else if (/pusher/i.test(ws.url) && (chat || !v.includes('ChatMessageEvent'))) kickFrame(v);
            }
          } catch {}
          return v;
        },
      });
    } catch {}
  }
  // Test için: window.__penguEvTest('twitch' | 'kick', ham mesaj)
  window.__penguEvTest = (kind, raw) => (kind === 'twitch' ? String(raw).split('\r\n').forEach(twitchLine) : kickFrame(raw));

  document.addEventListener(
    'click',
    (e) => {
      const n = nameFrom(e.target);
      if (!n) return;
      try { rememberLine(lineOf(e.target), typeof n === 'object' ? n.name : n); } catch { lastLine = null; lastPick = null; }
      if (typeof n === 'object') send(n.name, true);
      else send(n.match(NAME) ? n.match(NAME)[1] : n, false);
    },
    true
  );
})();
