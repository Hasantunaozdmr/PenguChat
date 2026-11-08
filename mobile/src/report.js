// Sorun bildir — Supabase ayarları (desktop/src/main.js içindeki REPORT_API ile aynı olmalı).
// Anahtar herkese açık "anon" anahtarı; gelen sorunlar yalnızca yönetici şifresiyle okunabilir.
export const REPORT_API = {
  url: 'SUPABASE_URL_BURAYA',
  key: 'SUPABASE_ANON_KEY_BURAYA',
};

export async function reportRpc(fn, args) {
  if (!/^https?:\/\//.test(REPORT_API.url)) throw new Error('Sorun bildirme henüz ayarlanmadı');
  let res;
  try {
    res = await fetch(`${REPORT_API.url}/rest/v1/rpc/${fn}`, {
      method: 'POST',
      headers: {
        apikey: REPORT_API.key,
        Authorization: `Bearer ${REPORT_API.key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(args),
    });
  } catch {
    throw new Error('İnternet bağlantısı yok');
  }
  const text = await res.text();
  if (!res.ok) {
    if (/yetkisiz/.test(text)) throw new Error('Şifre yanlış');
    throw new Error(`Sunucu hatası (${res.status})`);
  }
  return text ? JSON.parse(text) : null;
}
