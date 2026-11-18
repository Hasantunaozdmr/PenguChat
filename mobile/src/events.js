// 🔔 Etkinlikler: abone, hediye abone, bit, Kicks, bağış, takip, baskın.
// PC ve telefon uygulaması aynı dosyayı kullanır (mobile/src/events.js'e aynen kopyalanır).
// - Twitch / Kick etkinlikleri chat sayfasından gelir (pick-user.js → "__PENGU_EVENT__").
// - Bağışlar ve Twitch takipleri chat'te görünmez: istenirse Streamlabs "Socket API Token" ile alınır.
//   Token sadece bu cihazda saklanır; bağlantı doğrudan Streamlabs'e yapılır.
(function (root) {
  const ICON = { sub: '⭐', gift: '🎁', giftbomb: '🎁', bits: '💎', kicks: '🟩', donation: '💰', follow: '❤️', raid: '🚀' };

  function tierText(t) {
    if (!t) return '';
    return t === 'Prime' ? ' (Prime)' : t === '1' ? '' : ` (Tier ${t})`;
  }

  // Bir etkinliği tek satırlık Türkçe yazıya çevirir
  function describe(e) {
    switch (e.type) {
      case 'sub':
        if (e.upgrade) return `aboneliğini devam ettirdi${tierText(e.tier)}`;
        return e.months > 1 ? `${e.months}. ay abone oldu${tierText(e.tier)}` : `abone oldu${tierText(e.tier)}`;
      case 'gift':
        return e.to ? `${e.to} kişisine abonelik hediye etti${tierText(e.tier)}` : `abonelik hediye etti${tierText(e.tier)}`;
      case 'giftbomb':
        return `${e.count} abonelik hediye etti${tierText(e.tier)}`;
      case 'bits':
        return `${e.amount} bit gönderdi`;
      case 'kicks':
        return `${e.amount} Kicks gönderdi${e.gift ? ` (${e.gift})` : ''}`;
      case 'donation':
        return `${e.amountText || e.amount} bağış yaptı`;
      case 'follow':
        return 'takip etti';
      case 'raid':
        return e.p === 'kick' ? `host etti${e.count ? ` (${e.count} izleyici)` : ''}` : `baskın yaptı${e.count ? ` (${e.count} izleyici)` : ''}`;
      default:
        return '';
    }
  }

  // ---- Streamlabs (bağış + Twitch takip) ----
  // socket.io / engine.io v3 protokolünün ihtiyacımız kadarı (ek kütüphane yok)
  function connectStreamlabs(token, onEvent, onState) {
    let ws = null, ping = null, retry = null, closed = false, wait = 3000;
    const set = (s) => { try { onState && onState(s); } catch {} };
    function handle(payload) {
      const ev = payload && payload[1];
      if (!ev || payload[0] !== 'event' || !Array.isArray(ev.message)) return;
      const src = String(ev.for || '');
      for (const m of ev.message) {
        const id = 'sl:' + (ev.event_id || '') + ':' + (m._id || m.id || m.name || '');
        if (ev.type === 'donation') {
          onEvent({ p: 'streamlabs', id, type: 'donation', user: m.name || m.from || 'Anonim', amount: Number(m.amount) || 0, amountText: m.formatted_amount || (m.amount + ' ' + (m.currency || '')), msg: m.message || '' });
        } else if (ev.type === 'follow' && /twitch|kick/.test(src)) {
          // Twitch takipleri chat'te görünmez; Kick'tekiler chat'ten de gelebilir (aynısını iki kez göstermemek için ad + dakika ile ayırt edilir)
          onEvent({ p: /kick/.test(src) ? 'kick' : 'twitch', id: 'follow:' + String(m.name || '').toLowerCase(), type: 'follow', user: m.name || '' });
        }
      }
    }
    function open() {
      if (closed) return;
      set('connecting');
      try {
        ws = new WebSocket('wss://sockets.streamlabs.com/socket.io/?EIO=3&transport=websocket&token=' + encodeURIComponent(token));
      } catch { return later(); }
      ws.onmessage = (e) => {
        const d = String(e.data);
        if (d[0] === '0') {
          let iv = 25000;
          try { iv = JSON.parse(d.slice(1)).pingInterval || iv; } catch {}
          clearInterval(ping);
          ping = setInterval(() => { try { ws.send('2'); } catch {} }, iv);
        } else if (d === '40') { wait = 3000; set('ok'); }
        else if (d.startsWith('42')) { try { handle(JSON.parse(d.slice(2))); } catch {} }
        else if (d.startsWith('44')) { set('bad'); closed = true; try { ws.close(); } catch {} }
        else if (d === '2') { try { ws.send('3'); } catch {} }
      };
      ws.onclose = () => { clearInterval(ping); if (!closed) later(); };
      ws.onerror = () => {};
    }
    function later() {
      set('retry');
      clearTimeout(retry);
      retry = setTimeout(open, wait);
      wait = Math.min(wait * 2, 60000);
    }
    open();
    return () => { closed = true; clearInterval(ping); clearTimeout(retry); try { ws && ws.close(); } catch {} set('off'); };
  }

  // Aynı etkinlik iki kez gelirse (ör. iki kaynaktan) bir kez göster
  function makeStore(max = 100) {
    let list = [];
    const seen = new Map();
    return {
      add(e) {
        if (!e || !e.type || !e.user) return false;
        const key = e.id || e.p + e.type + e.user;
        const now = Date.now();
        if (seen.has(key) && now - seen.get(key) < 10 * 60 * 1000) return false;
        seen.set(key, now);
        if (seen.size > 500) seen.delete(seen.keys().next().value);
        list = [{ ...e, at: e.at || now }, ...list].slice(0, max);
        return true;
      },
      load(arr) { if (Array.isArray(arr)) { list = arr.slice(0, max); list.forEach((e) => seen.set(e.id || e.p + e.type + e.user, e.at || 0)); } },
      clear() { list = []; },
      get list() { return list; },
    };
  }

  const api = { ICON, describe, connectStreamlabs, makeStore };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PenguEvents = api;
})(typeof window !== 'undefined' ? window : globalThis);
