// Sayfa yüklenmeden önce çalışır: sayfanın açtığı WebSocket adreslerini not eder.
// Kick chat'i için Kick'in kendi kullandığı chat sunucusu adresini bulmaya yarar (anahtar değişse de çalışsın).
// Bağlantıyı değiştirmez, sadece adresi kaydeder.
export const WS_SNIFF_JS = `
(function () {
  if (window.__penguWsUrls || !window.WebSocket) return;
  window.__penguWsUrls = [];
  var W = window.WebSocket;
  function P(u, p) {
    try { if (window.__penguWsUrls.length < 20) window.__penguWsUrls.push(String(u)); } catch (e) {}
    return p === undefined ? new W(u) : new W(u, p);
  }
  P.prototype = W.prototype;
  ['CONNECTING', 'OPEN', 'CLOSING', 'CLOSED'].forEach(function (k) { P[k] = W[k]; });
  window.WebSocket = P;
})();
true;
`;
