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

  // ---- Telefon: sadece okuma modu ----
  // Mesaj yazma kutusunu ekrandan gizler (ekran dışına taşır). Kutu sayfada kaldığı için
  // hızlı timeout / ban komutları çalışmaya devam eder. Giriş yapılmamışsa dokunmaz,
  // böylece chat'teki "Giriş yap" düğmesi görünür kalır.
  const loggedIn = () => !!(isTwitch ? cookie('auth-token') : cookie('session_token'));
  function hideComposer() {
    if (!loggedIn()) return;
    const input = findInput();
    if (!input) return;
    // Mesaj kutusunu ve gönder düğmesini içeren alt şeridi bul
    let box = input;
    for (let el = input.parentElement, i = 0; el && el !== document.body && i < 8; el = el.parentElement, i++) {
      const r = el.getBoundingClientRect();
      if (r.height > 220) break;
      box = el;
    }
    if (box.__penguHidden) return;
    box.__penguHidden = true;
    box.style.setProperty('position', 'fixed', 'important');
    box.style.setProperty('left', '-10000px', 'important');
    box.style.setProperty('top', '0', 'important');
    box.style.setProperty('width', '600px', 'important');
  }
  window.__penguReadOnly = () => {
    if (window.__penguReadOnlyOn) return;
    window.__penguReadOnlyOn = true;
    hideComposer();
    setInterval(hideComposer, 2000); // sayfa yeniden çizerse tekrar gizle
  };

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

  // Telefon: Kick yayın adresi (gecikme ölçümü için) — kick.com API'si sadece sayfanın içinden çağrılabiliyor
  window.__penguKickPlayback = async (slug) => {
    let url = null;
    try {
      const r = await fetch('/api/v2/channels/' + encodeURIComponent(slug), { credentials: 'include', headers: { Accept: 'application/json' } });
      const j = r.ok ? await r.json() : null;
      url = (j && j.livestream && j.playback_url) || null;
    } catch {}
    if (window.ReactNativeWebView) post('__PENGU_KPB__' + JSON.stringify({ url }));
    return url;
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
