# Dual Chat Mobile — Twitch + Kick (Android & iPhone)

Masaüstü Dual Chat'in telefon sürümü. Twitch ve Kick'in resmi chat sayfalarını tek ekranda açar. Moderatör hesabınla giriş yaptığında ban, timeout, mesaj silme ve /komutlar normal çalışır. Girişler kalıcıdır.

## Özellikler
- **Link çubuğu:** Twitch veya Kick linkini yapıştırınca chat kendiliğinden doğru panelde açılır. **Yapıştır** düğmesi panodaki linki tek dokunuşla açar.
  - Düz kanal adı yazıp Git'e basarsan iki platformda da o ad açılır.
- **İki görünüm** (sağ üstteki düğme):
  - **⇆ Bölünmüş:** Dik tutunca chat'ler alt alta, yan çevirince yan yana durur.
  - **▤ Sekmeli:** Her chat tam ekran açılır, üstteki Twitch | Kick sekmeleriyle geçilir. Diğer chat arka planda açık kalır.
- Panel başına yazı boyutu (A− / A+).
- Chat'teki dış linkler telefonun tarayıcısında açılır.
- **Güncelleme (Android):** Yeni sürüm çıkınca üstte yeşil **⬆ Yeni sürüm var** çubuğu görünür, dokununca yeni APK iner, açıp **Güncelle** dersin. Girişler silinmez.

## İlk kullanım
1. Üstteki çubuğa yayın linkini yapıştır.
2. Her panelde bir kez **Giriş**'e bas, hesabınla giriş yap, sonra **⟳** ile chat'e dön.
   > Twitch'e **Google ile giriş** uygulama içinde çalışmaz (Google bunu engelliyor). Kullanıcı adı ve şifreyle giriş yap.

## Kurulum

### Android
GitHub'da **Actions → "Dual Chat Mobile - Android APK / iOS IPA" → son çalışma → Artifacts → DualChat-Android-APK** yolunu izle ve indir.
Zip'in içindeki `DualChat.apk` dosyasını telefona at ve aç. Telefon "bilinmeyen kaynaklardan uygulama yükleme" izni isterse ver.

### iPhone
Apple, App Store dışından uygulama kurmayı zorlaştırıyor. Üç yol var:

1. **Expo Go ile (en kolay, ücretsiz):** App Store'dan **Expo Go** uygulamasını kur. Bilgisayarda:
   ```bash
   cd dual-chat-mobile
   npm install
   npx expo start --tunnel
   ```
   Ekranda çıkan QR kodu iPhone kamerasıyla okut. Uygulama bilgisayar açıkken çalışır.
2. **Sideloadly / AltStore ile (ücretsiz Apple hesabı):** Actions'tan **DualChat-iOS-IPA-unsigned** dosyasını indir, bir Windows/Mac bilgisayarda Sideloadly ile kendi Apple hesabınla iPhone'a kur. Ücretsiz hesapta uygulamanın 7 günde bir yeniden imzalanması gerekir.
3. **Apple Geliştirici hesabı (yıllık 99 $):** `npx eas-cli build -p ios` ile imzalı sürüm üretilip TestFlight'tan kalıcı olarak kurulur.

## Geliştirme
```bash
npm install
npx expo start          # Expo Go ile telefonda dene
npx expo run:android    # Android Studio / bağlı telefon gerekir
```
