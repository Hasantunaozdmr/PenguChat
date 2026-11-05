/* PenguChat — renderer */
(() => {
  const STORE_KEY = 'dualchat:settings';
  const defaults = {
    twitch: '',
    kick: '',
    layout: 'horizontal', // horizontal = yan yana, vertical = alt alta
    swapped: false,
    show: { twitch: true, kick: true },
    timeoutSecs: 919824,
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
      chatUrl: (c) => `https://www.twitch.tv/popout/${encodeURIComponent(c)}/chat?popout=&darkpopout`, // darkpopout = koyu tema
    },
    kick: {
      chatUrl: (c) => `https://kick.com/popout/${encodeURIComponent(c)}/chat`,
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
    wv.addEventListener('console-message', (e) => {
      if (typeof e.message === 'string' && e.message.startsWith('__PENGU_PICK__')) {
        try { onPick(p, JSON.parse(e.message.slice(14))); } catch {}
      }
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
    switch (act) {
      case 'chat':
        openChat(p);
        break;
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
    if (action === 'check-update') { manualCheck = true; window.dualChat.checkUpdates(); }
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

  // ---------- Güncelleme ----------
  const updateBtn = $('#updateBtn');
  let manualCheck = false;
  function renderUpdate(u) {
    if (u.current) $('#versionLabel').textContent = 'v' + u.current;
    updateBtn.classList.remove('busy');
    updateBtn.disabled = false;
    if (u.state === 'downloading') {
      updateBtn.textContent = `Güncelleme iniyor… %${u.percent || 0}`;
      updateBtn.classList.add('busy');
      updateBtn.disabled = true;
      updateBtn.classList.remove('hidden');
    } else if (u.state === 'ready') {
      updateBtn.textContent = `⬆ Güncelle (v${u.version})`;
      updateBtn.title = 'Uygulama kapanıp yeni sürümle yeniden açılır';
      updateBtn.classList.remove('hidden');
    } else if (u.state === 'portable-available') {
      updateBtn.textContent = `⬇ Yeni sürüm var (v${u.version})`;
      updateBtn.title = 'Yeni sürümü indir, eskisinin yerine kullan';
      updateBtn.classList.remove('hidden');
    } else {
      updateBtn.classList.add('hidden');
      if (manualCheck && u.state === 'latest') { manualCheck = false; alert(`PenguChat güncel (v${u.current}).`); }
      if (manualCheck && u.state === 'error') { manualCheck = false; alert('Güncelleme kontrol edilemedi. İnternet bağlantını kontrol et.'); }
    }
  }
  window.dualChat.onUpdate(renderUpdate);
  window.dualChat.getUpdateStatus().then(renderUpdate);
  updateBtn.addEventListener('click', () => window.dualChat.installUpdate());

  // ---------- Hızlı ceza çubuğu ----------
  const modUser = $('#modUser');
  const toSecs = $('#toSecs');
  const modHint = $('#modHint');
  const targets = { twitch: false, kick: false };
  toSecs.value = state.timeoutSecs;

  function renderTargets() {
    $('#tgtTwitch').classList.toggle('active', targets.twitch);
    $('#tgtKick').classList.toggle('active', targets.kick);
    const ok = !!cleanChannel(modUser.value) && (targets.twitch || targets.kick);
    $('#toBtn').disabled = !ok;
    $('#banBtn').disabled = !ok;
  }
  let modHintTimer;
  function modMsg(text, cls) {
    modHint.textContent = text;
    modHint.className = 'hint ' + (cls || '');
    clearTimeout(modHintTimer);
    modHintTimer = setTimeout(() => (modHint.textContent = ''), 5000);
  }

  // Chat'te bir ada tıklanınca
  function onPick(fromPlatform, { name, restream }) {
    modUser.value = name;
    // Restream ile Kick'e gelen mesajın sahibi aslında Twitch'te
    const p = restream ? 'twitch' : fromPlatform;
    targets.twitch = p === 'twitch';
    targets.kick = p === 'kick';
    renderTargets();
  }

  $('#tgtTwitch').addEventListener('click', () => { targets.twitch = !targets.twitch; renderTargets(); });
  $('#tgtKick').addEventListener('click', () => { targets.kick = !targets.kick; renderTargets(); });
  $('#modClear').addEventListener('click', () => { modUser.value = ''; targets.twitch = targets.kick = false; renderTargets(); });
  modUser.addEventListener('input', () => {
    if (!targets.twitch && !targets.kick) { targets.twitch = state.show.twitch; targets.kick = state.show.kick; }
    renderTargets();
  });
  toSecs.addEventListener('change', () => {
    const v = Math.round(Number(toSecs.value));
    state.timeoutSecs = v > 0 ? Math.min(1209600, v) : 919824;
    toSecs.value = state.timeoutSecs;
    save();
  });

  function buildCommand(p, action, user) {
    if (action === 'ban') return `/ban ${user}`;
    // Twitch saniye, Kick dakika ister
    if (p === 'twitch') return `/timeout ${user} ${state.timeoutSecs}`;
    return `/timeout ${user} ${Math.max(1, Math.ceil(state.timeoutSecs / 60))}`;
  }

  async function sendCommand(p, cmd) {
    const wv = panes[p].view;
    if (!wv || !state[p]) return 'chat açık değil';
    const focused = await wv.executeJavaScript('window.__penguFocusInput ? window.__penguFocusInput() : false').catch(() => false);
    if (!focused) return 'mesaj kutusu bulunamadı (giriş yapılı mı?)';
    await wv.insertText(cmd);
    await new Promise((r) => setTimeout(r, 120));
    wv.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
    wv.sendInputEvent({ type: 'char', keyCode: '\r' });
    wv.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    return null;
  }

  async function punish(action) {
    const user = cleanChannel(modUser.value);
    const list = ['twitch', 'kick'].filter((p) => targets[p]);
    if (!user || !list.length) return;
    const names = list.map((p) => (p === 'twitch' ? 'Twitch' : 'Kick')).join(' + ');
    if (action === 'ban' && !confirm(`${user} ${names}'te BANLANSIN mı?`)) return;
    const results = [];
    for (const p of list) {
      const err = await sendCommand(p, buildCommand(p, action, user));
      results.push(`${p === 'twitch' ? 'Twitch' : 'Kick'} ${err ? '✗ ' + err : '✓'}`);
    }
    const failed = results.some((r) => r.includes('✗'));
    modMsg(`${user} ${action === 'ban' ? 'ban' : 'timeout'}: ${results.join(' · ')}`, failed ? 'err' : 'ok');
  }
  $('#toBtn').addEventListener('click', () => punish('timeout'));
  $('#banBtn').addEventListener('click', () => punish('ban'));
  renderTargets();

  // ---------- Yayın karşılaştırma ----------
  // İki yayını küçük, sessiz oynatıcılarda yan yana gösterir; kronometre ile gecikme farkı ölçülür
  const compareEl = $('#compare');
  const cmpViews = { twitch: $('#cmpTwitch'), kick: $('#cmpKick') };
  const playerUrl = {
    twitch: (c) => `https://player.twitch.tv/?channel=${encodeURIComponent(c)}&parent=twitch.tv&muted=true&autoplay=true`,
    kick: (c) => `https://player.kick.com/${encodeURIComponent(c)}?muted=true&autoplay=true`,
  };

  function loadPlayers() {
    for (const p of ['twitch', 'kick']) {
      const box = cmpViews[p];
      box.innerHTML = '';
      if (!state[p]) {
        box.innerHTML = '<div class="placeholder">Kanal açık değil</div>';
        continue;
      }
      const wv = document.createElement('webview');
      wv.setAttribute('partition', 'persist:dualchat');
      wv.setAttribute('src', playerUrl[p](state[p]));
      box.appendChild(wv);
    }
  }
  function openCompare(open) {
    compareEl.classList.toggle('hidden', !open);
    $('#compareBtn').classList.toggle('active', open);
    if (open) { loadPlayers(); placeCompare(); }
    else for (const p of ['twitch', 'kick']) cmpViews[p].innerHTML = ''; // kapatınca yayınları durdur
    resetTimer();
  }
  $('#compareBtn').addEventListener('click', () => openCompare(compareEl.classList.contains('hidden')));
  $('#cmpClose').addEventListener('click', () => openCompare(false));
  $('#cmpReload').addEventListener('click', loadPlayers);

  // Kutuyu başlığından tutup taşı (yeri hatırlanır)
  function placeCompare() {
    const pos = state.comparePos;
    if (!pos) return;
    const w = compareEl.offsetWidth || 560;
    const h = compareEl.offsetHeight || 300;
    compareEl.style.left = Math.min(Math.max(0, pos.x), window.innerWidth - w) + 'px';
    compareEl.style.top = Math.min(Math.max(0, pos.y), window.innerHeight - h) + 'px';
    compareEl.style.right = 'auto';
  }
  $('.cmp-head').addEventListener('mousedown', (e) => {
    if (e.target.closest('button')) return;
    e.preventDefault();
    const r = compareEl.getBoundingClientRect();
    const dx = e.clientX - r.left;
    const dy = e.clientY - r.top;
    // Sürüklerken oynatıcılar fareyi yutmasın
    const shield = document.createElement('div');
    shield.className = 'cmp-shield';
    document.body.appendChild(shield);
    const move = (ev) => {
      state.comparePos = { x: ev.clientX - dx, y: ev.clientY - dy };
      placeCompare();
    };
    const up = () => {
      shield.remove();
      window.removeEventListener('mousemove', move);
      window.removeEventListener('mouseup', up);
      save();
    };
    window.addEventListener('mousemove', move);
    window.addEventListener('mouseup', up);
  });
  window.addEventListener('resize', placeCompare);

  // Kronometre: aynı anı önce birinde, sonra diğerinde görünce iki düğmeye basılır
  let firstSeen = null;
  let timerReset;
  const cmpResult = $('#cmpResult');
  function resetTimer() {
    firstSeen = null;
    $('#sawTwitch').classList.remove('waiting');
    $('#sawKick').classList.remove('waiting');
  }
  function saw(p) {
    const now = performance.now();
    const label = (x) => (x === 'twitch' ? 'Twitch' : 'Kick');
    if (!firstSeen || firstSeen.p === p) {
      resetTimer();
      firstSeen = { p, t: now };
      $(p === 'twitch' ? '#sawTwitch' : '#sawKick').classList.add('waiting');
      const other = p === 'twitch' ? 'kick' : 'twitch';
      cmpResult.textContent = `Şimdi ${label(other)}'te aynı anı bekle…`;
      cmpResult.style.color = '';
      clearTimeout(timerReset);
      timerReset = setTimeout(() => { resetTimer(); cmpResult.textContent = ''; }, 60000);
      return;
    }
    const diff = (now - firstSeen.t) / 1000;
    const behind = p; // ikinci basılan platform geride
    clearTimeout(timerReset);
    resetTimer();
    if (diff < 0.7) {
      cmpResult.textContent = '✓ Eşit gidiyor';
      cmpResult.style.color = 'var(--kick)';
    } else {
      cmpResult.textContent = `${label(behind)} ${diff.toFixed(1).replace('.', ',')} sn geride`;
      cmpResult.style.color = diff > 5 ? '#ffb4ab' : 'var(--text)';
    }
  }
  $('#sawTwitch').addEventListener('click', () => saw('twitch'));
  $('#sawKick').addEventListener('click', () => saw('kick'));

  // ---------- Otomatik gecikme yazısı ----------
  const delayTag = $('#delayTag');
  const fmt = (x) => x.toFixed(1).replace('.', ',');
  async function kickPlaybackUrl() {
    const wv = panes.kick.view;
    if (!wv || !state.kick) return null;
    // Kick chat sayfası kick.com'da açık: API'yi o sayfanın içinden (çerezleriyle) çağır
    const js = `fetch('/api/v2/channels/' + ${JSON.stringify(state.kick)}, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(j => (j && j.livestream && j.playback_url) || null)
      .catch(() => null)`;
    return wv.executeJavaScript(js).catch(() => null);
  }

  let measuring = false;
  async function measureDelay() {
    if (measuring) return;
    if (!state.twitch || !state.kick) { delayTag.classList.add('hidden'); return; }
    measuring = true;
    try {
      const url = await kickPlaybackUrl();
      const r = await window.dualChat.measureDelay({ twitch: state.twitch, kickPlaybackUrl: url });
      delayTag.classList.remove('hidden', 'ok', 'warn', 'muted');
      delayTag.title = 'Twitch ile Kick yayını arasındaki yaklaşık gecikme farkı (±1-2 sn). Tıkla: yayınları yan yana gör.';
      if (r.twitch && r.kick) {
        // Canlı ucu daha eski olan taraf geride
        const diff = (r.twitch - r.kick) / 1000; // + ise Kick geride
        const abs = Math.abs(diff);
        if (abs < 1) {
          delayTag.textContent = '⏱ Yayınlar eşit';
          delayTag.classList.add('ok');
        } else {
          delayTag.textContent = `⏱ ${diff > 0 ? 'Kick' : 'Twitch'} ~${fmt(abs)} sn geride`;
          delayTag.classList.add(abs >= 5 ? 'warn' : 'ok');
        }
      } else {
        const off = !r.twitch && !r.kick ? 'İki yayın' : !r.twitch ? 'Twitch' : 'Kick';
        delayTag.textContent = `⏱ ${off} kapalı / ölçülemedi`;
        delayTag.title = 'Ölçülemedi: ' + JSON.stringify(r.errors);
        delayTag.classList.add('muted');
      }
    } catch {
      delayTag.classList.add('hidden');
    } finally {
      measuring = false;
    }
  }
  delayTag.addEventListener('click', () => openCompare(compareEl.classList.contains('hidden')));
  setTimeout(measureDelay, 4000);
  setInterval(measureDelay, 15000);

  // ---------- Başlangıç ----------
  applyLayout();
  if (state.pinned) setPinned(true);
  if (state.opacity < 100) window.dualChat.setOpacity(state.opacity / 100);
  openChat('twitch');
  openChat('kick');
  if (!state.twitch && !state.kick) linkInput.focus();
})();
