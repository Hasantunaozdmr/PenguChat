// Chat sayfalarına enjekte edilir: bir kullanıcı adına tıklanınca adı uygulamaya bildirir
// (hızlı timeout / ban çubuğu için). Sayfanın kendi davranışını engellemez.
(() => {
  if (window.__penguPick) return;
  window.__penguPick = true;
  const NAME = /^@?([A-Za-z0-9_]{2,25})$/;
  const isTwitch = /(^|\.)twitch\.tv$/.test(location.hostname);

  function send(name, fromRestream) {
    if (!name) return;
    const msg = '__PENGU_PICK__' + JSON.stringify({ name: name.replace(/^@/, '').toLowerCase(), restream: !!fromRestream });
    if (window.ReactNativeWebView) window.ReactNativeWebView.postMessage(msg);
    else console.log(msg);
  }

  // Restream ile Kick'e aktarılan mesajlarda gerçek yazan: "[Twitch: kullanici] mesaj"
  function restreamAuthor(el) {
    let row = el;
    for (let i = 0; i < 6 && row; i++, row = row.parentElement) {
      const m = (row.textContent || '').match(/\[Twitch:\s*([A-Za-z0-9_]{2,25})\]/);
      if (m) return m[1];
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

  // Chat yazı kutusunu bulup odaklar ve içini temizler (komut yazılmadan önce)
  window.__penguFocusInput = () => {
    const candidates = [
      ...document.querySelectorAll('[data-a-target="chat-input"], #message-input, [data-input="true"], textarea, [contenteditable="true"]'),
    ].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 40 && r.height > 10 && getComputedStyle(el).visibility !== 'hidden';
    });
    // Ekranın en altındaki kutu genelde mesaj kutusudur
    const input = candidates.sort((a, b) => b.getBoundingClientRect().bottom - a.getBoundingClientRect().bottom)[0];
    if (!input) return false;
    input.focus();
    if ('value' in input && input.tagName === 'TEXTAREA') {
      input.select();
    } else {
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      sel.removeAllRanges();
      sel.addRange(range);
    }
    document.execCommand('delete');
    return true;
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
