/* Dual Chat — renderer */
(() => {
  const STORE_KEY = 'dualchat:settings';
  const defaults = {
    twitch: '',
    kick: '',
    layout: 'horizontal', // horizontal = yan yana, vertical = alt alta
    swapped: false,
    show: { twitch: true, kick: true },
    zoom: { twitch: 1, kick: 1 },
    pinned: false,
    opacity: 100,
  };

  function load() {
    try {
      const s = JSON.parse(localStorage.getItem(STORE_KEY) || '{}');
      return {
        ...defaults,
        ...s,
        show: { ...defaults.show, ...(s.show || {}) },
        zoom: { ...defaults.zoom, ...(s.zoom || {}) },
      };
    } catch {
      return { ...defaults };
    }
  }
  const state = load();
  const save = () => {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch {}
  };

  const PLATFORMS = {
    twitch: {
      chatUrl: (c) => `https://www.twitch.tv/popout/${encodeURIComponent(c)}/chat?popout=`,
      loginUrl: () => 'https://www.twitch.tv/login',
      pageUrl: (c) => `https://www.twitch.tv/${encodeURIComponent(c)}`,
    },
    kick: {
      chatUrl: (c) => `https://kick.com/popout/${encodeURIComponent(c)}/chat`,
      loginUrl: () => 'https://kick.com/',
      pageUrl: (c) => `https://kick.com/${encodeURIComponent(c)}`,
    },
  };

  const $ = (s, r = document) => r.querySelector(s);
  const panesEl = $('#panes');
  const splitter = $('#splitter');

  // Kullanıcı "twitch.tv/kanal" veya "kick.com/kanal" yapıştırsa bile kanal adını çıkar
  function cleanChannel(v) {
    v = (v || '').trim();
    const m = v.match(/(?:twitch\.tv|kick\.com)\/(?:popout\/)?([^/?#\s]+)/i);
    if (m) v = m[1];
    return v.replace(/^@/, '').replace(/[^a-zA-Z0-9_-]/g, '').toLowerCase();
  }

  // ---------- Paneller ----------
  const panes = {};
  for (const p of Object.keys(PLATFORMS)) {
    const el = $(`#pane-${p}`);
    panes[p] = {
      el,
      body: $('.pane-body', el),
      placeholder: $('.placeholder', el),
      chan: $('.chan', el),
      status: $('.status', el),
      view: null,
    };
    el.querySelectorAll('[data-act]').forEach((b) =>
      b.addEventListener('click', () => paneAction(p, b.dataset.act))
    );
  }

  function ensureView(p) {
    const pane = panes[p];
    if (pane.view) return pane.view;
    const wv = document.createElement('webview');
    wv.setAttribute('partition', 'persist:dualchat');
    wv.setAttribute('allowpopups', '');
    wv.setAttribute('webpreferences', 'contextIsolation=yes');
    wv.addEventListener('did-start-loading', () => (pane.status.textContent = 'yükleniyor…'));
    wv.addEventListener('did-stop-loading', () => (pane.status.textContent = ''));
    wv.addEventListener('did-fail-load', (e) => {
      if (e.errorCode !== -3) pane.status.textContent = 'bağlantı hatası';
    });
    wv.addEventListener('dom-ready', () => {
      try { wv.setZoomFactor(state.zoom[p]); } catch {}
    });
    pane.body.appendChild(wv);
    pane.view = wv;
    return wv;
  }

  function openChat(p) {
    const pane = panes[p];
    const channel = state[p];
    pane.chan.textContent = channel ? '· ' + channel : '';
    if (!channel) {
      if (pane.view) { pane.view.remove(); pane.view = null; }
      pane.placeholder.classList.remove('hidden');
      return;
    }
    pane.placeholder.classList.add('hidden');
    const url = PLATFORMS[p].chatUrl(channel);
    const wv = ensureView(p);
    if (wv.getAttribute('src') !== url) wv.setAttribute('src', url);
    else wv.reload();
  }

  function paneAction(p, act) {
    const pane = panes[p];
    const channel = state[p];
    switch (act) {
      case 'chat':
        openChat(p);
        break;
      case 'login': {
        const wv = ensureView(p);
        pane.placeholder.classList.add('hidden');
        wv.setAttribute('src', PLATFORMS[p].loginUrl());
        pane.status.textContent = 'giriş yap, sonra ⟳ ile chat\'e dön';
        break;
      }
      case 'zoom-in':
      case 'zoom-out': {
        const z = state.zoom[p] + (act === 'zoom-in' ? 0.1 : -0.1);
        state.zoom[p] = Math.round(Math.min(2, Math.max(0.5, z)) * 10) / 10;
        save();
        if (pane.view) try { pane.view.setZoomFactor(state.zoom[p]); } catch {}
        pane.status.textContent = `%${Math.round(state.zoom[p] * 100)}`;
        setTimeout(() => { if (pane.status.textContent.startsWith('%')) pane.status.textContent = ''; }, 1200);
        break;
      }
      case 'external':
        if (channel) window.dualChat.openExternal(PLATFORMS[p].pageUrl(channel));
        break;
    }
  }

  // ---------- Link çubuğu ----------
  // Linkten platformu ve kanalı bulur. Düz kanal adı yazılırsa iki platforma birden uygulanır.
  function parseTargets(text) {
    const found = {};
    const re = /(?:https?:\/\/)?(?:www\.|m\.)?(twitch\.tv|kick\.com)\/(?:popout\/)?([A-Za-z0-9_-]+)/gi;
    let m;
    while ((m = re.exec(text))) {
      const p = m[1].toLowerCase().startsWith('twitch') ? 'twitch' : 'kick';
      found[p] = m[2].toLowerCase();
    }
    if (!Object.keys(found).length) {
      const name = cleanChannel(text);
      if (name) { found.twitch = name; found.kick = name; }
    }
    return found;
  }

  const linkInput = $('#linkInput');
  const linkHint = $('#linkHint');
  let hintTimer;
  function hint(msg, cls) {
    linkHint.textContent = msg;
    linkHint.className = 'hint ' + (cls || '');
    clearTimeout(hintTimer);
    hintTimer = setTimeout(() => (linkHint.textContent = ''), 3000);
  }

  function applyLink() {
    const targets = parseTargets(linkInput.value);
    const keys = Object.keys(targets);
    if (!keys.length) { hint('Link anlaşılamadı', 'err'); return; }
    for (const p of keys) {
      state[p] = targets[p];
      if (!state.show[p]) state.show[p] = true;
      openChat(p);
    }
    save(); applyLayout();
    hint(keys.map((p) => `${p === 'twitch' ? 'Twitch' : 'Kick'}: ${targets[p]}`).join(' · ') + ' açıldı', 'ok');
    linkInput.value = '';
  }

  $('#linkForm').addEventListener('submit', (e) => { e.preventDefault(); applyLink(); });
  // Link yapıştırılınca Enter'a basmadan otomatik aç
  linkInput.addEventListener('paste', () => setTimeout(() => {
    if (/(twitch\.tv|kick\.com)\//i.test(linkInput.value)) applyLink();
  }, 0));

  // ---------- Yerleşim ----------
  function applyLayout() {
    panesEl.classList.toggle('horizontal', state.layout === 'horizontal');
    panesEl.classList.toggle('vertical', state.layout === 'vertical');
    panesEl.classList.toggle('swapped', state.swapped);
    $('#layoutBtn').textContent = state.layout === 'horizontal' ? '⇆' : '⇅';
    $('#layoutBtn').title = state.layout === 'horizontal' ? 'Şu an: yan yana (alt alta yap)' : 'Şu an: alt alta (yan yana yap)';

    const both = state.show.twitch && state.show.kick;
    panes.twitch.el.classList.toggle('hidden', !state.show.twitch);
    panes.kick.el.classList.toggle('hidden', !state.show.kick);
    splitter.classList.toggle('hidden', !both);
    $('#toggleTwitch').classList.toggle('active', state.show.twitch);
    $('#toggleKick').classList.toggle('active', state.show.kick);
  }

  $('#layoutBtn').addEventListener('click', () => {
    state.layout = state.layout === 'horizontal' ? 'vertical' : 'horizontal';
    save(); applyLayout();
  });
  $('#swapBtn').addEventListener('click', () => {
    state.swapped = !state.swapped;
    save(); applyLayout();
  });
  for (const p of ['twitch', 'kick']) {
    const btn = $(p === 'twitch' ? '#toggleTwitch' : '#toggleKick');
    btn.addEventListener('click', () => {
      const other = p === 'twitch' ? 'kick' : 'twitch';
      // En az bir panel açık kalsın
      if (state.show[p] && !state.show[other]) state.show[other] = true;
      state.show[p] = !state.show[p];
      save(); applyLayout();
    });
  }

  // ---------- Pencere ayarları ----------
  const pinBtn = $('#pinBtn');
  async function setPinned(v) {
    state.pinned = await window.dualChat.setAlwaysOnTop(v);
    pinBtn.classList.toggle('active', state.pinned);
    save();
  }
  pinBtn.addEventListener('click', () => setPinned(!state.pinned));

  const opacity = $('#opacity');
  opacity.value = state.opacity;
  opacity.addEventListener('input', () => {
    state.opacity = Number(opacity.value);
    window.dualChat.setOpacity(state.opacity / 100);
    save();
  });

  // ---------- Menü ----------
  const menu = $('#menu');
  $('#menuBtn').addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); });
  document.addEventListener('click', () => menu.classList.add('hidden'));
  menu.addEventListener('click', async (e) => {
    const action = e.target.closest('button')?.dataset.action;
    if (action === 'reload-all') { openChat('twitch'); openChat('kick'); }
    if (action === 'logout' && confirm('Twitch ve Kick hesaplarından çıkış yapılsın mı?')) {
      await window.dualChat.logoutAll();
      openChat('twitch'); openChat('kick');
    }
  });

  window.addEventListener('keydown', (e) => {
    if (e.key === 'F5' || (e.ctrlKey && e.key.toLowerCase() === 'r')) {
      e.preventDefault();
      openChat('twitch'); openChat('kick');
    }
  });

  // ---------- Başlangıç ----------
  applyLayout();
  if (state.pinned) setPinned(true);
  if (state.opacity < 100) window.dualChat.setOpacity(state.opacity / 100);
  openChat('twitch');
  openChat('kick');
  if (!state.twitch && !state.kick) linkInput.focus();
})();
