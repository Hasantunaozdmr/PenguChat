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
    try {
      if (isTwitch) {
        const res = await fetch('https://gql.twitch.tv/gql', {
          method: 'POST',
          headers: { 'Client-Id': 'kimne78kx3ncx6brgo4mv6wki5h1ko' },
          body: JSON.stringify({ query: 'query($l: String!) { user(login: $l) { stream { viewersCount } } }', variables: { l: channel } }),
        });
        const d = (await res.json()).data;
        const st = d && d.user && d.user.stream;
        n = st ? Number(st.viewersCount) || 0 : null;
      } else {
        const res = await fetch('/api/v2/channels/' + encodeURIComponent(channel), { credentials: 'include', headers: { Accept: 'application/json' } });
        const j = res.ok ? await res.json() : null;
        n = j && j.livestream ? Number(j.livestream.viewer_count) || 0 : null;
      }
    } catch {
      n = undefined; // ölçülemedi
    }
    if (window.ReactNativeWebView) post('__PENGU_VIEW__' + JSON.stringify({ n: n === undefined ? -1 : n }));
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

  document.addEventListener(
    'click',
    (e) => {
      const n = nameFrom(e.target);
      if (!n) return;
      if (typeof n === 'object') send(n.name, true);
      else send(n.match(NAME) ? n.match(NAME)[1] : n, false);
    },
    true
  );
})();
