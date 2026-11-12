// 🎨 Renk teması: seçilen tek bir renkten bütün arayüz renkleri üretilir.
// Yazılar beyaz kaldığı için açıklık sabit tutulur; sadece rengin tonu ve canlılığı alınır.
// Çok koyu bir renk seçilirse (siyah gibi) koyu tema kullanılır.
(function (root) {
  const DEFAULT = '#0e8f8a';
  const TURKUAZ = { bg: '#0a6b67', panel: '#0e8f8a', panel2: '#0b7c77', input: '#075a56', hover: '#13a39d', border: '#23bdb5', muted: '#c9f3ef' };
  const PRESETS = [
    ['Turkuaz', '#0e8f8a'], ['Mavi', '#1e6fd9'], ['Lacivert', '#1e3a8a'], ['Mor', '#7c3aed'], ['Pembe', '#db2777'],
    ['Kırmızı', '#dc2626'], ['Turuncu', '#ea580c'], ['Hardal', '#ca8a04'], ['Yeşil', '#16a34a'], ['Zümrüt', '#059669'],
    ['Kahve', '#92400e'], ['Gri', '#6b7280'], ['Gece', '#1f2937'], ['Siyah', '#111111'],
  ];
  function hexToHsl(hex) {
    const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
    if (!m) return null;
    const n = parseInt(m[1], 16);
    const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
    const max = Math.max(r, g, b), min = Math.min(r, g, b), l = (max + min) / 2;
    let h = 0, s = 0;
    if (max !== min) {
      const d = max - min;
      s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
      h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
      h *= 60;
    }
    return [h, s, l];
  }
  function hsl(h, s, l) {
    s = Math.max(0, Math.min(1, s)); l = Math.max(0, Math.min(1, l));
    const k = (n) => (n + h / 30) % 12, a = s * Math.min(l, 1 - l);
    const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
    return '#' + [f(0), f(8), f(4)].map((x) => Math.round(x * 255).toString(16).padStart(2, '0')).join('');
  }
  function themeFrom(hex) {
    if (!hex || String(hex).toLowerCase() === DEFAULT) return { ...TURKUAZ };
    const v = hexToHsl(hex);
    if (!v) return { ...TURKUAZ };
    const [h, s0, l0] = v;
    const s = Math.min(s0, 0.85);
    const dark = l0 < 0.16; // siyah / çok koyu renk: koyu tema
    const L = dark ? { bg: 0.07, panel: 0.13, panel2: 0.1, input: 0.05, hover: 0.18, border: 0.28 } : { bg: 0.23, panel: 0.31, panel2: 0.27, input: 0.19, hover: 0.36, border: 0.47 };
    return {
      bg: hsl(h, s, L.bg), panel: hsl(h, s, L.panel), panel2: hsl(h, s, L.panel2), input: hsl(h, s, L.input),
      hover: hsl(h, s, L.hover), border: hsl(h, s * 0.85, L.border), muted: hsl(h, Math.min(0.6, s * 0.7), 0.86),
    };
  }
  const api = { DEFAULT, PRESETS, themeFrom };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  root.PenguTheme = api;
})(typeof window !== 'undefined' ? window : globalThis);
