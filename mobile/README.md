# 🐧 PenguChat Mobile — Twitch + Kick (Android & iPhone)

Masaüstü PenguChat'in telefon sürümü. Twitch ve Kick'in resmi chat sayfalarını tek ekranda açar. Moderatör hesabınla giriş yaptığında ban, timeout, mesaj silme ve /komutlar normal çalışır. Girişler kalıcıdır.

## Özellikler
- **Link çubuğu:** Twitch veya Kick linkini yapıştırınca chat kendiliğinden doğru panelde açılır. **Yapıştır** düğmesi panodaki linki tek dokunuşla açar.
  - Düz kanal adı yazıp Git'e basarsan iki platformda da o ad açılır.
- **İki görünüm** (sağ üstteki düğme):
  - **⇆ Bölünmüş:** Dik tutunca chat'ler alt alta, yan çevirince yan yana durur.
  - **▤ Sekmeli:** Her chat tam ekran açılır, üstteki Twitch | Kick sekmeleriyle geçilir. Diğer chat arka planda açık kalır.
- Panel başına yazı boyutu (A− / A+).
- **Hızlı ceza çubuğu (👤):** Chat'te bir ada dokun, üstte çubuk açılır. **⏱ Timeout** (varsayılan 919824 sn) ya da **⛔ Ban** komutu seçtiğin platform(lar)a gönderilir. Restream mesajlarında gerçek Twitch kullanıcısı seçilir. Sadece moderatör olduğun kanallarda görünür; normal izleyicide gizlidir.
- Chat'teki dış linkler telefonun tarayıcısında açılır.
- **Güncelleme (Android):** Yeni sürüm çıkınca üstte yeşil **⬆ Yeni sürüm var** çubuğu görünür, dokununca yeni APK iner, açıp **Güncelle** dersin. Girişler silinmez.

## İlk kullanım
1. Üstteki çubuğa yayın linkini yapıştır.
2. Chat'in içindeki **Giriş yap** düğmesiyle hesabına bir kez gir.
   > Twitch'e **Google ile giriş** uygulama içinde çalışmaz (Google bunu engelliyor). Kullanıcı adı ve şifreyle giriş yap.

## Kurulum

### Android
**https://github.com/Hasantunaozdmr/PenguChat/releases/latest/download/PenguChat.apk** dosyasını telefona indir ve aç. Telefon "bilinmeyen kaynaklardan uygulama yükleme" izni isterse ver.

### iPhone
Hazır bir iPhone sürümü yok; Apple, App Store dışından uygulama kurmayı zorlaştırıyor. İki yol var:

1. **Expo Go ile (en kolay, ücretsiz):** App Store'dan **Expo Go** uygulamasını kur. Bilgisayarda:
   ```bash
   cd mobile
   npm install
   npx expo start --tunnel
   ```
   Ekranda çıkan QR kodu iPhone kamerasıyla okut. Uygulama bilgisayar açıkken çalışır.
2. **Apple Geliştirici hesabı (yıllık 99 $):** `npx eas-cli build -p ios` ile imzalı sürüm üretilip TestFlight'tan kalıcı olarak kurulur.

## Geliştirme
```bash
npm install
npx expo start          # Expo Go ile telefonda dene
npx expo run:android    # Android Studio / bağlı telefon gerekir
```
