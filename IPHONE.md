# 🍏 PengusChat — iPhone sürümü için not

Merhaba! Bu not, PengusChat'in iPhone sürümünü hazırlayacak kişi (ve onun Claude'u) için.

## Kısaca durum

- PengusChat; Twitch ve Kick chat'ini tek ekranda gösteren, modlara hızlı timeout/ban, gecikme, izleyici sayısı, sorun bildirme, yetki ve bakım modu sunan bir uygulama.
- **Windows** (`desktop/`, Electron) ve **Android** (`mobile/`, Expo / React Native) sürümleri hazır ve kullanılıyor.
- **iPhone sürümü yok.** Ama telefon uygulaması Expo ile yazıldığı için kodun büyük kısmı iPhone'da da çalışır; asıl iş derleyip dağıtmak.

## Neler gerekiyor

1. **Mac** (Xcode kurulu). iPhone uygulaması sadece Mac'te derlenir.
2. **Apple Developer hesabı (yıllık 99 $)** — arkadaşlara dağıtmak için **TestFlight** gerekiyor (100'e kadar kişiye link ile).
   - Ücretsiz Apple hesabıyla da olur ama sadece kabloyla bağlı telefona kurulur ve 7 günde bir yeniden kurmak gerekir.
3. **App Store'a koymak önerilmez:** Apple, başka sitelerin sayfalarını (Twitch/Kick chat) içinde gösteren uygulamaları reddedebilir. Arkadaş grubu için TestFlight yeterli.

## Değişmemesi gerekenler

- `mobile/app.json` → `ios.bundleIdentifier: com.dualchat.mobile` (Android ile aynı kimlik ailesi; değiştirmeyin).
- Sunucu (Supabase) ayarları `mobile/src/report.js` içinde; anahtar herkese açık "publishable" anahtar, değiştirmeye gerek yok. Sorun bildirme, yetkiler, bakım modu, mod log, istatistik iPhone'da da aynen çalışır.
- `mobile/src/injected.js` otomatik üretilir: `desktop/src/pick-user.js` veya `fit-popups.js` değişirse `cd mobile && npm run sync-injected`.

## Claude için teknik notlar

- Proje: `mobile/` — Expo SDK 58, React Native 0.88, `react-native-webview`. Giriş noktası `mobile/App.js`.
- Derleme için iki yol:
  - **Mac'te yerel:** `cd mobile && npm ci && npx expo prebuild --platform ios && npx pod-install`, sonra `ios/*.xcworkspace` Xcode'da açılıp imzalanır ve Archive → TestFlight'a yüklenir.
  - **EAS (Expo bulutu):** `npx eas build --platform ios` + `npx eas submit --platform ios` (Expo hesabı + Apple hesabı ister).
- iPhone'a özel dikkat edilecekler:
  - `App.js` içindeki "Yeni sürüm var" kontrolü (latest.yml + APK indirme) **sadece Android'de** çalışıyor (`Platform.OS !== 'android'` kontrolü var). iPhone'da güncellemeler TestFlight'tan gelir; bu kısma dokunmaya gerek yok.
  - WebView'de `sharedCookiesEnabled` açık (Twitch/Kick girişlerinin kalıcı olması için). iOS'ta giriş sayfaları (özellikle Twitch "Giriş yap") ve Kick'in Cloudflare doğrulaması test edilmeli.
  - Masaüstü sitesini açmak için iOS'ta Safari kullanıcı kimliği (`USER_AGENT`) kullanılıyor.
  - Chat'ler telefonda "sadece okunur": `pick-user.js` içindeki `__penguReadOnly` mesaj kutusunu ekran dışına taşır (giriş yapılmamışsa dokunmaz). Hızlı timeout/ban bu gizli kutuyu kullanır; iPhone'da da çalıştığı kontrol edilmeli.
  - Uygulama kimliği/klasör adı değişmesin; `Platform.OS` sorun bildirmede ve istatistikte zaten "ios" olarak gönderiliyor.
- Kontrol listesi (gerçek iPhone'da):
  1. Twitch ve Kick'e chat içinden giriş yapılabiliyor mu, kapatıp açınca giriş kalıyor mu?
  2. Kanal adı yazınca iki chat açılıyor mu, başlıkta 👁 izleyici sayısı çıkıyor mu?
  3. Mod hesabında 👤 ile çubuk açılıyor mu, kullanıcı adına dokununca adı geliyor mu, timeout iki platforma da gidiyor mu?
  4. ⋯ menüsü: Sorun bildir, (yetkiliyse) Gelen sorunlar, görünüm değiştirme.
  5. Mesaj kutusu gizli mi, chat'in altında boşluk kalıyor mu?

Sorular için projenin sahibine (Hasan) yazabilirsiniz. 🐧
