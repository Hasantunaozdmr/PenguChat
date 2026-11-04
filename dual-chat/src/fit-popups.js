// Chat sayfalarına enjekte edilir: kullanıcı kartı gibi açılır pencereler dar panelde
// kenardan taşarsa onları panelin içine kaydırır (gerekirse daraltır).
// Twitch / Kick sayfa yapısına bağlı değildir: taşan "fixed/absolute" kutuları bulur.
(() => {
  if (window.__dualChatFit) return;
  window.__dualChatFit = true;
  const M = 4; // kenar boşluğu (px)

  function fit() {
    if (!document.body) return;
    const W = document.documentElement.clientWidth || window.innerWidth;
    const H = document.documentElement.clientHeight || window.innerHeight;
    const handled = [];
    const all = document.body.getElementsByTagName('*');
    for (let i = 0; i < all.length; i++) {
      const el = all[i];
      const r = el.getBoundingClientRect();
      if (r.width < 160 || r.height < 100) continue;
      // Tamamen ekran dışındaki (bilerek gizlenmiş) öğelere dokunma
      if (r.right <= 0 || r.left >= W || r.bottom <= 0 || r.top >= H) continue;
      const overX = r.left < -1 || r.right > W + 1;
      const overY = r.top >= 0 && r.bottom > H + 1 && r.height <= H;
      if (!overX && !overY) continue;
      if (handled.some((h) => h.contains(el))) continue;
      const cs = getComputedStyle(el);
      if (cs.position !== 'fixed' && cs.position !== 'absolute') continue;
      if (cs.visibility === 'hidden' || cs.opacity === '0') continue;

      if (r.width > W - 2 * M) {
        el.style.boxSizing = 'border-box';
        el.style.maxWidth = W - 2 * M + 'px';
      }
      const r2 = el.getBoundingClientRect();
      let dx = 0;
      let dy = 0;
      if (r2.left < M) dx = M - r2.left;
      else if (r2.right > W - M) dx = Math.max(M - r2.left, W - M - r2.right);
      if (r2.bottom > H - M && r2.height <= H) dy = Math.max(M - r2.top, H - M - r2.bottom);
      if (dx || dy) {
        const prev = (el.style.translate || '0px 0px').split(' ').map(parseFloat);
        el.style.translate = `${(prev[0] || 0) + dx}px ${(prev[1] || 0) + dy}px`;
      }
      handled.push(el);
    }
  }

  // Kartlar bir tıklamadan sonra açılır: birkaç kez kontrol et (animasyonlar için)
  let timers = [];
  function schedule() {
    timers.forEach(clearTimeout);
    timers = [30, 150, 400, 900, 1800].map((t) => setTimeout(fit, t));
  }
  document.addEventListener('click', schedule, true);
  window.addEventListener('resize', schedule);
})();
