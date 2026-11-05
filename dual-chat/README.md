# 🐧 PenguChat — Twitch + Kick tek pencerede

Aynı anda Twitch ve Kick'te yayın yapan bir kanalın iki chat'ini **tek pencerede, yan yana** açan küçük bir masaüstü uygulaması.
Paneller platformların **resmi popout chat'leridir**. Hesabınla giriş yaptığında moderatör araçlarının hepsi (ban, timeout, mesaj silme, mod menüsü, /komutlar) normal şekilde çalışır.

## Özellikler
- Twitch ve Kick chat'i yan yana veya alt alta (⇆ / ⇅)
- **Yayın gecikmesi:** Üst çubukta "⏱ Kick'te 3 saniye gecikme var" gibi bir yazı sürekli güncellenir. İki platformun canlı yayın listesi yaklaşık saniyede bir okunur, son 20 saniyenin en iyi ölçümü karşılaştırılır (±0,5 sn). Video oynatmaz, çok az internet kullanır. Yazıya tıklayınca hemen yeniden ölçer.
- **Hızlı ceza çubuğu:** Chat'te bir kullanıcı adına tıkla, üstteki çubukta seçilir. **⏱ Timeout** (varsayılan 919824 sn) ya da **⛔ Ban** ile komut senin yerine gönderilir. Twitch / Kick düğmeleriyle hangi platformda (ya da ikisinde birden) uygulanacağını seç. Restream'in Kick'e aktardığı "[Twitch: kullanıcı]" mesajlarında gerçek kullanıcı seçilir. Kick süreyi dakika olarak alır, uygulama çevirir.
- Panellerin yerini değiştirme (⇄), istenen paneli gizleme (Twitch / Kick düğmeleri)
- Panel başına yazı boyutu (A− / A+)
- 📌 Her zaman üstte + pencere saydamlığı (oyun / OBS üstünde tutmak için)
- Girişler kalıcıdır. Uygulamayı kapatıp açınca tekrar giriş yapman gerekmez
- Kanal adları ve yerleşim hatırlanır
- `F5` / `Ctrl+R` ile iki chat'i birlikte yenileme
- **Otomatik güncelleme:** Yeni sürüm çıkınca uygulama arka planda indirir, üstte **⬆ Güncelle** düğmesi çıkar. Menüden (⋯) elle de kontrol edilebilir.

## Kullanım
1. Üstteki çubuğa yayının linkini yapıştır, ör. `https://www.twitch.tv/kanal` veya `https://kick.com/kanal`. Chat kendiliğinden doğru panelde açılır, Enter'a basman gerekmez.
   - Twitch ve Kick linkini aynı anda (boşlukla ayırarak) yapıştırırsan ikisi birlikte açılır.
   - Link yerine düz kanal adı yazıp Enter'a basarsan iki platformda da o ad açılır.
2. Chat'in içindeki **Giriş yap** düğmesiyle moderatör hesabına bir kez gir.

## Kurulum

### Windows
**https://github.com/Hasantunaozdmr/Canzade-ToastyStat/releases/latest/download/PenguChat-Setup.exe** dosyasını indir ve kur.
Sonraki sürümler uygulamanın içindeki **⬆ Güncelle** düğmesiyle gelir.

### Kaynaktan çalıştırma
[Node.js](https://nodejs.org) (18+) kurulu olmalı.
```bash
cd dual-chat
npm install
npm start
```
Kendin .exe üretmek için: `npm run dist:win` (çıktı `dual-chat/dist/` klasörüne düşer).
