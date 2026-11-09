/* PengusChat — renderer */
(() => {
  const STORE_KEY = 'dualchat:settings';
  const defaults = {
    twitch: '',
    kick: '',
    layout: 'horizontal', // horizontal = yan yana, vertical = alt alta
    swapped: false,
    show: { twitch: true, kick: true },
    timeoutSecs: 0,
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
      setTimeout(() => updateViewers(p), 3000);
    });
    pane.body.appendChild(wv);
    pane.view = wv;
    return wv;
  }

  function openChat(p) {
    const pane = panes[p];
    const channel = state[p];
    pane.chan.textContent = channel ? '· ' + channel : '';
    $('.viewers', pane.el).textContent = '';
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

  // Saydamlık ayarı kaldırıldı: önceden düşürüldüyse pencereyi tam görünür yap

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

  // ---------- Sorun bildir ----------
  const ADMIN_KEY = 'penguchat:admin';
  const getAdmin = () => { try { return localStorage.getItem(ADMIN_KEY) || ''; } catch { return ''; } };
  const setAdmin = (v) => {
    try { v ? localStorage.setItem(ADMIN_KEY, v) : localStorage.removeItem(ADMIN_KEY); } catch {}
    refreshInboxBtn();
    if (v) checkNew(); else setBadge(0);
  };
  // 📥 tuşu: yönetici şifresi bu cihazda kayıtlıysa ya da sahibin Twitch/Kick hesabıyla girildiyse görünür.
  const OWNER_ACCOUNTS = { twitch: ['h1raeth0_'], kick: ['h1raeth0'] }; // küçük harfle
  // Uygulama içi yetkiler (📥 ekranındaki 👥 Yetkiler'den verilir; giriş yapılan Twitch/Kick adına göre)
  let roles = { modlog: false, reports: false, stats: false };
  const anyRole = () => roles.modlog || roles.reports || roles.stats;
  let rolesKey = '';
  async function refreshRoles() {
    const key = accounts.twitch + '|' + accounts.kick;
    if (key === rolesKey) return;
    rolesKey = key;
    if (!accounts.twitch && !accounts.kick) { roles = { modlog: false, reports: false, stats: false }; refreshInboxBtn(); return; }
    const r = await window.dualChat.rpc('my_roles', { p_twitch: accounts.twitch, p_kick: accounts.kick });
    if (r.ok && r.data) roles = { modlog: !!r.data.modlog, reports: !!r.data.reports, stats: !!r.data.stats };
    refreshInboxBtn();
  }
  const roleArgs = () => ({ p_twitch: accounts.twitch, p_kick: accounts.kick });
  const ownerOn = { twitch: false, kick: false };
  // Giriş yapılmış Twitch / Kick hesap adları (sorun bildirirken kullanıcı adı buradan gelir)
  const accounts = { twitch: '', kick: '' };
  function refreshInboxBtn() {
    $('#inboxBtn').classList.toggle('hidden', !(getAdmin() || ownerOn.twitch || ownerOn.kick || anyRole()));
  }

  // 📥 tuşundaki yeni sorun sayısı: en son görülen sorunun numarasından büyük olanlar.
  const SEEN_KEY = 'penguchat:seenReport';
  const getSeen = () => { try { return Number(localStorage.getItem(SEEN_KEY)) || 0; } catch { return 0; } };
  function setBadge(n) {
    const b = $('#inboxBadge');
    b.textContent = n > 9 ? '9+' : String(n);
    b.classList.toggle('hidden', !n);
  }
  function markSeen(list) {
    const max = Math.max(getSeen(), ...list.map((x) => Number(x.id) || 0));
    try { localStorage.setItem(SEEN_KEY, String(max)); } catch {}
    setBadge(0);
  }
  async function checkNew() {
    const pw = getAdmin();
    if (!pw) return;
    const r = await window.dualChat.listReports(pw);
    if (r.ok) setBadge((r.data || []).filter((x) => Number(x.id) > getSeen()).length);
  }
  $('#inboxBtn').addEventListener('click', () => openInbox());
  setInterval(checkNew, 5 * 60 * 1000);

  const reportDlg = $('#reportDlg');
  const inboxDlg = $('#inboxDlg');
  for (const d of [reportDlg, inboxDlg]) {
    d.addEventListener('click', (e) => {
      if (e.target === d || e.target.closest('[data-close]')) d.classList.add('hidden');
    });
  }
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') { reportDlg.classList.add('hidden'); inboxDlg.classList.add('hidden'); }
  });

  function reportHint(text, cls) {
    const h = $('#reportHint');
    h.textContent = text || '';
    h.className = 'hint' + (cls ? ' ' + cls : '');
  }
  // Bu cihazın gizli kimliği: kişi kendi gönderdiği sorunların durumunu görebilsin diye.
  const TOKEN_KEY = 'penguchat:reporterToken';
  function myToken(create) {
    let t = '';
    try { t = localStorage.getItem(TOKEN_KEY) || ''; } catch {}
    if (!t && create) {
      t = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
      try { localStorage.setItem(TOKEN_KEY, t); } catch {}
    }
    return t;
  }
  const STATUS = {
    bekliyor: '📨 Gönderildi',
    onaylandi: '📋 Sırada',
    cozuldu: '✅ Çözüldü',
    reddedildi: '❌ Reddedildi',
  };
  // Durumlar sadece ileri gider: çözülen / reddedilen kilitlenir
  const NEXT = {
    bekliyor: ['onaylandi', 'reddedildi'],
    onaylandi: ['cozuldu'],
    cozuldu: [],
    reddedildi: [],
  };
  // Yönetici düğmelerinin yazısı
  const ACTION = { onaylandi: '➡️ Sıraya al', cozuldu: '✅ Çözüldü', reddedildi: '❌ Reddet' };
  const stBadge = (st) => `<span class="st st-${esc(STATUS[st] ? st : 'bekliyor')}">${STATUS[st] || STATUS.bekliyor}</span>`;

  // Cevap / durum değişikliği görüldü mü? (sorun no → son görülen güncelleme zamanı)
  const MINE_SEEN_KEY = 'penguchat:mineSeen';
  const getMineSeen = () => { try { return JSON.parse(localStorage.getItem(MINE_SEEN_KEY) || '{}'); } catch { return {}; } };
  const isNews = (x, seen) => x.status !== 'bekliyor' && seen[x.id] !== x.updated_at;
  function setMineDot(on) {
    for (const id of ['#reportDot', '#mineDot']) $(id).classList.toggle('hidden', !on);
  }
  async function checkMine() {
    const t = myToken(false);
    if (!t) return;
    const r = await window.dualChat.myReports(t);
    if (!r.ok) return;
    const seen = getMineSeen();
    setMineDot((r.data || []).some((x) => isNews(x, seen)));
  }
  setInterval(checkMine, 5 * 60 * 1000);
  setTimeout(checkMine, 4000);

  function showTab(tab) {
    reportDlg.querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.tab === tab));
    $('#tabNew').classList.toggle('hidden', tab !== 'new');
    $('#tabMine').classList.toggle('hidden', tab !== 'mine');
    if (tab === 'mine') loadMine();
    else focusField($('#reportText'));
  }
  reportDlg.querySelector('.tabs').addEventListener('click', (e) => {
    const tab = e.target.closest('.tab')?.dataset.tab;
    if (tab) showTab(tab);
  });
  async function loadMine() {
    const box = $('#tabMine');
    const t = myToken(false);
    if (!t) { box.innerHTML = '<div class="empty">Bu cihazdan henüz sorun bildirmedin.</div>'; return; }
    box.innerHTML = '<div class="empty">Yükleniyor…</div>';
    const r = await window.dualChat.myReports(t);
    if (!r.ok) { box.innerHTML = `<div class="empty">Yüklenemedi: ${esc(r.error)}</div>`; return; }
    const list = r.data || [];
    const seen = getMineSeen();
    box.innerHTML = list.length
      ? list.map((x) => `<div class="rep">
          <div class="rep-meta">${stBadge(x.status)}<span>${esc(fmtDate(x.created_at))}</span>${isNews(x, seen) ? '<span class="dot-new"></span>' : ''}</div>
          <div class="rep-msg">${esc(x.message)}</div>
          ${x.status === 'reddedildi' && x.admin_note ? `<div class="rep-note"><b>Red sebebi:</b>${esc(x.admin_note)}</div>` : ''}
        </div>`).join('')
      : '<div class="empty">Bu cihazdan henüz sorun bildirmedin.</div>';
    // Görüldü olarak işaretle
    const next = {};
    for (const x of list) next[x.id] = x.updated_at;
    try { localStorage.setItem(MINE_SEEN_KEY, JSON.stringify(next)); } catch {}
    setMineDot(false);
  }

  // Klavyeyi chat panelinden geri alıp kutuya ver
  async function focusField(el) {
    if (document.activeElement && document.activeElement.tagName === 'WEBVIEW') document.activeElement.blur();
    await window.dualChat.focusHost();
    el.focus();
  }
  // Pencerelerdeki bir kutuya tıklanınca da odağı garantile
  for (const d of [reportDlg, inboxDlg]) {
    d.addEventListener('mousedown', (e) => {
      const f = e.target.closest('textarea, input:not([readonly])');
      if (f) focusField(f);
    });
  }
  $('#reportBtn').addEventListener('click', () => openReport());
  // Kullanıcı adı elle yazılmaz: giriş yapılan Twitch / Kick hesabından gelir (trollemeyi önler)
  function accountText() {
    return [accounts.twitch && 'Twitch: ' + accounts.twitch, accounts.kick && 'Kick: ' + accounts.kick].filter(Boolean).join(' · ');
  }
  function fillAccounts() {
    const t = accountText();
    $('#reportContact').value = t || 'Giriş yapılmamış';
    $('#reportContact').classList.toggle('bad', !t);
  }
  function openReport() {
    // Her açılışta boş başlasın
    $('#reportText').value = '';
    reportHint('');
    $('#reportSend').disabled = false;
    fillAccounts();
    ['twitch', 'kick'].forEach(checkMod); // hesap adlarını tazele
    reportDlg.classList.remove('hidden');
    // Cevap geldiyse doğrudan "Bildirdiklerim"i aç
    showTab($('#reportDot').classList.contains('hidden') ? 'new' : 'mine');
  }
  $('#reportSend').addEventListener('click', async () => {
    const message = $('#reportText').value.trim();
    if (!message) { reportHint('Önce sorunu yaz.', 'err'); return; }
    const contact = accountText();
    if (!contact) { reportHint('Sorun bildirmek için chat\'ten Twitch ya da Kick\'e giriş yap.', 'err'); return; }
    $('#reportSend').disabled = true;
    reportHint('Gönderiliyor…');
    const r = await window.dualChat.sendReport({ message, contact, token: myToken(true) });
    $('#reportSend').disabled = false;
    if (!r.ok) { reportHint('Gönderilemedi: ' + r.error, 'err'); return; }
    $('#reportText').value = '';
    reportHint('Gönderildi! Durumunu "Bildirdiklerim"den takip edebilirsin 🐧', 'ok');
    focusField($('#reportText'));
  });

  // Gizli giriş: 🐧 logosuna 3 saniye içinde 5 kez tıkla.
  let brandClicks = [];
  $('#brand').addEventListener('click', () => {
    const now = Date.now();
    brandClicks = brandClicks.filter((t) => now - t < 3000).concat(now);
    if (brandClicks.length >= 5) { brandClicks = []; openInbox(); }
  });

  const inboxList = $('#inboxList');
  const esc = (t) => String(t ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function fmtDate(iso) {
    const d = new Date(iso);
    return isNaN(d) ? '' : d.toLocaleString('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  }
  function showLogin(err) {
    $('#inboxCount').textContent = '';
    $('#inboxTabs').classList.add('hidden');
    $('#inboxLogout').classList.add('hidden');
    $('#inboxRefresh').classList.add('hidden');
    inboxList.innerHTML = `<form class="empty" id="adminForm">
        <p>Yönetici şifresini gir.</p>
        <input id="adminPw" type="password" placeholder="Şifre" autocomplete="off" />
        <button class="btn primary" type="submit">Giriş</button>
        <p class="hint ${err ? 'err' : ''}">${esc(err || '')}</p>
      </form>`;
    $('#adminPw').focus();
    $('#adminForm').addEventListener('submit', async (e) => {
      e.preventDefault();
      const pw = $('#adminPw').value;
      if (!pw) return;
      const r = await window.dualChat.reportIsAdmin(pw);
      if (!r.ok) return showLogin(r.error);
      if (r.data !== true) return showLogin('Şifre yanlış');
      setAdmin(pw);
      loadInbox();
    });
  }
  // Hangi sekmeyi kim görür: yönetici hepsini, yetkili kişi kendine verilenleri
  function tabAllowed(t) {
    if (getAdmin()) return true;
    return { reports: roles.reports, mod: roles.modlog, stats: roles.stats }[t] || false; // log, roles, maint: sadece yönetici
  }
  function showTabs() {
    $('#inboxTabs').querySelectorAll('.tab').forEach((b) => {
      b.classList.toggle('hidden', !tabAllowed(b.dataset.itab));
      b.classList.toggle('active', b.dataset.itab === inboxTab);
    });
  }
  async function loadInbox() {
    const pw = getAdmin();
    if (!pw && !anyRole()) return showLogin();
    if (!tabAllowed(inboxTab)) inboxTab = ['reports', 'mod', 'stats'].find(tabAllowed) || 'reports';
    showTabs();
    $('#inboxLogout').classList.toggle('hidden', !pw);
    $('#inboxRefresh').classList.remove('hidden');
    $('#inboxTabs').classList.remove('hidden');
    inboxList.innerHTML = '<div class="empty">Yükleniyor…</div>';
    if (inboxTab === 'log') return loadLog(pw);
    if (inboxTab === 'stats') return loadStats(pw);
    if (inboxTab === 'mod') return loadModLog(pw);
    if (inboxTab === 'roles') return loadRoles(pw);
    if (inboxTab === 'maint') return loadMaint();
    const r = pw ? await window.dualChat.listReports(pw) : await window.dualChat.rpc('role_reports', roleArgs());
    if (!r.ok) {
      if (r.error === 'Şifre yanlış') return failed(r);
      inboxList.innerHTML = `<div class="empty">Yüklenemedi: ${esc(r.error)}</div>`;
      return;
    }
    const list = r.data || [];
    if (pw) markSeen(list);
    $('#inboxCount').textContent = list.length ? `${list.length} sorun` : '';
    if (!list.length) { inboxList.innerHTML = '<div class="empty">Henüz gelen sorun yok 🎉</div>'; return; }
    inboxList.innerHTML = list.map((x) => `<div class="rep" data-id="${Number(x.id)}" data-status="${esc(x.status || 'bekliyor')}" data-note="${esc(x.admin_note || '')}">
        <div class="rep-meta">${stBadge(x.status)}<b>${esc(x.contact || 'İsimsiz')}</b><span>${esc(fmtDate(x.created_at))}</span>
          <span>${esc(x.platform || '')} · v${esc(x.app_version || '?')}</span><div class="spacer"></div>
          ${pw ? `<button class="btn mini" data-del="${Number(x.id)}" title="Sil">🗑</button>` : ''}</div>
        <div class="rep-msg">${esc(x.message)}</div>
        ${x.status === 'reddedildi' && x.admin_note ? `<div class="rep-note"><b>Red sebebi:</b>${esc(x.admin_note)}</div>` : ''}
        <div class="rep-acts">
          ${(NEXT[x.status] || NEXT.bekliyor).map((st) => `<button class="btn mini" data-st="${st}">${ACTION[st]}</button>`).join('')}
          ${(NEXT[x.status] || NEXT.bekliyor).length ? '' : '<span class="hint">🔒 Kesinleşti</span>'}
          <span class="hint act-hint"></span>
        </div>
        <div class="rep-edit hidden">
          <textarea maxlength="1000" placeholder="Red sebebi — örn: Bu sorun uygulamayla değil, internetinle ilgili."></textarea>
          <div class="row"><span class="hint"></span><div class="spacer"></div><button class="btn mini" data-cancel>Vazgeç</button><button class="btn mini primary" data-save>Reddet</button></div>
        </div>
      </div>`).join('');
  }
  inboxList.addEventListener('click', async (e) => {
    const card = e.target.closest('.rep');
    const delId = e.target.closest('[data-del]')?.dataset.del;
    if (delId) {
      if (!confirm('Bu sorun silinsin mi?')) return;
      const r = await window.dualChat.deleteReport(getAdmin(), delId);
      if (!r.ok) { alert('Silinemedi: ' + r.error); return; }
      return loadInbox();
    }
    if (!card) return;
    const edit = card.querySelector('.rep-edit');
    const stBtn = e.target.closest('[data-st]');
    const save = async (st, note, hintEl) => {
      hintEl.textContent = 'Kaydediliyor…';
      hintEl.className = 'hint';
      const r = getAdmin()
        ? await window.dualChat.setReportStatus(getAdmin(), card.dataset.id, st, note)
        : await window.dualChat.rpc('role_set_status', { ...roleArgs(), p_id: Number(card.dataset.id), p_status: st, p_note: note });
      if (!r.ok) { hintEl.textContent = 'Kaydedilemedi: ' + r.error; hintEl.className = 'hint err'; return; }
      loadInbox();
    };
    if (stBtn) {
      const st = stBtn.dataset.st;
      if (!(NEXT[card.dataset.status] || NEXT.bekliyor).includes(st)) return;
      if (st !== 'reddedildi') return save(st, '', card.querySelector('.act-hint')); // tek tık
      // Reddet: sebep kutusunu aç
      edit.classList.remove('hidden');
      edit.querySelector('.hint').textContent = '';
      edit.querySelector('textarea').focus();
      return;
    }
    if (e.target.closest('[data-cancel]')) { edit.classList.add('hidden'); return; }
    if (e.target.closest('[data-save]')) {
      const note = edit.querySelector('textarea').value.trim();
      const hint = edit.querySelector('.hint');
      if (!note) { hint.textContent = 'Red sebebini yaz.'; hint.className = 'hint err'; return; }
      save('reddedildi', note, hint);
    }
  });
  // ---- 📜 Log ve 📊 İstatistik (sadece yönetici) ----
  let inboxTab = 'reports';
  $('#inboxTabs').addEventListener('click', (e) => {
    const t = e.target.closest('[data-itab]')?.dataset.itab;
    if (!t) return;
    inboxTab = t;
    $('#inboxTabs').querySelectorAll('.tab').forEach((b) => b.classList.toggle('active', b.dataset.itab === t));
    loadInbox();
  });
  const LOG_KIND = {
    gonderildi: '📨 Gönderildi',
    onaylandi: '📋 Sıraya alındı',
    cozuldu: '✅ Çözüldü',
    reddedildi: '❌ Reddedildi',
    silindi: '🗑 Silindi',
  };
  function failed(r) {
    if (r.error === 'Şifre yanlış') {
      if (getAdmin()) { setAdmin(''); showLogin('Şifre değişmiş, yeniden gir.'); return true; }
      inboxList.innerHTML = '<div class="empty">Bu bölüm için yetkin yok.</div>';
      return true;
    }
    const missing = /\(404\)/.test(r.error) ? ' — Supabase\'e log/istatistik SQL\'i çalıştırılmamış olabilir.' : '';
    inboxList.innerHTML = `<div class="empty">Yüklenemedi: ${esc(r.error)}${missing}</div>`;
    return true;
  }
  async function loadLog(pw) {
    const r = await window.dualChat.reportLog(pw);
    if (!r.ok) return failed(r);
    const list = r.data || [];
    $('#inboxCount').textContent = list.length ? `${list.length} kayıt` : '';
    inboxList.innerHTML = list.length
      ? list.map((x) => `<div class="log-row"><span class="t">${esc(fmtDate(x.at))}</span><span class="k">${LOG_KIND[x.kind] || esc(x.kind)}</span>
          <span class="d"><b>${esc(x.contact || 'İsimsiz')}</b> · ${esc(x.message || '')}${x.note ? `<small>Sebep: ${esc(x.note)}</small>` : ''}</span></div>`).join('')
      : '<div class="empty">Henüz kayıt yok.</div>';
  }
  function fmtDur(secs) {
    if (!secs) return '';
    if (secs % 86400 === 0) return secs / 86400 + ' gün';
    if (secs % 3600 === 0) return secs / 3600 + ' saat';
    if (secs % 60 === 0) return secs / 60 + ' dk';
    return secs + ' sn';
  }
  async function loadModLog(pw) {
    const r = pw ? await window.dualChat.modLog(pw) : await window.dualChat.rpc('role_mod_log', roleArgs());
    if (!r.ok) return failed(r);
    renderModLog(r.data || [], inboxList, $('#inboxCount'));
  }
  function renderModLog(list, box, countEl) {
    countEl.textContent = list.length ? `${list.length} işlem` : '';
    box.innerHTML = list.length
      ? list.map((x) => {
          const who = (x.platform === 'twitch' ? x.mod_twitch : x.mod_kick) || x.mod_twitch || x.mod_kick || '?';
          return `<div class="log-row"><span class="t">${esc(fmtDate(x.at))}</span>
            <span class="k">${x.action === 'ban' ? '⛔ Ban' : '⏱ Timeout ' + esc(fmtDur(x.secs))}</span>
            <span class="d"><b>${esc(x.target)}</b> · ${x.platform === 'twitch' ? 'Twitch' : 'Kick'}<small>mod: ${esc(who)}${x.ok === false ? ' · ✗ gönderilemedi' : ''}</small></span></div>`;
        }).join('')
      : '<div class="empty">Henüz mod işlemi yok. (Sadece bu uygulamadan atılan timeout / ban kaydedilir.)</div>';
  }
  function ago(iso) {
    const m = Math.max(0, Math.round((Date.now() - new Date(iso)) / 60000));
    if (m < 2) return 'şimdi';
    if (m < 60) return m + ' dk önce';
    if (m < 1440) return Math.round(m / 60) + ' sa önce';
    return Math.round(m / 1440) + ' gün önce';
  }
  async function loadStats(pw) {
    const r = pw ? await window.dualChat.reportStats(pw) : await window.dualChat.rpc('role_stats', roleArgs());
    if (!r.ok) return failed(r);
    const d = r.data || {};
    const list = d.list || [];
    $('#inboxCount').textContent = '';
    const online = (x) => Date.now() - new Date(x.last_seen) < 10 * 60000;
    inboxList.innerHTML = `<div class="stats">
        <div class="stat"><b>${Number(d.total) || 0}</b><span>Toplam kullanıcı</span></div>
        <div class="stat"><b>${Number(d.online) || 0}</b><span>Şu an açık</span></div>
        <div class="stat"><b>${Number(d.today) || 0}</b><span>Son 24 saat</span></div>
        <div class="stat"><b>${Number(d.mods) || 0}</b><span>Mod (son 7 gün)</span></div>
        <div class="stat"><b>${Number(d.bans) || 0}</b><span>Ban</span></div>
        <div class="stat"><b>${Number(d.timeouts) || 0}</b><span>Timeout</span></div>
        <div class="stat"><b>${Number(d.actions_today) || 0}</b><span>Bugünkü mod işlemi</span></div>
      </div>
      <table class="users"><tr><th></th><th>Twitch</th><th>Kick</th><th>Mod</th><th>Cihaz</th><th>Sürüm</th><th>Son görülme</th></tr>
      ${list.map((x) => `<tr><td class="${online(x) ? 'on' : ''}">${online(x) ? '●' : '○'}</td><td>${esc(x.twitch || '—')}</td><td>${esc(x.kick || '—')}</td>
        <td>${x.is_mod ? '🛡️' : ''}</td><td>${esc((x.platform || '').split(' ')[0])}</td><td>v${esc(x.version || '?')}</td><td>${esc(ago(x.last_seen))}</td></tr>`).join('')}
      </table>`;
  }

  // ---- 👥 Yetkiler (sadece yönetici) ----
  const ROLE_LABEL = { modlog: '🛡️ Mod log', reports: '📥 Sorunlar', stats: '📊 İstatistik' };
  async function loadRoles(pw) {
    const r = await window.dualChat.rpc('list_roles', { p_password: pw });
    if (!r.ok) return failed(r);
    const list = r.data || [];
    $('#inboxCount').textContent = list.length ? `${list.length} kişi` : '';
    const boxes = (x) => ['modlog', 'reports', 'stats'].map((k) => `<label><input type="checkbox" data-role="${k}" ${x && x['can_' + k] ? 'checked' : ''}/> ${ROLE_LABEL[k]}</label>`).join(' ');
    inboxList.innerHTML = `<div class="role-add" id="roleAdd">
        <select id="roleP"><option value="twitch">Twitch</option><option value="kick">Kick</option></select>
        <input type="text" id="roleU" placeholder="kullanıcı adı" spellcheck="false" />
        ${boxes(null)}
        <button class="btn mini primary" id="roleSave">Yetki ver</button>
        <span class="hint" id="roleHint"></span>
      </div>
      <p class="dlg-note">Kanal modluğu Twitch / Kick'ten otomatik okunur; buradaki yetkiler sadece bu uygulama içindir. Kutuları kaldırınca yetki silinir.</p>
      ${list.length ? `<table class="roles"><tr><th>Platform</th><th>Kullanıcı</th><th>Yetkiler</th></tr>
        ${list.map((x) => `<tr data-p="${esc(x.platform)}" data-u="${esc(x.username)}"><td>${x.platform === 'twitch' ? 'Twitch' : 'Kick'}</td><td><b>${esc(x.username)}</b></td><td>${boxes(x)}</td></tr>`).join('')}</table>`
        : '<div class="empty">Henüz kimseye yetki verilmedi.</div>'}`;
  }
  async function saveRole(platform, username, row, hintEl) {
    const get = (k) => !!row.querySelector(`[data-role="${k}"]`).checked;
    const r = await window.dualChat.rpc('set_role', {
      p_password: getAdmin(), p_platform: platform, p_username: username,
      p_modlog: get('modlog'), p_reports: get('reports'), p_stats: get('stats'),
    });
    if (!r.ok) { if (hintEl) { hintEl.textContent = 'Kaydedilemedi: ' + r.error; hintEl.className = 'hint err'; } else alert('Kaydedilemedi: ' + r.error); return false; }
    return true;
  }
  inboxList.addEventListener('click', async (e) => {
    if (e.target.id !== 'roleSave') return;
    const u = $('#roleU').value.trim().replace(/^@/, '');
    const hint = $('#roleHint');
    if (!u) { hint.textContent = 'Kullanıcı adını yaz.'; hint.className = 'hint err'; return; }
    if (!$('#roleAdd').querySelector('[data-role]:checked')) { hint.textContent = 'En az bir yetki seç.'; hint.className = 'hint err'; return; }
    if (await saveRole($('#roleP').value, u, $('#roleAdd'), hint)) loadInbox();
  });
  inboxList.addEventListener('change', async (e) => {
    const row = e.target.closest('tr[data-u]');
    if (!row || !e.target.dataset.role) return;
    if (await saveRole(row.dataset.p, row.dataset.u, row, null)) loadInbox();
  });

  $('#inboxRefresh').addEventListener('click', loadInbox);
  $('#inboxLogout').addEventListener('click', () => { setAdmin(''); showLogin(); });
  function openInbox() {
    inboxTab = 'reports';
    inboxDlg.classList.remove('hidden');
    loadInbox();
  }
  setAdmin(getAdmin());

  // ---------- Güncelleme ----------
  const updateBtn = $('#updateBtn');
  let manualCheck = false;
  // Beta süresince kullanıcıya sürüm numarası yerine "Beta" gösterilir. Beta bitince BETA = '' yap.
  const BETA = 'Beta';
  const ver = (v) => BETA || 'v' + v;
  function renderUpdate(u) {
    if (u.current) $('#versionLabel').textContent = ver(u.current);
    updateBtn.classList.remove('busy');
    updateBtn.disabled = false;
    if (u.state === 'downloading') {
      updateBtn.textContent = `Güncelleme iniyor… %${u.percent || 0}`;
      updateBtn.classList.add('busy');
      updateBtn.disabled = true;
      updateBtn.classList.remove('hidden');
    } else if (u.state === 'ready') {
      updateBtn.textContent = BETA ? '⬆ Güncelle' : `⬆ Güncelle (v${u.version})`;
      updateBtn.title = 'Uygulama kapanıp yeni sürümle yeniden açılır';
      updateBtn.classList.remove('hidden');
    } else if (u.state === 'portable-available') {
      updateBtn.textContent = BETA ? '⬇ Yeni sürüm var' : `⬇ Yeni sürüm var (v${u.version})`;
      updateBtn.title = 'Yeni sürümü indir, eskisinin yerine kullan';
      updateBtn.classList.remove('hidden');
    } else {
      updateBtn.classList.add('hidden');
      if (manualCheck && u.state === 'latest') { manualCheck = false; alert(`PengusChat güncel (${ver(u.current)}).`); }
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
  state.timeoutSecs = 0; // her açılışta 0'dan başlar (süreyi mod kendisi yazar)
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
    const me = await wv.executeJavaScript('window.__penguMe || ""').catch(() => '');
    ownerOn[p] = OWNER_ACCOUNTS[p].includes(String(me).toLowerCase());
    accounts[p] = String(me || '').slice(0, 40);
    refreshInboxBtn();
    refreshRoles();
    if (!reportDlg.classList.contains('hidden')) fillAccounts();
  }
  // Sonradan modluk verilirse / alınırsa en geç 1 dakikada fark et
  setInterval(() => ['twitch', 'kick'].forEach(checkMod), 60 * 1000);

  function applyModUi() {
    const anyAccess = canMod('twitch') || canMod('kick');
    const toggle = $('#modToggle');
    // Normal izleyici: mod araçları hiç görünmez
    toggle.classList.toggle('hidden', !anyAccess);
    toggle.classList.toggle('active', anyAccess && state.modBarOpen);
    $('#modbar').classList.toggle('hidden', !(anyAccess && state.modBarOpen));
    try { renderDelay(); } catch {} // gecikme yazısı da sadece modlara
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
    state.timeoutSecs = v > 0 ? Math.min(1209600, v) : 0;
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
    if (action === 'timeout' && !(state.timeoutSecs > 0)) { modMsg('Önce süreyi yaz (saniye).', 'err'); toSecs.focus(); toSecs.select(); return; }
    const names = list.map((p) => (p === 'twitch' ? 'Twitch' : 'Kick')).join(' + ');
    if (action === 'ban' && !confirm(`${user} ${names}'te BANLANSIN mı?`)) return;
    const results = [];
    for (const p of list) {
      const err = await sendCommand(p, buildCommand(p, action, user));
      window.dualChat.modAction({
        client: clientId(), twitch: accounts.twitch, kick: accounts.kick,
        platform: p, action, target: user, secs: action === 'timeout' ? state.timeoutSecs : null, ok: !err,
      }).catch(() => {});
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
    // Normal izleyiciye gecikme yazısı gösterilmez
    if (!canMod('twitch') && !canMod('kick')) { delayTag.classList.add('hidden'); return; }
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
    if (!canMod('twitch') && !canMod('kick')) { delayTag.classList.add('hidden'); return; } // izleyici: ölçme bile
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

  // ---------- Yayının izleyici sayısı (herkese açık) ----------
  const fmtNum = (n) => n.toLocaleString('tr-TR');
  async function updateViewers(p) {
    const el = $('.viewers', panes[p].el);
    const wv = panes[p].view;
    if (!wv || !state[p]) { el.textContent = ''; return; }
    const n = await wv.executeJavaScript(`window.__penguViewers ? window.__penguViewers(${JSON.stringify(state[p])}) : -1`).catch(() => -1);
    if (n == null) { el.textContent = '· kapalı'; el.classList.add('off'); }
    else if (n >= 0) { el.textContent = `👁 ${fmtNum(n)}`; el.classList.remove('off'); }
  }
  setInterval(() => ['twitch', 'kick'].forEach(updateViewers), 30 * 1000);

  // ---------- Kullanım bilgisi (sadece yöneticinin istatistik ekranı için) ----------
  const CLIENT_KEY = 'penguchat:clientId';
  function clientId() {
    let id = '';
    try { id = localStorage.getItem(CLIENT_KEY) || ''; } catch {}
    if (!id) {
      id = (crypto.randomUUID() + crypto.randomUUID()).replace(/-/g, '');
      try { localStorage.setItem(CLIENT_KEY, id); } catch {}
    }
    return id;
  }
  function ping() {
    window.dualChat.ping({
      id: clientId(),
      mod: modStatus.twitch === 'mod' || modStatus.kick === 'mod',
      twitch: accounts.twitch,
      kick: accounts.kick,
    }).catch(() => {});
  }
  setTimeout(ping, 15 * 1000); // chat'ler açılıp hesaplar okunduktan sonra
  setInterval(ping, 5 * 60 * 1000);

  // ---------- Bakım modu ----------
  // Bakım açıkken uygulama herkese kapalıdır; yönetici (şifre ya da kendi Twitch/Kick hesabı) kullanmaya devam eder.
  let maintState = { maintenance: false, message: '', eta: '' };
  const maintExempt = () => !!(getAdmin() || ownerOn.twitch || ownerOn.kick);
  function applyMaint() {
    const on = maintState.maintenance && !maintExempt();
    $('#maintScreen').classList.toggle('hidden', !on);
    $('#maintMsg').textContent = maintState.message ? 'Sebep: ' + maintState.message : 'PengusChat kısa bir süre bakımda. Birazdan kendiliğinden açılacak.';
    $('#maintEta').textContent = maintState.eta ? '⏰ Tahmini açılış: ' + maintState.eta : '';
    $('#maintEta').classList.toggle('hidden', !maintState.eta);
  }
  async function checkMaint() {
    const r = await window.dualChat.rpc('app_status', {});
    if (r.ok && r.data) maintState = { maintenance: !!r.data.maintenance, message: r.data.message || '', eta: r.data.eta || '' };
    applyMaint(); // sunucuya ulaşılamazsa son bilinen durum kalır
  }
  checkMaint();
  setInterval(checkMaint, 30 * 1000);
  setInterval(applyMaint, 3000); // hesap adı sonradan okununca yöneticiyi tanı
  async function loadMaint() {
    $('#inboxCount').textContent = '';
    await checkMaint();
    const on = maintState.maintenance;
    inboxList.innerHTML = `<div class="maint-form">
        <div class="maint-state">${on ? '🛠️ Bakım modu AÇIK — uygulama sadece sende çalışıyor' : '✅ Uygulama herkese açık'}</div>
        <label>Sebep (zorunlu · kullanıcılar görür)</label>
        <textarea id="maintText" maxlength="300" placeholder="örn: Yeni özellik ekleniyor">${esc(maintState.message)}</textarea>
        <label>⏰ Tahmini açılış (zorunlu · kullanıcılar görür)</label>
        <input id="maintEtaIn" maxlength="60" placeholder="örn: 22:30  ya da  1 saat sonra" value="${esc(maintState.eta)}" />
        <div class="dlg-foot"><span class="hint" id="maintHint"></span><div class="spacer"></div>
          ${on ? '<button class="btn mini" id="maintSave">Bilgiyi güncelle</button><button class="btn primary" id="maintOff">Bakımı kapat</button>'
               : '<button class="btn mod danger" id="maintOn">🛠️ Bakıma al</button>'}</div>
        <p class="dlg-note">Bakımdayken diğer herkeste uygulama "Bakımdayız" ekranıyla kapanır, sen kullanmaya devam edersin. Kapatınca en geç 30 saniyede herkeste açılır. (Bu özellikten önceki sürümleri kullananlar etkilenmez.)</p>
      </div>`;
  }
  inboxList.addEventListener('click', async (e) => {
    const id = e.target.id;
    if (!['maintOn', 'maintOff', 'maintSave'].includes(id)) return;
    if (id !== 'maintOff') {
      // Bakıma alırken / güncellerken sebep ve tahmini açılış zorunlu
      const miss = !$('#maintText').value.trim() ? 'Sebebi yaz.' : !$('#maintEtaIn').value.trim() ? 'Tahmini açılış saatini yaz.' : '';
      if (miss) { $('#maintHint').textContent = miss; $('#maintHint').className = 'hint err'; return; }
    }
    if (id === 'maintOn' && !confirm('Uygulama senin dışındaki herkese kapansın mı?')) return;
    const on = id === 'maintOff' ? false : true;
    const r = await window.dualChat.rpc('set_maintenance', { p_password: getAdmin(), p_on: on, p_message: $('#maintText').value, p_eta: $('#maintEtaIn').value });
    if (!r.ok) { $('#maintHint').textContent = 'Kaydedilemedi: ' + r.error; $('#maintHint').className = 'hint err'; return; }
    loadMaint();
  });

  // ---------- Başlangıç ----------
  applyLayout();
  applyModUi();
  // "Her zaman üstte" düğmesi kaldırıldı: önceden açık bırakıldıysa kapat
  if (state.pinned) { state.pinned = false; save(); window.dualChat.setAlwaysOnTop(false); }
  if (state.opacity < 100) { state.opacity = 100; save(); window.dualChat.setOpacity(1); }
  openChat('twitch');
  openChat('kick');
  if (!state.twitch && !state.kick) linkInput.focus();
})();
