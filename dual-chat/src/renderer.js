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
    modBarOpen: true,
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
      // Sayfa (ve giriş çerezleri) hazır olunca mod mu diye bak
      setTimeout(() => checkMod(p), 2500);
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
    if (modStatus[p] !== 'pending' && pane.view && pane.view.getAttribute('src') !== PLATFORMS[p].chatUrl(channel)) {
      modStatus[p] = 'pending'; // yeni kanal: yetki yeniden sorulacak
      applyModUi();
    }
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

  // ---- İzleyici / mod modu ----
  // Her platform için: 'pending' (bakılıyor), 'mod', 'viewer' (normal izleyici), 'unknown' (anlaşılamadı)
  const modStatus = { twitch: 'pending', kick: 'pending' };
  const canMod = (p) => !!state[p] && (modStatus[p] === 'mod' || modStatus[p] === 'unknown');

  async function checkMod(p) {
    const wv = panes[p].view;
    if (!wv || !state[p]) return;
    const res = await wv
      .executeJavaScript(`window.__penguModStatus ? window.__penguModStatus(${JSON.stringify(state[p])}) : 'unknown'`)
      .catch(() => 'unknown');
    modStatus[p] = ['mod', 'viewer', 'unknown'].includes(res) ? res : 'unknown';
    applyModUi();
  }
  // Sonradan modluk verilirse / alınırsa birkaç dakikada fark et
  setInterval(() => ['twitch', 'kick'].forEach(checkMod), 3 * 60 * 1000);

  function applyModUi() {
    const anyAccess = canMod('twitch') || canMod('kick');
    const toggle = $('#modToggle');
    // Normal izleyici: mod araçları hiç görünmez
    toggle.classList.toggle('hidden', !anyAccess);
    toggle.classList.toggle('active', anyAccess && state.modBarOpen);
    $('#modbar').classList.toggle('hidden', !(anyAccess && state.modBarOpen));
    toggle.title =
      'Mod araçları (timeout / ban) aç / kapat' +
      (['twitch', 'kick'].some((p) => modStatus[p] === 'unknown') ? ' · Yetkin otomatik anlaşılamadı' : '');
    for (const p of ['twitch', 'kick']) {
      const chip = $(p === 'twitch' ? '#tgtTwitch' : '#tgtKick');
      chip.disabled = !canMod(p);
      chip.title = canMod(p) ? `${p === 'twitch' ? 'Twitch' : 'Kick'}'te uygula` : 'Bu kanalda moderatör değilsin';
      if (!canMod(p)) targets[p] = false;
    }
    renderTargets();
  }
  $('#modToggle').addEventListener('click', () => {
    state.modBarOpen = !state.modBarOpen;
    save();
    applyModUi();
  });

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
    if (!canMod('twitch') && !canMod('kick')) return; // izleyici modunda tıklama bir şey yapmaz
    modUser.value = name;
    // Restream ile Kick'e gelen mesajın sahibi aslında Twitch'te
    const p = restream ? 'twitch' : fromPlatform;
    targets.twitch = p === 'twitch' && canMod('twitch');
    targets.kick = p === 'kick' && canMod('kick');
    renderTargets();
  }

  $('#tgtTwitch').addEventListener('click', () => { if (canMod('twitch')) targets.twitch = !targets.twitch; renderTargets(); });
  $('#tgtKick').addEventListener('click', () => { if (canMod('kick')) targets.kick = !targets.kick; renderTargets(); });
  $('#modClear').addEventListener('click', () => { modUser.value = ''; targets.twitch = targets.kick = false; renderTargets(); });
  modUser.addEventListener('input', () => {
    if (!targets.twitch && !targets.kick) { targets.twitch = canMod('twitch'); targets.kick = canMod('kick'); }
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

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  async function sendCommand(p, cmd) {
    const wv = panes[p].view;
    if (!wv || !state[p]) return 'chat açık değil';
    // Klavye komutları (tümünü seç / sil / Enter) bu panele gitsin
    if (document.activeElement && document.activeElement !== wv) document.activeElement.blur();
    wv.focus();
    await sleep(120);
    const focused = await wv.executeJavaScript('window.__penguFocusInput ? window.__penguFocusInput() : false').catch(() => false);
    if (!focused) return 'mesaj kutusu bulunamadı (giriş yapılı mı?)';
    const left = () => wv.executeJavaScript('window.__penguInputText ? window.__penguInputText() : ""').catch(() => '');
    // Kutuyu gerçek düzenleme komutlarıyla temizle (Kick'in kutusu sayfa içi silmeyi dinlemiyor)
    async function clearBox() {
      for (let i = 0; i < 3 && (await left()); i++) {
        wv.selectAll();
        await sleep(40);
        wv.delete();
        await sleep(120);
      }
      return !(await left());
    }
    await sleep(60);
    if (!(await clearBox())) return 'mesaj kutusu temizlenemedi';
    await wv.insertText(cmd);
    await sleep(150);
    const enter = () => {
      wv.sendInputEvent({ type: 'keyDown', keyCode: 'Enter' });
      wv.sendInputEvent({ type: 'char', keyCode: '\r' });
      wv.sendInputEvent({ type: 'keyUp', keyCode: 'Enter' });
    };
    // Önce gönder düğmesi (Kick'te komut ipucu kutusu Enter'ı yutuyor), olmazsa Enter
    const steps = [() => wv.executeJavaScript('window.__penguClickSend && window.__penguClickSend()').catch(() => {}), enter, enter];
    for (const step of steps) {
      await step();
      await sleep(350);
      if (!(await left())) return null;
    }
    // Gönderilemedi: komut kutuda kalıp bir sonrakine eklenmesin
    await clearBox();
    return 'gönderilemedi';
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

  // ---------- Otomatik gecikme yazısı ----------
  const delayTag = $('#delayTag');
  // Kick yayın adresi birkaç dakika geçerli: sık sık API'ye gitmemek için sakla
  let kickUrlCache = { slug: null, url: null, at: 0 };
  async function kickPlaybackUrl() {
    const wv = panes.kick.view;
    if (!wv || !state.kick) return null;
    if (kickUrlCache.slug === state.kick && kickUrlCache.url && Date.now() - kickUrlCache.at < 4 * 60 * 1000) {
      return kickUrlCache.url;
    }
    // Kick chat sayfası kick.com'da açık: API'yi o sayfanın içinden (çerezleriyle) çağır
    const js = `fetch('/api/v2/channels/' + ${JSON.stringify(state.kick)}, { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(j => (j && j.livestream && j.playback_url) || null)
      .catch(() => null)`;
    const url = await wv.executeJavaScript(js).catch(() => null);
    kickUrlCache = { slug: state.kick, url, at: url ? Date.now() : 0 };
    return url;
  }

  const DELAY_TITLE = 'Yayının izleyiciye ulaşma gecikmesi (son 20 sn ölçümü, bilgisayar saatine göre). 10 saniyede bir Twitch / Kick arasında değişir. Tıkla: diğerini göster.';
  let lastDelay = null; // son ölçüm sonucu
  let showing = 'twitch'; // yazının şu an gösterdiği platform

  function renderDelay() {
    const r = lastDelay;
    if (!r) return;
    delayTag.classList.remove('hidden', 'ok', 'warn', 'muted');
    delayTag.title = DELAY_TITLE;
    const label = showing === 'twitch' ? 'Twitch' : 'Kick';
    const lag = r[showing];
    if (lag == null) {
      delayTag.textContent = `⏱ ${label} kapalı / ölçülemedi`;
      delayTag.title = 'Ölçülemedi: ' + (r.errors[showing] || '');
      delayTag.classList.add('muted');
    } else if (r.n[showing] < 4) {
      delayTag.textContent = `⏱ ${label} ölçülüyor…`;
      delayTag.classList.add('muted');
    } else {
      const secs = Math.max(0, Math.round(lag / 1000));
      delayTag.textContent = `⏱ ${label} gecikmesi: ${secs} sn`;
      delayTag.classList.add(secs >= 10 ? 'warn' : 'ok');
    }
  }

  let measuring = false;
  async function measureDelay() {
    if (measuring) return;
    if (!state.twitch && !state.kick) { delayTag.classList.add('hidden'); return; }
    measuring = true;
    try {
      const url = state.kick ? await kickPlaybackUrl() : null;
      const r = await window.dualChat.measureDelay({ twitch: state.twitch, kick: state.kick, kickPlaybackUrl: url });
      if (!r.kick) kickUrlCache.url = null; // yayın yeni açıldıysa adresi yeniden sor
      lastDelay = r;
      renderDelay();
    } catch {
      delayTag.classList.add('hidden');
    } finally {
      measuring = false;
    }
  }

  function flipDelay() {
    const other = showing === 'twitch' ? 'kick' : 'twitch';
    if (state[other]) showing = other; // kanal açık değilse o platformu atla
    renderDelay();
  }
  // 10 saniyede bir Twitch / Kick arasında geçiş
  setInterval(flipDelay, 10000);
  delayTag.addEventListener('click', flipDelay);
  // Aralık rastgele: sabit 2 sn olsaydı listenin hep aynı anına denk gelir, doğru değeri kaçırırdı.
  // Her okuma 1-2 KB'lık bir metin.
  (function loop() {
    measureDelay().finally(() => setTimeout(loop, 900 + Math.random() * 700));
  })();

  // ---------- Başlangıç ----------
  applyLayout();
  applyModUi();
  // "Her zaman üstte" düğmesi kaldırıldı: önceden açık bırakıldıysa kapat
  if (state.pinned) { state.pinned = false; save(); window.dualChat.setAlwaysOnTop(false); }
  if (state.opacity < 100) window.dualChat.setOpacity(state.opacity / 100);
  openChat('twitch');
  openChat('kick');
  if (!state.twitch && !state.kick) linkInput.focus();
})();
